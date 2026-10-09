import { SaxesParser } from 'saxes';

export interface Span { start: number; end: number }
interface Element extends Span { name: string; openEnd: number; closeStart: number; attributes: Record<string, { value: string; span: Span }>; children: Element[]; selfClosing: boolean }
export interface Entry { key: string; value: string; comment: string; readonly: boolean; reason?: string; node: Element; valueNode?: Element; commentNode?: Element }
export interface Resource { text: string; entries: Entry[]; duplicates: string[]; root: Element; eol: string; indent: string }
export type Operation = { kind: 'set'; key: string; field: 'value' | 'comment'; value: string } | { kind: 'add'; key: string; value?: string; comment?: string } | { kind: 'rename'; key: string; newKey: string } | { kind: 'delete'; key: string };
export interface Patch extends Span { text: string }

export function escapeXml(value: string, attribute = false): string {
    // XML 1.0 cannot encode these controls, including via character references.
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) { throw new Error('Text contains characters forbidden by XML 1.0.'); }
    let result = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
    if (attribute) { result = result.replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;'); }
    return result;
}

function decode(value: string): string {
    let result = '';
    const parser = new SaxesParser();
    parser.on('text', text => { result += text; });
    parser.on('cdata', text => { result += text; });
    parser.write(`<v>${value}</v>`).close();
    return result;
}

export function parseResource(text: string): Resource {
    if (/^(?:<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)(?: |$)/m.test(text)) { throw new Error('Merge conflict markers found. Resolve the conflict in XML before editing.'); }
    const validator = new SaxesParser();
    validator.on('doctype', () => { throw new Error('DTD declarations are not supported for safe resource editing.'); });
    validator.write(text).close();
    const roots: Element[] = [];
    const stack: Element[] = [];
    // Validation above guarantees well-formed XML; this scanner only records original ranges.
    const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/(?:[^>]+)>|<(?:"[^"]*"|'[^']*'|[^'">])*>/g;
    for (const token of text.matchAll(tokens)) {
        const raw = token[0];
        const start = token.index!;
        if (raw.startsWith('<?') || raw.startsWith('<!')) { continue; }
        if (raw.startsWith('</')) {
            const node = stack.pop()!;
            node.closeStart = start;
            node.end = start + raw.length;
            continue;
        }
        const name = /^<([^\s/>]+)/.exec(raw)![1];
        const attributes: Element['attributes'] = {};
        for (const attr of raw.matchAll(/([^\s=<>]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
            const valueStart = start + attr.index! + attr[0].indexOf(attr[2]) + 1;
            // Attribute whitespace normalization matches XML 1.0.
            attributes[attr[1]] = { value: decode(attr[3].replace(/[\r\n\t]/g, ' ')), span: { start: valueStart, end: valueStart + attr[3].length } };
        }
        const selfClosing = /\/\s*>$/.test(raw);
        const node: Element = { name, start, openEnd: start + raw.length, end: start + raw.length, closeStart: start + raw.length, attributes, children: [], selfClosing };
        (stack.length ? stack[stack.length - 1].children : roots).push(node);
        if (!selfClosing) { stack.push(node); }
    }
    const root = roots[0];
    if (!root || root.name !== 'root' || root.selfClosing) { throw new Error('Expected a <root>...</root> resource document.'); }
    const entries = root.children.filter(n => n.name === 'data').map(node => {
        const values = node.children.filter(n => n.name === 'value');
        const comments = node.children.filter(n => n.name === 'comment');
        const valueNode = values[0];
        const commentNode = comments[0];
        const content = (n?: Element) => n && !n.selfClosing ? text.slice(n.openEnd, n.closeStart) : '';
        const type = node.attributes.type?.value;
        const typed = !!node.attributes.mimetype || (!!type && !/^System\.String(?:\s*,|$)/.test(type));
        const complex = values.length !== 1 || comments.length > 1 || !!valueNode?.children.length || !!commentNode?.children.length || node.children.some(n => !['value', 'comment'].includes(n.name)) || /<!--|<\?/.test(content(valueNode) + content(commentNode));
        if (!node.attributes.name) { throw new Error('A data node is missing its name attribute.'); }
        return { key: node.attributes.name.value, value: complex ? content(valueNode) : decode(content(valueNode)), comment: complex ? content(commentNode) : decode(content(commentNode)), readonly: typed || complex, reason: typed ? `Unsupported resource type: ${type ?? node.attributes.mimetype.value}` : complex ? 'Complex or ambiguous XML content' : undefined, node, valueNode, commentNode };
    });
    const seen = new Set<string>();
    const duplicates = entries.filter(e => seen.has(e.key) || !seen.add(e.key)).map(e => e.key);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const indent = /(?:\r?\n)([\t ]+)<data\b/.exec(text)?.[1] ?? /(?:\r?\n)([\t ]+)</.exec(text)?.[1] ?? '  ';
    return { text, root, entries, duplicates, eol, indent };
}

export function planOperation(resource: Resource, op: Operation): Patch[] {
    const { text, root, entries, eol, indent } = resource;
    if (resource.duplicates.length) { throw new Error(`Duplicate keys: ${resource.duplicates.join(', ')}. Resolve in XML first.`); }
    if (!op.key.trim()) { throw new Error('Key cannot be empty.'); }
    escapeXml(op.key, true);
    const entry = entries.find(e => e.key === op.key);
    if (op.kind === 'add') {
        if (entry) { throw new Error(`Key already exists: ${op.key}`); }
        const node = `<data name="${escapeXml(op.key, true)}" xml:space="preserve">${eol}${indent}${indent}<value>${escapeXml(op.value ?? '')}</value>${op.comment ? `${eol}${indent}${indent}<comment>${escapeXml(op.comment)}</comment>` : ''}${eol}${indent}</data>`;
        const lineStart = text.lastIndexOf('\n', root.closeStart - 1) + 1;
        const ownLine = /^\s*$/.test(text.slice(lineStart, root.closeStart));
        const offset = ownLine ? lineStart : root.closeStart;
        return [{ start: offset, end: offset, text: `${ownLine ? '' : eol}${indent}${node}${eol}` }];
    }
    if (!entry) { throw new Error(`Key no longer exists: ${op.key}`); }
    if (entry.readonly) { throw new Error(`${op.key} is read-only: ${entry.reason}`); }
    if (op.kind === 'delete') { return [{ start: entry.node.start, end: entry.node.end, text: '' }]; }
    if (op.kind === 'rename') {
        if (!op.newKey.trim()) { throw new Error('Key cannot be empty.'); }
        if (entries.some(e => e.key === op.newKey && e !== entry)) { throw new Error(`Key already exists: ${op.newKey}`); }
        return [{ ...entry.node.attributes.name.span, text: escapeXml(op.newKey, true) }];
    }
    const child = op.field === 'value' ? entry.valueNode : entry.commentNode;
    const escaped = escapeXml(op.value);
    if (entry[op.field] === op.value) { return []; }
    if (!child) { return [{ start: entry.node.closeStart, end: entry.node.closeStart, text: `${eol}${indent}${indent}<comment>${escaped}</comment>${eol}${indent}` }]; }
    if (child.selfClosing) {
        const opening = text.slice(child.start, child.end).replace(/\/\s*>$/, '>');
        return [{ start: child.start, end: child.end, text: `${opening}${escaped}</${child.name}>` }];
    }
    const raw = text.slice(child.openEnd, child.closeStart);
    // Keep a simple CDATA representation if it is safe to do so.
    const replacement = /^<!\[CDATA\[[\s\S]*\]\]>$/.test(raw) && !op.value.includes(']]>') && !op.value.includes('\r') ? `<![CDATA[${op.value}]]>` : escaped;
    return [{ start: child.openEnd, end: child.closeStart, text: replacement }];
}

export function applyPatches(text: string, patches: Patch[]): string {
    for (const patch of [...patches].sort((a, b) => b.start - a.start)) { text = text.slice(0, patch.start) + patch.text + text.slice(patch.end); }
    return text;
}

export function applyOperations(text: string, operations: Operation[]): string {
    for (const op of operations) { text = applyPatches(text, planOperation(parseResource(text), op)); }
    parseResource(text); // Validate generated text as well (unpaired surrogates, etc.).
    return text;
}

/** One minimal common-prefix/suffix edit for an atomic batch; all unchanged bytes stay unchanged. */
export function minimalPatch(before: string, after: string): Patch | undefined {
    if (before === after) { return; }
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) { start++; }
    let end = before.length;
    let afterEnd = after.length;
    while (end > start && afterEnd > start && before[end - 1] === after[afterEnd - 1]) { end--; afterEnd--; }
    return { start, end, text: after.slice(start, afterEnd) };
}

export function newResource(): string {
    return '<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>\n  <resheader name="version"><value>2.0</value></resheader>\n  <resheader name="reader"><value>System.Resources.ResXResourceReader, System.Windows.Forms</value></resheader>\n  <resheader name="writer"><value>System.Resources.ResXResourceWriter, System.Windows.Forms</value></resheader>\n</root>\n';
}
