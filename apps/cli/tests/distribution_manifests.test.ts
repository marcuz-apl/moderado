import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { generateDistributionManifests } from '../../../scripts/distribution_manifests.mjs';

it('generates reviewable Homebrew, Scoop, and winget manifests from checksums', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moderado-distribution-'));
  try {
    await generateDistributionManifests({
      version: 'v0.2.22+260919w',
      revision: 'abc123',
      artifacts: [{ target: 'node22-win-x64', filename: 'moderado-win-x64.exe', platform: 'win32', architecture: 'x64', size: 10, checksum: 'a'.repeat(64), signed: false }],
    }, root, 'https://example.invalid/moderado/releases/download/v0.2.22');
    expect(await readFile(join(root, 'homebrew', 'moderado.rb'), 'utf8')).toContain('sha256 "' + 'a'.repeat(64) + '"');
    expect(await readFile(join(root, 'scoop', 'moderado.json'), 'utf8')).toContain('moderado-win-x64.exe');
    expect(await readFile(join(root, 'winget', 'Moderado.yaml'), 'utf8')).toContain('InstallerSha256: ' + 'a'.repeat(64));
  } finally { await rm(root, { recursive: true, force: true }); }
});
