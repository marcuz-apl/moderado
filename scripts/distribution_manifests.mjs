import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function versionWithoutPrefix(version) { return version.replace(/^v/, '').split('+')[0]; }

export function artifactUrl(releaseBaseUrl, filename) {
  return `${releaseBaseUrl}/${filename}`;
}

export function artifactByPlatform(manifest, platform, architecture) {
  return manifest.artifacts.find((candidate) => candidate.platform === platform && candidate.architecture === architecture);
}

export async function generateDistributionManifests(manifest, outputDirectory, releaseBaseUrl) {
  const version = versionWithoutPrefix(manifest.version);
  for (const artifact of manifest.artifacts) {
    if (!artifact || artifact.signed !== false) throw new Error('Only unsigned verified artifacts may be staged.');
  }
  const windows = artifactByPlatform(manifest, 'win32', 'x64');
  const macos = artifactByPlatform(manifest, 'darwin', 'arm64');
  const linux = artifactByPlatform(manifest, 'linux', 'x64');
  if (!windows || !macos || !linux) throw new Error('A verified artifact is required for each supported platform.');
  await Promise.all(['homebrew', 'scoop', 'winget', 'aur'].map((directory) => mkdir(join(outputDirectory, directory), { recursive: true })));
  const linuxUrl = artifactUrl(releaseBaseUrl, linux.filename);
  const windowsUrl = artifactUrl(releaseBaseUrl, windows.filename);
  const macosUrl = artifactUrl(releaseBaseUrl, macos.filename);
  await writeFile(join(outputDirectory, 'homebrew', 'moderado.rb'), `class Moderado < Formula
  desc "Free-first AI coding agent"
  homepage "https://github.com/marcuz-apl/moderado"
  version "${version}"
  if OS.mac?
    url "${macosUrl}"
    sha256 "${macos.checksum}"
  else
    url "${linuxUrl}"
    sha256 "${linux.checksum}"
  end
  def install
    if OS.mac?
      bin.install "${macos.filename}" => "moderado"
    else
      bin.install "${linux.filename}" => "moderado"
    end
  end
end
`);
  await writeFile(join(outputDirectory, 'scoop', 'moderado.json'), `${JSON.stringify({ version, description: 'Free-first AI coding agent', homepage: 'https://github.com/marcuz-apl/moderado', architecture: { '64bit': { url: windowsUrl, hash: windows.checksum } }, bin: windows.filename }, null, 2)}\n`);
  await writeFile(join(outputDirectory, 'winget', 'Moderado.yaml'), `PackageIdentifier: MarcuzApl.Moderado\nPackageVersion: ${version}\nPackageName: Moderado\nPublisher: Marcuz Apl\nInstallerType: portable\nInstallers:\n- Architecture: x64\n  InstallerUrl: ${windowsUrl}\n  InstallerSha256: ${windows.checksum}\nManifestType: singleton\nManifestVersion: 1.6.0\n`);
  // winget requires a sibling locale manifest; `winget validate` otherwise fails
  // with "Required field missing. [PackageLocale]". Follow the upstream defaultLocale
  // schema exactly: ManifestType `defaultLocale`, `License` (not `PackageLicense`),
  // and PackageIdentifier/PackageVersion repeated in the locale file.
  await writeFile(join(outputDirectory, 'winget', 'Moderado.locale.en-US.yaml'), `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json\n\nPackageIdentifier: MarcuzApl.Moderado\nPackageVersion: ${version}\nPackageLocale: en-US\nPublisher: Marcuz Apl\nPublisherUrl: https://github.com/marcuz-apl/moderado\nPublisherSupportUrl: https://github.com/marcuz-apl/moderado/issues\nPackageName: Moderado\nPackageUrl: https://github.com/marcuz-apl/moderado\nLicense: MIT\nLicenseUrl: https://github.com/marcuz-apl/moderado/blob/master/LICENSE\nShortDescription: Free-first AI coding agent\nDescription: |-\n  Moderado is a lightweight, provider-independent CLI coding agent with free-first model routing and a human-in-the-loop approval boundary.\nMoniker: moderado\nTags:\n- command-line\n- ai\n- coding-agent\n- cli\nManifestType: defaultLocale\nManifestVersion: 1.6.0\n`);
  await writeFile(join(outputDirectory, 'aur', 'PKGBUILD'), `pkgname=moderado-bin\npkgver=${version}\npkgrel=1\npkgdesc='Free-first AI coding agent'\narch=('x86_64')\nurl='https://github.com/marcuz-apl/moderado'\nlicense=('MIT')\nsource_x86_64=("${linuxUrl}")\nsha256sums_x86_64=('${linux.checksum}')\npackage() {\n  install -Dm755 "$srcdir/${linux.filename}" "$pkgdir/usr/bin/moderado"\n}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [manifestPath, outputDirectory, releaseBaseUrl] = process.argv.slice(2);
  Promise.all([readFile(manifestPath, 'utf8'), Promise.resolve(outputDirectory), Promise.resolve(releaseBaseUrl)])
    .then(([raw, output, base]) => generateDistributionManifests(JSON.parse(raw), output, base))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
