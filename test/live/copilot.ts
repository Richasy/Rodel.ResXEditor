// Explicit, interactive opt-in only. Uses the signed-in machine VS Code profile.
import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Documents } from '../../src/documents';
import { parseResource } from '../../src/core/xml';
import type { translate, TranslationSummary } from '../../src/copilot';

export async function run() {
    const report = process.env.RODEL_LIVE_REPORT!;
    if (JSON.parse(await readFile(report, 'utf8')).status === 'superseded') return;
    const record = (value: unknown) => writeFile(report, JSON.stringify(value, null, 2), 'utf8');
    const root = process.env.RODEL_LIVE_WORKSPACE ? vscode.Uri.file(process.env.RODEL_LIVE_WORKSPACE) : vscode.workspace.workspaceFolders![0].uri;
    try {
        const extension = await vscode.extensions.getExtension('RichasyZhang.rodel-resource-editor')!.activate();
        const translateResources: typeof translate = extension.translateResources;
        assert.equal(typeof translateResources, 'function', 'live test calls the real extension API so Copilot consent belongs to RichasyZhang.rodel-resource-editor');
        const documents = new Documents();
        const source = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, 'Strings', 'zh-CN', 'Resources.resw'));
        const items = await documents.discover(source);
        const target = items.find(item => item.language === 'en-US')!.document;
        const sourceBefore = source.getText(); const targetBefore = target.getText();
        await vscode.window.showTextDocument(target);
        await record({ status: 'waiting-for-language-model-selection', workspace: root.fsPath, expectedMissing: 22, expectedBatchRequests: 2 });
        let summary: TranslationSummary | undefined;
        const command = vscode.commands.registerCommand('rodel.liveCopilotTest', () => translateResources(items, 'zh-CN', undefined, value => { summary = value; }, process.env.RODEL_LIVE_AUTOMATIC === '1' ? { targetLanguages: ['en-US'], modelId: 'auto' } : undefined));
        let changes;
        try { changes = await vscode.commands.executeCommand<Awaited<ReturnType<typeof translate>>>('rodel.liveCopilotTest'); }
        finally { command.dispose(); }
        if (!changes || !summary) { await record({ status: 'cancelled' }); return; }
        assert.equal(source.getText(), sourceBefore);
        assert.equal(target.getText(), targetBefore, 'results are not applied before review');
        await record({ status: 'received', ...summary });
        assert.equal(summary.translatedCount, 22, 'all missing translations pass protection validation');
        assert.ok(summary.requestCount <= 3, 'real translation uses batches, not individual requests');
        assert.deepEqual(summary.failures, []);
        await documents.apply(changes);
        const translated = parseResource(target.getText());
        assert.equal(translated.entries.length, 25);
        for (const entry of parseResource(targetBefore).entries) assert.equal(translated.entries.find(e => e.key === entry.key)!.value, entry.value, 'existing human translations preserved');
        await vscode.commands.executeCommand('undo'); assert.equal(target.getText(), targetBefore);
        await vscode.commands.executeCommand('redo'); assert.equal(parseResource(target.getText()).entries.length, 25);
        await target.save();
        await record({ status: 'passed', ...summary, sourceUnchanged: source.getText() === sourceBefore, humanTranslationsPreserved: true, undoRedo: true, outputFile: target.uri.fsPath, translations: translated.entries.map(({ key, value }) => ({ key, value })) });
        console.log(`LIVE PASS: ${summary.model}, ${summary.translatedCount} translations in ${summary.requestCount} requests; placeholders, preview isolation, human translations and undo/redo verified.`);
    } catch (error) { await record({ status: 'failed', error: String(error) }); throw error; }
}
