import { describe, expect, it } from 'vitest';
import { CONNECT_PROVIDER_PRESET_IDS, CONNECT_PROVIDER_PRESET_META, freeModelPolicyFor, isFreeModelOption, resolveModeradoCloudBaseUrl } from '../src/presets.js';

describe('shared provider presets', () => {
  it('keeps the built-in presets available to other hosts', () => {
    // `openai-compatible` is a CLI pick-list entry with no fixed base URL, so
    // it has no preset metadata.
    expect(CONNECT_PROVIDER_PRESET_META.map((item) => item.id)).toEqual([
      'nvidia-nim', 'moderado-cloud', 'openrouter', 'agnes-ai', 'orcarouter', 'ollama', 'lm-studio',
    ]);
    expect(CONNECT_PROVIDER_PRESET_IDS).toContain('openai-compatible');
  });

  it('declares Moderado Cloud as the keyed auto route', () => {
    expect(CONNECT_PROVIDER_PRESET_META.find((item) => item.id === 'moderado-cloud')).toMatchObject({
      kind: 'openai-compatible',
      baseUrl: 'https://api.mod.alfazen.org/v1',
      defaultModel: 'auto',
      requiresApiKey: true,
      freeCatalog: true,
    });
  });

  it('uses a configured Gateway URL, inferring the default environment from loopback hosts', () => {
    expect(resolveModeradoCloudBaseUrl(undefined, 'http://localhost:8787/v1')).toBe('http://localhost:8787/v1');
    expect(resolveModeradoCloudBaseUrl(undefined, 'http://127.0.0.1:8787/v1')).toBe('http://127.0.0.1:8787/v1');
    expect(resolveModeradoCloudBaseUrl(undefined, 'https://cloud.moderado.example/v1')).toBe('https://cloud.moderado.example/v1');
    expect(resolveModeradoCloudBaseUrl(undefined)).toBe('https://api.mod.alfazen.org/v1');
    expect(resolveModeradoCloudBaseUrl('development')).toBe('http://127.0.0.1:8787/v1');
    expect(resolveModeradoCloudBaseUrl('production', 'http://localhost:8787/v1')).toBe('https://api.mod.alfazen.org/v1');
    expect(resolveModeradoCloudBaseUrl(undefined, 'http://nas.lan:8787/v1')).toBe('https://api.mod.alfazen.org/v1');
  });

  it('does not grant a provider-specific free declaration to another provider', () => {
    const unknown = { modelId: 'orcarouter/free', accessTier: 'unknown', toolSupport: 'unknown', source: 'heuristic' } as const;
    expect(isFreeModelOption({ id: 'orcarouter/free' }, unknown, freeModelPolicyFor('orcarouter'))).toBe(true);
    expect(isFreeModelOption({ id: 'orcarouter/free' }, unknown, freeModelPolicyFor('openrouter'))).toBe(false);
  });
});
