// Explicit opt-in: small real Copilot translation run in a development window.
import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
const automatic = process.argv.includes('--auto');
const runDirectory = path.join(root, '.vscode-test', `copilot-live-${Date.now()}`);
const workspace = path.join(runDirectory, 'workspace');
const helperMarker = path.join(root, '.vscode-test', 'copilot-live-helper-path.txt');
const helper = await readFile(helperMarker, 'utf8').catch(() => path.join(root, '.vscode-test', 'copilot-live-helper'));
await mkdir(workspace, { recursive: true });
await cp('samples/Copilot/Strings', path.join(workspace, 'Strings'), { recursive: true });
await mkdir(path.join(workspace, '.vscode'), { recursive: true });
await writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'rodelResx.defaultLanguage': 'zh-CN', 'rodelResx.translationBatchSize': 20 }));
await mkdir(helper, { recursive: true });
await writeFile(helperMarker, helper);
await build({ entryPoints: ['test/live/copilot.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: path.join(helper, 'test.cjs') });
const report = path.join(runDirectory, 'report.json');
await writeFile(report, JSON.stringify({ status: 'waiting-for-start' }));
await writeFile(path.join(helper, 'package.json'), JSON.stringify({ name: 'rodel-copilot-live-test', publisher: 'local', version: '0.0.1', engines: { vscode: '^1.95.0' }, main: './index.cjs', activationEvents: ['onStartupFinished'], contributes: { commands: [{ command: 'rodel.startLiveTest', title: 'Rodel: Start Copilot Live Test' }] } }));
await writeFile(path.join(helper, 'index.cjs'), `const vscode = require('vscode');
exports.activate = context => {
    let started = false;
    context.subscriptions.push(vscode.commands.registerCommand('rodel.startLiveTest', async () => {
        if (started) return; started = true;
        process.env.RODEL_LIVE_REPORT = ${JSON.stringify(report)};
        process.env.RODEL_LIVE_AUTOMATIC = ${JSON.stringify(automatic ? '1' : '0')};
        process.env.RODEL_LIVE_WORKSPACE = ${JSON.stringify(workspace)};
        try { await require('./test.cjs').run(); void vscode.window.showInformationMessage('Copilot 联调通过，报告已写入测试目录。'); }
        catch (error) { void vscode.window.showErrorMessage('Copilot 联调失败：' + String(error)); }
    }));
    ${automatic ? "vscode.commands.executeCommand('rodel.startLiveTest');" : "vscode.window.showInformationMessage('Rodel Copilot 联调：仅使用独立样本，22 条资源预计两个批次。', '开始 Copilot 联调').then(choice => { if (choice) vscode.commands.executeCommand('rodel.startLiveTest'); });"}
};`);
console.log(`Live report: ${report}`);
const executable = path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe');
execFileSync(executable, ['--new-window', workspace, `--extensionDevelopmentPath=${root}`, `--extensionDevelopmentPath=${helper}`], { stdio: 'ignore', windowsHide: true });
