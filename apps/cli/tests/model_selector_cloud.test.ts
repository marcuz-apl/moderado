import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pickerState = vi.hoisted(() => ({
  selected: 'cancel',
  items: [] as Array<{ label: string; value: string; tag?: string; description?: string }>,
}));

vi.mock('../src/ui/popup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/popup.js')>();
  return {
    ...actual,
    layerPromptBox: vi.fn(),
    selectListPopup: vi.fn(async (_title: string, items: typeof pickerState.items) => {
      pickerState.items = items;
      return pickerState.selected;
    }),
  };
});

import { selectCompatibleModelOverlay } from '../src/ui/model_selector.js';

describe('Moderado model picker discovery', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let responseStatus: number;
  let responseBody: unknown;
  let authorization: string | undefined;
  let requestPath: string | undefined;

  beforeEach(async () => {
    responseStatus = 200;
    responseBody = { data: [{ id: 'vendor/route-one' }, { id: 'vendor/route-two' }] };
    authorization = undefined;
    requestPath = undefined;
    server = createServer((request, response) => {
      authorization = request.headers.authorization;
      requestPath = request.url;
      response.writeHead(responseStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify(responseBody));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock Gateway failed to start.');
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
    pickerState.selected = 'cancel';
    pickerState.items = [];
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    vi.restoreAllMocks();
  });

  const pickerOptions = (currentModel = 'auto') => ({
    apiKey: undefined,
    baseUrl,
    providerId: 'moderado',
    providerName: 'Moderado',
    currentModel,
    drawFrame: vi.fn(),
  });

  it('loads routes without a key and returns the exact selected route ID', async () => {
    pickerState.selected = 'model:vendor/route-one';
    const selected = await selectCompatibleModelOverlay(pickerOptions());

    expect(requestPath).toBe('/v1/models');
    expect(authorization).toBeUndefined();
    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'auto', value: 'model:auto' }),
      expect.objectContaining({ label: 'vendor/route-one', value: 'model:vendor/route-one', tag: 'Price unknown' }),
      expect.objectContaining({ label: 'vendor/route-two', value: 'model:vendor/route-two', tag: 'Price unknown' }),
    ]));
    expect(selected).toBe('vendor/route-one');
  });

  it('maps the visible auto choice to the Gateway model ID auto', async () => {
    pickerState.selected = 'model:auto';
    await expect(selectCompatibleModelOverlay(pickerOptions())).resolves.toBe('auto');
  });

  it('lists the Gateway default models for a keyless profile instead of auto', async () => {
    responseBody = {
      object: 'list',
      data: [
        { id: 'stealth one', name: 'Stealth One', access: 'paid', section: 'default' },
        { id: 'stealth two', access: 'paid', section: 'default' },
        { id: 'vendor/free', access: 'free', section: 'other' },
      ],
    };
    pickerState.selected = 'model:stealth one';
    const selected = await selectCompatibleModelOverlay({ ...pickerOptions(), gatewayFreeOnly: true });

    expect(requestPath).toBe('/v1/models');
    expect(authorization).toBeUndefined();
    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Stealth One', value: 'model:stealth one', tag: 'Free',
        description: expect.stringContaining('No key'),
      }),
      expect.objectContaining({ label: 'stealth two', value: 'model:stealth two', tag: 'Free' }),
      expect.objectContaining({ value: 'keep', tag: 'Gateway free defaults' }),
    ]));
    expect(pickerState.items.some((item) => item.value === 'model:auto')).toBe(false);
    expect(pickerState.items.some((item) => item.value === 'model:vendor/free')).toBe(false);
    expect(selected).toBe('stealth one');
  });

  it('explains when a keyless Gateway lists no default models instead of offering auto', async () => {
    responseBody = { data: [{ id: 'vendor/free', access: 'free', section: 'other' }] };
    pickerState.selected = 'cancel';
    const selected = await selectCompatibleModelOverlay({ ...pickerOptions(), gatewayFreeOnly: true });

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'No account-free models listed' }),
      expect.objectContaining({ label: 'Enter a model ID', value: 'custom' }),
    ]));
    expect(pickerState.items.some((item) => item.value === 'model:auto')).toBe(false);
    expect(selected).toBe('auto');
  });

  it('shows a diagnostic when a keyless Gateway catalog is unavailable', async () => {
    responseStatus = 401;
    responseBody = { error: { code: 'unauthorized', message: 'must not be displayed' } };
    pickerState.selected = 'cancel';

    await selectCompatibleModelOverlay({ ...pickerOptions(), gatewayFreeOnly: true });

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Model list unavailable' }),
    ]));
    expect(pickerState.items.some((item) => item.value === 'model:auto')).toBe(false);
    expect(pickerState.items.some((item) => item.description?.includes('must not be displayed'))).toBe(false);
  });

  it('labels Gateway paid and free routes from access metadata', async () => {
    responseBody = { data: [{ id: 'free-route', access: 'free' }, { id: 'paid-route', access: 'paid' }] };
    await selectCompatibleModelOverlay(pickerOptions());
    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'free-route', tag: 'Free' }),
      expect.objectContaining({ label: 'paid-route', tag: 'Paid' }),
    ]));
  });

  it('shows a safe diagnostic when the Gateway rejects model discovery', async () => {
    responseStatus = 401;
    responseBody = { error: { code: 'unauthorized', message: 'must not be displayed' } };

    await selectCompatibleModelOverlay(pickerOptions());

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Model list unavailable',
        description: expect.stringContaining('Use /connect to enter a website key'),
      }),
    ]));
    expect(pickerState.items.some((item) => item.description?.includes('must not be displayed'))).toBe(false);
  });

  it('explains when discovery succeeds but no Moderado routes are enabled', async () => {
    responseBody = { data: [] };

    await selectCompatibleModelOverlay(pickerOptions());

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'No available Gateway routes',
        description: expect.stringContaining('no configured routes'),
      }),
    ]));
  });

  it('shows a diagnostic when an Ollama instance is not running', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:99999'));
    // The mocked picker records its items before returning, so an early exit on
    // 'cancel' still exercises the menu construction. 'custom' would fall
    // through to the free-text prompt and block on stdin.
    pickerState.selected = 'cancel';
    const ollamaOptions = {
      apiKey: undefined,
      baseUrl: 'http://127.0.0.1:99999/v1',
      providerId: 'ollama',
      providerName: 'Ollama',
      currentModel: 'llama3.2',
      drawFrame: vi.fn(),
    };
    await selectCompatibleModelOverlay(ollamaOptions);
    fetchSpy.mockRestore();

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Model list unavailable',
        description: expect.stringContaining('Ollama'),
      }),
    ]));
    expect(pickerState.items.some((item) => item.value === 'custom')).toBe(true);
    expect(pickerState.items.some((item) => item.value === 'keep')).toBe(true);
  });

  it('shows a diagnostic when an LM Studio instance returns a 503', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Network Error')
    );
    pickerState.selected = 'cancel';
    const lmStudioOptions = {
      apiKey: undefined,
      baseUrl: 'http://127.0.0.1:19999/v1', // Wrong port ensures network error
      providerId: 'lm-studio',
      providerName: 'LM Studio',
      currentModel: undefined,
      drawFrame: vi.fn(),
    };

    await selectCompatibleModelOverlay(lmStudioOptions);
    fetchSpy.mockRestore();

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Model list unavailable',
        description: expect.stringContaining('LM Studio'),
      }),
    ]));
  });
});

describe('local provider model picker', () => {
  // A local runtime publishes no `pricing` and no `access` tier, so nothing in
  // its catalog is ever classified free. The /model menu used to offer only a
  // free/paid split, which left it with no models in it at all — discovery
  // appeared to do nothing for Ollama and LM Studio.
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    pickerState.selected = 'cancel';
    pickerState.items = [];
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        data: [
          { id: 'gemma4:31b-cloud', object: 'model', owned_by: 'library' },
          { id: 'deepseek-v4-flash:cloud', object: 'model', owned_by: 'library' },
        ],
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock local runtime failed to start.');
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    vi.restoreAllMocks();
  });

  const localOptions = (providerId: string, providerName: string, currentModel?: string) => ({
    apiKey: undefined,
    baseUrl,
    providerId,
    providerName,
    currentModel,
    drawFrame: vi.fn(),
  });

  it('lists every discovered model for Ollama instead of an empty free/paid split', async () => {
    await selectCompatibleModelOverlay(localOptions('ollama', 'Ollama', 'gemma4:31b-cloud'));

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'gemma4:31b-cloud', value: 'model:gemma4:31b-cloud', tag: 'Local' }),
      expect.objectContaining({ label: 'deepseek-v4-flash:cloud', value: 'model:deepseek-v4-flash:cloud', tag: 'Local' }),
    ]));
    // The Gateway routing row and the free-only browse row are both meaningless
    // for a runtime that serves models from this machine.
    expect(pickerState.items.some((item) => item.value === 'model:auto')).toBe(false);
    expect(pickerState.items.some((item) => item.value === 'free' || item.value === 'browse')).toBe(false);
    // The manual escape hatches stay available.
    expect(pickerState.items.some((item) => item.value === 'custom')).toBe(true);
    expect(pickerState.items.some((item) => item.value === 'keep')).toBe(true);
  });

  it('lists every discovered model for LM Studio', async () => {
    await selectCompatibleModelOverlay(localOptions('lm-studio', 'LM Studio'));

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'gemma4:31b-cloud', value: 'model:gemma4:31b-cloud', tag: 'Local' }),
      expect.objectContaining({ label: 'deepseek-v4-flash:cloud', value: 'model:deepseek-v4-flash:cloud', tag: 'Local' }),
    ]));
  });

  it('returns the exact selected local model ID', async () => {
    pickerState.selected = 'model:deepseek-v4-flash:cloud';

    await expect(selectCompatibleModelOverlay(localOptions('ollama', 'Ollama')))
      .resolves.toBe('deepseek-v4-flash:cloud');
  });

  it('still lists a hosted catalog directly when nothing in it is classified free', async () => {
    await selectCompatibleModelOverlay({
      ...localOptions('some-custom-endpoint', 'Some Endpoint'),
      providerId: 'some-custom-endpoint',
    });

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'gemma4:31b-cloud', value: 'model:gemma4:31b-cloud' }),
      expect.objectContaining({ label: 'deepseek-v4-flash:cloud', value: 'model:deepseek-v4-flash:cloud' }),
    ]));
  });
});
