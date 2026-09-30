import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildZip, listZipEntries, readZip } from '../../../scripts/zip.mjs';
import { buildVsix } from '../../../scripts/vsix.mjs';

const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as Record<string, unknown>;

describe('zip', () => {
  it('round-trips entries through the container', () => {
    const zip = buildZip([
      { name: 'a.txt', data: 'hello world' },
      { name: 'nested/b.bin', data: Buffer.from([0, 1, 2, 253, 254, 255]) },
    ]);
    const files = readZip(zip);
    expect(files.get('a.txt')?.toString('utf8')).toBe('hello world');
    expect([...(files.get('nested/b.bin') ?? [])]).toEqual([0, 1, 2, 253, 254, 255]);
  });

  it('stores an incompressible entry rather than growing it', () => {
    const zip = buildZip([{ name: 'z.bin', data: Buffer.from([0]) }]);
    expect(readZip(zip).get('z.bin')?.length).toBe(1);
  });

  it('rejects something that is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip'))).toThrow(/end-of-central-directory/);
  });
});

describe('vsix packaging', () => {
  const vsix = buildVsix(manifest, {
    'dist/extension.cjs': Buffer.from('console.log("extension")'),
    'media/main.js': Buffer.from('// webview'),
    'media/main.css': Buffer.from('body{}'),
    'README.md': Buffer.from('# Moderado'),
  });
  const files = readZip(vsix);

  it('produces the OPC parts VS Code expects', () => {
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      'extension.vsixmanifest',
      'extension/README.md',
      'extension/dist/extension.cjs',
      'extension/media/main.css',
      'extension/media/main.js',
      'extension/package.json',
    ]);
  });

  it('carries the identity the marketplace and About page both read', () => {
    const xml = files.get('extension.vsixmanifest')?.toString('utf8') ?? '';
    expect(xml).toContain('<Identity Language="en-US"');
    expect(xml).toContain(`Id="${manifest.publisher}"`);
    expect(xml).toContain(`Version="${manifest.version}"`);
    const packaged = JSON.parse(files.get('extension/package.json')?.toString('utf8') ?? '{}') as Record<string, unknown>;
    // About reads this file at runtime, so it must ship and match the manifest.
    expect(packaged.version).toBe(manifest.version);
  });

  it('writes each path exactly once and refuses a duplicate manifest', () => {
    // A duplicated zip entry is a real packaging defect: a reader may take
    // either copy. This must read the raw names, since readZip keys by name.
    const names = listZipEntries(vsix);
    expect(new Set(names).size).toBe(names.length);
    // The guard exists precisely because this input previously shipped twice.
    expect(() => buildVsix(manifest, {
      'dist/extension.cjs': Buffer.from('x'),
      'package.json': Buffer.from('{}'),
    })).toThrow(/package\.json/);
  });

  it('never ships sources, tests, or a secret', () => {
    for (const name of files.keys()) {
      expect(name).not.toMatch(/\.(ts|map)$/);
      expect(name).not.toContain('/tests/');
      expect(name).not.toContain('node_modules');
    }
    expect(vsix.includes(Buffer.from('NVIDIA_API_KEY'))).toBe(false);
  });

  it('refuses to package without the entrypoint the manifest declares', () => {
    expect(() => buildVsix(manifest, { 'media/main.js': Buffer.from('') })).toThrow(/dist\/extension\.cjs/);
  });

  it('refuses an identity a marketplace cannot accept', () => {
    expect(() => buildVsix({ ...manifest, version: '' }, { 'dist/extension.cjs': Buffer.from('') })).toThrow(/version/);
    expect(() => buildVsix({ ...manifest, publisher: '' }, { 'dist/extension.cjs': Buffer.from('') })).toThrow(/publisher/);
  });
});