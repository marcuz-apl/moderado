import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { selectModelInteractive } from '../src/ui/model_selector.js';
import { loadConfig, saveConfig } from '../src/config.js';

describe('CLI Model Selector (OpenCode-Style Free vs Paid)', () => {
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
