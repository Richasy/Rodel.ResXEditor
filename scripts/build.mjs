import { build, context } from 'esbuild';
import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });
await copyFile('node_modules/@vscode/codicons/dist/codicon.css', 'dist/codicon.css');
await copyFile('node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/codicon.ttf');
const options = { entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: 'dist/extension.js', sourcemap: true, metafile: true };
const validation = { entryPoints: ['src/preview-validation.ts'], bundle: true, platform: 'browser', format: 'iife', outfile: 'dist/preview-validation.js' };
if (process.argv.includes('--watch')) { for (const settings of [options, validation]) { const ctx = await context(settings); await ctx.watch(); } }
else {
    const result = await build(options);
    await build(validation);
    const packages = new Set(Object.keys(result.metafile.inputs).map(input => input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean));
    packages.add('node_modules/@vscode/codicons');
    const notices = [];
    for (const directory of [...packages].sort()) {
        const pkg = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
        notices.push(`\n=== ${pkg.name} ${pkg.version} (${pkg.license ?? 'see license below'}) ===\n`);
        for (const file of await readdir(directory)) {
            if (/^(licen[cs]e|copying|notice)(\.|$)/i.test(file)) {
                try { notices.push(await readFile(`${directory}/${file}`, 'utf8')); } catch { /* A directory named license is not a notice file. */ }
            }
        }
    }
    await writeFile('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n'));
}
