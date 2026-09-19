import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function binaryTargets() {
  return [
    { target: 'node20-win-x64', filename: 'moderado-win-x64.exe', platform: 'win32', architecture: 'x64' },
    { target: 'node20-macos-arm64', filename: 'moderado-macos-arm64', platform: 'darwin', architecture: 'arm64' },
    { target: 'node20-linux-x64', filename: 'moderado-linux-x64', platform: 'linux', architecture: 'x64' },
  ];
}

export function buildCommand(target, entry, outputDirectory) {
  return ['pkg', entry, '--target', target.target, '--output', join(outputDirectory, target.filename)];
}

async function digest(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function writeArtifactManifest(directory, version, revision, targets) {
  const artifacts = await Promise.all(targets.map(async (target) => {
    const file = join(directory, target.filename);
    const checksum = await digest(file);
    const info = await stat(file);
    await writeFile(`${file}.sha256`, `${checksum}  ${target.filename}\n`);
    return { ...target, size: info.size, checksum, signed: false };
  }));
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify({ version, revision, artifacts }, null, 2)}\n`);
}

export async function verifyArtifactManifest(directory, version) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== version || !Array.isArray(manifest.artifacts)) throw new Error('Artifact manifest version is invalid.');
  for (const artifact of manifest.artifacts) {
    if (artifact.signed !== false || await digest(join(directory, artifact.filename)) !== artifact.checksum) throw new Error(`Artifact verification failed for ${artifact.filename}.`);
  }
}
