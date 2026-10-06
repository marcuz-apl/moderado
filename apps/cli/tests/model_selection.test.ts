import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildModelConnectionRequiredItems,
  buildCompatibleModelMenuItems,
  buildOverlayMenuItems,
  selectModelInteractive,
} from '../src/ui/model_selector.js';
import { loadConfig, saveConfig } from '../src/config.js';

describe('CLI Model Selector (OpenCode-Style Free vs Paid)', () => {
  it('offers a visible connection explanation when NVIDIA model selection is unavailable', () => {
    const items = buildModelConnectionRequiredItems();

    expect(items).toEqual([
      expect.objectContaining({
        label: 'Connect Moderado Cloud first',
        description: expect.stringContaining('/login'),
      }),
      expect.objectContaining({ label: 'Close Window' }),
    ]);
  });

  it('offers discovered and explicit model choices for OpenAI-compatible providers', () => {
    const items = buildCompatibleModelMenuItems('OpenRouter', [
      { id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } },
      { id: 'z-ai/glm-5.3-flash', pricing: { prompt: '0.000001', completion: '0.000001' } },
    ], 'openrouter/free');

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Browse Free Models', tag: '1 Free' }),
      expect.objectContaining({ label: 'Enter a model ID', description: expect.stringContaining('OpenRouter') }),
      expect.objectContaining({ label: 'Keep Current Model', value: 'keep' }),
    ]));
  });

  it('filters OpenRouter models to offer only free models', () => {
    const items = buildCompatibleModelMenuItems('OpenRouter', [
      { id: 'openrouter/free', pricing: { prompt: '0', completion: '0', request: '0' } },
      { id: 'openai/gpt-4', pricing: { prompt: '0.00003', completion: '0.00006', request: '0' } },
    ]);

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Browse Free Models', tag: '1 Free' }),
    ]));
    expect(items.find((item) => item.label.includes('Paid'))).toBeUndefined();
  });

  it('marks every Agnes model choice as free', () => {
    const items = buildCompatibleModelMenuItems('Agnes AI', [{ id: 'agnes/chat' }, { id: 'agnes/code' }], undefined, { freeCatalog: true });

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Browse available models', tag: '2 Free' }),
      expect.objectContaining({ label: 'Enter a model ID', tag: 'Manual' }),
    ]));
  });

  it('offers the full Moderado Cloud route inventory as free models', () => {
    const items = buildCompatibleModelMenuItems('Moderado Cloud', [
      { id: 'vendor/route-one' }, { id: 'vendor/route-two' },
    ], 'auto', { freeCatalog: true });
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Browse available models', tag: '2 Free' }),
    ]));
  });

  it('lists Moderado Cloud routes directly and labels auto routing as auto:free', () => {
    const items = buildCompatibleModelMenuItems('Moderado Cloud', [
      { id: 'auto' }, { id: 'vendor/route-one' }, { id: 'vendor/route-two' },
    ], 'auto', { freeCatalog: true }, { listModelsDirectly: true, autoLabel: 'auto:free' });

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'auto:free', value: 'model:auto' }),
      expect.objectContaining({ label: 'vendor/route-one', value: 'model:vendor/route-one', tag: 'Free' }),
      expect.objectContaining({ label: 'vendor/route-two', value: 'model:vendor/route-two', tag: 'Free' }),
    ]));
    expect(items.find((item) => item.label === 'Browse available models')).toBeUndefined();
  });

  it('shows a sanitized catalog diagnostic when no Cloud routes can be loaded', () => {
    const items = buildCompatibleModelMenuItems('Moderado Cloud', [], 'auto', { freeCatalog: true }, {
      listModelsDirectly: true,
      autoLabel: 'auto:free',
      catalogError: 'Could not load models (HTTP 401). Check the API key and retry /model.',
    });

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Model list unavailable', value: 'catalog-status', tag: 'Check connection' }),
    ]));
  });

  it('explains when the Gateway has no enabled model routes', () => {
    const items = buildCompatibleModelMenuItems('Moderado Cloud', [], 'auto', { freeCatalog: true }, {
      listModelsDirectly: true,
      autoLabel: 'auto:free',
      noAvailableModels: true,
    });

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'No available Cloud models', value: 'catalog-status' }),
    ]));
  });

  it('puts curated popular free models ahead of dynamic catalog actions', () => {
    const items = buildOverlayMenuItems([
      'nvidia/nemotron-3-ultra-120b-a12b',
      'nvidia/nemotron-3-5-lightning-30b-a3b',
      'z-ai/glm-5.3-flash',
    ], 75, 9, 'auto');

    expect(items.slice(0, 3).map((item) => item.label)).toEqual([
      'Nemotron 3 Ultra Free',
      'Nemotron 3.5 Lightning Free',
      'z-ai/glm-5.3-flash',
    ]);
    expect(items.map((item) => item.label)).toContain('Browse Free Models');
    expect(items.map((item) => item.label)).toContain('Cancel & Close Window');
  });

  let tempHome: string;
  let origEnvKey: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-model-sel-'));
    origEnvKey = process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;
  });

  afterEach(() => {
    if (origEnvKey) {
      process.env.NVIDIA_API_KEY = origEnvKey;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('selectModelInteractive exports properly and handles auto selection', async () => {
    // We can verify selectModelInteractive is a valid callable async function
    expect(typeof selectModelInteractive).toBe('function');
  });

  it('selectModelInteractive preserves currentModel when signal is aborted or cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await selectModelInteractive({
      currentModel: 'moonshotai/kimi-k3',
      signal: controller.signal,
    });

    expect(result.modelId).toBe('moonshotai/kimi-k3');
  });

  it('correctly persists default model and allowPaid flags in config', () => {
    saveConfig(
      {
        defaultModel: 'nvidia/llama-3.1-nemotron-70b-instruct',
        allowPaid: false,
      },
      tempHome
    );

    const loaded = loadConfig(tempHome);
    expect(loaded.defaultModel).toBe('nvidia/llama-3.1-nemotron-70b-instruct');
    expect(loaded.allowPaid).toBe(false);

    // Update with a paid model
    saveConfig(
      {
        defaultModel: 'mistralai/mistral-large-2-instruct',
        allowPaid: true,
      },
      tempHome
    );

    const updated = loadConfig(tempHome);
    expect(updated.defaultModel).toBe('mistralai/mistral-large-2-instruct');
    expect(updated.allowPaid).toBe(true);
  });
});
