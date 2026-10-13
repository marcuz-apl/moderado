import { describe, expect, it, vi } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  buildNpmUpdateInvocation,
  detectInstallChannel,
  fetchPublishedReleases,
  parseInstalledVersion,
  parseReleaseMetadata,
  selectUpdateRelease,
  SelfUpdateError,
  runNpmUpdate,
  updateStandalone,
  handleSelfUpdateCommand,
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

async function localArtifactServer(files: Map<string, Buffer>, destroyAfterPartialPath?: string) {
  const server = createServer((request, response) => {
    const body = files.get(request.url ?? '');
    if (!body) { response.writeHead(404).end(); return; }
    if (request.url === destroyAfterPartialPath) {
      response.writeHead(200);
      response.flushHeaders();
      response.write(body.subarray(0, 4));
      setTimeout(() => response.destroy(new Error('fixture stream interrupted')), 1);
      return;
    }
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
  return {
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      const filename = new URL(String(input)).pathname.split('/').pop();
      return fetch(`http://127.0.0.1:${address.port}/${filename}`, init);
    }) as typeof fetch,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
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

  it('kills an active npm update when its abort signal fires', async () => {
    const fixture = await npmCliFixture("setTimeout(() => process.exit(0), 5000);");
    const controller = new AbortController();
    try {
      const update = withFixtureNode(fixture.node, () => runNpmUpdate('v0.4.16', process.platform, fixture.script, undefined, controller.signal));
      setTimeout(() => controller.abort(), 40);
      await expect(update).rejects.toThrow(/cancelled/i);
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

  it.each([null, [], {}, { tag_name: 'v1.2.3' }, release('v1.2.3', { draft: 'false' }), release('v1.2.3', { html_url: 'javascript:alert(1)' }), release('v1.2.3', { html_url: 'https://user:pass@github.com/marcuz-apl/moderado/releases/tag/v1.2.3' })])(
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

describe('self update command handler', () => {
  it('reports the installed version and succeeds when already current', async () => {
    const originalFetch = globalThis.fetch;
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    globalThis.fetch = (async () => new Response(JSON.stringify([release('v0.4.17')]))) as typeof fetch;
    try {
      expect(await handleSelfUpdateCommand('update', 'v0.4.17+261013f', new AbortController().signal)).toBe(0);
      expect(output.mock.calls.map(([chunk]) => String(chunk)).join(' ')).toMatch(/already current/i);
      const lines = output.mock.calls.map(([chunk]) => String(chunk).trim());
      expect(lines).toContain('Installed version: v0.4.17+261013f');
      expect(lines).toContain('Target version: v0.4.17');
    } finally {
      globalThis.fetch = originalFetch;
      output.mockRestore();
    }
  });

  it('returns nonzero when release lookup fails and when cancelled', async () => {
    const originalFetch = globalThis.fetch;
    const output = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    globalThis.fetch = (async () => new Response('unavailable', { status: 503 })) as typeof fetch;
    try {
      expect(await handleSelfUpdateCommand('upgrade', 'v0.4.17+261013f', new AbortController().signal)).toBe(1);
      const controller = new AbortController();
      controller.abort();
      expect(await handleSelfUpdateCommand('upgrade', 'v0.4.17+261013f', controller.signal)).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      output.mockRestore();
    }
  });

  it('returns nonzero with actionable guidance when install ownership is unknown', async () => {
    const originalFetch = globalThis.fetch;
    const output = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const originalArgv = process.argv[1];
    globalThis.fetch = (async () => new Response(JSON.stringify([release('v0.4.18')]))) as typeof fetch;
    process.argv[1] = '/tmp/unrecognized-moderado';
    try {
      expect(await handleSelfUpdateCommand('update', 'v0.4.17+261013f', new AbortController().signal)).toBe(1);
      expect(output.mock.calls.map(([chunk]) => String(chunk)).join(' ')).toMatch(/original installer or package manager/i);
    } finally {
      process.argv[1] = originalArgv;
      globalThis.fetch = originalFetch;
      output.mockRestore();
    }
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

describe('standalone update', () => {
  it('cancels an active artifact stream, removes staging, and preserves the executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moderado-standalone-abort-'));
    const executable = join(root, 'moderado');
    const artifact = Buffer.from('partial executable');
    const checksum = createHash('sha256').update(artifact).digest('hex');
    const filename = 'moderado-linux-x64';
    const manifest = { version: 'v1.2.3', artifacts: [{ target: 'node22-linux-x64', filename, platform: 'linux', architecture: 'x64', size: artifact.length, checksum, signed: false }] };
    const controller = new AbortController();
    let started!: () => void;
    const streamStarted = new Promise<void>((resolve) => { started = resolve; });
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return new Response(JSON.stringify(manifest));
      if (url.endsWith('.sha256')) return new Response(`${checksum}  ${filename}\n`);
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) { stream.enqueue(artifact); started(); },
      }));
    };
    await writeFile(executable, 'original executable');
    try {
      const update = updateStandalone({ release: parseReleaseMetadata(release('v1.2.3'))!, executablePath: executable, platform: 'linux', architecture: 'x64', fetchImpl, signal: controller.signal });
      await streamStarted;
      await new Promise((resolve) => setTimeout(resolve, 30));
      controller.abort();
      await expect(update).rejects.toThrow(/cancelled/i);
      expect(await readFile(executable, 'utf8')).toBe('original executable');
      expect((await readdir(root)).sort()).toEqual(['moderado']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves the executable when cancellation arrives during staged-file chmod', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moderado-standalone-abort-stage-'));
    const executable = join(root, 'moderado');
    const artifact = Buffer.from('replacement executable');
    const checksum = createHash('sha256').update(artifact).digest('hex');
    const filename = 'moderado-linux-x64';
    const manifest = { version: 'v1.2.3', artifacts: [{ target: 'node22-linux-x64', filename, platform: 'linux', architecture: 'x64', size: artifact.length, checksum, signed: false }] };
    const controller = new AbortController();
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return new Response(JSON.stringify(manifest));
      if (url.endsWith('.sha256')) return new Response(`${checksum}  ${filename}\n`);
      return new Response(artifact);
    };
    await writeFile(executable, 'original executable');
    try {
      await expect(updateStandalone({
        release: parseReleaseMetadata(release('v1.2.3'))!, executablePath: executable, platform: 'linux', architecture: 'x64', fetchImpl,
        signal: controller.signal,
        chmodImpl: async (path, mode) => {
          const { chmod } = await import('node:fs/promises');
          await chmod(path, mode);
          controller.abort();
        },
      })).rejects.toThrow(/cancelled/i);
      expect(await readFile(executable, 'utf8')).toBe('original executable');
      expect((await readdir(root)).sort()).toEqual(['moderado']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replaces the executable only after the local release artifact is verified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moderado-standalone-'));
    const executable = join(root, 'moderado');
    const artifact = Buffer.from('new standalone executable');
    const checksum = createHash('sha256').update(artifact).digest('hex');
    const filename = 'moderado-linux-x64';
    const manifest = { version: 'v1.2.3', revision: 'abc', artifacts: [{ target: 'node22-linux-x64', filename, platform: 'linux', architecture: 'x64', size: artifact.length, checksum, signed: false }] };
    const files = new Map<string, Buffer>([
      ['/manifest.json', Buffer.from(JSON.stringify(manifest))],
      [`/${filename}`, artifact],
      [`/${filename}.sha256`, Buffer.from(`${checksum}  ${filename}\n`)],
    ]);
    const server = createServer((request, response) => {
      const body = files.get(request.url ?? '');
      if (!body) { response.writeHead(404).end(); return; }
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
    const fetchFixture: typeof fetch = async (input, init) => {
      const original = new URL(String(input));
      const url = `http://127.0.0.1:${address.port}${original.pathname.split('/').slice(-1)[0] === 'manifest.json' ? '/manifest.json' : `/${original.pathname.split('/').slice(-1)[0]}`}`;
      return fetch(url, init);
    };
    await writeFile(executable, 'old executable');
    try {
      await updateStandalone({ release: parseReleaseMetadata(release('v1.2.3'))!, executablePath: executable, platform: 'linux', architecture: 'x64', fetchImpl: fetchFixture });
      expect(await readFile(executable)).toEqual(artifact);
      expect((await readdir(root)).sort()).toEqual(['moderado']);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['missing host artifact', 'malformed manifest', 'bad sidecar', 'manifest checksum mismatch', 'truncated artifact', 'oversized stream', 'oversized manifest', 'oversized sidecar', 'midstream reader error', 'network failure'])(
    'preserves the executable and removes staged files after %s', async (failure) => {
      const root = await mkdtemp(join(tmpdir(), 'moderado-standalone-failure-'));
      const executable = join(root, 'moderado');
      const artifact = Buffer.from('new standalone executable');
      const checksum = createHash('sha256').update(artifact).digest('hex');
      const filename = 'moderado-linux-x64';
      const manifest = { version: 'v1.2.3', revision: 'abc', artifacts: [{ target: 'node22-linux-x64', filename, platform: 'linux', architecture: 'x64', size: artifact.length, checksum, signed: false }] };
      let downloaded = artifact;
      let sidecar = Buffer.from(`${checksum}  ${filename}\n`);
      let manifestBody: Buffer;
      if (failure === 'missing host artifact') manifest.artifacts = [];
      if (failure === 'bad sidecar') sidecar = Buffer.from('not a checksum');
      if (failure === 'manifest checksum mismatch') manifest.artifacts[0].checksum = '0'.repeat(64);
      if (failure === 'truncated artifact') downloaded = artifact.subarray(0, 4);
      if (failure === 'oversized stream') downloaded = Buffer.concat([artifact, Buffer.from('unexpected extra bytes')]);
      if (failure === 'oversized sidecar') sidecar = Buffer.alloc(2048, 0x61);
      manifestBody = Buffer.from(failure === 'malformed manifest' ? '{' : JSON.stringify(manifest));
      if (failure === 'oversized manifest') manifestBody = Buffer.alloc(70 * 1024, 0x20);
      const files = new Map<string, Buffer>([
        ['/manifest.json', manifestBody], [`/${filename}`, downloaded], [`/${filename}.sha256`, sidecar],
      ]);
      if (failure === 'network failure') files.delete('/manifest.json');
      const server = await localArtifactServer(files, failure === 'midstream reader error' ? `/${filename}` : undefined);
      await writeFile(executable, 'old executable');
      try {
        const update = updateStandalone({ release: parseReleaseMetadata(release('v1.2.3'))!, executablePath: executable, platform: 'linux', architecture: 'x64', fetchImpl: server.fetchImpl });
        if (failure === 'oversized manifest') await expect(update).rejects.toThrow(/manifest response exceeds size limit/i);
        else if (failure === 'oversized sidecar') await expect(update).rejects.toThrow(/sidecar response exceeds size limit/i);
        else await expect(update).rejects.toThrow();
        expect(await readFile(executable, 'utf8')).toBe('old executable');
        expect((await readdir(root)).sort()).toEqual(['moderado']);
      } finally {
        await server.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('gives Windows-specific recovery steps when a running executable cannot be replaced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moderado-windows-update-'));
    const executable = join(root, 'moderado-win-x64.exe');
    await writeFile(executable, 'original remains');
    const artifact = Buffer.from('new standalone executable');
    const checksum = createHash('sha256').update(artifact).digest('hex');
    const filename = 'moderado-win-x64.exe';
    const manifest = { version: 'v1.2.3', revision: 'abc', artifacts: [{ target: 'node22-win-x64', filename, platform: 'win32', architecture: 'x64', size: artifact.length, checksum, signed: false }] };
    const server = await localArtifactServer(new Map([
      ['/manifest.json', Buffer.from(JSON.stringify(manifest))],
      [`/${filename}`, artifact], [`/${filename}.sha256`, Buffer.from(`${checksum}  ${filename}\n`)],
    ]));
    try {
      await expect(updateStandalone({ release: parseReleaseMetadata(release('v1.2.3'))!, executablePath: executable, platform: 'win32', architecture: 'x64', fetchImpl: server.fetchImpl, renameImpl: async () => { throw new Error('image is in use'); } }))
        .rejects.toThrow(/Exit Moderado.*download https:.*use File Explorer to replace this executable/i);
      expect(await readFile(executable, 'utf8')).toBe('original remains');
      expect((await readdir(root)).sort()).toEqual(['moderado-win-x64.exe']);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
