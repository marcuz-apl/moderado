import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ciWorkflow = readFileSync(path.resolve(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8');

describe('integration workflow', () => {
  it('gates pull requests and master pushes on the offline suite', () => {
    expect(ciWorkflow).toContain('pull_request:');
    expect(ciWorkflow).toMatch(/push:\s*\n\s*branches: \[master\]/);
    expect(ciWorkflow).toContain('npm ci');
    // Workspace packages resolve @moderado/* through their dist entry points.
    expect(ciWorkflow).toContain('npm run build');
    expect(ciWorkflow).toContain('npm run typecheck');
    expect(ciWorkflow).toContain('npm test');
  });

  it('stays read-only and never publishes', () => {
    expect(ciWorkflow).toContain('contents: read');
    expect(ciWorkflow).not.toMatch(
      /npm\s+publish|gh\s+release|id-token:\s*write|NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./i,
    );
  });
});
