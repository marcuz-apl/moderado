import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vscodeRoot = path.resolve(__dirname, '..');

export function buildExtension() {
  esbuild.buildSync({
    entryPoints: [path.join(vscodeRoot, 'src', 'extension.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['vscode'],
    outfile: path.join(vscodeRoot, 'dist', 'extension.js'),
    sourcemap: true,
  });
  console.log('Successfully bundled extension with esbuild');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildExtension();
}
