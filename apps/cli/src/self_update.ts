import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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

export type InstallChannel =
  | { channel: 'npm' }
  | { channel: 'standalone' }
  | { channel: 'package-manager'; manager: 'homebrew' | 'scoop'; guidance: string }
  | { channel: 'unknown'; guidance: string };

export function detectInstallChannel(executablePath: string | undefined, platform: string = process.platform): InstallChannel {
  const unknown: InstallChannel = { channel: 'unknown', guidance: 'Update this installation with its original installer or package manager.' };
  if (!executablePath) return unknown;
  let resolved = executablePath;
  try {
    resolved = realpathSync(executablePath);
  } catch {
    // The path may be supplied for inspection before it exists.
  }
  const path = resolved.replace(/\\/g, '/');
  const matchPath = platform === 'win32' ? path.toLowerCase() : path;
  if (platform === 'darwin' && /^\/(?:opt\/homebrew|usr\/local)\/Cellar\/moderado\/[^/]+\/bin\/moderado$/.test(matchPath)) {
    return { channel: 'package-manager', manager: 'homebrew', guidance: 'brew upgrade moderado' };
  }
  if (platform === 'win32' && /^(?:[a-z]:\/|\/)[^\n]*\/scoop\/apps\/moderado\/(?:current|[^/]+)\/moderado-win-x64\.exe$/.test(matchPath)) {
    return { channel: 'package-manager', manager: 'scoop', guidance: 'scoop update moderado' };
  }
  if (platform === 'win32') {
    if (/\/appdata\/roaming\/npm\/node_modules\/moderado\/dist\/index\.js$/.test(matchPath) && !matchPath.includes('/_npx/')) {
      return { channel: 'npm' };
    }
  } else if (/(?:^|\/)lib\/node_modules\/moderado\/dist\/index\.js$/.test(matchPath) && !matchPath.includes('/_npx/')) {
    return { channel: 'npm' };
  }
  if (platform !== 'win32' && matchPath === join(homedir(), '.local', 'bin', 'moderado').replace(/\\/g, '/')) {
    return { channel: 'standalone' };
  }
  return unknown;
}

export function buildNpmUpdateInvocation(
  version: string, platform: string = process.platform, npmExecPath?: string,
): { command: string; args: string[] } {
  const { major, minor, patch } = parseVersion(version);
  const args = ['install', '--global', `moderado@${major}.${minor}.${patch}`];
  if (npmExecPath || platform === 'win32') {
    return {
      command: process.execPath,
      args: [npmExecPath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args],
    };
  }
  return { command: 'npm', args };
}

export async function runNpmUpdate(
  version: string, platform: string = process.platform, npmExecPath: string | undefined = process.env.npm_execpath,
): Promise<{ stdout: string; stderr: string }> {
  const { command, args } = buildNpmUpdateInvocation(version, platform, npmExecPath);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:_API_KEY|_TOKEN|_SECRET_ACCESS_KEY)$/i.test(key) || /^(?:AWS_ACCESS_KEY_ID|GH_TOKEN)$/i.test(key)) {
      delete env[key];
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, env, windowsHide: true, timeout: 120_000 });
    let stdout = '';
    let stderr = '';
    let outputExceeded = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > 64 * 1024) {
        outputExceeded = true;
        child.kill();
      } else stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length + chunk.length > 64 * 1024) {
        outputExceeded = true;
        child.kill();
      } else stderr += chunk;
    });
    child.on('error', (error) => reject(new SelfUpdateError(`Could not start npm: ${error.message}`)));
    child.on('close', (code, signal) => {
      if (outputExceeded) reject(new SelfUpdateError('npm update exceeded the output limit'));
      else if (signal) reject(new SelfUpdateError(`npm update stopped (${signal})`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new SelfUpdateError(`npm update failed (exit ${code ?? 'unknown'}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}
