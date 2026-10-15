import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { GatewayError } from '@moderado/contracts';
import { authorizeModeradoCloudInBrowser, buildConnection, buildModeradoCloudConnection, connectProviderInteractive, findReusableConnection, isAuthenticationFailure, isModeradoCloudOAuthConnection, loginModeradoCloudInteractive, PROVIDER_PRESETS, renderConnectionPrompt } from '../src/ui/provider_connect.js';
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
  it('offers NVIDIA NIM, Moderado Cloud, OpenRouter, and Agnes AI presets', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.value)).toEqual([
      'moderado-cloud', 'nvidia-nim', 'agnes-ai', 'openrouter', 'orcarouter', 'ollama', 'lm-studio', 'openai-compatible',
    ]);
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'openrouter')?.baseUrl)
      .toBe('https://openrouter.ai/api/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'agnes-ai')?.baseUrl)
      .toBe('https://apihub.agnes-ai.com/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'orcarouter')?.baseUrl).toBe('https://api.orcarouter.ai/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'ollama')?.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'lm-studio')?.baseUrl).toBe('http://127.0.0.1:1234/v1');
  });

  it('finds the saved profile for a named provider preset', () => {
    expect(findReusableConnection('openrouter', { openrouter: openRouter })).toEqual(openRouter);
    expect(findReusableConnection('agnes-ai', { openrouter: openRouter })).toBeUndefined();
    expect(findReusableConnection('openai-compatible', { openrouter: openRouter })).toBeUndefined();
  });

  it('defaults OrcaRouter to its free routing model', () => {
    const orcarouter = PROVIDER_PRESETS.find((preset) => preset.value === 'orcarouter');
    expect(orcarouter?.defaultModel).toBe('orcarouter/free');
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
  });

  it('identifies expiring Moderado OAuth credentials for browser reauthorization', () => {
    expect(isModeradoCloudOAuthConnection({ id: 'moderado-cloud', credentialExpiresAt: Date.now(), displayName: 'Moderado Cloud', kind: 'openai-compatible', baseUrl: 'https://mod.alfazen.org/v1' })).toBe(true);
    expect(isModeradoCloudOAuthConnection({ id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible', baseUrl: 'https://mod.alfazen.org/v1' })).toBe(false);
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

  it('builds a Moderado Cloud profile from a key and manages the Gateway URL', () => {
    const previous = process.env.MODERADO_CLOUD_ENV;
    delete process.env.MODERADO_CLOUD_ENV;
    try {
      expect(buildModeradoCloudConnection('mrd_test-key')).toEqual({
        id: 'moderado-cloud',
        displayName: 'Moderado Cloud',
        kind: 'openai-compatible',
        baseUrl: 'https://mod.alfazen.org/v1',
        apiKey: 'mrd_test-key',
        defaultModel: 'auto',
      });
      expect(() => buildModeradoCloudConnection('sk_wrong')).toThrow('mrd_');
      expect(() => buildModeradoCloudConnection('mrd_')).toThrow('mrd_');
    } finally {
      if (previous !== undefined) process.env.MODERADO_CLOUD_ENV = previous;
    }
  });

  it('builds a public Moderado Gateway profile without an account key', () => {
    const previousBaseUrl = process.env.MODERADO_CLOUD_BASE_URL;
    process.env.MODERADO_CLOUD_BASE_URL = 'https://gateway.example/v1/';
    try {
      expect(buildModeradoCloudConnection()).toEqual({
        id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible',
        baseUrl: 'https://gateway.example/v1', apiKey: undefined, defaultModel: 'auto',
      });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.MODERADO_CLOUD_BASE_URL;
      else process.env.MODERADO_CLOUD_BASE_URL = previousBaseUrl;
    }
  });

  it('targets the local Gateway when login runs in development mode', () => {
    const previous = process.env.MODERADO_CLOUD_ENV;
    process.env.MODERADO_CLOUD_ENV = 'development';
    try {
      expect(buildModeradoCloudConnection('mrd_test-key').baseUrl).toBe('http://127.0.0.1:4788/v1');
    } finally {
      if (previous === undefined) delete process.env.MODERADO_CLOUD_ENV;
      else process.env.MODERADO_CLOUD_ENV = previous;
    }
  });

  it('uses the selected Gateway Base URL even when an environment mode is set', () => {
    const previous = process.env.MODERADO_CLOUD_ENV;
    process.env.MODERADO_CLOUD_ENV = 'production';
    try {
      expect(buildModeradoCloudConnection('mrd_test-key', undefined, 'http://127.0.0.1:4788/v1').baseUrl)
        .toBe('http://127.0.0.1:4788/v1');
    } finally {
      if (previous === undefined) delete process.env.MODERADO_CLOUD_ENV;
      else process.env.MODERADO_CLOUD_ENV = previous;
    }
  });

  it('uses a configured loopback Gateway URL for a new Cloud login', () => {
    const previous = process.env.MODERADO_CLOUD_BASE_URL;
    process.env.MODERADO_CLOUD_BASE_URL = 'http://localhost:4788/v1/';
    try {
      expect(buildModeradoCloudConnection('mrd_test-key').baseUrl).toBe('http://localhost:4788/v1');
    } finally {
      if (previous === undefined) delete process.env.MODERADO_CLOUD_BASE_URL;
      else process.env.MODERADO_CLOUD_BASE_URL = previous;
    }
  });

  it('builds a Moderado Cloud profile from a browser token with expiry metadata', () => {
    expect(buildModeradoCloudConnection('mrd_oauth-token', Date.now() + 2_592_000_000)).toMatchObject({
      id: 'moderado-cloud',
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
    const pending = authorizeModeradoCloudInBrowser(undefined, {
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

describe('repeat Cloud login', () => {
  it('offers the saved key and shows the active provider without exposing the key', async () => {
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      authorization = request.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock Gateway failed to start.');
    const saved = { ...buildModeradoCloudConnection('mrd_saved-secret'), baseUrl: `http://127.0.0.1:${address.port}/v1` };
    const frames: string[][] = [];
    let modeSelected = false;
    let urlSelected = false;
    let keyConfirmed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_000);
    try {
      const result = await loginModeradoCloudInteractive({
        signal: controller.signal,
        activeConnection: saved,
        savedConnections: { 'moderado-cloud': { ...saved, apiKey: undefined } },
        resolveSavedConnection: async () => saved,
        drawFrame: (lines) => {
          frames.push(lines);
          const frame = lines.map(stripAnsi).join('\n');
          if (frame.includes('Moderado Gateway Mode') && !modeSelected) {
            modeSelected = true;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Moderado Gateway Base URL') && !urlSelected) {
            urlSelected = true;
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { ctrl: true, name: 'a' });
              for (const character of saved.baseUrl) process.stdin.emit('keypress', character, { name: character });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          } else if (frame.includes('Moderado Gateway API key') && !keyConfirmed) {
            keyConfirmed = true;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          }
          else if (frame.includes('Moderado Cloud Models')) setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'escape' }));
        },
      });
      expect(result).toEqual(saved);
      const visible = frames.flat().map(stripAnsi).join('\n');
      expect(visible).toContain('Moderado Gateway API key');
      expect(visible).toContain('*'.repeat(saved.apiKey!.length));
      expect(visible).not.toContain('mrd_saved-secret');
      expect(authorization).toBe('Bearer mrd_saved-secret');
    } finally {
      clearTimeout(timeout);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('shows the Gateway Base URL as an editable value inside the popup border', async () => {
    const frames: string[][] = [];
    let modeSelected = false;
    let urlSelected = false;
    let keyFrame = '';
    await loginModeradoCloudInteractive({
      activeConnection: buildModeradoCloudConnection(),
      drawFrame: (lines) => {
        frames.push(lines);
        const frame = lines.map(stripAnsi).join('\n');
        if (frame.includes('Moderado Gateway Mode') && !modeSelected) {
          modeSelected = true;
          setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
        } else if (frame.includes('Moderado Gateway Base URL') && !urlSelected) {
          urlSelected = true;
          setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
        } else if (frame.includes('Moderado Gateway API key')) {
          keyFrame = frame;
          setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'escape' }));
        }
      },
    });
    const lines = frames.find((frame) => frame.some((line) => stripAnsi(line).includes('Moderado Gateway Base URL')))!.map(stripAnsi);
    expect(lines.join('\n')).toContain('https://mod.alfazen.org/v1');
    expect(lines.join('\n')).toContain('Ctrl+A clear to edit');
    expect(lines.every((line) => line.length <= lines[0].length)).toBe(true);
    expect(keyFrame).toContain('Moderado Gateway API key');
  });
});

describe('unified provider connection', () => {
  it('shows a saved Gateway key masked and reuses it when confirmed', async () => {
    const saved = {
      id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible' as const,
      baseUrl: 'https://mod.alfazen.org/v1', apiKey: 'mrd_hidden-secret', defaultModel: 'auto',
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    let selectedMode = false;
    let confirmedUrl = false;
    let confirmedKey = false;
    let keyFrame = '';
    let showedMethodMenu = false;
    try {
      const result = await loginModeradoCloudInteractive({
        signal: controller.signal,
        savedConnections: { 'moderado-cloud': saved },
        resolveSavedConnection: async (connection) => connection,
        drawFrame: (lines) => {
          const frame = lines.map(stripAnsi).join('\n');
          if (frame.includes('Moderado Gateway Mode') && !selectedMode) {
            selectedMode = true;
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          } else if (frame.includes('Moderado Gateway Base URL') && !confirmedUrl) {
            confirmedUrl = true;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Moderado Gateway API key') && !confirmedKey) {
            confirmedKey = true;
            keyFrame = frame;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Login · Active:')) {
            showedMethodMenu = true;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Moderado Cloud Models')) {
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'escape' }));
          }
        },
      });
      expect(keyFrame).toContain('*'.repeat(saved.apiKey.length));
      expect(keyFrame).not.toContain(saved.apiKey);
      expect(showedMethodMenu).toBe(false);
      expect(result).toMatchObject({ apiKey: saved.apiKey, baseUrl: 'http://127.0.0.1:4788/v1' });
    } finally {
      clearTimeout(timeout);
    }
  });

  it('lets the user select Dev Mode for the Gateway and shows both /v1 URLs', async () => {
    const saved = {
      id: 'moderado-cloud', displayName: 'Moderado Cloud', kind: 'openai-compatible' as const,
      baseUrl: 'https://mod.alfazen.org/v1', apiKey: 'mrd_saved-key', defaultModel: 'auto',
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_000);
    let selectedMode = false;
    let selectedUrl = false;
    let confirmedKey = false;
    let productionModeFrame = '';
    let developmentModeFrame = '';
    let urlFrame = '';
    const previousMode = process.env.MODERADO_CLOUD_ENV;
    delete process.env.MODERADO_CLOUD_ENV;
    try {
      const result = await loginModeradoCloudInteractive({
        signal: controller.signal,
        gatewayUrl: saved.baseUrl,
        savedConnections: { 'moderado-cloud': saved },
        resolveSavedConnection: async (connection) => connection,
        drawFrame: (lines) => {
          const frame = lines.map(stripAnsi).join('\n');
          if (frame.includes('Moderado Gateway Mode')) {
            if (!frame.includes('http://127.0.0.1:4788/v1')) productionModeFrame = frame;
            else developmentModeFrame = frame;
            if (!selectedMode) {
              selectedMode = true;
              setImmediate(() => {
                process.stdin.emit('keypress', undefined, { name: 'down' });
                process.stdin.emit('keypress', '\r', { name: 'return' });
              });
            }
          } else if (frame.includes('Moderado Gateway Base URL') && !selectedUrl) {
            selectedUrl = true;
            urlFrame = frame;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Moderado Gateway API key') && !confirmedKey) {
            confirmedKey = true;
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Moderado Cloud Models')) {
            setImmediate(() => process.stdin.emit('keypress', undefined, { name: 'escape' }));
          }
        },
      });
      expect(productionModeFrame).toContain('https://mod.alfazen.org/v1');
      expect(developmentModeFrame).toContain('http://127.0.0.1:4788/v1');
      expect(urlFrame).toContain('http://127.0.0.1:4788/v1');
      expect(result?.baseUrl).toBe('http://127.0.0.1:4788/v1');
    } finally {
      clearTimeout(timeout);
      if (previousMode === undefined) delete process.env.MODERADO_CLOUD_ENV;
      else process.env.MODERADO_CLOUD_ENV = previousMode;
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
    const previousEnvironment = process.env.MODERADO_CLOUD_ENV;
    const previousUrl = process.env.MODERADO_CLOUD_BASE_URL;
    delete process.env.MODERADO_CLOUD_ENV;
    delete process.env.MODERADO_CLOUD_BASE_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_000);
    const seen = new Set<string>();
    try {
      const result = await connectProviderInteractive({
        signal: controller.signal,
        drawFrame: (lines) => {
          const frame = lines.map(stripAnsi).join('\n');
          if (frame.includes('Connect Provider') && !seen.has('provider')) {
            seen.add('provider');
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Moderado Gateway Mode') && !seen.has('mode')) {
            seen.add('mode');
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Moderado Gateway Base URL') && !seen.has('url')) {
            seen.add('url');
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { ctrl: true, name: 'a' });
              for (const character of gatewayUrl) process.stdin.emit('keypress', character, { name: character });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          } else if (frame.includes('Moderado Gateway API key') && !seen.has('key')) {
            seen.add('key');
            setImmediate(() => process.stdin.emit('keypress', '\r', { name: 'return' }));
          } else if (frame.includes('Moderado Cloud Models') && !seen.has('model')) {
            seen.add('model');
            setImmediate(() => {
              process.stdin.emit('keypress', undefined, { name: 'down' });
              process.stdin.emit('keypress', '\r', { name: 'return' });
            });
          }
        },
      });
      expect(result).toMatchObject({ id: 'moderado-cloud', defaultModel: 'vendor/route-one' });
      expect([...seen]).toEqual(['provider', 'mode', 'url', 'key', 'model']);
    } finally {
      clearTimeout(timeout);
      if (previousEnvironment === undefined) delete process.env.MODERADO_CLOUD_ENV;
      else process.env.MODERADO_CLOUD_ENV = previousEnvironment;
      if (previousUrl === undefined) delete process.env.MODERADO_CLOUD_BASE_URL;
      else process.env.MODERADO_CLOUD_BASE_URL = previousUrl;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
