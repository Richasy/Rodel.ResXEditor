import { createVSIX } from '@vscode/vsce';
import JSZip from 'jszip';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SaxesParser } from 'saxes';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const output = `artifacts/${manifest.name}-${manifest.version}.vsix`;
await mkdir('artifacts', { recursive: true });
await mkdir('.vscode-test', { recursive: true });
const staging = '.vscode-test/release-package.vsix';
// vsce creates the standard VS Code manifest and validates the package first.
await createVSIX({ cwd: process.cwd(), packagePath: staging, githubBranch: 'main', baseImagesUrl: 'https://raw.githubusercontent.com/Richasy/Rodel.ResXEditor/main' });
const zip = await JSZip.loadAsync(await readFile(staging));
let vsix = await zip.file('extension.vsixmanifest').async('string');
let readme = await zip.file('extension/readme.md').async('string');
const sourceReadme = await readFile('README.md', 'utf8');
const images = [...new Set([...sourceReadme.matchAll(/!\[[^\]]*\]\((docs\/images\/[\w.-]+\.png)\)/g)].map(match => match[1]))];
const assets = [];
// Addressable VSIX assets avoid private GitHub image links on the Marketplace.
// This changes only packaged README URLs; the repository keeps relative images.
for (const image of images) {
    const path = `extension/${image}`;
    assert.ok(zip.file(path), `Screenshot missing from VSIX: ${path}`);
    const type = `Rodel.ResXEditor.Images.${image.split('/').at(-1).replace('.png', '')}`;
    const url = `https://${manifest.publisher.toLowerCase()}.gallery.vsassets.io/_apis/public/gallery/publisher/${manifest.publisher}/extension/${manifest.name}/${manifest.version}/asset/${type}`;
    const github = `https://raw.githubusercontent.com/Richasy/Rodel.ResXEditor/main/${image}`;
    assert.ok(readme.includes(github), `Unrecognized vsce image rewrite: ${image}`);
    readme = readme.replaceAll(github, url);
    assets.push({ type, path, url });
}
vsix = vsix.replace('</Assets>', assets.map(asset => `<Asset Type="${asset.type}" Path="${asset.path}" Addressable="true" />`).join('\n') + '\n</Assets>');
new SaxesParser().write(vsix).close();
assert.ok(vsix.includes(`Version="${manifest.version}"`));
assert.ok(vsix.includes('Microsoft.VisualStudio.Code'));
assert.ok(zip.file(`extension/${manifest.icon}`));
assert.equal(images.length, 4, 'All four release screenshots must be referenced and packaged.');
assert.ok(!readme.includes('raw.githubusercontent.com/Richasy/Rodel.ResXEditor/main/docs/images/'));
zip.file('extension.vsixmanifest', vsix);
zip.file('extension/readme.md', readme);
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
await writeFile(output, bytes);
await writeFile('artifacts/extension.vsixmanifest', vsix);
await writeFile('artifacts/release-manifest.json', JSON.stringify({ publisher: manifest.publisher, name: manifest.name, version: manifest.version, vscode: manifest.engines.vscode, file: output, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), screenshots: assets }, null, 2) + '\n');
console.log(`Validated release: ${output} (${bytes.length} bytes; ${assets.length} addressable screenshots)`);
