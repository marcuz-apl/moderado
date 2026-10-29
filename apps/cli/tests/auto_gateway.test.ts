import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAutomaticModeradoBaseUrl,
  MODERADO_DEVELOPMENT_BASE_URL,
  MODERADO_PRODUCTION_BASE_URL,
  resolveAutoModeradoBaseUrl,
  resolveModeradoSessionConnection,
} from '../src/config.js';

interface MockGateway {
  url: string;
  requests: string[];
  close: () => Promise<void>;
}

async function startGateway(status = 200, delayMs = 0): Promise<MockGateway> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    setTimeout(() => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock Gateway failed to start.');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function closedPortUrl(): Promise<string> {
  const gateway = await startGateway();
  await gateway.close();
  return gateway.url;
}

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const close of cleanup.splice(0)) await close();
});

describe('automatic Moderado Gateway selection', () => {
  it('uses the reachable development Gateway before production', async () => {
    const development = await startGateway();
    const production = await startGateway();
    cleanup.push(development.close, production.close);

    await expect(resolveAutoModeradoBaseUrl({}, { developmentUrl: development.url, productionUrl: production.url }))
      .resolves.toBe(development.url);
    expect(development.requests).toEqual(['/v1/models']);
    expect(production.requests).toEqual([]);
  });

  it('falls back to production when the development Gateway is unavailable', async () => {
    const production = await startGateway();
    cleanup.push(production.close);
    const developmentUrl = await closedPortUrl();

    await expect(resolveAutoModeradoBaseUrl({}, { developmentUrl, productionUrl: production.url }))
      .resolves.toBe(production.url);
  });

  it('falls back to production when the development Gateway is not ready', async () => {
    const development = await startGateway(503);
    const production = await startGateway();
    cleanup.push(development.close, production.close);

    await expect(resolveAutoModeradoBaseUrl({}, { developmentUrl: development.url, productionUrl: production.url }))
      .resolves.toBe(production.url);
  });

  it('keeps an explicit Gateway URL without probing', async () => {
    const development = await startGateway();
    cleanup.push(development.close);
    vi.stubEnv('MODERADO_BASE_URL', 'https://gateway.example/v1');

    await expect(resolveAutoModeradoBaseUrl({}, { developmentUrl: development.url }))
      .resolves.toBe('https://gateway.example/v1');
    expect(development.requests).toEqual([]);
  });

  it('keeps a saved Moderado profile without probing', async () => {
    const development = await startGateway();
    cleanup.push(development.close);

    await expect(resolveAutoModeradoBaseUrl({
      connections: {
        moderado: {
          id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
          baseUrl: 'https://saved.example/v1', defaultModel: 'auto',
        },
      },
    }, { developmentUrl: development.url })).resolves.toBe('https://saved.example/v1');
    expect(development.requests).toEqual([]);
  });

  it('treats a development Gateway that misses the probe deadline as unavailable', async () => {
    const development = await startGateway(200, 200);
    const production = await startGateway();
    cleanup.push(development.close, production.close);

    await expect(resolveAutoModeradoBaseUrl({}, {
      developmentUrl: development.url,
      productionUrl: production.url,
      timeoutMs: 30,
    })).resolves.toBe(production.url);
  });

  it('recognizes the built-in Gateway URLs as probe results rather than explicit choices', () => {
    expect(isAutomaticModeradoBaseUrl(MODERADO_PRODUCTION_BASE_URL)).toBe(true);
    expect(isAutomaticModeradoBaseUrl(MODERADO_DEVELOPMENT_BASE_URL)).toBe(true);
    expect(isAutomaticModeradoBaseUrl('https://gateway.example/v1')).toBe(false);
    expect(isAutomaticModeradoBaseUrl(undefined)).toBe(false);
  });

  it('re-probes when a keyless profile saved the default production Gateway', async () => {
    const development = await startGateway();
    cleanup.push(development.close);

    await expect(resolveAutoModeradoBaseUrl({
      connections: {
        moderado: {
          id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
          baseUrl: MODERADO_PRODUCTION_BASE_URL, defaultModel: 'auto',
        },
      },
    }, { developmentUrl: development.url })).resolves.toBe(development.url);
    expect(development.requests).toEqual(['/v1/models']);
  });

  it('keeps a keyed profile on its production Gateway without probing', async () => {
    const development = await startGateway();
    cleanup.push(development.close);

    await expect(resolveAutoModeradoBaseUrl({
      connections: {
        moderado: {
          id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
          baseUrl: MODERADO_PRODUCTION_BASE_URL, apiKey: 'mrd_test-key', defaultModel: 'auto',
        },
      },
    }, { developmentUrl: development.url })).resolves.toBe(MODERADO_PRODUCTION_BASE_URL);
    expect(development.requests).toEqual([]);
  });

  it('re-probes a keyless session profile but leaves keyed and custom profiles alone', async () => {
    const development = await startGateway();
    cleanup.push(development.close);
    const keyless = {
      id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible' as const,
      baseUrl: MODERADO_PRODUCTION_BASE_URL, defaultModel: 'auto',
    };

    await expect(resolveModeradoSessionConnection(
      keyless, { connections: { moderado: keyless } }, { developmentUrl: development.url },
    )).resolves.toMatchObject({ baseUrl: development.url });

    const keyed = { ...keyless, apiKey: 'mrd_test-key' };
    await expect(resolveModeradoSessionConnection(
      keyed, { connections: { moderado: keyed } }, { developmentUrl: development.url },
    )).resolves.toBe(keyed);

    const custom = { ...keyless, baseUrl: 'https://gateway.example/v1' };
    await expect(resolveModeradoSessionConnection(
      custom, { connections: { moderado: custom } }, { developmentUrl: development.url },
    )).resolves.toBe(custom);
  });

  it('honors a saved production choice instead of probing a reachable development Gateway', async () => {
    const development = await startGateway();
    cleanup.push(development.close);

    await expect(resolveAutoModeradoBaseUrl({
      connections: {
        moderado: {
          id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
          baseUrl: MODERADO_PRODUCTION_BASE_URL, gatewayEnvironment: 'production', defaultModel: 'auto',
        },
      },
    }, { developmentUrl: development.url })).resolves.toBe(MODERADO_PRODUCTION_BASE_URL);
    expect(development.requests).toEqual([]);
  });

  it('honors a saved development choice even when that Gateway is down', async () => {
    const production = await startGateway();
    cleanup.push(production.close);
    const developmentUrl = await closedPortUrl();

    await expect(resolveAutoModeradoBaseUrl({
      connections: {
        moderado: {
          id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
          baseUrl: developmentUrl, gatewayEnvironment: 'development', defaultModel: 'auto',
        },
      },
    }, { developmentUrl, productionUrl: production.url })).resolves.toBe(developmentUrl);
  });

  it('lets an explicit environment URL override the saved choice', async () => {
    const development = await startGateway();
    cleanup.push(development.close);
    vi.stubEnv('MODERADO_BASE_URL', 'https://gateway.example/v1');

    await expect(resolveAutoModeradoBaseUrl({
      connections: {
        moderado: {
          id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
          baseUrl: MODERADO_DEVELOPMENT_BASE_URL, gatewayEnvironment: 'development', defaultModel: 'auto',
        },
      },
    }, { developmentUrl: development.url })).resolves.toBe('https://gateway.example/v1');
  });

  it('moves a session profile to the explicitly chosen deployment without probing', async () => {
    const development = await startGateway();
    cleanup.push(development.close);
    const keyed = {
      id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible' as const,
      baseUrl: MODERADO_PRODUCTION_BASE_URL, apiKey: 'mrd_test-key',
      gatewayEnvironment: 'development' as const, defaultModel: 'auto',
    };

    await expect(resolveModeradoSessionConnection(
      keyed, { connections: { moderado: keyed } }, { developmentUrl: development.url },
    )).resolves.toMatchObject({
      baseUrl: MODERADO_DEVELOPMENT_BASE_URL,
      gatewayEnvironment: 'development',
      apiKey: 'mrd_test-key',
    });
    expect(development.requests).toEqual([]);
  });
});
