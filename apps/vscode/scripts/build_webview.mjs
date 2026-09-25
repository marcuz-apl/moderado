import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaDir = path.resolve(__dirname, '..', 'media');

/**
 * The webview script is plain DOM code, so it only needs transpiling, not
 * bundling. Regenerating it here stops `media/main.js` from silently drifting
 * out of sync with `media/main.ts`.
 */
export function buildWebview() {
  const source = path.join(mediaDir, 'main.ts');
  const target = path.join(mediaDir, 'main.js');
  const { code } = esbuild.transformSync(fs.readFileSync(source, 'utf8'), {
    loader: 'ts',
    target: 'es2020',
  });
  fs.writeFileSync(target, '"use strict";\n' + code, 'utf8');
  return target;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = buildWebview();
  console.log(`Built webview script: ${path.relative(process.cwd(), out)}`);
}
