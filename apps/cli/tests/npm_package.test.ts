import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareNpmPackage } from '../../../scripts/prepare_npm_package.mjs';
import { createNpmEnvironment, getInstalledCliInvocation, getNpmInvocation, verifyPackedFiles } from '../../../scripts/verify_npm_package.mjs';

describe('npm package preparation', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it('vendors internal runtime modules and rewrites bare imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moderado-package-'));
    roots.push(root);
    await mkdir(join(root, 'apps/cli/dist'), { recursive: true });
    await mkdir(join(root, 'packages/core/dist'), { recursive: true });
    await mkdir(join(root, 'packages/contracts/dist'), { recursive: true });
    await mkdir(join(root, 'packages/providers/dist'), { recursive: true });
    await mkdir(join(root, 'packages/tools/dist'), { recursive: true });
    await writeFile(join(root, 'apps/cli/dist/index.js'), "import { run } from '@moderado/core';\n");
    await writeFile(join(root, 'packages/core/dist/index.js'), "import { Event } from '@moderado/contracts';\n");
    await writeFile(join(root, 'packages/contracts/dist/index.js'), 'export const Event = {};\n');
    await writeFile(join(root, 'packages/providers/dist/index.js'), 'export const provider = {};\n');
    await writeFile(join(root, 'packages/tools/dist/index.js'), 'export const tools = {};\n');

    await prepareNpmPackage(root);

    const entry = await readFile(join(root, 'apps/cli/dist/index.js'), 'utf8');
    expect(entry).not.toContain("'@moderado/core'");
    expect(entry).toContain("'./vendor/core/index.js'");
    await expect(readFile(join(root, 'apps/cli/dist/vendor/contracts/index.js'), 'utf8')).resolves.toContain('Event');
  });

  it('rejects source, tests, user data, and node_modules from a package tarball', () => {
    expect(() => verifyPackedFiles(['package/dist/index.js', 'package/dist/vendor/core/index.js'])).not.toThrow();
    expect(() => verifyPackedFiles(['package/src/index.ts'])).toThrow('source file');
    expect(() => verifyPackedFiles(['package/node_modules/zod/index.js'])).toThrow('node_modules');
    expect(() => verifyPackedFiles(['package/.moderado/config.json'])).toThrow('user data');
  });

  it('runs npm through node on Windows without enabling a shell', () => {
    const invocation = getNpmInvocation('win32', 'C:/Program Files/nodejs/node.exe');
    expect(invocation.command).toBe('C:/Program Files/nodejs/node.exe');
    expect(invocation.prefix[0].replaceAll('\\', '/')).toBe('C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js');
  });

  it('uses a supplied temporary npm cache', () => {
    expect(createNpmEnvironment('C:/temp/moderado-cache').npm_config_cache).toBe('C:/temp/moderado-cache');
  });

  it('runs the installed CLI through node on Windows without enabling a shell', () => {
    const invocation = getInstalledCliInvocation('C:/temp/moderado', 'C:/Program Files/nodejs/node.exe');
    expect(invocation.command).toBe('C:/Program Files/nodejs/node.exe');
    expect(invocation.args[0].replaceAll('\\', '/')).toBe('C:/temp/moderado/node_modules/moderado/dist/index.js');
    expect(invocation.args[1]).toBe('--help');
  });
});
