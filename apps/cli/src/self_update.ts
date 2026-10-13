const RELEASES_URL = 'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100';
const RELEASE_TAG_PATH = '/marcuz-apl/moderado/releases/tag/';
const MAX_PAGES = 10;
const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type SemanticVersion = { major: number; minor: number; patch: number };
export type UpdateRelease = { tag_name: string; html_url: string; version: SemanticVersion };

export class SelfUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfUpdateError';
  }
}

function parseVersion(value: string): SemanticVersion {
  const match = VERSION.exec(value);
  if (!match) throw new SelfUpdateError(`Invalid version: ${value}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new SelfUpdateError(`Invalid version: ${value}`);
  }
  return { major, minor, patch };
}

export function parseInstalledVersion(value: string): SemanticVersion {
  const match = /^(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:\+\d{6}[0-9a-zA-Z])?$/.exec(value);
  if (!match) throw new SelfUpdateError(`Invalid installed version: ${value}`);
  return parseVersion(match[1]);
}

export function parseReleaseMetadata(value: unknown): UpdateRelease | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SelfUpdateError('Invalid GitHub release: expected an object');
  }
  const release = value as Record<string, unknown>;
  if (typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean') {
    throw new SelfUpdateError('Invalid GitHub release: draft and prerelease must be booleans');
  }
  if (release.draft || release.prerelease) return null;
  if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') {
    throw new SelfUpdateError('Invalid GitHub release: missing tag or URL');
  }
  const version = parseVersion(release.tag_name);
  let url: URL;
  try {
    url = new URL(release.html_url);
  } catch {
    throw new SelfUpdateError(`Invalid GitHub release URL for ${release.tag_name}`);
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port ||
      url.pathname !== `${RELEASE_TAG_PATH}${release.tag_name}` || url.search || url.hash) {
    throw new SelfUpdateError(`Invalid GitHub release URL for ${release.tag_name}`);
  }
  return { tag_name: release.tag_name, html_url: release.html_url, version };
}

function compareVersions(a: SemanticVersion, b: SemanticVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function selectUpdateRelease(
  releases: UpdateRelease[], installedVersion: string, mode: 'update' | 'upgrade',
): UpdateRelease {
  const installed = parseInstalledVersion(installedVersion);
  if (mode !== 'update' && mode !== 'upgrade') throw new SelfUpdateError(`Invalid update mode: ${String(mode)}`);
  const compatible = releases.filter((release) => mode === 'upgrade' || release.version.major === installed.major);
  if (compatible.length === 0) throw new SelfUpdateError('No compatible release available');
  const latest = compatible.reduce((best, release) => compareVersions(release.version, best.version) > 0 ? release : best);
  if (compareVersions(latest.version, installed) <= 0) throw new SelfUpdateError('Already current');
  return latest;
}

function nextPage(linkHeader: string | null, currentPage: number): string | null {
  if (!linkHeader) return null;
  const next = linkHeader.split(',').map((part) => /<([^>]+)>\s*;\s*rel="?next"?(?:\s*;.*)?$/.exec(part.trim()))
    .filter((match): match is RegExpExecArray => match !== null);
  if (next.length === 0) return null;
  if (next.length !== 1) throw new SelfUpdateError('Invalid GitHub pagination link');
  let url: URL;
  try {
    url = new URL(next[0][1]);
  } catch {
    throw new SelfUpdateError('Invalid GitHub pagination link');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || url.port || url.username || url.password ||
      url.pathname !== '/repos/marcuz-apl/moderado/releases' ||
      url.searchParams.size !== 2 || url.searchParams.getAll('per_page').length !== 1 ||
      url.searchParams.get('per_page') !== '100' || url.searchParams.getAll('page').length !== 1 ||
      url.searchParams.get('page') !== String(currentPage + 1) ||
      url.hash) {
    throw new SelfUpdateError('Invalid GitHub pagination link');
  }
  return url.href;
}

export async function fetchPublishedReleases(
  fetchImpl: typeof fetch = fetch, signal?: AbortSignal,
): Promise<UpdateRelease[]> {
  const releases: UpdateRelease[] = [];
  const tags = new Set<string>();
  const visited = new Set<string>();
  let url: string | null = RELEASES_URL;
  for (let page = 1; url !== null && page <= MAX_PAGES; page++) {
    if (visited.has(url)) throw new SelfUpdateError('Repeated GitHub pagination link');
    visited.add(url);
    const response = await fetchImpl(url, { signal, headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new SelfUpdateError(`GitHub releases request failed: HTTP ${response.status}`);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SelfUpdateError('Invalid GitHub releases JSON');
    }
    if (!Array.isArray(payload)) throw new SelfUpdateError('Invalid GitHub releases: expected an array');
    for (const item of payload) {
      const release = parseReleaseMetadata(item);
      if (release === null) continue;
      if (tags.has(release.tag_name)) throw new SelfUpdateError(`Duplicate GitHub release tag: ${release.tag_name}`);
      tags.add(release.tag_name);
      releases.push(release);
    }
    url = nextPage(response.headers.get('link'), page);
    if (page === MAX_PAGES && url !== null) throw new SelfUpdateError(`GitHub release lookup exceeded ${MAX_PAGES} pages`);
  }
  return releases;
}
