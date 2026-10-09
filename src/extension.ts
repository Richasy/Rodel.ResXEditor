import * as vscode from 'vscode';
import * as path from 'node:path';
import { ResourceEditor } from './editor';
import { canonicalLanguage, identify, resourcePath } from './core/discovery';
import { newResource } from './core/xml';
import { generateDesigner } from './core/designer';
import { projectLanguage } from './documents';
import { translate } from './copilot';

export function activate(context: vscode.ExtensionContext) {
    const provider = new ResourceEditor(context);
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(ResourceEditor.viewType, provider, { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: true } }));
    const register = (name: string, handler: (...args: any[]) => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(`rodel.${name}`, async (...args: any[]) => { try { await handler(...args); } catch (error) { vscode.window.showErrorMessage(String(error)); } }));
    register('open', async (uri?: vscode.Uri) => {
        uri ??= vscode.window.activeTextEditor?.document.uri;
        if (!uri) { uri = (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Resources: ['resw', 'resx'] } }))?.[0]; }
        if (uri) { await vscode.commands.executeCommand('vscode.openWith', uri, ResourceEditor.viewType); }
    });
    register('openText', async (uri?: vscode.Uri) => { if (uri) { await vscode.commands.executeCommand('vscode.openWith', uri, 'default'); } else { await provider.command('text'); } });
    for (const action of ['translate', 'export', 'import']) { register(action, () => provider.command(action)); }
    register('create', async (uri?: vscode.Uri) => {
        uri ??= vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!uri) { uri = (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false }))?.[0]; }
        if (!uri) { return; }
        const stat = await vscode.workspace.fs.stat(uri);
        let directory = stat.type & vscode.FileType.Directory ? uri.fsPath : path.dirname(uri.fsPath);
        let name = 'Resources';
        let kind: 'resw' | 'resx' | undefined;
        if (/\.res[wx]$/i.test(uri.path)) { const identity = identify(uri.fsPath); directory = identity.directory; name = identity.name; kind = identity.kind; }
        else {
            const choice = await vscode.window.showQuickPick(['resw', 'resx'], { title: 'Resource format' });
            kind = choice === 'resw' || choice === 'resx' ? choice : undefined;
            if (!kind) { return; }
            if (kind === 'resw' && path.basename(directory).toLowerCase() !== 'strings') { directory = path.join(directory, 'Strings'); }
        }
        const defaultLanguage = await projectLanguage(vscode.Uri.file(path.join(directory, name)));
        const language = await vscode.window.showInputBox({ title: 'Language (BCP-47)', value: defaultLanguage, placeHolder: 'zh-CN', validateInput: value => { try { canonicalLanguage(value); return null; } catch (e) { return String(e); } } });
        if (!language) { return; }
        const fileName = await vscode.window.showInputBox({ title: 'Resource file name (without extension)', value: name, validateInput: value => { try { resourcePath(directory, value, kind!, language); return null; } catch (e) { return String(e); } } });
        if (!fileName) { return; }
        const target = vscode.Uri.file(resourcePath(directory, fileName, kind, language));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
        const edit = new vscode.WorkspaceEdit();
        edit.createFile(target, { overwrite: false, ignoreIfExists: false });
        edit.insert(target, new vscode.Position(0, 0), newResource());
        if (!await vscode.workspace.applyEdit(edit)) { throw new Error('Could not create resource; file may already exist.'); }
        await (await vscode.workspace.openTextDocument(target)).save();
        await vscode.commands.executeCommand('vscode.openWith', target, ResourceEditor.viewType);
    });
    register('nesting', async () => {
        const config = vscode.workspace.getConfiguration('explorer.fileNesting');
        const patterns = { ...config.get<Record<string, string>>('patterns', {}), '*.resx': '${capture}.*.resx, ${capture}.Designer.cs' };
        await config.update('patterns', patterns, vscode.ConfigurationTarget.Workspace);
        await config.update('enabled', true, vscode.ConfigurationTarget.Workspace);
    });
    register('designer', async () => {
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc || path.extname(doc.uri.fsPath) !== '.resx') { throw new Error('Open the neutral .resx as XML first. .resw accessors are owned by Sprout.'); }
        const identity = identify(doc.uri.fsPath);
        if (identity.language !== 'neutral') { throw new Error('Generate from the neutral .resx only.'); }
        const config = vscode.workspace.getConfiguration('rodelResx', doc.uri);
        if (!config.get<boolean>('generateDesigner')) { throw new Error('Designer generation is disabled. Enable rodelResx.generateDesigner to opt in.'); }
        const ns = config.get<string>('designerNamespace', 'Resources');
        const baseName = config.get<string>('designerBaseName', '');
        const code = generateDesigner(doc.getText(), ns, identity.name, baseName);
        const target = vscode.Uri.file(path.join(identity.directory, `${identity.name}.Designer.cs`));
        try { const existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(target)); if (!existing.startsWith('// Generated by Rodel.ResXEditor.')) { throw new Error('Existing Designer.cs is not owned by Rodel.ResXEditor.'); } } catch (e) { if (!(e instanceof vscode.FileSystemError && e.code === 'FileNotFound')) { throw e; } }
        await vscode.workspace.fs.writeFile(target, Buffer.from(code));
        await vscode.window.showTextDocument(target);
    });
    return { documents: provider.documents, editorDiagnostics: () => provider.diagnostics(), translateResources: translate };
}
