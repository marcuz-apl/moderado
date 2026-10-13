import { describe, expect, it } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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

async function npmInstallFixture() {
  const prefix = await mkdtemp(join(tmpdir(), 'moderado-prefix-'));
  const packageDir = join(prefix, 'lib', 'node_modules', 'moderado');
  const script = join(packageDir, 'dist', 'index.js');
  await mkdir(join(packageDir, 'dist'), { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'moderado', bin: { moderado: './dist/index.js' } }));
  await writeFile(script, '');
  return { prefix, packageDir, script, cleanup: () => rm(prefix, { recursive: true, force: true }) };
}

async function npmCliFixture(source: string) {
  const root = await mkdtemp(join(tmpdir(), 'moderado-npm-cli-'));
  const packageDir = join(root, 'node_modules', 'npm');
  const script = join(packageDir, 'bin', 'npm-cli.js');
  const node = join(root, 'node');
  await mkdir(join(packageDir, 'bin'), { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'npm', bin: { npm: 'bin/npm-cli.js' } }));
  await writeFile(script, source);
  await symlink(process.execPath, node);
  return { root, script, node, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function withFixtureNode<T>(node: string, run: () => T | Promise<T>): Promise<T> {
  const original = process.execPath;
  process.execPath = node;
  try {
    return await run();
  } finally {
    process.execPath = original;
  }
}

describe('install channel', () => {
  it('derives and preserves the active npm global prefix from a real Moderado package', async () => {
    const fixture = await npmInstallFixture();
    try {
      expect(detectInstallChannel(fixture.script, 'linux')).toEqual({ channel: 'npm', prefix: realpathSync(fixture.prefix) });
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not trust missing, renamed, or symlinked package files', async () => {
    const fixture = await npmInstallFixture();
    const outside = join(fixture.prefix, 'outside.js');
    try {
      expect(detectInstallChannel(join(fixture.packageDir, 'dist', 'missing.js'), 'linux').channel).toBe('unknown');
      await writeFile(join(fixture.packageDir, 'package.json'), JSON.stringify({ name: 'other', bin: { moderado: './dist/index.js' } }));
      expect(detectInstallChannel(fixture.script, 'linux').channel).toBe('unknown');
      await writeFile(join(fixture.packageDir, 'package.json'), JSON.stringify({ name: 'moderado', bin: { moderado: './dist/index.js' } }));
      await rm(fixture.script);
      await writeFile(outside, '');
      await symlink(outside, fixture.script);
      expect(detectInstallChannel(fixture.script, 'linux').channel).toBe('unknown');
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not identify a nonexistent installer binary as managed standalone', () => {
    expect(detectInstallChannel(join(homedir(), '.local', 'bin', 'moderado'), 'linux').channel).toBe('unknown');
  });
  it.each([
    ['/home/alice/project/node_modules/moderado/dist/index.js', 'linux'],
    ['/home/alice/.npm/_npx/123/node_modules/moderado/dist/index.js', 'linux'],
    ['C:\\work\\npm\\node_modules\\moderado\\dist\\index.js', 'win32'],
    ['/opt/homebrew/bin/moderado', 'darwin'],
    ['/opt/homebrew/Cellar/moderado/0.4.15/bin/moderado', 'darwin'],
    ['C:\\Users\\alice\\scoop\\apps\\moderado\\current\\moderado-win-x64.exe', 'win32'],
    ['/tmp/node_modules/other/dist/index.js', 'linux'],
    ['', 'linux'],
  ])('does not infer ownership from ambiguous path %s', (path, platform) => {
    expect(detectInstallChannel(path, platform).channel).toBe('unknown');
  });
});

describe('npm update', () => {
  it('rejects a forged npm package outside the running Node installation without executing it', async () => {
    const marker = join(tmpdir(), `moderado-forged-npm-${process.pid}`);
    const fixture = await npmCliFixture(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    try {
      await expect(runNpmUpdate('v0.4.16', process.platform, fixture.script)).rejects.toThrow(/verified npm/i);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await rm(marker, { force: true });
      await fixture.cleanup();
    }
  });
  it('adds the actual install prefix to a one-off global update', async () => {
    const fixture = await npmCliFixture('');
    try {
      await withFixtureNode(fixture.node, () => {
        expect(buildNpmUpdateInvocation('v0.4.16', 'linux', fixture.script, '/tmp/custom-prefix')).toEqual({
          command: fixture.node,
          args: [realpathSync(fixture.script), 'install', '--global', '--prefix', '/tmp/custom-prefix', 'moderado@0.4.16'],
        });
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects an arbitrary npm_execpath and unsafe prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moderado-wrong-npm-'));
    const script = join(root, 'npm-cli.js');
    await writeFile(script, '');
    try {
      expect(() => buildNpmUpdateInvocation('v0.4.16', 'linux', script)).toThrow(/npm/i);
      expect(() => buildNpmUpdateInvocation('v0.4.16', 'linux', undefined, 'relative-prefix')).toThrow(/prefix/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('targets one validated version with a verified npm CLI on POSIX', async () => {
    const fixture = await npmCliFixture('');
    try {
      await withFixtureNode(fixture.node, () => {
        expect(buildNpmUpdateInvocation('v0.4.16', 'linux', fixture.script)).toEqual({
          command: fixture.node, args: [realpathSync(fixture.script), 'install', '--global', 'moderado@0.4.16'],
        });
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('uses the current verified npm script through Node on Windows', async () => {
    const fixture = await npmCliFixture('');
    try {
      await withFixtureNode(fixture.node, () => {
        expect(buildNpmUpdateInvocation('v1.2.3', 'win32', fixture.script)).toEqual({
          command: fixture.node,
          args: [realpathSync(fixture.script), 'install', '--global', 'moderado@1.2.3'],
        });
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('uses a verified Node adjacent npm CLI when no current script is known', () => {
    const invocation = buildNpmUpdateInvocation('v1.2.3', 'win32');
    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args.slice(1)).toEqual(['install', '--global', 'moderado@1.2.3']);
    expect(invocation.args[0]).toMatch(/\/node_modules\/npm\/bin\/npm-cli\.js$/);
  });

  it.each(['1.2.3', 'v1.2.3; echo bad', 'v1.2.3+build'])('rejects invalid target %s', (target) => {
    expect(() => buildNpmUpdateInvocation(target, 'linux')).toThrow(SelfUpdateError);
  });

  it('runs an argv-only npm child without provider credentials', async () => {
    const fixture = await npmCliFixture("process.stdout.write(JSON.stringify({ args: process.argv.slice(2), key: process.env.NVIDIA_API_KEY, token: process.env.MODERADO_TOKEN, prefix: process.env.npm_config_prefix }));");
    const previous = { key: process.env.NVIDIA_API_KEY, token: process.env.MODERADO_TOKEN, prefix: process.env.npm_config_prefix };
    process.env.NVIDIA_API_KEY = 'secret-key';
    process.env.MODERADO_TOKEN = 'secret-token';
    process.env.npm_config_prefix = '/custom/prefix';
    try {
      const result = await withFixtureNode(fixture.node, () =>
        runNpmUpdate('v0.4.16', process.platform, fixture.script, '/actual/install'));
      expect(JSON.parse(result.stdout)).toEqual({
        args: ['install', '--global', '--prefix', '/actual/install', 'moderado@0.4.16'],
        prefix: '/custom/prefix',
      });
    } finally {
      if (previous.key === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = previous.key;
      if (previous.token === undefined) delete process.env.MODERADO_TOKEN; else process.env.MODERADO_TOKEN = previous.token;
      if (previous.prefix === undefined) delete process.env.npm_config_prefix; else process.env.npm_config_prefix = previous.prefix;
      await fixture.cleanup();
    }
  });

  it('reports npm nonzero exits', async () => {
    const fixture = await npmCliFixture("process.stderr.write('package unavailable'); process.exitCode = 7;");
    try {
      await withFixtureNode(fixture.node, async () => {
        await expect(runNpmUpdate('v0.4.16', process.platform, fixture.script)).rejects.toThrow(/package unavailable/);
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('stops an npm child that exceeds the output cap', async () => {
    const fixture = await npmCliFixture("process.stdout.write('x'.repeat(70000));");
    try {
      await withFixtureNode(fixture.node, async () => {
        await expect(runNpmUpdate('v0.4.16', process.platform, fixture.script)).rejects.toThrow(/output limit/i);
      });
    } finally {
      await fixture.cleanup();
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
