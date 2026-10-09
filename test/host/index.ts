import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { Documents, projectLanguage } from '../../src/documents';
import { newResource, applyOperations, parseResource } from '../../src/core/xml';
import { exportWorkbook, importWorkbook } from '../../src/excel';
import ExcelJS from 'exceljs';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, message: string) {
    for (let i = 0; i < 100; i++) { if (predicate()) { return; } await wait(50); }
    assert.ok(predicate(), message);
}
async function writeFile(uri: vscode.Uri, bytes: Uint8Array) {
    for (let attempt = 0; ; attempt++) {
        try { await vscode.workspace.fs.writeFile(uri, bytes); return; }
        catch (error) { if (attempt >= 5 || !String(error).includes('EBUSY')) { throw error; } await wait(100); }
    }
}

export async function run() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([hostTests(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Host test timeout after 45s; inspect last checkpoint.')), 45000); })]); }
    finally { clearTimeout(timer); }
}
async function hostTests() {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const extension = vscode.extensions.getExtension('Richasy.rodel-resxeditor')!;
    assert.ok(extension, 'extension registered');
    const exports = await extension.activate();
    assert.ok(exports.documents, 'activation returns document service');
    console.log('HOST: activated');
    const documents = new Documents();
    const original = '\uFEFF' + applyOperations(newResource().replace(/\n/g, '\r\n'), [{ kind: 'add', key: 'Hello', value: '你好 {0}', comment: 'Greeting' }]);
    const uri = vscode.Uri.joinPath(root, 'Strings', 'zh-CN', 'Resources.resw');
    const en = vscode.Uri.joinPath(root, 'Strings', 'en-US', 'Resources.resw');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, 'Strings', 'zh-CN'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, 'Strings', 'en-US'));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(original));
    await vscode.workspace.fs.writeFile(en, Buffer.from(newResource()));
    const doc = await vscode.workspace.openTextDocument(uri);
    const items = await documents.discover(doc);
    assert.deepEqual(items.map(i => i.language), ['en-US', 'zh-CN']);
    assert.equal(await projectLanguage(uri), 'zh-CN', 'reads explicit Sprout default');
    assert.ok(!doc.isDirty);
    console.log('HOST: language discovery');
    await vscode.window.showTextDocument(doc);
    const oldVersion = doc.version;
    let events = 0;
    const listener = vscode.workspace.onDidChangeTextDocument(e => { if (e.document === doc) { events++; } });
    await documents.apply([{ uri: uri.toString(), version: oldVersion, operations: [{ kind: 'set', key: 'Hello', field: 'value', value: '修改 {0}' }] }]);
    assert.ok(doc.isDirty, 'edits are unsaved');
    assert.equal(parseResource(doc.getText()).entries[0].value, '修改 {0}');
    assert.ok(events > 0);
    await assert.rejects(documents.apply([{ uri: uri.toString(), version: oldVersion, operations: [{ kind: 'delete', key: 'Hello' }] }]), /changed/);
    await vscode.commands.executeCommand('undo');
    assert.equal(parseResource(doc.getText()).entries[0].value, '你好 {0}');
    await vscode.commands.executeCommand('redo');
    assert.equal(parseResource(doc.getText()).entries[0].value, '修改 {0}');
    await doc.save();
    const saved = Buffer.from(await vscode.workspace.fs.readFile(uri));
    assert.deepEqual(saved, Buffer.from(original.replace('你好 {0}', '修改 {0}')), 'exact BOM/CRLF/untouched-byte preservation');
    console.log('HOST: edit, undo/redo and UTF-8 save');
    const external = original.replace('你好 {0}', '外部 {0}');
    await writeFile(uri, Buffer.from(external));
    await until(() => doc.getText().includes('外部'), 'clean document reloads after external changes');
    console.log('HOST: external reload');
    const refreshed = await documents.discover(doc);
    // Group mutation is a single workspace edit and does not automatically save siblings.
    await documents.apply(refreshed.map(i => ({ uri: i.document.uri.toString(), version: i.document.version, operations: [{ kind: 'add' as const, key: 'Added', value: '' }] })));
    assert.ok(refreshed.every(i => i.document.isDirty));
    const bytes = await exportWorkbook(refreshed, 'zh-CN');
    assert.deepEqual(await importWorkbook(bytes, refreshed, 'zh-CN'), [], 'Excel round trip is lossless');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Resources')!;
    const row = sheet.getRows(2, sheet.rowCount - 1)!.find(r => r.getCell(1).value === 'Hello')!;
    row.getCell(3).value = 'English {0}';
    const diff = await importWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()), refreshed, 'zh-CN');
    assert.equal(diff.length, 1, 'preview identifies only changed language');
    await documents.apply(diff);
    assert.equal(parseResource(refreshed[0].document.getText()).entries.find(e => e.key === 'Hello')!.value, 'English {0}');
    row.getCell(3).value = { formula: '1+1' };
    await assert.rejects(importWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()), refreshed, 'zh-CN'), /plain text/);
    for (const i of refreshed) { await i.document.save(); }
    console.log('HOST: Excel round trip and preview');
    // Encoding remains VS Code's native encoding: verify UTF-16 LE BOM on a separate sample.
    const utf16uri = vscode.Uri.joinPath(root, 'Utf16.resx');
    const utf16 = applyOperations(newResource().replace('utf-8', 'utf-16'), [{ kind: 'add', key: 'Hello', value: 'before' }]);
    await vscode.workspace.fs.writeFile(utf16uri, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(utf16, 'utf16le')]));
    const utf16doc = await vscode.workspace.openTextDocument(utf16uri);
    await documents.apply([{ uri: utf16uri.toString(), version: utf16doc.version, operations: [{ kind: 'set', key: 'Hello', field: 'value', value: 'after' }] }]);
    await utf16doc.save();
    assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(utf16uri)), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(utf16.replace('before', 'after'), 'utf16le')]));
    console.log('HOST: UTF-16 save');
    // A malformed sibling aborts a whole batch before any file is changed.
    const before = doc.getText();
    await assert.rejects(documents.apply([{ uri: uri.toString(), version: doc.version, operations: [{ kind: 'rename', key: 'Hello', newKey: 'New' }] }, { uri: en.toString(), version: -1, operations: [] }]), /changed/);
    assert.equal(doc.getText(), before);
    console.log('HOST: opening custom editor');
    // Both custom views share one TextDocument and update via native change events.
    await vscode.commands.executeCommand('vscode.openWith', uri, 'rodel.resourceEditor');
    console.log('HOST: custom editor opened');
    await until(() => exports.editorDiagnostics().some((view: { languageCount: number; resourceCount: number }) => view.languageCount === 2 && view.resourceCount === 2), 'actual webview script renders both languages and resource rows');
    console.log('HOST: actual webview rendered both languages');
    await vscode.commands.executeCommand('workbench.action.splitEditor');
    await wait(600);
    await until(() => exports.editorDiagnostics().length === 2, 'split view also renders');
    assert.equal(vscode.workspace.textDocuments.filter(d => d.uri.toString() === uri.toString()).length, 1);
    await documents.apply([{ uri: uri.toString(), version: doc.version, operations: [{ kind: 'set', key: 'Hello', field: 'value', value: 'shared {0}' }] }]);
    assert.ok(events >= 4);
    await vscode.commands.executeCommand('undo');
    assert.equal(parseResource(doc.getText()).entries.find(e => e.key === 'Hello')!.value, '外部 {0}', 'custom editor native undo');
    await vscode.commands.executeCommand('redo');
    assert.equal(parseResource(doc.getText()).entries.find(e => e.key === 'Hello')!.value, 'shared {0}', 'custom editor native redo');
    await doc.save();
    const previousUri = vscode.Uri.joinPath(root, 'Previous.resw');
    console.log('Testing native text diff and dirty disk conflict...');
    await vscode.workspace.fs.writeFile(previousUri, Buffer.from(original));
    await vscode.commands.executeCommand('vscode.diff', previousUri, uri, 'Resource text comparison');
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff, 'diff uses native text editor');
    // External changes while dirty must leave both the disk edit and the draft intact.
    await vscode.window.showTextDocument(doc);
    await documents.apply([{ uri: uri.toString(), version: doc.version, operations: [{ kind: 'set', key: 'Hello', field: 'value', value: 'dirty draft {0}' }] }]);
    await writeFile(uri, Buffer.from(original.replace('你好 {0}', 'disk conflict {0}')));
    await wait(500);
    assert.ok(doc.isDirty && doc.getText().includes('dirty draft'), 'dirty buffer retained during disk conflict');
    assert.ok(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8').includes('disk conflict'), 'disk change not overwritten automatically');
    // Do not invoke Revert here: VS Code correctly asks for confirmation for the dirty draft.
    // The isolated profile exits immediately after this assertion.
    listener.dispose();
    console.log('PASS: host activation, both language documents, Sprout default, dirty edits, stale conflicts, undo/redo, UTF-8 BOM/CRLF, UTF-16 BOM, external reload, atomic multi-file mutation, Excel round trip/preview/formula rejection, split document identity.');
}
