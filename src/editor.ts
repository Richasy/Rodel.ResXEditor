import * as vscode from 'vscode';
import { createHash, randomBytes } from 'node:crypto';
import { Documents, DocumentChange, LanguageDocument, projectLanguage, snapshot } from './documents';
import { Operation, parseResource } from './core/xml';
import { exportWorkbook, importWorkbook } from './excel';
import { translate } from './copilot';

interface Message { action: string; languageCount?: number; resourceCount?: number; requestId?: number; selection?: string[]; expectedValue?: string; uri?: string; version?: number; key?: string; value?: string; field?: 'value' | 'comment'; keys?: string[]; versions?: Record<string, number>; source?: string }
export class ResourceEditor implements vscode.CustomTextEditorProvider {
    static readonly viewType = 'rodel.resourceEditor';
    private active?: { panel: vscode.WebviewPanel; run: (message: Message) => Promise<void> };
    private readonly rendered = new Map<vscode.WebviewPanel, { uri: string; languageCount: number; resourceCount: number }>();
    diagnostics() { return [...this.rendered.values()]; }
    constructor(private readonly context: vscode.ExtensionContext, readonly documents = new Documents()) {}

    async command(action: string): Promise<void> {
        if (!this.active) { throw new Error('Open a resource in Rodel Resource Editor first.'); }
        await this.active.run({ action });
    }

    async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
        panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media'), vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
        panel.webview.html = this.html(panel.webview);
        let items: LanguageDocument[] = [];
        let source = '';
        let pending: DocumentChange[] | undefined;
        let pendingGuards: Record<string, number> = {};
        let disposed = false;
        let generation = 0;
        let runningLongAction = false;
        let pendingReveal: string[] | undefined;
        const diskBaselines = new Map<string, string>();
        const fingerprint = async (uri: vscode.Uri) => createHash('sha256').update(await vscode.workspace.fs.readFile(uri)).digest('hex');
        const diskConflict = async (item: LanguageDocument) => {
            if (!item.document.isDirty) { return false; }
            const base = diskBaselines.get(item.document.uri.toString());
            return !!base && base !== await fingerprint(item.document.uri);
        };
        const update = async () => {
            const current = ++generation;
            try {
                const discovered = await this.documents.discover(document);
                const explicit = await projectLanguage(document.uri);
                if (disposed || current !== generation) { return; }
                items = discovered;
                for (const item of items) { if (!item.document.isDirty) { diskBaselines.set(item.document.uri.toString(), await fingerprint(item.document.uri)); } }
                if (disposed || current !== generation) { return; }
                if (!items.some(i => i.language === source)) { source = items.find(i => i.language === explicit)?.language ?? (items.find(i => i.language === 'neutral')?.language ?? items[0].language); }
                const states = await Promise.all(items.map(async item => ({ ...snapshot(item), warning: await diskConflict(item) ? 'File changed on disk while you have unsaved edits. Open XML to compare and resolve the save conflict.' : '' })));
                if (disposed || current !== generation) { return; }
                const revealKeys = pendingReveal;
                await panel.webview.postMessage({ type: 'state', name: require('node:path').basename(document.uri.fsPath), items: states, source, revealKeys, showComments: vscode.workspace.getConfiguration('rodelResx', document.uri).get('showComments', true) });
                if (pendingReveal === revealKeys) pendingReveal = undefined;
            } catch (error) { await panel.webview.postMessage({ type: 'error', message: String(error), fatal: true }); }
        };
        const preview = async (changes: DocumentChange[] | undefined) => {
            if (!changes?.length) { return; }
            pending = changes;
            pendingGuards = Object.fromEntries(items.map(i => [i.document.uri.toString(), i.document.version]));
            await panel.webview.postMessage({ type: 'preview', rows: changes.flatMap((c, changeIndex) => {
                const item = items.find(i => i.document.uri.toString() === c.uri)!;
                const entries = parseResource(item.document.getText()).entries;
                return c.operations.map((op, opIndex) => ({ id: `${changeIndex}:${opIndex}`, language: item.language, key: op.key, field: op.kind === 'set' ? op.field : 'value', before: entries.find(e => e.key === op.key)?.[op.kind === 'set' ? op.field : 'value'] ?? '', after: op.kind === 'set' ? op.value : op.kind === 'add' ? op.value ?? '' : '', existing: !!entries.find(e => e.key === op.key)?.value }));
            }) });
        };
        const run = async (message: Message) => {
            const action = message.action;
            if (action === 'ready' || action === 'refresh') { await update(); return; }
            if (action === 'text') { await vscode.commands.executeCommand('vscode.openWith', message.uri ? vscode.Uri.parse(message.uri) : document.uri, 'default'); return; }
            if (action === 'source') { if (items.some(i => i.language === message.source)) { source = message.source!; await update(); } return; }
            if (action === 'comments') { await vscode.workspace.getConfiguration('rodelResx', document.uri).update('showComments', message.value === 'true', vscode.ConfigurationTarget.Global); return; }
            if (action === 'undo' || action === 'redo') { await vscode.commands.executeCommand(action); return; }
            if (action === 'save') {
                for (const item of items) { if (await diskConflict(item)) { throw new Error(`${item.language}: disk and unsaved edits conflict. Open XML, then Save to use VS Code's compare/overwrite choices.`); } }
                // VS Code owns file encoding, BOM, save conflicts and the dirty document lifecycle.
                for (const item of items) { if (item.document.isDirty && !await item.document.save()) { throw new Error(`Save failed for ${item.language}; use Open XML to resolve the conflict.`); } }
                await update(); return;
            }
            if (action === 'cancelPreview') { pending = undefined; return; }
            if (action === 'applyPreview') {
                if (pending) {
                    if (items.some(i => i.document.version !== pendingGuards[i.document.uri.toString()])) { throw new Error('Resources changed after preview. Discard it and generate a new preview.'); }
                    const selected = message.selection;
                    const changes = pending.map((c, index) => ({ ...c, operations: c.operations.filter((_, opIndex) => !selected || selected.includes(`${index}:${opIndex}`)) })).filter(c => c.operations.length);
                    await this.documents.apply(changes); pending = undefined; await panel.webview.postMessage({ type: 'previewClosed' });
                }
                return;
            }
            if (action === 'export' || action === 'import' || action === 'translate') {
                if (runningLongAction) { throw new Error('A resource import, export or translation is already running in this editor.'); }
                runningLongAction = true;
                try {
                    if (items.some(i => snapshot(i).error)) { throw new Error('Resolve invalid XML or duplicate keys before this action.'); }
                    if (action === 'export') {
                        const uri = await vscode.window.showSaveDialog({ filters: { Excel: ['xlsx'] }, defaultUri: vscode.Uri.joinPath(vscode.Uri.file(require('node:path').dirname(document.uri.fsPath)), 'Resources.xlsx') });
                        if (uri) { await vscode.workspace.fs.writeFile(uri, await exportWorkbook(items, source)); }
                    } else if (action === 'import') {
                        const uris = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Excel: ['xlsx'] } });
                        if (uris?.[0]) { await preview(await importWorkbook(await vscode.workspace.fs.readFile(uris[0]), items, source)); }
                    } else { await preview(await translate(items, source, message.keys?.length ? message.keys : undefined)); }
                } finally { runningLongAction = false; }
                return;
            }
            const changes: DocumentChange[] = [];
            if (action === 'addMany' || action === 'deleteMany') {
                const keys = message.keys;
                if (!Array.isArray(keys) || !keys.length || keys.length > 1000 || keys.some(k => typeof k !== 'string' || !k.trim()) || new Set(keys).size !== keys.length) { throw new Error('Provide 1–1,000 distinct, non-empty keys.'); }
                if (action === 'deleteMany' && await vscode.window.showWarningMessage(`Delete ${keys.length} resources from all languages?`, { modal: true }, 'Delete') !== 'Delete') { return; }
                for (const item of items) {
                    const resource = parseResource(item.document.getText());
                    const operations: Operation[] = keys.filter(key => action === 'addMany' || resource.entries.some(e => e.key === key)).map(key => action === 'addMany' ? { kind: 'add', key } : { kind: 'delete', key });
                    changes.push({ uri: item.document.uri.toString(), version: message.versions?.[item.document.uri.toString()] ?? -1, operations });
                }
                await this.documents.apply(changes);
                if (action === 'addMany') pendingReveal = keys;
                return;
            }
            const key = message.key;
            if (typeof key !== 'string') { throw new Error('Missing resource key.'); }
            if (['rename', 'delete', 'add', 'copy'].includes(action)) {
                let newKey = message.value;
                if (action !== 'delete' && !newKey) { newKey = await vscode.window.showInputBox({ title: action === 'rename' ? `Rename ${key} in all languages` : 'Resource key', value: action === 'copy' ? `${key}_Copy` : action === 'rename' ? key : '', validateInput: value => !value.trim() ? 'Key cannot be empty' : null }); if (!newKey) { return; } }
                if (action === 'delete' && await vscode.window.showWarningMessage(`Delete ${key} from all languages?`, { modal: true }, 'Delete') !== 'Delete') { return; }
                for (const item of items) {
                    const entry = parseResource(item.document.getText()).entries.find(e => e.key === key);
                    if (action === 'copy' && entry?.readonly) { throw new Error(`Cannot duplicate read-only resource ${key}.`); }
                    const operations: Operation[] = [];
                    if (action === 'rename' && entry) { operations.push({ kind: 'rename', key, newKey: newKey! }); }
                    if (action === 'delete' && entry) { operations.push({ kind: 'delete', key }); }
                    if (action === 'add' || action === 'copy') { operations.push({ kind: 'add', key: newKey!, value: action === 'copy' ? entry?.value ?? '' : '', comment: action === 'copy' ? entry?.comment ?? '' : '' }); }
                    changes.push({ uri: item.document.uri.toString(), version: message.versions?.[item.document.uri.toString()] ?? -1, operations });
                }
            } else if (action === 'set') {
                const item = items.find(i => i.document.uri.toString() === message.uri);
                if (!item || !['value', 'comment'].includes(message.field ?? '') || typeof message.value !== 'string') { throw new Error('Invalid resource edit.'); }
                const entry = parseResource(item.document.getText()).entries.find(e => e.key === key);
                if (message.expectedValue !== undefined && (entry?.[message.field!] ?? '') !== message.expectedValue) { throw new Error('This cell changed since you started editing. Your draft was not applied; review the current value.'); }
                const operations: Operation[] = entry ? [{ kind: 'set', key, field: message.field!, value: message.value }] : [{ kind: 'add', key, value: message.field === 'value' ? message.value : '', comment: message.field === 'comment' ? message.value : '' }];
                changes.push({ uri: item.document.uri.toString(), version: message.version ?? -1, operations });
            } else { throw new Error(`Unknown action: ${action}`); }
            await this.documents.apply(changes);
            if (['add', 'copy', 'rename'].includes(action)) pendingReveal = changes.flatMap(change => change.operations.flatMap(operation => operation.kind === 'add' ? [operation.key] : operation.kind === 'rename' ? [operation.newKey] : [])).filter((key, index, keys) => keys.indexOf(key) === index);
        };
        const safeRun = async (message: Message) => {
            try { await run(message); }
            catch (error) { await panel.webview.postMessage({ type: 'error', message: String(error) }); }
            finally { if (!disposed) { await update(); await panel.webview.postMessage({ type: 'ack', requestId: message.requestId }); } }
        };
        this.active = { panel, run: safeRun };
        const disposables = [
            panel.webview.onDidReceiveMessage((message: Message) => {
                if (message.action === 'rendered') { this.rendered.set(panel, { uri: document.uri.toString(), languageCount: message.languageCount ?? 0, resourceCount: message.resourceCount ?? 0 }); }
                else { void safeRun(message); }
            }),
            vscode.workspace.onDidChangeTextDocument(event => { if (items.some(i => i.document === event.document)) { void update(); } }),
            vscode.workspace.onDidSaveTextDocument(saved => { if (items.some(i => i.document === saved)) { void update(); } }),
            vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('rodelResx')) { void update(); } }),
            panel.onDidChangeViewState(() => { if (panel.active) { this.active = { panel, run: safeRun }; } })
        ];
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(require('./core/discovery').identify(document.uri.fsPath).directory, '**/*.{resw,resx}'));
        disposables.push(watcher, watcher.onDidCreate(() => { void update(); }), watcher.onDidDelete(() => { void update(); }), watcher.onDidChange(() => { void update(); }));
        panel.onDidDispose(() => { disposed = true; generation++; this.rendered.delete(panel); disposables.forEach(d => d.dispose()); if (this.active?.panel === panel) { this.active = undefined; } });
        // Do not await postMessage before VS Code has mounted the webview.
        // The script's ready message requests the authoritative first snapshot.
        void update();
    }

    private html(webview: vscode.Webview): string {
        const nonce = randomBytes(24).toString('base64');
        const uri = (folder: string, file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, folder, file));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${uri('dist', 'codicon.css')}"><link rel="stylesheet" href="${uri('media', 'editor.css')}"></head><body><main id="app" aria-label="Resource editor"></main><script nonce="${nonce}" src="${uri('media', 'editor.js')}"></script></body></html>`;
    }
}
