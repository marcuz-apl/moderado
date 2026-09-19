import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { binaryTargets, buildCommand, verifyArtifactManifest, writeArtifactManifest } from '../../../scripts/binaries.mjs';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))); });

it('defines the supported binary artifact names', () => {
  expect(binaryTargets().map((target) => target.filename)).toEqual(['moderado-win-x64.exe', 'moderado-macos-arm64', 'moderado-linux-x64']);
});

it('builds each target from the compiled CLI entry point', () => {
  const command = buildCommand(binaryTargets()[0], 'apps/cli/dist/index.js', 'artifacts/test');
  expect(command.slice(0, 5)).toEqual(['pkg', 'apps/cli/dist/index.js', '--target', 'node20-win-x64', '--output']);
  expect(command[5].replaceAll('\\', '/')).toBe('artifacts/test/moderado-win-x64.exe');
});

it('writes and validates an unsigned artifact manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moderado-binaries-'));
  dirs.push(dir);
  await writeFile(join(dir, 'moderado-win-x64.exe'), 'binary');
  await writeArtifactManifest(dir, 'v0.2.21+260919v', 'abc123', [binaryTargets()[0]]);
  await expect(verifyArtifactManifest(dir, 'v0.2.21+260919v')).resolves.toBeUndefined();
  expect(await readFile(join(dir, 'moderado-win-x64.exe.sha256'), 'utf8')).toContain('moderado-win-x64.exe');
});
