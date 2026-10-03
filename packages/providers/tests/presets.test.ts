import { describe, expect, it } from 'vitest';
import { CONNECT_PROVIDER_PRESET_IDS, CONNECT_PROVIDER_PRESET_META, freeModelPolicyFor, isFreeModelOption } from '../src/presets.js';

describe('shared provider presets', () => {
  it('keeps the CLI 0.3.8 built-in presets available to other hosts', () => {
    // The shipped v0.3.8 catalog has six connectable presets. `openai-compatible`
    // is a CLI pick-list entry with no fixed base URL, so it has no preset meta.
    expect(CONNECT_PROVIDER_PRESET_META.map((item) => item.id)).toEqual([
      'nvidia-nim', 'moderado-cloud', 'openrouter', 'agnes-ai', 'orcarouter', 'ollama', 'lm-studio',
    ]);
    expect(CONNECT_PROVIDER_PRESET_IDS).toContain('openai-compatible');
  });

  it('does not grant a provider-specific free declaration to another provider', () => {
    const unknown = { modelId: 'orcarouter/free', accessTier: 'unknown', toolSupport: 'unknown', source: 'heuristic' } as const;
    expect(isFreeModelOption({ id: 'orcarouter/free' }, unknown, freeModelPolicyFor('orcarouter'))).toBe(true);
    expect(isFreeModelOption({ id: 'orcarouter/free' }, unknown, freeModelPolicyFor('openrouter'))).toBe(false);
  });
});
