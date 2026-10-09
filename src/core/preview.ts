import type { DocumentChange } from '../documents';
import type { Operation } from './xml';
import { escapeXml } from './xml';
import { validateTranslation } from './translation';

export const previewRowId = (uri: string, op: Operation) => JSON.stringify([uri, op.key, op.kind === 'set' ? op.field : 'value']);

// Validate the entire selected set before the document layer applies any edit.
export function editedPreview(changes: DocumentChange[], selection?: string[], edits?: unknown, translation = false): DocumentChange[] {
    if (edits !== undefined && (!edits || typeof edits !== 'object' || Array.isArray(edits))) throw new Error('Invalid preview edits.');
    const replacements = (edits ?? {}) as Record<string, unknown>;
    const known = new Set(changes.flatMap(change => change.operations.map(op => previewRowId(change.uri, op))));
    if (Object.keys(replacements).some(id => !known.has(id)) || selection?.some(id => !known.has(id))) throw new Error('Unknown preview row. Generate a new preview.');
    return changes.map(change => ({ ...change, operations: change.operations.filter(op => !selection || selection.includes(previewRowId(change.uri, op))).map(op => {
        const id = previewRowId(change.uri, op);
        if (!Object.hasOwn(replacements, id)) return op;
        const value = replacements[id];
        if (typeof value !== 'string' || (op.kind !== 'set' && op.kind !== 'add')) throw new Error(`Invalid edited value for ${op.key}.`);
        try {
            escapeXml(value);
            if (translation) validateTranslation(op.value ?? '', value);
        } catch (error) { throw new Error(`${op.key}: ${String(error)}`); }
        return { ...op, value };
    }) })).filter(change => change.operations.length);
}
