import { describe, expect, it } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  buildNpmUpdateInvocation,
  detectInstallChannel,
  fetchPublishedReleases,
  parseInstalledVersion,
  parseReleaseMetadata,
  selectUpdateRelease,
  SelfUpdateError,
  runNpmUpdate,
} from '../src/self_update.js';

const release = (tag_name: string, extra: Record<string, unknown> = {}) => ({
  tag_name,
  html_url: `https://github.com/marcuz-apl/moderado/releases/tag/${tag_name}`,
  draft: false,
  prerelease: false,
  ...extra,
});

describe('install channel', () => {
  it.each([
    ['/usr/local/lib/node_modules/moderado/dist/index.js', 'linux'],
    ['/home/alice/.nvm/versions/node/v20/lib/node_modules/moderado/dist/index.js', 'linux'],
    ['C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\moderado\\dist\\index.js', 'win32'],
  ])('recognizes an npm package CLI at %s', (path, platform) => {
    expect(detectInstallChannel(path, platform)).toEqual({ channel: 'npm' });
  });

  it('recognizes only the installer managed standalone location', () => {
    expect(detectInstallChannel(join(homedir(), '.local', 'bin', 'moderado'), 'linux')).toEqual({ channel: 'standalone' });
    expect(detectInstallChannel('/tmp/moderado', 'linux').channel).toBe('unknown');
  });

  it.each([
    ['/opt/homebrew/Cellar/moderado/0.4.15/bin/moderado', 'darwin', 'homebrew', 'brew upgrade moderado'],
    ['C:\\Users\\alice\\scoop\\apps\\moderado\\current\\moderado-win-x64.exe', 'win32', 'scoop', 'scoop update moderado'],
  ])('guides package-manager updates for %s', (path, platform, manager, guidance) => {
    expect(detectInstallChannel(path, platform)).toEqual({ channel: 'package-manager', manager, guidance });
  });

  it.each([
    ['/home/alice/project/node_modules/moderado/dist/index.js', 'linux'],
    ['/home/alice/.npm/_npx/123/node_modules/moderado/dist/index.js', 'linux'],
    ['C:\\work\\npm\\node_modules\\moderado\\dist\\index.js', 'win32'],
    ['/opt/homebrew/bin/moderado', 'darwin'],
    ['/tmp/node_modules/other/dist/index.js', 'linux'],
    ['', 'linux'],
  ])('does not infer ownership from ambiguous path %s', (path, platform) => {
    expect(detectInstallChannel(path, platform).channel).toBe('unknown');
  });
});

describe('npm update', () => {
  it('targets one validated version and preserves the npm prefix on POSIX', () => {
    expect(buildNpmUpdateInvocation('v0.4.16', 'linux')).toEqual({
      command: 'npm', args: ['install', '--global', 'moderado@0.4.16'],
    });
  });

  it('uses the current npm script through Node when available', () => {
    expect(buildNpmUpdateInvocation('v1.2.3', 'win32', 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js')).toEqual({
      command: process.execPath,
      args: ['C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'install', '--global', 'moderado@1.2.3'],
    });
  });

  it('uses Node with its npm CLI on Windows when no current npm script is known', () => {
    expect(buildNpmUpdateInvocation('v1.2.3', 'win32')).toEqual({
      command: process.execPath,
      args: [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'install', '--global', 'moderado@1.2.3'],
    });
  });

  it.each(['1.2.3', 'v1.2.3; echo bad', 'v1.2.3+build'])('rejects invalid target %s', (target) => {
    expect(() => buildNpmUpdateInvocation(target, 'linux')).toThrow(SelfUpdateError);
  });

  it('runs an argv-only npm child without provider credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moderado-npm-run-'));
    const script = join(dir, 'npm.cjs');
    await writeFile(script, "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), key: process.env.NVIDIA_API_KEY, token: process.env.MODERADO_TOKEN, prefix: process.env.npm_config_prefix }));");
    const previous = { key: process.env.NVIDIA_API_KEY, token: process.env.MODERADO_TOKEN, prefix: process.env.npm_config_prefix };
    process.env.NVIDIA_API_KEY = 'secret-key';
    process.env.MODERADO_TOKEN = 'secret-token';
    process.env.npm_config_prefix = '/custom/prefix';
    try {
      const result = await runNpmUpdate('v0.4.16', process.platform, script);
      expect(JSON.parse(result.stdout)).toEqual({ args: ['install', '--global', 'moderado@0.4.16'], prefix: '/custom/prefix' });
    } finally {
      if (previous.key === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = previous.key;
      if (previous.token === undefined) delete process.env.MODERADO_TOKEN; else process.env.MODERADO_TOKEN = previous.token;
      if (previous.prefix === undefined) delete process.env.npm_config_prefix; else process.env.npm_config_prefix = previous.prefix;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports npm nonzero exits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moderado-npm-fail-'));
    const script = join(dir, 'npm.cjs');
    await writeFile(script, "process.stderr.write('package unavailable'); process.exitCode = 7;");
    try {
      await expect(runNpmUpdate('v0.4.16', process.platform, script)).rejects.toThrow(/package unavailable/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stops an npm child that exceeds the output cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moderado-npm-output-'));
    const script = join(dir, 'npm.cjs');
    await writeFile(script, "process.stdout.write('x'.repeat(70000));");
    try {
      await expect(runNpmUpdate('v0.4.16', process.platform, script)).rejects.toThrow(/output limit/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('release metadata', () => {
  it('parses a stable GitHub release into numeric semantic version parts', () => {
    expect(parseReleaseMetadata(release('v2.10.3'))).toEqual({
      tag_name: 'v2.10.3',
      html_url: 'https://github.com/marcuz-apl/moderado/releases/tag/v2.10.3',
      version: { major: 2, minor: 10, patch: 3 },
    });
  });

  it.each([null, [], {}, { tag_name: 'v1.2.3' }, release('v1.2.3', { draft: 'false' }), release('v1.2.3', { html_url: 'javascript:alert(1)' })])(
    'rejects malformed release shape %#', (value) => {
      expect(() => parseReleaseMetadata(value)).toThrow(SelfUpdateError);
    },
  );

  it.each(['v1.2', '1.2.3', 'v01.2.3', 'v1.2.3-rc.1', 'v1.2.3+build', 'v9007199254740992.0.0'])(
    'rejects invalid release tag %s', (tag) => {
      expect(() => parseReleaseMetadata(release(tag))).toThrow(SelfUpdateError);
    },
  );

  it('skips releases explicitly marked draft or prerelease', () => {
    expect(parseReleaseMetadata(release('v1.2.3', { draft: true }))).toBeNull();
    expect(parseReleaseMetadata(release('v1.2.3', { prerelease: true }))).toBeNull();
  });

  it('parses a connected installed version without comparing build metadata', () => {
    expect(parseInstalledVersion('v0.4.13+2610135')).toEqual({ major: 0, minor: 4, patch: 13 });
    expect(parseInstalledVersion('v0.4.13+261013a')).toEqual({ major: 0, minor: 4, patch: 13 });
    expect(() => parseInstalledVersion('v0.4.13+bad')).toThrow(SelfUpdateError);
  });
});

describe('release selection', () => {
  const releases = ['v2.0.0', 'v1.9.0', 'v1.10.0', 'v1.8.9'].map((tag) => parseReleaseMetadata(release(tag))!);

  it('chooses the highest newer release within the installed major for update', () => {
    expect(selectUpdateRelease(releases, 'v1.8.9+2610135', 'update').tag_name).toBe('v1.10.0');
  });

  it('chooses the highest newer release across majors for upgrade', () => {
    expect(selectUpdateRelease(releases, 'v1.8.9+2610135', 'upgrade').tag_name).toBe('v2.0.0');
  });

  it('reports already current when no newer release exists', () => {
    expect(() => selectUpdateRelease(releases, 'v2.0.0+2610135', 'upgrade')).toThrowError(SelfUpdateError);
    expect(() => selectUpdateRelease(releases, 'v2.0.0+2610135', 'upgrade')).toThrow(/already current/i);
  });

  it('reports no compatible release when only another major is available', () => {
    expect(() => selectUpdateRelease(releases, 'v3.0.0+2610135', 'update')).toThrow(/no compatible release/i);
  });
});

describe('fetchPublishedReleases', () => {
  it('fetches pages through an injected fetch and ignores marked drafts', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      urls.push(String(url));
      if (urls.length === 1) return new Response(JSON.stringify([release('v1.0.0'), release('v1.1.0', { draft: true })]), {
        headers: { Link: '<https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=2>; rel="next"' },
      });
      return new Response(JSON.stringify([release('v2.0.0')]));
    };
    const result = await fetchPublishedReleases(fetchImpl as typeof fetch);
    expect(result.map((item) => item.tag_name)).toEqual(['v1.0.0', 'v2.0.0']);
    expect(urls).toEqual([
      'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100',
      'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=2',
    ]);
  });

  it.each([{}, null, [release('v1.0.0'), release('v1.0.0')], [release('v1.0.0', { tag_name: 'bad' })]])(
    'rejects invalid or duplicate stable releases %#', async (payload) => {
      await expect(fetchPublishedReleases(async () => new Response(JSON.stringify(payload)))).rejects.toThrow(SelfUpdateError);
    },
  );

  it('rejects HTTP errors and unsafe pagination links', async () => {
    await expect(fetchPublishedReleases(async () => new Response('missing', { status: 404 }))).rejects.toThrow(/HTTP 404/);
    await expect(fetchPublishedReleases(async () => new Response('[]', {
      headers: { Link: '<https://evil.example/releases?page=2>; rel="next"' },
    }))).rejects.toThrow(/pagination/i);
  });

  it.each([
    'https://user:secret@api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=2',
    'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&per_page=1&page=2',
    'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=3',
  ])('rejects a pagination link that could skip or redirect release results', async (next) => {
    let calls = 0;
    await expect(fetchPublishedReleases(async () => {
      calls++;
      return new Response('[]', calls === 1 ? { headers: { Link: `<${next}>; rel="next"` } } : undefined);
    })).rejects.toThrow(/pagination/i);
  });

  it('fails closed when a next page remains after ten pages', async () => {
    let pages = 0;
    const fetchImpl = async () => {
      pages++;
      return new Response('[]', { headers: { Link: `<https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=${pages + 1}>; rel="next"` } });
    };
    await expect(fetchPublishedReleases(fetchImpl as typeof fetch)).rejects.toThrow(/10 pages/);
    expect(pages).toBe(10);
  });

  it('passes cancellation signal to fetch', async () => {
    const controller = new AbortController();
    const fetchImpl = async (_url: string | URL | Request, options?: RequestInit) => {
      expect(options?.signal).toBe(controller.signal);
      return new Response('[]');
    };
    await fetchPublishedReleases(fetchImpl as typeof fetch, controller.signal);
  });
});
