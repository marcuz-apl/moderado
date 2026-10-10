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

describe('Moderado Gateway model picker discovery', () => {
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
  });

  const pickerOptions = (currentModel = 'auto') => ({
    apiKey: undefined,
    baseUrl,
    providerId: 'moderado-cloud',
    providerName: 'Moderado Cloud',
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
        description: expect.stringContaining('rejected the API key'),
      }),
    ]));
    expect(pickerState.items.some((item) => item.description?.includes('must not be displayed'))).toBe(false);
  });

  it('explains when discovery succeeds but the Cloud pool has no enabled routes', async () => {
    responseBody = { data: [] };

    await selectCompatibleModelOverlay(pickerOptions());

    expect(pickerState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'No available Gateway routes',
        description: expect.stringContaining('no configured routes'),
      }),
    ]));
  });
});
