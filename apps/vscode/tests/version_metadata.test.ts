import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

describe('Milestone 0.4.0 Version Metadata Consistency', () => {
  const rootDir = path.resolve(import.meta.dirname, '../../..');
  const versionFile = path.join(rootDir, 'VERSION');
  const cliPkgFile = path.join(rootDir, 'apps/cli/package.json');
  const vscodePkgFile = path.join(rootDir, 'apps/vscode/package.json');

  it('ensures root VERSION and package manifests exist', () => {
    expect(existsSync(versionFile)).toBe(true);
    expect(existsSync(cliPkgFile)).toBe(true);
    expect(existsSync(vscodePkgFile)).toBe(true);
  });

  it('aligns all product version metadata to milestone 0.4.0', () => {
    const rawVersion = readFileSync(versionFile, 'utf8').trim();
    const cliPkg = JSON.parse(readFileSync(cliPkgFile, 'utf8'));
    const vscodePkg = JSON.parse(readFileSync(vscodePkgFile, 'utf8'));

    // Extract SemVer from root VERSION (e.g., "v0.4.0+260924a" -> "0.4.0")
    const match = /^v?([0-9]+\.[0-9]+\.[0-9]+)/.exec(rawVersion);
    expect(match).not.toBeNull();
    const rootSemver = match![1];

    // Check target milestone version
    expect(rootSemver).toBe('0.4.0');
    expect(cliPkg.version).toBe('0.4.0');
    expect(vscodePkg.version).toBe('0.4.0');

    // Root VERSION must have connected Alfazen build metadata
    expect(rawVersion).toMatch(/^v0\.4\.0\+[0-9]{6}[0-9a-zA-Z]$/);
  });
});
