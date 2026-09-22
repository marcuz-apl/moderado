import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { artifactByPlatform, artifactUrl, generateDistributionManifests } from '../../../scripts/distribution_manifests.mjs';

const manifest = {
  version: 'v0.2.22+260919w',
  revision: 'abc123',
  artifacts: [
    { target: 'node22-win-x64', filename: 'moderado-win-x64.exe', platform: 'win32', architecture: 'x64', size: 10, checksum: 'a'.repeat(64), signed: false },
    { target: 'node22-macos-arm64', filename: 'moderado-macos-arm64', platform: 'darwin', architecture: 'arm64', size: 11, checksum: 'c'.repeat(64), signed: false },
    { target: 'node22-linux-x64', filename: 'moderado-linux-x64', platform: 'linux', architecture: 'x64', size: 12, checksum: 'b'.repeat(64), signed: false },
  ],
};
const base = 'https://example.invalid/moderado/releases/download/v0.2.22';

it('resolves each release asset by platform', () => {
  expect(artifactUrl(base, 'moderado-linux-x64')).toBe(`${base}/moderado-linux-x64`);
  expect(artifactByPlatform(manifest, 'darwin', 'arm64')?.filename).toBe('moderado-macos-arm64');
  expect(artifactByPlatform(manifest, 'win32', 'x64')?.checksum).toBe('a'.repeat(64));
  expect(artifactByPlatform(manifest, 'linux', 'arm64')).toBeUndefined();
});

it('generates reviewable Homebrew, Scoop, and winget manifests from checksums', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moderado-distribution-'));
  try {
    await generateDistributionManifests(manifest, root, base);
    const formula = await readFile(join(root, 'homebrew', 'moderado.rb'), 'utf8');
    expect(formula).toContain('sha256 "' + 'c'.repeat(64) + '"');
    expect(formula).toContain('sha256 "' + 'b'.repeat(64) + '"');
    expect(formula).toContain('moderado-macos-arm64');
    expect(formula).toContain('moderado-linux-x64');
    expect(await readFile(join(root, 'scoop', 'moderado.json'), 'utf8')).toContain('moderado-win-x64.exe');
    expect(await readFile(join(root, 'winget', 'Moderado.yaml'), 'utf8')).toContain('InstallerSha256: ' + 'a'.repeat(64));
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('generates an AUR PKGBUILD from the verified Linux artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moderado-aur-'));
  try {
    await generateDistributionManifests(manifest, root, base);
    const pkgbuild = await readFile(join(root, 'aur', 'PKGBUILD'), 'utf8');
    expect(pkgbuild).toContain(`sha256sums_x86_64=('${'b'.repeat(64)}')`);
    expect(pkgbuild).toContain('moderado-linux-x64');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects a manifest missing any supported platform', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moderado-distribution-'));
  try {
    await expect(generateDistributionManifests({ ...manifest, artifacts: [manifest.artifacts[0]] }, root, base)).rejects.toThrow('each supported platform');
  } finally { await rm(root, { recursive: true, force: true }); }
});
