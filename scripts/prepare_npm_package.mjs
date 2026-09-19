import { cp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const internalPackages = {
  '@moderado/contracts': 'contracts',
  '@moderado/core': 'core',
  '@moderado/providers': 'providers',
  '@moderado/tools': 'tools',
};

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  }));
  return children.flat();
}

function relativeSpecifier(fromFile, targetFile) {
  const path = relative(dirname(fromFile), targetFile).split(sep).join('/');
  return path.startsWith('.') ? path : `./${path}`;
}

async function rewriteInternalImports(directory, vendorDirectory) {
  for (const file of await listJavaScriptFiles(directory)) {
    const source = await readFile(file, 'utf8');
    const rewritten = source.replace(/(['"])(@moderado\/(?:contracts|core|providers|tools))\1/g, (match, quote, packageName) => {
      const target = internalPackages[packageName];
      if (!target) return match;
      return `${quote}${relativeSpecifier(file, join(vendorDirectory, target, 'index.js'))}${quote}`;
    });
    if (rewritten.includes('@moderado/')) throw new Error(`Unresolved internal module specifier in ${file}.`);
    if (rewritten !== source) await writeFile(file, rewritten);
  }
}

export async function prepareNpmPackage(repoRoot) {
  const root = resolve(repoRoot);
  const cliDist = join(root, 'apps', 'cli', 'dist');
  const vendorDirectory = join(cliDist, 'vendor');
  await stat(cliDist);
  await rm(vendorDirectory, { force: true, recursive: true });

  for (const name of Object.values(internalPackages)) {
    const source = join(root, 'packages', name, 'dist');
    await stat(source);
    await cp(source, join(vendorDirectory, name), { recursive: true });
  }

  await rewriteInternalImports(cliDist, vendorDirectory);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareNpmPackage(process.cwd()).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
