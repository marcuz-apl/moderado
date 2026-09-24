import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release workflow', () => {
  it('verifies and uploads a package without publishing it', async () => {
    const yaml = await readFile('.github/workflows/release.yml', 'utf8');
    expect(yaml).toContain('workflow_dispatch:');
    expect(yaml).toContain("'v*'");
    expect(yaml).toContain('npm run verify:package');
    expect(yaml).toContain('cut -d+ -f1 VERSION');
    expect(yaml).toContain('actions/upload-artifact@');
    expect(yaml).not.toMatch(/npm\s+publish|NODE_AUTH_TOKEN|NPM_TOKEN/i);
  });

  it('builds and combines unsigned native binaries on their matching operating systems', async () => {
    const yaml = await readFile('.github/workflows/release.yml', 'utf8');
    expect(yaml).toContain('binary-package:');
    expect(yaml).toContain('windows-latest');
    expect(yaml).toContain('macos-latest');
    expect(yaml).toContain('ubuntu-latest');
    expect(yaml).toContain('npm run build:binaries');
    expect(yaml).toContain('npm run verify:binaries');
    expect(yaml).toContain('merge-binaries');
    expect(yaml).not.toMatch(/gh\s+release|npm\s+publish|NODE_AUTH_TOKEN|NPM_TOKEN/i);
  });

  it('keeps public publication behind an explicit manual confirmation workflow', async () => {
    const yaml = await readFile('.github/workflows/publish.yml', 'utf8');
    expect(yaml).toContain('workflow_dispatch:');
    expect(yaml).toContain('confirm:');
    expect(yaml).toContain('PUBLISH');
    expect(yaml).toContain('npm publish');
    expect(yaml).toContain('node-version: 22');
    expect(yaml).toContain('npm@11.5.1');
    expect(yaml).toContain('gh release create');
    expect(yaml).toMatch(/gh release create "\$\{\{ inputs\.tag \}\}" --verify-tag --title/);
    expect(yaml).toContain('id-token: write');
    expect(yaml).toContain('--commit "$GITHUB_SHA"');
    expect(yaml).not.toContain("--branch '${{ inputs.tag }}'");
  });
});
