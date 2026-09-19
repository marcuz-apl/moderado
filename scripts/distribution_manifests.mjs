import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function versionWithoutPrefix(version) { return version.replace(/^v/, '').split('+')[0]; }

export async function generateDistributionManifests(manifest, outputDirectory, releaseBaseUrl) {
  if (!manifest?.version || !Array.isArray(manifest.artifacts) || !releaseBaseUrl) throw new Error('A verified binary manifest and release URL are required.');
  const version = versionWithoutPrefix(manifest.version);
  const artifact = manifest.artifacts[0];
  if (!artifact || artifact.signed !== false) throw new Error('Only unsigned verified artifacts may be staged.');
  const url = `${releaseBaseUrl}/${artifact.filename}`;
  await Promise.all(['homebrew', 'scoop', 'winget'].map((directory) => mkdir(join(outputDirectory, directory), { recursive: true })));
  await writeFile(join(outputDirectory, 'homebrew', 'moderado.rb'), `class Moderado < Formula\n  desc "Free-first AI coding agent"\n  homepage "https://github.com/marcuz-apl/moderado"\n  version "${version}"\n  url "${url}"\n  sha256 "${artifact.checksum}"\n  def install\n    bin.install "${artifact.filename}" => "moderado"\n  end\nend\n`);
  await writeFile(join(outputDirectory, 'scoop', 'moderado.json'), `${JSON.stringify({ version, description: 'Free-first AI coding agent', homepage: 'https://github.com/marcuz-apl/moderado', architecture: { '64bit': { url, hash: artifact.checksum } }, bin: 'moderado-win-x64.exe' }, null, 2)}\n`);
  await writeFile(join(outputDirectory, 'winget', 'Moderado.yaml'), `PackageIdentifier: MarcuzApl.Moderado\nPackageVersion: ${version}\nPackageName: Moderado\nPublisher: Marcuz Apl\nInstallerType: portable\nInstallers:\n- Architecture: x64\n  InstallerUrl: ${url}\n  InstallerSha256: ${artifact.checksum}\nManifestType: singleton\nManifestVersion: 1.6.0\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [manifestPath, outputDirectory, releaseBaseUrl] = process.argv.slice(2);
  Promise.all([readFile(manifestPath, 'utf8'), Promise.resolve(outputDirectory), Promise.resolve(releaseBaseUrl)])
    .then(([raw, output, base]) => generateDistributionManifests(JSON.parse(raw), output, base))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
