import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI package metadata', () => {
  it('keeps the publishable package version aligned with the connected VERSION file', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as Record<string, unknown>;
    const version = fs.readFileSync(path.resolve(import.meta.dirname, '../../../VERSION'), 'utf8').trim();
    expect(manifest.version).toBe(version.replace(/^v/, '').split(/[+-]/)[0]);
  });

  it('declares a Node 20+ MIT distributable CLI package', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest.license).toBe('MIT');
    expect((manifest.engines as Record<string, string>).node).toContain('20');
    expect(manifest.files).toEqual(expect.arrayContaining(['dist']));
    expect(manifest.repository).toBeDefined();
  });
});
