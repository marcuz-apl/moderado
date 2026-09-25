import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageSidecar, SIDECAR_RUNTIME_PACKAGES } from '../scripts/package_vsix.mjs';

/**
 * Guards the bundle-first contract: the VSIX must carry a sidecar that runs with
 * no monorepo and no global CLI on the machine. Copying `apps/cli/dist` alone is
 * NOT enough, because it imports `@moderado/*` and `zod` as bare specifiers.
 */
describe('sidecar staging', () => {
  let targetDir: string;
  let sidecarEntry: string;

  beforeAll(() => {
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-stage-'));
    stageSidecar(targetDir);
    sidecarEntry = path.join(targetDir, 'dist', 'sidecar', 'index.js');
  });

  afterAll(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('stages the CLI entry point and marks it as an ES module', () => {
    expect(fs.existsSync(sidecarEntry)).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(targetDir, 'dist', 'sidecar', 'package.json'), 'utf8'),
    );
    expect(manifest.type).toBe('module');
  });

  it('stages every runtime dependency the CLI imports', () => {
    for (const pkg of SIDECAR_RUNTIME_PACKAGES) {
      expect(fs.existsSync(path.join(targetDir, ...pkg.to)), pkg.name).toBe(true);
    }
    // @moderado/* resolve via "exports", so their manifests must travel too.
    for (const pkg of ['contracts', 'core', 'providers', 'tools']) {
      expect(
        fs.existsSync(path.join(targetDir, 'node_modules', '@moderado', pkg, 'package.json')),
        `@moderado/${pkg} manifest`,
      ).toBe(true);
    }
  });

  it('runs the staged sidecar outside the repo with no NODE_PATH help', () => {
    // `--help` exits non-zero after printing usage, so only stdout matters here.
    const out = execFileSync(process.execPath, [sidecarEntry, 'host', '--help'], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out).toContain('moderado host');
    // A missing module would surface as ERR_MODULE_NOT_FOUND on stderr instead.
    expect(out).not.toContain('ERR_MODULE_NOT_FOUND');
  });
});
