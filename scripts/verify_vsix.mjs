import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listZipEntries, readZip } from './zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'apps/vscode/package.json'), 'utf8'));
const dir = join(root, 'artifacts/vsix');
const target = join(dir, `${manifest.name}-${manifest.version}.vsix`);

const bytes = await readFile(target);
const names = listZipEntries(bytes);
const files = readZip(bytes);
const fail = (message) => { console.error(`FAIL ${target}: ${message}`); process.exitCode = 1; };

if (new Set(names).size !== names.length) fail('contains a duplicate entry');
for (const required of ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json', `extension/${manifest.main.replace(/^\.\//, '')}`]) {
  if (!names.includes(required)) fail(`missing ${required}`);
}
const xml = files.get('extension.vsixmanifest')?.toString('utf8') ?? '';
if (!xml.includes(`Version="${manifest.version}"`)) fail('vsixmanifest version does not match the extension manifest');
if (!xml.includes(`Publisher="${manifest.publisher}"`)) fail('vsixmanifest publisher does not match the extension manifest');
if (!xml.includes('<InstallationTarget Id="Microsoft.VisualStudio.Code"')) fail('no VS Code installation target');
for (const name of names) {
  if (/\.(ts|map)$/.test(name) || name.includes('/tests/') || name.includes('node_modules')) fail(`ships a development file: ${name}`);
}
if (bytes.includes(Buffer.from('NVIDIA_API_KEY'))) fail('contains a provider credential name');

console.log(`Verified ${target}: ${names.length} entries, version ${manifest.version}`);
console.log(names.map((name) => `  ${name}`).join('\n'));