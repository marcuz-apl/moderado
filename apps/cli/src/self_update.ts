import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { chmod, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const RELEASES_URL = 'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100';
const RELEASE_TAG_PATH = '/marcuz-apl/moderado/releases/tag/';
const MAX_PAGES = 10;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SIDECAR_BYTES = 1024;
const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type SemanticVersion = { major: number; minor: number; patch: number };
export type UpdateRelease = { tag_name: string; html_url: string; version: SemanticVersion };

export class SelfUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfUpdateError';
  }
}

async function readLimitedText(response: Response, maxBytes: number, label: string, signal?: AbortSignal): Promise<string> {
  if (!response.body) throw new SelfUpdateError(`${label} response has no body`);
  const reader = response.body.getReader();
  const abortReader = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abortReader, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new SelfUpdateError(`${label} read cancelled`);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SelfUpdateError(`${label} response exceeds size limit (${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SelfUpdateError) throw error;
    throw new SelfUpdateError(`Could not read ${label} response: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    signal?.removeEventListener('abort', abortReader);
  }
  return Buffer.concat(chunks, size).toString('utf8');
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
  | { channel: 'npm'; prefix: string }
  | { channel: 'standalone' }
  | { channel: 'package-manager'; manager: 'homebrew' | 'scoop'; guidance: string }
  | { channel: 'unknown'; guidance: string };

export function detectInstallChannel(executablePath: string | undefined, platform: string = process.platform): InstallChannel {
  const unknown: InstallChannel = { channel: 'unknown', guidance: 'Update this installation with its original installer or package manager.' };
  if (!executablePath) return unknown;
  let resolved: string;
  try {
    resolved = realpathSync(executablePath);
    if (!statSync(resolved).isFile()) return unknown;
  } catch {
    return unknown;
  }
  const path = resolved.replace(/\\/g, '/');
  const matchPath = platform === 'win32' ? path.toLowerCase() : path;
  if (platform === 'darwin' && /^\/(?:opt\/homebrew|usr\/local)\/Cellar\/moderado\/[^/]+\/bin\/moderado$/.test(matchPath)) {
    return { channel: 'package-manager', manager: 'homebrew', guidance: 'brew upgrade moderado' };
  }
  if (platform === 'win32' && /^(?:[a-z]:\/|\/)[^\n]*\/scoop\/apps\/moderado\/(?:current|[^/]+)\/moderado-win-x64\.exe$/.test(matchPath)) {
    return { channel: 'package-manager', manager: 'scoop', guidance: 'scoop update moderado' };
  }
  const npmLayout = platform === 'win32'
    ? /^(.*\/appdata\/roaming\/npm)\/node_modules\/moderado\/dist\/index\.js$/.exec(matchPath)
    : /^(.*)\/lib\/node_modules\/moderado\/dist\/index\.js$/.exec(matchPath);
  if (npmLayout && !matchPath.includes('/_npx/')) {
    try {
      const packageJson = JSON.parse(readFileSync(join(dirname(dirname(resolved)), 'package.json'), 'utf8')) as Record<string, unknown>;
      const bin = packageJson.bin;
      if (packageJson.name === 'moderado' && bin && typeof bin === 'object' && !Array.isArray(bin) &&
          (bin as Record<string, unknown>).moderado === './dist/index.js') {
        return { channel: 'npm', prefix: path.slice(0, npmLayout[1].length) || '/' };
      }
    } catch {
      return unknown;
    }
  }
  if (platform !== 'win32' && matchPath === join(homedir(), '.local', 'bin', 'moderado').replace(/\\/g, '/') &&
      resolved === realpathSync(process.execPath)) {
    return { channel: 'standalone' };
  }
  return unknown;
}

function verifiedNpmCli(path: string): string | null {
  let resolved: string;
  try {
    resolved = realpathSync(path);
    if (!statSync(resolved).isFile() || !resolved.replace(/\\/g, '/').endsWith('/node_modules/npm/bin/npm-cli.js')) return null;
    const packageJson = JSON.parse(readFileSync(join(dirname(dirname(resolved)), 'package.json'), 'utf8')) as Record<string, unknown>;
    const bin = packageJson.bin;
    return packageJson.name === 'npm' && bin && typeof bin === 'object' && !Array.isArray(bin) &&
      (bin as Record<string, unknown>).npm === 'bin/npm-cli.js' ? resolved : null;
  } catch {
    return null;
  }
}

export function buildNpmUpdateInvocation(
  version: string, platform: string = process.platform, npmExecPath?: string, prefix?: string,
): { command: string; args: string[] } {
  const { major, minor, patch } = parseVersion(version);
  if (prefix !== undefined && (!prefix || !/^(?:\/|[a-zA-Z]:[\\/])/.test(prefix) || prefix.includes('\0'))) {
    throw new SelfUpdateError('Cannot update: npm install prefix must be an absolute path');
  }
  const adjacentNpm = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const posixNpm = join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const knownNpm = (platform === 'win32' ? [adjacentNpm, posixNpm] : [posixNpm, adjacentNpm])
    .map(verifiedNpmCli).filter((path): path is string => path !== null);
  const requestedNpm = npmExecPath === undefined ? undefined : verifiedNpmCli(npmExecPath);
  const npmCli = npmExecPath === undefined ? knownNpm[0] : knownNpm.find((path) => path === requestedNpm);
  if (!npmCli) throw new SelfUpdateError('Cannot locate a verified npm CLI; update manually with npm install -g moderado');
  const args = [npmCli, 'install', '--global', ...(prefix === undefined ? [] : ['--prefix', prefix]), `moderado@${major}.${minor}.${patch}`];
  return { command: process.execPath, args };
}

export async function runNpmUpdate(
  version: string, platform: string = process.platform, npmExecPath: string | undefined = process.env.npm_execpath,
  prefix?: string, signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  if (signal?.aborted) throw new SelfUpdateError('npm update cancelled');
  const { command, args } = buildNpmUpdateInvocation(version, platform, npmExecPath, prefix);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:_API_KEY|_TOKEN|_SECRET_ACCESS_KEY)$/i.test(key) || /^(?:AWS_ACCESS_KEY_ID|GH_TOKEN)$/i.test(key)) {
      delete env[key];
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, env, windowsHide: true, timeout: 120_000 });
    const abort = () => child.kill();
    let wasAborted = false;
    const onAbort = () => { wasAborted = true; abort(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const optionsSignalCleanup = () => signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) onAbort();
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
    child.on('error', (error) => {
      optionsSignalCleanup();
      reject(new SelfUpdateError(`Could not start npm: ${error.message}`));
    });
    child.on('close', (code, exitSignal) => {
      optionsSignalCleanup();
      if (wasAborted) reject(new SelfUpdateError('npm update cancelled'));
      else if (outputExceeded) reject(new SelfUpdateError('npm update exceeded the output limit'));
      else if (exitSignal) reject(new SelfUpdateError(`npm update stopped (${exitSignal})`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new SelfUpdateError(`npm update failed (exit ${code ?? 'unknown'}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export type StandaloneUpdateOptions = {
  release: UpdateRelease;
  executablePath: string;
  platform: string;
  architecture: string;
  fetchImpl?: typeof fetch;
  renameImpl?: typeof rename;
  chmodImpl?: typeof chmod;
  signal?: AbortSignal;
};

type ReleaseArtifact = {
  target: string; filename: string; platform: string; architecture: string;
  size: number; checksum: string; signed: false;
};

export async function updateStandalone(options: StandaloneUpdateOptions): Promise<void> {
  const { release, executablePath, platform, architecture } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = options.signal;
  if (signal?.aborted) throw new SelfUpdateError('Standalone update cancelled');
  if (!executablePath || !release || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(release.tag_name)) {
    throw new SelfUpdateError('Cannot update standalone binary: invalid release or executable path');
  }
  const targets: Record<string, { target: string; filename: string }> = {
    'win32-x64': { target: 'node22-win-x64', filename: 'moderado-win-x64.exe' },
    'darwin-arm64': { target: 'node22-macos-arm64', filename: 'moderado-macos-arm64' },
    'linux-x64': { target: 'node22-linux-x64', filename: 'moderado-linux-x64' },
  };
  const targetDetails = new Map(Object.entries(targets).map(([hostKey, value]) => {
    const [targetPlatform, targetArchitecture] = hostKey.split('-');
    return [value.target, { ...value, platform: targetPlatform, architecture: targetArchitecture }] as const;
  }));
  const host = targets[`${platform}-${architecture}`];
  if (!host) throw new SelfUpdateError(`Unsupported standalone platform: ${platform} ${architecture}`);
  const base = `https://github.com/marcuz-apl/moderado/releases/download/${release.tag_name}`;
  const get = async (url: string): Promise<Response> => {
    let response: Response;
    try { response = await fetchImpl(url, { signal }); } catch (error) {
      throw new SelfUpdateError(`Standalone update download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new SelfUpdateError(`Standalone update download failed: HTTP ${response.status}`);
    return response;
  };
  let manifest: unknown;
  try { manifest = JSON.parse(await readLimitedText(await get(`${base}/manifest.json`), MAX_MANIFEST_BYTES, 'Standalone manifest', signal)); } catch (error) {
    if (error instanceof SelfUpdateError) throw error;
    throw new SelfUpdateError('Standalone release manifest is malformed');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new SelfUpdateError('Standalone release manifest is malformed');
  const data = manifest as Record<string, unknown>;
  if (data.version !== release.tag_name || !Array.isArray(data.artifacts)) throw new SelfUpdateError('Standalone release manifest version or artifacts are invalid');
  const seen = new Set<string>();
  let artifact: ReleaseArtifact | undefined;
  for (const item of data.artifacts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new SelfUpdateError('Standalone release manifest contains an invalid artifact');
    const entry = item as Record<string, unknown>;
    if (typeof entry.target !== 'string' || seen.has(entry.target)) throw new SelfUpdateError('Standalone release manifest contains duplicate targets');
    seen.add(entry.target);
    if (typeof entry.filename !== 'string' || basename(entry.filename) !== entry.filename || /[\\/\0]/.test(entry.filename) ||
        typeof entry.platform !== 'string' || typeof entry.architecture !== 'string' ||
        !Number.isSafeInteger(entry.size) || (entry.size as number) < 1 ||
        typeof entry.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(entry.checksum) || entry.signed !== false) {
      throw new SelfUpdateError('Standalone release manifest contains an invalid artifact');
    }
    const expected = targetDetails.get(entry.target);
    if (!expected || entry.filename !== expected.filename || entry.platform !== expected.platform || entry.architecture !== expected.architecture) {
      throw new SelfUpdateError('Standalone release manifest contains an unsupported artifact target');
    }
    if (entry.target === host.target && entry.platform === platform && entry.architecture === architecture) {
      artifact = entry as ReleaseArtifact;
    }
  }
  if (!artifact || artifact.filename !== host.filename) throw new SelfUpdateError(`Standalone release has no artifact for ${platform} ${architecture}`);
  const [artifactResponse, sidecarResponse] = await Promise.all([
    get(`${base}/${artifact.filename}`), get(`${base}/${artifact.filename}.sha256`),
  ]);
  if (signal?.aborted) throw new SelfUpdateError('Standalone update cancelled');
  const stagedPath = join(dirname(executablePath), `.${basename(executablePath)}.${randomUUID()}.tmp`);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let operationError: unknown;
  let abortReader: (() => void) | undefined;
  try {
    if (!artifactResponse.body) throw new SelfUpdateError('Standalone artifact response had no body');
    file = await open(stagedPath, 'wx', 0o600);
    const reader = artifactResponse.body.getReader();
    abortReader = () => { void reader.cancel().catch(() => undefined); };
    signal?.addEventListener('abort', abortReader, { once: true });
    const hash = createHash('sha256');
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new SelfUpdateError('Standalone update cancelled');
      if (done) break;
      size += value.byteLength;
      if (size > artifact.size) throw new SelfUpdateError(`Standalone artifact exceeds manifest size for ${artifact.filename}`);
      hash.update(value);
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
        if (bytesWritten === 0) throw new SelfUpdateError('Could not write staged standalone artifact');
        offset += bytesWritten;
      }
    }
    if (size !== artifact.size) throw new SelfUpdateError(`Standalone artifact size verification failed for ${artifact.filename}`);
    const [checksum, sidecar] = await Promise.all([
      Promise.resolve(hash.digest('hex')),
      readLimitedText(sidecarResponse, MAX_SIDECAR_BYTES, 'Standalone sidecar', signal),
    ]);
    if (sidecar !== `${artifact.checksum}  ${artifact.filename}\n` || checksum !== artifact.checksum) {
      throw new SelfUpdateError(`Standalone artifact checksum verification failed for ${artifact.filename}`);
    }
    await file.close();
    file = undefined;
    if (platform !== 'win32') await (options.chmodImpl ?? chmod)(stagedPath, 0o755);
    if (signal?.aborted) throw new SelfUpdateError('Standalone update cancelled');
    try {
      await (options.renameImpl ?? rename)(stagedPath, executablePath);
    } catch (error) {
      const detail = platform === 'win32'
        ? `Exit Moderado, then download https://github.com/marcuz-apl/moderado/releases/download/${release.tag_name}/${artifact.filename} and use File Explorer to replace this executable. Open a new terminal when done.`
        : 'Check that the executable directory is writable and retry.';
      throw new SelfUpdateError(`Could not replace standalone executable. ${detail} (${error instanceof Error ? error.message : String(error)})`);
    }
  } catch (error) {
    const failure = error instanceof SelfUpdateError ? error : new SelfUpdateError(`Standalone artifact download or staging failed: ${error instanceof Error ? error.message : String(error)}`);
    operationError = failure;
    throw failure;
  } finally {
    if (abortReader) signal?.removeEventListener('abort', abortReader);
    let cleanupError: unknown;
    try { await file?.close(); } catch (error) { cleanupError = error; }
    try {
      await unlink(stagedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupError ??= error;
    }
    if (operationError === undefined && cleanupError !== undefined) {
      throw new SelfUpdateError(`Could not clean up staged standalone artifact: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
  }
}

export async function handleSelfUpdateCommand(
  mode: 'update' | 'upgrade', installedVersion: string, signal: AbortSignal,
): Promise<number> {
  const write = (message: string) => process.stdout.write(`${message}\n`);
  try {
    if (signal.aborted) throw new SelfUpdateError('Update cancelled. Run the command again when ready.');
    const releases = await fetchPublishedReleases(fetch, signal);
    let release: UpdateRelease;
    try {
      release = selectUpdateRelease(releases, installedVersion, mode);
    } catch (error) {
      if (error instanceof SelfUpdateError && error.message === 'Already current') {
        const installed = parseInstalledVersion(installedVersion);
        const targetVersion = `v${installed.major}.${installed.minor}.${installed.patch}`;
        write(`Installed version: ${installedVersion}`);
        write(`Target version: ${targetVersion}`);
        write('Already current.');
        return 0;
      }
      throw error;
    }
    write(`Installed version: ${installedVersion}`);
    write(`Target version: ${release.tag_name}`);
    const channel = detectInstallChannel(process.argv[1]);
    if (channel.channel === 'package-manager') {
      write(`Update with your package manager: ${channel.guidance}`);
      return 1;
    }
    if (channel.channel === 'unknown') {
      throw new SelfUpdateError(`Cannot safely identify this installation. ${channel.guidance}`);
    }
    if (signal.aborted) throw new SelfUpdateError('Update cancelled. Run the command again when ready.');
    if (channel.channel === 'npm') {
      await runNpmUpdate(release.tag_name, process.platform, process.env.npm_execpath, channel.prefix, signal);
    } else {
      await updateStandalone({
        release, executablePath: process.argv[1] ?? '', platform: process.platform, architecture: process.arch, signal,
      });
    }
    write(`Updated successfully to ${release.tag_name}. Restart Moderado to use the new version.`);
    return 0;
  } catch (error) {
    process.stderr.write(`Update failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
