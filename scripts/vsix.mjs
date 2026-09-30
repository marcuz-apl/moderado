import { buildZip } from './zip.mjs';

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);

const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="cjs" ContentType="application/javascript" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
`;

/**
 * Build the VSIX (an OPC package) for the extension.
 *
 * Only what an install needs is included: the bundled entrypoint, the webview
 * assets, the manifest, and the README. Sources, maps, tests, and node_modules
 * stay out, and the manifest is required to be publishable so a broken package
 * fails here rather than in the marketplace.
 */
export function buildVsix(manifest, files) {
  const { name, displayName, description, version, publisher, engines, license, categories } = manifest;
  for (const [field, value] of Object.entries({ name, displayName, description, version, publisher })) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Extension manifest ${field} is required to package a VSIX.`);
  }
  const entry = String(manifest.main ?? '').replace(/^\.\//, '');
  if (!files[entry]) throw new Error(`Missing packaged entrypoint ${entry}; run the extension build first.`);

  const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(publisher)}" Version="${escapeXml(version)}" Publisher="${escapeXml(publisher)}" />
    <DisplayName>${escapeXml(displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(description)}</Description>
    <Tags>ai,agent,coding-agent</Tags>
    <Categories>${escapeXml(categories ?? 'Other')}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(engines?.vscode ?? '^1.90.0')}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${escapeXml(manifest.repository?.url ?? '')}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;

  const entries = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: 'extension.vsixmanifest', data: vsixManifest },
    { name: 'extension/package.json', data: `${JSON.stringify(manifest, null, 2)}\n` },
  ];
  // A caller that also passes package.json would emit the path twice, and a
  // reader may take either copy. Refuse rather than ship an ambiguous archive.
  for (const [relative] of Object.entries(files)) {
    if (relative === 'package.json') throw new Error('package.json is written by buildVsix; do not pass it in files.');
    entries.push({ name: `extension/${relative}`, data: files[relative] });
  }
  return buildZip(entries);
}

export { escapeXml };