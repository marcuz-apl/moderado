import { describe, expect, it } from 'vitest';
import { CONNECT_PROVIDER_PRESET_IDS, CONNECT_PROVIDER_PRESET_META, freeModelPolicyFor, isFreeModelOption, resolveModeradoBaseUrl, resolveModeradoCloudBaseUrl } from '../src/presets.js';

describe('shared provider presets', () => {
  it('keeps the built-in presets available to other hosts', () => {
    // `openai-compatible` is a CLI pick-list entry with no fixed base URL, so
    // it has no preset metadata.
    expect(CONNECT_PROVIDER_PRESET_META.map((item) => item.id)).toEqual([
      'nvidia-nim', 'moderado', 'openrouter', 'agnes-ai', 'orcarouter', 'ollama', 'lm-studio',
    ]);
    expect(CONNECT_PROVIDER_PRESET_IDS).toContain('openai-compatible');
    expect(CONNECT_PROVIDER_PRESET_IDS).toContain('moderado-cloud');
    expect(CONNECT_PROVIDER_PRESET_META.find((item) => item.id === 'moderado')).toMatchObject({ label: 'Moderado' });
    expect(freeModelPolicyFor('moderado-cloud')).toEqual(freeModelPolicyFor('moderado'));
  });

  it('declares Moderado as a public catalog with key-gated free routes', () => {
    expect(CONNECT_PROVIDER_PRESET_META.find((item) => item.id === 'moderado')).toMatchObject({
      kind: 'openai-compatible',
      baseUrl: 'https://modr.alfazen.org/v1',
      defaultModel: 'auto',
      requiresApiKey: false,
    });
  });

  it('uses a configured Gateway URL, inferring the default environment from loopback hosts', () => {
    expect(resolveModeradoBaseUrl(undefined, 'http://localhost:4788/v1')).toBe('http://localhost:4788/v1');
    expect(resolveModeradoBaseUrl(undefined, 'http://127.0.0.1:4788/v1')).toBe('http://127.0.0.1:4788/v1');
    expect(resolveModeradoBaseUrl(undefined, 'https://gateway.moderado.example/v1')).toBe('https://gateway.moderado.example/v1');
    expect(resolveModeradoBaseUrl(undefined)).toBe('https://modr.alfazen.org/v1');
    expect(resolveModeradoBaseUrl(undefined, 'https://api.mod.alfazen.org/v1')).toBe('https://modr.alfazen.org/v1');
    expect(resolveModeradoBaseUrl(undefined, 'http://127.0.0.1:8787/v1')).toBe('http://127.0.0.1:4788/v1');
    expect(resolveModeradoBaseUrl('development')).toBe('http://127.0.0.1:4788/v1');
    expect(resolveModeradoBaseUrl('production', 'http://localhost:4788/v1')).toBe('https://modr.alfazen.org/v1');
    expect(resolveModeradoBaseUrl(undefined, 'http://nas.lan:8787/v1')).toBe('https://modr.alfazen.org/v1');
    expect(resolveModeradoCloudBaseUrl('development')).toBe(resolveModeradoBaseUrl('development'));
    expect(resolveModeradoBaseUrl('production')).toBe('https://modr.alfazen.org/v1');
  });

  it('does not grant a provider-specific free declaration to another provider', () => {
    const unknown = { modelId: 'orcarouter/free', accessTier: 'unknown', toolSupport: 'unknown', source: 'heuristic' } as const;
    expect(isFreeModelOption({ id: 'orcarouter/free' }, unknown, freeModelPolicyFor('orcarouter'))).toBe(true);
    expect(isFreeModelOption({ id: 'orcarouter/free' }, unknown, freeModelPolicyFor('openrouter'))).toBe(false);
  });

  it('uses Gateway route access for cost and leaves unannotated routes unknown', () => {
    const moderadoFreePolicy = freeModelPolicyFor('moderado');
    const genericPaidClassification = { modelId: 'openai/gpt-oss-20b', accessTier: 'paid', toolSupport: 'supported', source: 'official_metadata' } as const;

    expect(isFreeModelOption({ id: 'openai/gpt-oss-20b' }, genericPaidClassification, moderadoFreePolicy)).toBe(false);
    expect(isFreeModelOption({ id: 'auto' }, { ...genericPaidClassification, modelId: 'auto', source: 'heuristic' }, moderadoFreePolicy)).toBe(false);
    expect(isFreeModelOption({ id: 'openai/gpt-oss-20b', pricing: { prompt: '0.001', completion: '0.002' } }, genericPaidClassification, moderadoFreePolicy)).toBe(false);
    expect(isFreeModelOption({ id: 'paid-route', access: 'paid' }, genericPaidClassification, moderadoFreePolicy)).toBe(false);
    expect(isFreeModelOption({ id: 'free-route', access: 'free' }, genericPaidClassification, moderadoFreePolicy)).toBe(true);
  });
});
