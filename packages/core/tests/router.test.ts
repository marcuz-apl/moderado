import { describe, it, expect } from 'vitest';
import { Router, NoEligibleModelError } from '../src/router.js';
import { ModelInventoryEntry } from '@moderado/contracts';

describe('Router (Free-First Routing)', () => {
  const sampleInventory: ModelInventoryEntry[] = [
    { id: 'meta/llama-3.3-70b-instruct', object: 'model', owned_by: 'nvidia' },
    { id: 'deepseek-ai/deepseek-r1', object: 'model', owned_by: 'nvidia' },
    { id: 'custom/paid-tool-model', object: 'model', owned_by: 'nvidia' },
  ];

  it('selects free tool-capable model ahead of others', () => {
    const router = new Router({
      'custom/paid-tool-model': { accessTier: 'paid', toolSupport: 'supported' },
    });

    const result = router.selectModel(sampleInventory);
    expect(result.selectedModel.id).toBe('meta/llama-3.3-70b-instruct');
    expect(result.selectedModel.classification.accessTier).toBe('free_trial');
  });

  it('excludes tool-unsupported model when requireTools is true', () => {
    const router = new Router();
    const inventory: ModelInventoryEntry[] = [
      { id: 'deepseek-ai/deepseek-r1', object: 'model', owned_by: 'nvidia' },
    ];

    expect(() => router.selectModel(inventory, { requireTools: true })).toThrow(NoEligibleModelError);
  });

  it('allows paid model when explicitly enabled with allowPaid', () => {
    const router = new Router({
      'custom/paid-tool-model': { accessTier: 'paid', toolSupport: 'supported' },
    });

    const inventory: ModelInventoryEntry[] = [
      { id: 'custom/paid-tool-model', object: 'model', owned_by: 'nvidia' },
    ];

    const result = router.selectModel(inventory, { allowPaid: true });
    expect(result.selectedModel.id).toBe('custom/paid-tool-model');
  });

  it('pins exact model when pinnedModelId is supplied', () => {
    const router = new Router();
    const result = router.selectModel(sampleInventory, {
      pinnedModelId: 'deepseek-ai/deepseek-r1',
    });

    expect(result.selectedModel.id).toBe('deepseek-ai/deepseek-r1');
  });

  it('returns next fallback candidate in ranked order', () => {
    const router = new Router({
      'model-a': { accessTier: 'free_trial', toolSupport: 'supported' },
      'model-b': { accessTier: 'free_trial', toolSupport: 'supported' },
    });

    const inventory: ModelInventoryEntry[] = [
      { id: 'model-a', object: 'model', owned_by: 'nvidia' },
      { id: 'model-b', object: 'model', owned_by: 'nvidia' },
    ];

    const result = router.selectModel(inventory);
    const fallback = router.getNextFallback(result.rankedCandidates, result.selectedModel.id);
    expect(fallback).toBeDefined();
    expect(fallback?.id).toBe('model-b');
  });
});
