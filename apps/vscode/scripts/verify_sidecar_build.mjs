import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageSidecar, SIDECAR_RUNTIME_PACKAGES } from './package_vsix.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Fails fast when the sidecar the VSIX will bundle is not buildable, so a stale
 * or partial CLI build cannot ship. Complements `stageSidecar`, which re-checks
 * the same inputs at packaging time.
 */
export function verifySidecarBuild() {
  const missing = [];
  for (const pkg of SIDECAR_RUNTIME_PACKAGES) {
    if (!fs.existsSync(pkg.from())) missing.push(pkg.name);
  }
  if (missing.length > 0) {
    throw new Error(
      `Cannot bundle the sidecar; missing build output for: ${missing.join(', ')}. ` +
        "Run 'npm install' and 'npm run build' from the repository root first.",
    );
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    verifySidecarBuild();
    const target = path.join(repoRoot, 'apps', 'vscode', 'dist', '.sidecar-check');
    stageSidecar(target);
    fs.rmSync(target, { recursive: true, force: true });
    console.log('Sidecar bundle inputs verified');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
