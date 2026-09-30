import type { HostResult } from '@moderado/contracts';

export type AboutResult = Extract<HostResult, { type: 'about' }>;

/**
 * Build the About page from the packaged manifest, so the displayed version is
 * the one actually installed rather than a value duplicated in source.
 *
 * Everything here is metadata that becomes an anchor in the webview, so each URL
 * is required to be a real https link: `javascript:` would be script execution.
 */
export function buildAbout(manifest: Record<string, unknown>): AboutResult {
  const repository = normalizeRepository(manifest.repository);
  const homepage = typeof manifest.homepage === 'string' ? manifest.homepage : undefined;
  const documentation = httpsUrl(homepage ?? repository, 'homepage');
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
  const description = typeof manifest.description === 'string' ? manifest.description.trim() : '';
  const license = typeof manifest.license === 'string' ? manifest.license.trim() : '';
  if (!version) throw new Error('Extension manifest has no version.');
  if (!description) throw new Error('Extension manifest has no description.');
  return {
    type: 'about',
    version,
    license: license || 'See repository',
    description,
    documentation,
    repository,
    issues: httpsUrl(issuesUrl(manifest) ?? `${repository}/issues`, 'bugs'),
  };
}

function issuesUrl(manifest: Record<string, unknown>): string | undefined {
  const bugs = manifest.bugs;
  if (typeof bugs === 'string') return bugs;
  if (bugs && typeof bugs === 'object' && typeof (bugs as { url?: unknown }).url === 'string') {
    return (bugs as { url: string }).url;
  }
  return undefined;
}

/** Accept both the string and `{ url }` shapes npm allows for `repository`. */
function normalizeRepository(repository: unknown): string {
  const raw = typeof repository === 'string'
    ? repository
    : repository && typeof repository === 'object' && typeof (repository as { url?: unknown }).url === 'string'
      ? (repository as { url: string }).url
      : '';
  // npm records git remotes as `git+https://host/org/repo.git#ref`.
  return raw.replace(/^git\+/, '').replace(/\.git(#.*)?$/, '').replace(/#.*$/, '');
}

function httpsUrl(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('https://')) throw new Error(`Extension manifest ${field} must be an https URL.`);
  return trimmed;
}