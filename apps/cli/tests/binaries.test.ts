import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  artifactDirectory,
  binaryTargets,
  buildCommand,
  mergeArtifactManifests,
  pkgEnvironment,
  pkgInvocation,
  verifyArtifactManifest,
  writeArtifactManifest,
} from '../../../scripts/binaries.mjs';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))); });

it('defines the supported binary artifact names', () => {
  expect(binaryTargets().map((target) => target.filename)).toEqual(['moderado-win-x64.exe', 'moderado-macos-arm64', 'moderado-linux-x64']);
});

it('builds each target from the compiled CLI entry point', () => {
  const command = buildCommand(binaryTargets()[0], 'apps/cli/dist/index.js', 'artifacts/test');
  expect(command.slice(0, 5)).toEqual(['pkg', 'apps/cli/dist/index.js', '--target', 'node22-win-x64', '--output']);
  expect(command[5].replaceAll('\\', '/')).toBe('artifacts/test/moderado-win-x64.exe');
});

it('invokes pkg through Node without repeating the pkg command name', () => {
  const invocation = pkgInvocation('node', 'node_modules/@yao-pkg/pkg/lib-es5/bin.js', ['pkg', 'entry.js']);
  expect(invocation).toEqual({ command: 'node', args: ['node_modules/@yao-pkg/pkg/lib-es5/bin.js', 'entry.js'] });
});

it('uses a caller-provided project cache for pkg runtime downloads', () => {
  expect(pkgEnvironment('artifacts/pkg-cache').PKG_CACHE_PATH).toBe('artifacts/pkg-cache');
});

it('places each matrix target under the connected-version artifact directory', () => {
  expect(artifactDirectory('artifacts', 'v0.2.21+260919v', binaryTargets()[0]).replaceAll('\\', '/')).toBe('artifacts/v0.2.21+260919v/node22-win-x64');
});

it('writes and validates an unsigned artifact manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moderado-binaries-'));
  dirs.push(dir);
  await writeFile(join(dir, 'moderado-win-x64.exe'), 'binary');
  await writeArtifactManifest(dir, 'v0.2.21+260919v', 'abc123', [binaryTargets()[0]]);
  await expect(verifyArtifactManifest(dir, 'v0.2.21+260919v')).resolves.toBeUndefined();
  expect(await readFile(join(dir, 'moderado-win-x64.exe.sha256'), 'utf8')).toContain('moderado-win-x64.exe');
});

it('rejects a missing checksum file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moderado-binaries-'));
  dirs.push(dir);
  await writeFile(join(dir, 'moderado-win-x64.exe'), 'binary');
  await writeArtifactManifest(dir, 'v0.2.21+260919v', 'abc123', [binaryTargets()[0]]);
  await rm(join(dir, 'moderado-win-x64.exe.sha256'));
  await expect(verifyArtifactManifest(dir, 'v0.2.21+260919v')).rejects.toThrow('checksum');
});

it('merges separately validated target artifacts into one release manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moderado-binaries-'));
  dirs.push(root);
  const targets = binaryTargets().slice(0, 2);
  const inputDirectories = await Promise.all(targets.map(async (target) => {
    const directory = join(root, target.target);
    await mkdir(directory);
    await writeFile(join(directory, target.filename), target.filename);
    await writeArtifactManifest(directory, 'v0.2.21+260919v', 'abc123', [target]);
    return directory;
  }));
  const output = join(root, 'release');
  await mergeArtifactManifests(inputDirectories, output, 'v0.2.21+260919v', 'abc123');
  await expect(verifyArtifactManifest(output, 'v0.2.21+260919v')).resolves.toBeUndefined();
});
