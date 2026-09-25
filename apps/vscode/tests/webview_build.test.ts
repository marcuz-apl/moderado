import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWebview } from '../scripts/build_webview.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaDir = path.resolve(__dirname, '..', 'media');

/**
 * `media/main.js` is a build artifact checked into the repo, so nothing forces it
 * to match `media/main.ts` unless a test does.
 */
describe('webview build artifact', () => {
  it('regenerates main.js identically to the committed copy', () => {
    const target = path.join(mediaDir, 'main.js');
    const before = fs.readFileSync(target, 'utf8');
    buildWebview();
    const after = fs.readFileSync(target, 'utf8');
    expect(after).toBe(before);
  });

  it('carries the sidecar-unavailable handlers', () => {
    const js = fs.readFileSync(path.join(mediaDir, 'main.js'), 'utf8');
    expect(js).toContain('sidecarUnavailable');
    expect(js).toContain('sidecarReady');
    expect(js).toContain('retrySidecar');
  });
});
