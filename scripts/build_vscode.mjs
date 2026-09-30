import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// npm runs workspace scripts with cwd set to the workspace, so resolve from the
// repository root rather than the process directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'apps/vscode/src/extension.ts')],
  outfile: resolve(root, 'apps/vscode/dist/extension.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
});
