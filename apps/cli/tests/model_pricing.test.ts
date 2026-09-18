import { describe, expect, it } from 'vitest';
import { findModelPricing } from '../src/model_pricing.js';

describe('model pricing lookup', () => {
  it('returns the selected model pricing from a discovered provider catalog', () => {
    expect(findModelPricing([
      { id: 'free-model', pricing: { prompt: '0', completion: '0' } },
      { id: 'paid-model', pricing: { prompt: '0.000001', completion: '0.000002' } },
    ], 'paid-model')).toEqual({ prompt: '0.000001', completion: '0.000002' });
  });

  it('does not guess pricing for an absent or incomplete model record', () => {
    expect(findModelPricing([{ id: 'custom-model' }], 'custom-model')).toBeUndefined();
    expect(findModelPricing([], 'unknown-model')).toBeUndefined();
  });
});
