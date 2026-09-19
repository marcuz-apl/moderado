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
});
