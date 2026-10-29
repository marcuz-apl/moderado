import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { GatewayError } from '@moderado/contracts';
import { NvidiaAdapter } from '@moderado/providers';
import { MODERADO_DEVELOPMENT_BASE_URL, MODERADO_PRODUCTION_BASE_URL } from '../src/config.js';
import { authorizeModeradoCloudInBrowser, authorizeModeradoInBrowser, buildConnection, buildModeradoCloudConnection, buildModeradoConnection, connectProviderInteractive, findReusableConnection, isAuthenticationFailure, isModeradoCloudOAuthConnection, isModeradoOAuthConnection, loginModeradoCloudInteractive, loginModeradoInteractive, PROVIDER_PRESETS, renderConnectionPrompt, resolveAutoModeradoConnection } from '../src/ui/provider_connect.js';
import { stripAnsi } from '../src/ui/welcome.js';

/** Minimal fake stdin: the code only attaches a `keypress` listener to it. */
function fakeStdin(): EventEmitter {
  const stdin = new EventEmitter() as EventEmitter & { isTTY?: boolean };
  stdin.isTTY = false;
  return stdin;
}

const openRouter = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  kind: 'openai-compatible' as const,
  baseUrl: 'https://openrouter.ai/api/v1',
  credentialReference: 'moderado/provider/openrouter',
  defaultModel: 'openrouter/free',
};

describe('provider connection setup', () => {
  it('offers the supported provider presets with the intended names and badges', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.value)).toEqual([
      'moderado', 'nvidia-nim', 'openrouter', 'ollama', 'lm-studio', 'openai-compatible',
    ]);
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'moderado')).toMatchObject({
      label: 'Moderado',
    });
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'nvidia-nim')).toMatchObject({
      label: 'NVIDIA NIM',
      tag: 'BYOK',
    });
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'openrouter')).toMatchObject({
      label: 'OpenRouter',
      tag: 'BYOK',
    });
    expect(PROVIDER_PRESETS.some((preset) => preset.label === 'Agnes AI' || preset.label === 'OrcaRouter')).toBe(false);
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'openrouter')?.baseUrl)
      .toBe('https://openrouter.ai/api/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'ollama')?.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'lm-studio')?.baseUrl).toBe('http://127.0.0.1:1234/v1');
  });

  it('finds the saved profile for a named provider preset', () => {
    expect(findReusableConnection('openrouter', { openrouter: openRouter })).toEqual(openRouter);
    expect(findReusableConnection('agnes-ai', { openrouter: openRouter })).toBeUndefined();
    expect(findReusableConnection('openai-compatible', { openrouter: openRouter })).toBeUndefined();
  });

  it('builds local providers without an API key', () => {
    expect(buildConnection({ kind: 'openai-compatible', displayName: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen2.5-coder' })).toMatchObject({ id: 'ollama', apiKey: undefined });
    expect(buildConnection({ kind: 'openai-compatible', displayName: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'local-model' })).toMatchObject({ id: 'lm-studio', apiKey: undefined });
  });

  it('recognizes provider authentication failures without exposing a key', () => {
    expect(isAuthenticationFailure(new Error('OpenRouter authentication failed (401) during chat'))).toBe(true);
    expect(isAuthenticationFailure(new Error('request failed with status 429'))).toBe(false);
    expect(isAuthenticationFailure(new GatewayError('unauthorized', 401))).toBe(true);
    expect(isAuthenticationFailure(new GatewayError('scope_denied', 403))).toBe(false);
    // The agent loop reports provider failures as typed error events, so the
    // same decision must work on the emitted `{ code, message }` shape.
    expect(isAuthenticationFailure({ code: 'ERR_GATEWAY_UNAUTHORIZED', message: 'Moderado could not authorize this request.' })).toBe(true);
    expect(isAuthenticationFailure({ message: 'NVIDIA NIM authentication failed (403) during streamChat' })).toBe(true);
    expect(isAuthenticationFailure({ code: 'ERR_RATE_LIMIT', message: 'Provider rate limit reached.' })).toBe(false);
    expect(isAuthenticationFailure(undefined)).toBe(false);
  });

  it('identifies expiring Moderado OAuth credentials for browser reauthorization', () => {
    expect(isModeradoCloudOAuthConnection({ id: 'moderado-cloud', credentialExpiresAt: Date.now(), displayName: 'Moderado Cloud', kind: 'openai-compatible', baseUrl: 'https://modr.alfazen.org/v1' })).toBe(true);
    expect(isModeradoCloudOAuthConnection({ id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible', baseUrl: 'https://modr.alfazen.org/v1' })).toBe(false);
    expect(isModeradoOAuthConnection({ id: 'moderado', credentialExpiresAt: Date.now(), displayName: 'Moderado', kind: 'openai-compatible', baseUrl: 'https://modr.alfazen.org/v1' })).toBe(true);
  });

  it('renders credential entry as a popup, masking secrets', () => {
    const plain = renderConnectionPrompt('NVIDIA API key', 'nvapi-secret', true).join('\n').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    expect(plain).toContain('NVIDIA API key');
    expect(plain).toContain('************');
    expect(plain).not.toContain('nvapi-secret');
  });

  it('builds a NVIDIA NIM profile with free-first AUTO routing', () => {
    expect(buildConnection({ kind: 'nvidia-nim', apiKey: 'nvapi-test' })).toEqual({
      id: 'nvidia-nim',
      displayName: 'NVIDIA NIM',
      kind: 'nvidia-nim',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test',
    });
  });

  it('keeps the selected NVIDIA Base URL and requires URLs to end in /v1', () => {
    expect(buildConnection({ kind: 'nvidia-nim', baseUrl: 'https://nim.example/v1', apiKey: 'nvapi-test' }).baseUrl)
      .toBe('https://nim.example/v1');
    expect(() => buildConnection({ kind: 'openai-compatible', displayName: 'Provider', baseUrl: 'https://provider.example', apiKey: 'key', defaultModel: 'model' }))
      .toThrow('/v1');
  });

  it('builds a canonical Moderado profile from a key and manages the Gateway URL', () => {
    const previous = process.env.MODERADO_ENV;
    delete process.env.MODERADO_ENV;
    try {
      expect(buildModeradoConnection('mrd_test-key')).toEqual({
        id: 'moderado',
        displayName: 'Moderado',
        kind: 'openai-compatible',
        baseUrl: 'https://modr.alfazen.org/v1',
        apiKey: 'mrd_test-key',
        defaultModel: 'auto',
      });
      expect(buildModeradoCloudConnection('mrd_test-key')).toEqual(buildModeradoConnection('mrd_test-key'));
      expect(() => buildModeradoConnection('sk_wrong')).toThrow('mrd_');
      expect(() => buildModeradoConnection('mrd_')).toThrow('mrd_');
    } finally {
      if (previous !== undefined) process.env.MODERADO_ENV = previous;
    }
  });

  it('builds a public Moderado Gateway profile without an account key', () => {
    const previousBaseUrl = process.env.MODERADO_BASE_URL;
    process.env.MODERADO_BASE_URL = 'https://gateway.example/v1/';
    try {
      expect(buildModeradoConnection()).toEqual({
        id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
        baseUrl: 'https://gateway.example/v1', apiKey: undefined, defaultModel: 'auto',
      });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.MODERADO_BASE_URL;
      else process.env.MODERADO_BASE_URL = previousBaseUrl;
    }
  });

  it('targets the local Gateway when login runs in development mode', () => {
    const previous = process.env.MODERADO_ENV;
    process.env.MODERADO_ENV = 'development';
    try {
      expect(buildModeradoConnection('mrd_test-key').baseUrl).toBe('http://127.0.0.1:4788/v1');
    } finally {
      if (previous === undefined) delete process.env.MODERADO_ENV;
      else process.env.MODERADO_ENV = previous;
    }
  });

  it('uses the selected Gateway Base URL even when an environment mode is set', () => {
    const previous = process.env.MODERADO_ENV;
    process.env.MODERADO_ENV = 'production';
    try {
      expect(buildModeradoConnection('mrd_test-key', undefined, 'http://127.0.0.1:4788/v1').baseUrl)
        .toBe('http://127.0.0.1:4788/v1');
    } finally {
      if (previous === undefined) delete process.env.MODERADO_ENV;
      else process.env.MODERADO_ENV = previous;
    }
  });

  it('uses a configured loopback Gateway URL for a new Moderado login', () => {
    const previous = process.env.MODERADO_BASE_URL;
    process.env.MODERADO_BASE_URL = 'http://localhost:4788/v1/';
    try {
      expect(buildModeradoConnection('mrd_test-key').baseUrl).toBe('http://localhost:4788/v1');
    } finally {
      if (previous === undefined) delete process.env.MODERADO_BASE_URL;
      else process.env.MODERADO_BASE_URL = previous;
    }
  });

  it('builds a Moderado profile from a browser token with expiry metadata', () => {
    expect(buildModeradoConnection('mrd_oauth-token', Date.now() + 2_592_000_000)).toMatchObject({
      id: 'moderado',
      apiKey: 'mrd_oauth-token',
      credentialExpiresAt: expect.any(Number),
      defaultModel: 'auto',
    });
  });

  it('normalizes an OpenAI-compatible endpoint and requires a model', () => {
    expect(buildConnection({
      kind: 'openai-compatible',
      displayName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-test',
      defaultModel: 'openrouter/free',
    })).toMatchObject({
      id: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'openrouter/free',
    });
    expect(() => buildConnection({ kind: 'openai-compatible', baseUrl: 'https://example.com/v1' }))
      .toThrow('model');
  });
});

describe('browser sign-in wait', () => {
  // The browser sends no callback when it is closed without signing in, so the
  // only escapes are a keypress, an abort, or the timeout. Every one of these
  // must settle promptly as `undefined` instead of hanging or rejecting into
  // the async keypress handler (which would crash the TUI).
  it('returns undefined when Esc cancels the wait instead of hanging', async () => {
    const stdin = fakeStdin();
    const pending = authorizeModeradoInBrowser(undefined, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      openBrowser: () => setImmediate(() => stdin.emit('keypress', undefined, { name: 'escape' })),
      timeoutMs: 60_000, // would fail the test if cancel did not work
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it('returns undefined when Ctrl+C cancels the wait', async () => {
    const stdin = fakeStdin();
    const pending = authorizeModeradoCloudInBrowser(undefined, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      openBrowser: () => setImmediate(() => stdin.emit('keypress', undefined, { ctrl: true, name: 'c' })),
      timeoutMs: 60_000,
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it('returns undefined when the session aborts during the wait', async () => {
    const controller = new AbortController();
    const stdin = fakeStdin();
    const pending = authorizeModeradoCloudInBrowser(controller.signal, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      openBrowser: () => setImmediate(() => controller.abort()),
      timeoutMs: 60_000,
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it('settles as undefined on timeout instead of rejecting', async () => {
    const stdin = fakeStdin();
    await expect(authorizeModeradoCloudInBrowser(undefined, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      openBrowser: () => { /* browser closed without signing in */ },
      timeoutMs: 30,
    })).resolves.toBeUndefined();
  });

  it('draws a waiting frame that tells the user how to cancel', async () => {
    const stdin = fakeStdin();
    const frames: string[][] = [];
    const pending = authorizeModeradoCloudInBrowser(undefined, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      openBrowser: () => setImmediate(() => stdin.emit('keypress', undefined, { name: 'escape' })),
      drawFrame: (lines) => { frames.push(lines); },
      timeoutMs: 60_000,
    });
    await pending;
    const text = frames.flat().join('\n');
    expect(text).toContain('Sign-in page opened in your browser');
    expect(text).toContain('Press Esc or Ctrl+C to cancel');
  });

  it('completes a verified callback and exchanges the token offline', async () => {
    const stdin = fakeStdin();
    const pending = authorizeModeradoCloudInBrowser(undefined, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      openBrowser: (authorizationUrl) => {
        const authorize = new URL(authorizationUrl);
        const redirect = authorize.searchParams.get('redirect_uri')!;
        const state = authorize.searchParams.get('state')!;
        void fetch(`${redirect}?code=auth-code&state=${encodeURIComponent(state)}`);
      },
      tokenFetch: async () => new Response(JSON.stringify({ access_token: 'mrd_browser-token', token_type: 'Bearer', expires_in: 2_592_000 })),
      timeoutMs: 60_000,
    });
    await expect(pending).resolves.toEqual({ accessToken: 'mrd_browser-token', expiresAt: expect.any(Number) });
  });

  it('rejects when the loopback callback fails state validation', async () => {
    const stdin = fakeStdin();
    const pending = authorizeModeradoCloudInBrowser(undefined, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      openBrowser: (authorizationUrl) => {
        const redirect = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
        void fetch(`${redirect}?code=auth-code&state=tampered`);
      },
      timeoutMs: 60_000,
    });
    await expect(pending).rejects.toThrow(/could not be verified/);
  });
});

describe('Moderado login asks only what it cannot know', () => {
  it('reuses the saved key without asking for a key or a base URL', async () => {
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      authorization = request.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock Gateway failed to start.');
    const saved = { ...buildModeradoConnection('mrd_saved-secret'), baseUrl: `http://127.0.0.1:${address.port}/v1` };
    const frames: string[] = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const result = await loginModeradoCloudInteractive({
        signal: controller.signal,
        activeConnection: saved,
        savedConnections: { 'moderado-cloud': { ...saved, apiKey: undefined } },
        resolveSavedConnection: async () => saved,
        drawFrame: (lines) => {
          const frame = stripAnsi(lines.join('\n'));
          frames.push(frame);
          if (frame.includes('Moderado Models')) setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'escape' }));
        },
      });
      expect(result).toEqual(saved);
      const visible = frames.join('\n');
      expect(visible).not.toContain('Moderado Gateway Base URL');
      expect(visible).not.toContain('API key');
      expect(visible).not.toContain('mrd_saved-secret');
      expect(authorization).toBe('Bearer mrd_saved-secret');
    } finally {
      clearTimeout(timeout);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('reuses the active Gateway URL and offers sign-in instead of asking for a URL', async () => {
    const frames: string[] = [];
    let signInFrame = '';
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('offline test'));
    try {
      const result = await loginModeradoInteractive({
        activeConnection: buildModeradoConnection(),
        drawFrame: (lines) => {
          const frame = stripAnsi(lines.join('\n'));
          frames.push(frame);
          if (frame.includes('Moderado Sign-in')) {
            signInFrame = frame;
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'escape' }));
          }
        },
      });
      expect(result).toBeUndefined();
      expect(frames.join('\n')).not.toContain('Base URL');
      expect(frames.join('\n')).not.toContain('Gateway Mode');
      expect(signInFrame).toContain('Sign in with browser');
      expect(signInFrame).toContain('Paste an API key');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('re-probes the development Gateway for a keyless saved production profile', async () => {
    const discovery = vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
      { id: 'stealth/ocellaris:free', name: 'Stealth/Ocellaris:Free', object: 'model', owned_by: 'agnes', access: 'free', section: 'default' },
    ]);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    try {
      const saved = { ...buildModeradoConnection(), baseUrl: MODERADO_PRODUCTION_BASE_URL };
      let picked = false;
      const result = await loginModeradoInteractive({
        activeConnection: saved,
        savedConnections: { moderado: saved },
        drawFrame: (lines) => {
          const frame = stripAnsi(lines.join('\n'));
          if (frame.includes('Moderado Sign-in')) {
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'return' }));
          } else if (frame.includes('Moderado Free Models') && !picked) {
            picked = true;
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'return' }));
          }
        },
      });
      expect(picked).toBe(true);
      expect(result).toMatchObject({
        baseUrl: MODERADO_DEVELOPMENT_BASE_URL,
        apiKey: undefined,
        defaultModel: 'stealth/ocellaris:free',
      });
    } finally {
      fetchSpy.mockRestore();
      discovery.mockRestore();
    }
  });

  it('lists the same stealth defaults when production is the reachable Gateway', async () => {
    const discovery = vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
      { id: 'stealth/ocellaris:free', name: 'Stealth/Ocellaris:Free', object: 'model', owned_by: 'agnes', access: 'free', section: 'default' },
      { id: 'stealth/ocevolex:free', name: 'Stealth/Ocevolex:Free', object: 'model', owned_by: 'nvidia', access: 'free', section: 'default' },
    ]);
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('dev Gateway unavailable'));
    try {
      const saved = { ...buildModeradoConnection(), baseUrl: MODERADO_PRODUCTION_BASE_URL };
      let modelFrame = '';
      const result = await loginModeradoInteractive({
        activeConnection: saved,
        savedConnections: { moderado: saved },
        drawFrame: (lines) => {
          const frame = stripAnsi(lines.join('\n'));
          if (frame.includes('Moderado Sign-in')) {
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'return' }));
          } else if (frame.includes('Moderado Free Models') && !modelFrame) {
            modelFrame = frame;
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'return' }));
          }
        },
      });
      expect(modelFrame).toContain('Stealth/Ocellaris:Free');
      expect(modelFrame).toContain('Stealth/Ocevolex:Free');
      expect(result).toMatchObject({
        baseUrl: MODERADO_PRODUCTION_BASE_URL,
        defaultModel: 'stealth/ocellaris:free',
      });
    } finally {
      fetchSpy.mockRestore();
      discovery.mockRestore();
    }
  });

  it('offers the account-free defaults as selectable models after choosing the free option', async () => {
    const frames: string[] = [];
    let signInFrame = '';
    let modelFrame = '';
    const discovery = vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
      { id: 'stealth/ocellaris:free', name: 'Stealth/Ocellaris:Free', object: 'model', owned_by: 'agnes', access: 'free', section: 'default' },
      { id: 'stealth/ocevolex:free', name: 'Stealth/Ocevolex:Free', object: 'model', owned_by: 'nvidia', access: 'free', section: 'default' },
    ]);
    try {
      const result = await loginModeradoInteractive({
        gatewayUrl: 'https://gateway.example/v1',
        drawFrame: (lines) => {
          const frame = stripAnsi(lines.join('\n'));
          frames.push(frame);
          if (frame.includes('Moderado Sign-in')) {
            signInFrame = frame;
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'return' }));
          } else if (frame.includes('Moderado Free Models') && !modelFrame) {
            modelFrame = frame;
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'return' }));
          }
        },
      });
      expect(signInFrame).toContain('Use free models without an account');
      expect(signInFrame.indexOf('Use free models without an account'))
        .toBeLessThan(signInFrame.indexOf('Sign in with browser'));
      expect(signInFrame).not.toContain('Change server');
      expect(modelFrame).toContain('Stealth/Ocellaris:Free');
      expect(modelFrame).toContain('Stealth/Ocevolex:Free');
      expect(result).toMatchObject({ id: 'moderado', apiKey: undefined, defaultModel: 'stealth/ocellaris:free' });
      expect(result?.baseUrl).toBe('https://gateway.example/v1');
    } finally {
      discovery.mockRestore();
    }
  });

  it('switches deployments through the Change server row and remembers the choice', async () => {
    const discovery = vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
      { id: 'stealth/ocellaris:free', name: 'Stealth/Ocellaris:Free', object: 'model', owned_by: 'agnes', access: 'free', section: 'default' },
    ]);
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('dev Gateway unavailable'));
    const saved = { ...buildModeradoConnection(), baseUrl: MODERADO_PRODUCTION_BASE_URL };
    const signInFrames: string[] = [];
    let changeRequested = false;
    let pickedChange = false;
    let serverChanged = false;
    let freeChosen = false;
    let modelPicked = false;
    try {
      const result = await loginModeradoInteractive({
        savedConnections: { moderado: saved },
        drawFrame: (lines) => {
          const frame = stripAnsi(lines.join('\n'));
          if (frame.includes('Moderado Gateway') && !pickedChange) {
            pickedChange = true;
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', '\r', { name: 'return' });
              serverChanged = true;
            });
          } else if (frame.includes('Moderado Sign-in')) {
            if (!serverChanged) {
              if (changeRequested) return;
              changeRequested = true;
              signInFrames.push(frame);
              setImmediate(() => {
                for (let index = 0; index < 3; index++) process.stdin.emit('keypress', undefined, { name: 'down' });
                process.stdin.emit('keypress', '\r', { name: 'return' });
              });
            } else if (!freeChosen) {
              freeChosen = true;
              signInFrames.push(frame);
              setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
            }
          } else if (frame.includes('Moderado Free Models') && freeChosen && !modelPicked) {
            modelPicked = true;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          }
        },
      });
      expect(modelPicked).toBe(true);
      expect(signInFrames[0]).toContain('Change server');
      expect(signInFrames[1]).toContain('Development');
      expect(result).toMatchObject({
        baseUrl: MODERADO_DEVELOPMENT_BASE_URL,
        gatewayEnvironment: 'development',
        apiKey: undefined,
        defaultModel: 'stealth/ocellaris:free',
      });
    } finally {
      fetchSpy.mockRestore();
      discovery.mockRestore();
    }
  });

  it('offers Change server again when a saved key already exists', async () => {
    const discovery = vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
      { id: 'stealth/ocellaris:free', name: 'Stealth/Ocellaris:Free', object: 'model', owned_by: 'agnes', access: 'free', section: 'default' },
    ]);
    // The reported case: Production connected, so the key is stored, and now the
    // user wants Development.
    const saved = {
      ...buildModeradoConnection('mrd_saved-secret'),
      baseUrl: MODERADO_PRODUCTION_BASE_URL,
      gatewayEnvironment: 'production' as const,
    };
    const menus: string[] = [];
    let choseServer = false;
    let pickedDevelopment = false;
    let confirmedConnection = false;
    let modelConfirmed = false;
    try {
      const result = await loginModeradoInteractive({
        savedConnections: { moderado: saved },
        resolveSavedConnection: async (connection) => connection,
        drawFrame: (lines) => {
          if (modelConfirmed) return;
          const frame = stripAnsi(lines.join('\n'));
          if (frame.includes('Moderado Connection') && !choseServer) {
            choseServer = true;
            menus.push(frame);
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          } else if (frame.includes('Moderado Gateway') && choseServer && !pickedDevelopment) {
            pickedDevelopment = true;
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          } else if (frame.includes('Moderado Connection') && pickedDevelopment && !confirmedConnection) {
            confirmedConnection = true;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (confirmedConnection) {
            // The model overlay: take whatever it highlights first.
            modelConfirmed = true;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          }
        },
      });
      expect(choseServer).toBe(true);
      expect(menus[0]).toContain('Change server');
      expect(menus[0]).toContain('Connect to Production');
      expect(result).toMatchObject({
        baseUrl: MODERADO_DEVELOPMENT_BASE_URL,
        gatewayEnvironment: 'development',
        apiKey: 'mrd_saved-secret',
      });
    } finally {
      discovery.mockRestore();
    }
  });
});

describe('account-free automatic connection', () => {
  it('builds a keyless Moderado connection from the first reachable Gateway', async () => {
    const development = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => development.listen(0, '127.0.0.1', resolve));
    const address = development.address();
    if (!address || typeof address === 'string') throw new Error('Mock Gateway failed to start.');
    const developmentUrl = `http://127.0.0.1:${address.port}/v1`;
    const previousMode = process.env.MODERADO_ENV;
    const previousUrl = process.env.MODERADO_BASE_URL;
    delete process.env.MODERADO_ENV;
    delete process.env.MODERADO_BASE_URL;
    try {
      await expect(resolveAutoModeradoConnection({}, { developmentUrl, productionUrl: 'https://production.example/v1' }))
        .resolves.toEqual({
          id: 'moderado',
          displayName: 'Moderado',
          kind: 'openai-compatible',
          baseUrl: developmentUrl,
          apiKey: undefined,
          defaultModel: 'auto',
        });
    } finally {
      if (previousMode === undefined) delete process.env.MODERADO_ENV;
      else process.env.MODERADO_ENV = previousMode;
      if (previousUrl === undefined) delete process.env.MODERADO_BASE_URL;
      else process.env.MODERADO_BASE_URL = previousUrl;
      await new Promise<void>((resolve, reject) => development.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe('unified provider connection', () => {
  it('reuses a saved Gateway key without prompting for it again', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock Gateway failed to start.');
    const saved = {
      id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible' as const,
      baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'mrd_hidden-secret', defaultModel: 'auto',
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    let sawSignIn = false;
    let sawKeyPrompt = false;
    try {
      const result = await loginModeradoInteractive({
        signal: controller.signal,
        savedConnections: { moderado: saved },
        resolveSavedConnection: async (connection) => connection,
        drawFrame: (lines) => {
          const frame = stripAnsi(lines.join('\n'));
          if (frame.includes('Moderado Sign-in')) sawSignIn = true;
          if (frame.includes('API key')) sawKeyPrompt = true;
          if (frame.includes('Moderado Models')) setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'escape' }));
        },
      });
      expect(sawSignIn).toBe(false);
      expect(sawKeyPrompt).toBe(false);
      expect(result).toMatchObject({ apiKey: saved.apiKey, baseUrl: saved.baseUrl });
    } finally {
      clearTimeout(timeout);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('probes for a Gateway instead of asking for a deployment, then connects with a key', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const previousMode = process.env.MODERADO_ENV;
    const previousUrl = process.env.MODERADO_BASE_URL;
    delete process.env.MODERADO_ENV;
    delete process.env.MODERADO_BASE_URL;
    const frames: string[] = [];
    let step = 'signin';
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('offline test'));
    try {
      const result = await loginModeradoInteractive({
        signal: controller.signal,
        drawFrame: (lines) => {
          const frame = stripAnsi(lines.join('\n'));
          frames.push(frame);
          if (frame.includes('Moderado Sign-in') && step === 'signin') {
            step = 'key';
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          } else if (frame.includes('Moderado API key') && step === 'key') {
            step = 'models';
            setImmediate(() => {
              for (const character of 'mrd_dev-key') process.stdin.emit('keypress', character, { name: character });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          } else if (frame.includes('Moderado Models') && step === 'models') {
            step = 'done';
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'escape' }));
          }
        },
      });
      const visible = frames.join('\n');
      expect(visible).not.toContain('Gateway Mode');
      expect(visible).not.toContain('Base URL');
      // No development Gateway is listening in tests, so the probe lands on production.
      expect(result?.baseUrl).toBe('https://modr.alfazen.org/v1');
      expect(result?.apiKey).toBe('mrd_dev-key');
    } finally {
      fetchSpy.mockRestore();
      clearTimeout(timeout);
      if (previousMode === undefined) delete process.env.MODERADO_ENV;
      else process.env.MODERADO_ENV = previousMode;
      if (previousUrl === undefined) delete process.env.MODERADO_BASE_URL;
      else process.env.MODERADO_BASE_URL = previousUrl;
    }
  });

  it('connects to the Gateway and selects one of its routes through /connect', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'vendor/route-one' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock Gateway failed to start.');
    const gatewayUrl = `http://127.0.0.1:${address.port}/v1`;
    const previousEnvironment = process.env.MODERADO_ENV;
    const previousUrl = process.env.MODERADO_BASE_URL;
    delete process.env.MODERADO_ENV;
    delete process.env.MODERADO_BASE_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const seen = new Set<string>();
    try {
      const result = await connectProviderInteractive({
        signal: controller.signal,
        gatewayUrl,
        drawFrame: (lines) => {
          const frame = stripAnsi(lines.join('\n'));
          if (frame.includes('Connect Provider') && !seen.has('provider')) {
            seen.add('provider');
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Moderado Sign-in') && !seen.has('signin')) {
            seen.add('signin');
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          } else if (frame.includes('Moderado API key') && !seen.has('key')) {
            seen.add('key');
            setImmediate(() => {
              for (const character of 'mrd_route-key') process.stdin.emit('keypress', character, { name: character });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          } else if (frame.includes('Moderado Models') && !seen.has('model')) {
            seen.add('model');
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          }
        },
      });
      expect(result).toMatchObject({ id: 'moderado', displayName: 'Moderado', defaultModel: 'vendor/route-one' });
      // No deployment picker and no Base URL prompt: the configured Gateway is reused.
      expect([...seen]).toEqual(['provider', 'signin', 'key', 'model']);
    } finally {
      clearTimeout(timeout);
      if (previousEnvironment === undefined) delete process.env.MODERADO_ENV;
      else process.env.MODERADO_ENV = previousEnvironment;
      if (previousUrl === undefined) delete process.env.MODERADO_BASE_URL;
      else process.env.MODERADO_BASE_URL = previousUrl;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
