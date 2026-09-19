import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI package metadata', () => {
  it('declares a Node 20+ MIT distributable CLI package', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest.license).toBe('MIT');
    expect((manifest.engines as Record<string, string>).node).toContain('20');
    expect(manifest.files).toEqual(expect.arrayContaining(['dist']));
    expect(manifest.repository).toBeDefined();
  });
});
