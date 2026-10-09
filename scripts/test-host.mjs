import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const runDirectory = path.join(root, '.vscode-test', `run-${Date.now()}`);
const workspace = path.join(runDirectory, 'workspace');
await mkdir(workspace, { recursive: true });
await writeFile(path.join(workspace, 'HostTest.csproj'), '<Project><ItemGroup><PackageReference Include="Sprout" Version="0.1.0" /></ItemGroup><PropertyGroup><SproutDefaultLanguage>zh-CN</SproutDefaultLanguage></PropertyGroup></Project>');
await build({ entryPoints: ['test/host/index.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: '.vscode-test/host.cjs' });
await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    extensionDevelopmentPath: process.env.RODEL_PACKAGED_EXTENSION || root,
    extensionTestsPath: path.join(root, '.vscode-test', 'host.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--user-data-dir', path.join(runDirectory, 'user'), '--extensions-dir', path.join(root, '.vscode-test', 'extensions')]
});
