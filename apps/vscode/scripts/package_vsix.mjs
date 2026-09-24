import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vscodeRoot = path.resolve(__dirname, '..');

function buildManifest(pkg) {
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
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function buildContentTypes() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="md" ContentType="text/markdown" />
</Types>
`;
}

export function packageVsix(targetDir = vscodeRoot) {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

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

  // 4. Webview media assets
  const mediaDir = path.join(targetDir, 'media');
  if (existsSync(mediaDir)) {
    mkdirSync(path.join(extensionDir, 'media'), { recursive: true });
    // Copy only production media assets (.html, .css, .js)
    const mediaFiles = ['index.html', 'styles.css', 'main.js'];
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
    execFileSync(
      'tar',
      ['-a', '-cf', vsixPath, 'extension.vsixmanifest', '[Content_Types].xml', 'extension'],
      {
        cwd: stageDir,
        stdio: 'pipe',
      },
    );
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }

  console.log(`Successfully packaged VSIX: ${vsixPath}`);
  return vsixPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  packageVsix();
}
