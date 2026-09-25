import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from './build_extension.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vscodeRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(vscodeRoot, '..', '..');

const BASE_MEDIA_FILES = ['index.html', 'styles.css', 'main.js', 'icon.svg'];

/**
 * The CLI dist is not self-contained: it imports `@moderado/*` and `zod` as bare
 * specifiers, so shipping `apps/cli/dist` alone yields ERR_MODULE_NOT_FOUND.
 * Stage the runtime modules it actually needs alongside it.
 */
export const SIDECAR_RUNTIME_PACKAGES = [
  { name: 'zod', from: () => path.join(repoRoot, 'node_modules', 'zod'), to: ['node_modules', 'zod'] },
  ...['contracts', 'core', 'providers', 'tools'].map((pkg) => ({
    name: `@moderado/${pkg}`,
    from: () => path.join(repoRoot, 'packages', pkg, 'dist'),
    to: ['node_modules', '@moderado', pkg, 'dist'],
    manifest: () => path.join(repoRoot, 'packages', pkg, 'package.json'),
  })),
];

function assertBuilt(relativePath, hint) {
  const target = path.join(repoRoot, relativePath);
  if (!existsSync(target)) {
    throw new Error(
      `Required build output missing: ${relativePath}. ${hint}`,
    );
  }
  return target;
}

/**
 * Copy the compiled CLI and its runtime dependencies into `targetDir`, producing
 * a self-contained sidecar that runs without the monorepo installed.
 */
export function stageSidecar(targetDir, { strict = true } = {}) {
  const cliDist = assertBuilt('apps/cli/dist', "Run 'npm run build' first.");
  if (!existsSync(path.join(cliDist, 'index.js'))) {
    throw new Error("apps/cli/dist/index.js is missing. Run 'npm run build' first.");
  }

  const sidecarDir = path.join(targetDir, 'dist', 'sidecar');
  rmSync(sidecarDir, { recursive: true, force: true });
  cpSync(cliDist, sidecarDir, { recursive: true });

  // The CLI is ESM. Without this marker Node emits MODULE_TYPELESS_PACKAGE_JSON
  // and reparses every file on first import.
  writeFileSync(
    path.join(sidecarDir, 'package.json'),
    JSON.stringify({ name: 'moderado-sidecar', private: true, type: 'module' }, null, 2),
    'utf8',
  );

  for (const pkg of SIDECAR_RUNTIME_PACKAGES) {
    const source = pkg.from();
    const destination = path.join(targetDir, ...pkg.to);
    if (!existsSync(source)) {
      if (strict) {
        throw new Error(
          `Sidecar dependency missing: ${pkg.name} (expected at ${source}). Run 'npm install' and 'npm run build' first.`,
        );
      }
      continue;
    }
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
    if (pkg.manifest) {
      // @moderado/* resolve through "exports", so the manifest must travel with the code.
      const manifest = pkg.manifest();
      if (existsSync(manifest)) {
        cpSync(manifest, path.join(path.dirname(destination), 'package.json'));
      }
    }
  }

  return sidecarDir;
}

export function buildManifest(pkg) {
  const assets = [
    '    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />',
  ];
  if (pkg.icon) {
    assets.push(
      `    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${pkg.icon}" Addressable="true" />`,
    );
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${pkg.displayName || pkg.name}</DisplayName>
    <Description>${pkg.description || ''}</Description>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" Version="${pkg.engines?.vscode || '[1.85.0,)'}" />
  </Installation>
  <Dependencies />
  <Assets>
${assets.join('\n')}
  </Assets>
</PackageManifest>
`;
}

export function buildContentTypes() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="svg" ContentType="image/svg+xml" />
</Types>
`;
}

export function collectMediaFiles(pkg, targetDir = vscodeRoot) {
  const mediaFiles = [...BASE_MEDIA_FILES];
  if (!pkg.icon) {
    return mediaFiles;
  }
  if (path.extname(pkg.icon) !== '.png') {
    throw new Error(`extension icon '${pkg.icon}' must be a PNG file`);
  }
  const iconFile = pkg.icon.startsWith('media/') ? pkg.icon.slice('media/'.length) : pkg.icon;
  if (!existsSync(path.join(targetDir, ...pkg.icon.split('/')))) {
    throw new Error(`extension icon '${pkg.icon}' is missing; run 'node scripts/generate_icon.mjs' to create it`);
  }
  if (!mediaFiles.includes(iconFile)) {
    mediaFiles.push(iconFile);
  }
  return mediaFiles;
}

export function packageVsix(targetDir = vscodeRoot) {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  // Ensure fresh standalone bundle
  buildExtension();

  const stageDir = path.join(tmpdir(), `vsix-stage-${Date.now()}`);
  const extensionDir = path.join(stageDir, 'extension');
  mkdirSync(extensionDir, { recursive: true });

  // 1. Root manifest files
  writeFileSync(path.join(stageDir, 'extension.vsixmanifest'), buildManifest(pkg), 'utf8');
  writeFileSync(path.join(stageDir, '[Content_Types].xml'), buildContentTypes(), 'utf8');

  // 2. Package manifest and documentation
  writeFileSync(path.join(extensionDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

  const readmePath = path.join(targetDir, 'README.md');
  if (existsSync(readmePath)) {
    cpSync(readmePath, path.join(extensionDir, 'README.md'));
  }

  // 3. Compiled extension code
  const distDir = path.join(targetDir, 'dist');
  if (!existsSync(distDir)) {
    throw new Error(`dist directory not found at ${distDir}. Run 'npm run build:vscode' first.`);
  }
  cpSync(distDir, path.join(extensionDir, 'dist'), { recursive: true });

  // 3b. The bundled sidecar, so the IDE works without a separate CLI install
  stageSidecar(extensionDir);

  // 4. Webview media assets, including the branded extension icon
  const mediaDir = path.join(targetDir, 'media');
  if (existsSync(mediaDir)) {
    mkdirSync(path.join(extensionDir, 'media'), { recursive: true });
    const mediaFiles = collectMediaFiles(pkg, targetDir);
    for (const f of mediaFiles) {
      const src = path.join(mediaDir, f);
      if (existsSync(src)) {
        cpSync(src, path.join(extensionDir, 'media', f));
      }
    }
  }

  // 5. Build zip / vsix
  const vsixName = `${pkg.name}-${pkg.version}.vsix`;
  const vsixPath = path.join(targetDir, vsixName);
  if (existsSync(vsixPath)) {
    rmSync(vsixPath);
  }

  try {
    let packed = false;
    try {
      execFileSync(
        'tar',
        ['--format', 'zip', '-cf', vsixPath, 'extension.vsixmanifest', '[Content_Types].xml', 'extension'],
        {
          cwd: stageDir,
          stdio: 'pipe',
        },
      );
      packed = true;
    } catch (tarErr) {
      try {
        execFileSync(
          'zip',
          ['-r', vsixPath, 'extension.vsixmanifest', '[Content_Types].xml', 'extension'],
          {
            cwd: stageDir,
            stdio: 'pipe',
          },
        );
        packed = true;
      } catch (zipErr) {
        throw new Error(`Failed to create VSIX zip archive: ${tarErr?.message || tarErr}`);
      }
    }
    if (!packed) {
      throw new Error('Failed to create VSIX archive: neither tar --format zip nor zip command succeeded.');
    }
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }

  console.log(`Successfully packaged VSIX: ${vsixPath}`);
  return vsixPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  packageVsix();
}
