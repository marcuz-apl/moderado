import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVsix } from './vsix.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'apps/vscode');
const outputDir = join(root, 'artifacts/vsix');

/**
 * Files an install needs, taken from the built extension. Never sources or deps.
 * `buildVsix` writes the manifest itself, so it must not also appear here.
 */
async function collectFiles(manifest) {
  const files = {};
  files[manifest.main.replace(/^\.\//, '')] = await readFile(join(extensionDir, manifest.main));
  const readme = join(extensionDir, 'README.md');
  if (existsSync(readme)) files['README.md'] = await readFile(readme);
  const media = join(extensionDir, 'media');
  for (const name of await readdir(media)) {
    if (/\.(js|css|svg|png)$/.test(name)) files[`media/${name}`] = await readFile(join(media, name));
  }
  return files;
}

const manifest = JSON.parse(await readFile(join(extensionDir, 'package.json'), 'utf8'));
const files = await collectFiles(manifest);
const vsix = buildVsix(manifest, files);

await mkdir(outputDir, { recursive: true });
const target = join(outputDir, `${basename(manifest.name)}-${manifest.version}.vsix`);
await writeFile(target, vsix);
console.log(`Packaged ${target} (${vsix.length} bytes, ${Object.keys(files).length + 3} entries)`);