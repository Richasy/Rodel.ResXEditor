import * as vscode from 'vscode';
import * as path from 'node:path';
import { canonicalLanguage, identify, sameGroup } from './core/discovery';
import { applyOperations, minimalPatch, Operation, parseResource } from './core/xml';

export interface LanguageDocument { language: string; document: vscode.TextDocument }
export interface DocumentChange { uri: string; version: number; operations: Operation[] }

/** All mutations pass through one queue, including edits from separate views. */
export class Documents {
    private tail: Promise<unknown> = Promise.resolve();

    async discover(document: vscode.TextDocument): Promise<LanguageDocument[]> {
        const identity = identify(document.uri.fsPath);
        const parent = vscode.Uri.file(identity.directory);
        const files = identity.kind === 'resw'
            ? await vscode.workspace.findFiles(new vscode.RelativePattern(parent, `{*.resw,*/${identity.name}.resw}`), null, 500)
            : await vscode.workspace.findFiles(new vscode.RelativePattern(parent, '*.resx'), null, 500);
        const uris = [document.uri, ...files].filter((uri, index, all) => all.findIndex(u => u.toString() === uri.toString()) === index && sameGroup(document.uri.fsPath, uri.fsPath));
        const result = await Promise.all(uris.map(async uri => ({ language: identify(uri.fsPath).language, document: await vscode.workspace.openTextDocument(uri) })));
        const languages = new Set<string>();
        for (const item of result) {
            if (languages.has(item.language)) { throw new Error(`Ambiguous language ${item.language}: multiple files belong to this resource mapping.`); }
            languages.add(item.language);
        }
        return result.sort((a, b) => a.language.localeCompare(b.language));
    }

    apply(changes: DocumentChange[]): Promise<boolean> {
        const task = this.tail.then(async () => {
            const unique = new Set(changes.map(c => c.uri));
            if (unique.size !== changes.length) { throw new Error('Batch contains duplicate document targets.'); }
            const prepared = await Promise.all(changes.map(async change => {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(change.uri));
                if (doc.version !== change.version) { throw new Error('Resource changed since this edit or preview. Refresh and review the new version.'); }
                const before = doc.getText();
                const after = applyOperations(before, change.operations);
                return { doc, version: doc.version, patch: minimalPatch(before, after) };
            }));
            // No await between this second version check and applyEdit.
            const edit = new vscode.WorkspaceEdit();
            for (const item of prepared) {
                if (item.doc.version !== item.version) { throw new Error('Resource changed while preparing the edit. Please retry.'); }
                if (item.patch) { edit.replace(item.doc.uri, new vscode.Range(item.doc.positionAt(item.patch.start), item.doc.positionAt(item.patch.end)), item.patch.text); }
            }
            if (!edit.size) { return true; }
            if (!await vscode.workspace.applyEdit(edit, { isRefactoring: false })) { throw new Error('VS Code could not apply the edit. No files were saved.'); }
            return true;
        });
        this.tail = task.catch(() => undefined);
        return task;
    }
}

export async function projectLanguage(uri: vscode.Uri): Promise<string> {
    const config = vscode.workspace.getConfiguration('rodelResx', uri);
    const explicit = config.get<string>('defaultLanguage', '');
    if (explicit) { return canonicalLanguage(explicit); }
    if (config.get<string>('projectAdapter') === 'none' || uri.scheme !== 'file') { return ''; }
    let dir = path.dirname(uri.fsPath);
    const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
    while (folder && (dir === folder || dir.startsWith(folder + path.sep))) {
        const projects = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '*.csproj'), null, 20);
        const defaults = new Set<string>();
        for (const project of projects) {
            const text = (await vscode.workspace.openTextDocument(project)).getText();
            if (/Sprout(?:[.<"\s])/.test(text)) {
                const language = /<SproutDefaultLanguage>\s*([^<]+)\s*<\/SproutDefaultLanguage>/.exec(text)?.[1]?.trim();
                if (language && !language.includes('$(')) { defaults.add(language); }
            }
        }
        if (defaults.size === 1) { return canonicalLanguage([...defaults][0]); }
        if (projects.length) { return ''; }
        dir = path.dirname(dir);
    }
    return '';
}

export function snapshot(item: LanguageDocument) {
    const document = item.document;
    try {
        const parsed = parseResource(document.getText());
        return { language: item.language, uri: document.uri.toString(), version: document.version, dirty: document.isDirty, error: parsed.duplicates.length ? `Duplicate keys: ${parsed.duplicates.join(', ')}` : '', entries: parsed.entries.map(e => ({ key: e.key, value: e.value, comment: e.comment, readonly: e.readonly, reason: e.reason })) };
    } catch (error) { return { language: item.language, uri: document.uri.toString(), version: document.version, dirty: document.isDirty, error: String(error), entries: [] }; }
}
