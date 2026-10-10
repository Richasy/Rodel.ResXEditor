import { createVSIX } from '@vscode/vsce';
import JSZip from 'jszip';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SaxesParser } from 'saxes';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const output = `artifacts/${manifest.name}-${manifest.version}.vsix`;
await mkdir('artifacts', { recursive: true });
const imageBase = 'https://raw.githubusercontent.com/Richasy/Rodel.ResXEditor/main';
const contentBase = 'https://github.com/Richasy/Rodel.ResXEditor/blob/main';
// Use official vsce URL rewriting and the public repository as the image host.
await createVSIX({ cwd: process.cwd(), packagePath: output, githubBranch: 'main', baseImagesUrl: imageBase, baseContentUrl: contentBase });
const bytes = await readFile(output);
const zip = await JSZip.loadAsync(bytes);
const vsix = await zip.file('extension.vsixmanifest').async('string');
const readme = await zip.file('extension/readme.md').async('string');
const sourceReadme = await readFile('README.md', 'utf8');
const images = [...new Set([...sourceReadme.matchAll(/!\[[^\]]*\]\((docs\/images\/[\w.-]+\.png)\)/g)].map(match => match[1]))];
const screenshots = images.map(image => {
    const path = `extension/${image}`;
    const url = `${imageBase}/${image}`;
    assert.ok(zip.file(path), `Screenshot missing from VSIX: ${path}`);
    assert.ok(readme.includes(url), `Image URL not rewritten by vsce: ${image}`);
    return { path, url };
});
new SaxesParser().write(vsix).close();
assert.ok(vsix.includes(`Version="${manifest.version}"`));
assert.ok(vsix.includes(`Publisher="${manifest.publisher}"`));
assert.ok(vsix.includes(`Id="${manifest.name}"`));
assert.ok(zip.file(`extension/${manifest.icon}`));
assert.equal(images.length, 4, 'All four screenshots must be present in the English README.');
assert.ok(!readme.includes('.gallery.vsassets.io'), 'README must not depend on custom gallery assets.');
assert.ok(readme.includes(`${contentBase}/README.zh-CN.md`));
assert.ok(!Object.keys(zip.files).some(path => path.toLowerCase().endsWith('/readme.zh-cn.md')), 'VSIX should contain only the English README.');
await writeFile('artifacts/extension.vsixmanifest', vsix);
await writeFile('artifacts/release-manifest.json', JSON.stringify({ publisher: manifest.publisher, name: manifest.name, version: manifest.version, vscode: manifest.engines.vscode, file: output, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), screenshots }, null, 2) + '\n');
console.log(`Validated release: ${output} (${bytes.length} bytes; ${images.length} public repository screenshots)`);
