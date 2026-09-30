import { describe, expect, it } from 'vitest';
import { filterProvenFreeModels, listProviderPresets } from '../src/provider_service.js';

describe('provider service', () => {
  it('lists enabled presets and configured custom providers without losing connection details', () => {
    const choices = listProviderPresets({
      enabled: ['ollama'],
      custom: [{ id: 'gateway', name: 'Gateway', baseUrl: 'https://gateway.example/v1' }],
    });
    expect(choices).toEqual([
      expect.objectContaining({ id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', requiresApiKey: false }),
      expect.objectContaining({ id: 'custom:gateway', label: 'Gateway', baseUrl: 'https://gateway.example/v1', requiresApiKey: true }),
    ]);
  });

  it('keeps only entries with proven zero pricing, even when a paid id contains free', () => {
    expect(filterProvenFreeModels('openrouter', [
      { id: 'model:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'model/free', pricing: { prompt: '0.01', completion: '0' } },
      { id: 'unknown', pricing: { prompt: '0' } },
      { id: 'metered' },
    ]).map((entry) => entry.id)).toEqual(['model:free']);
  });

  it('accepts declared provider-free entries but lets nonzero pricing override the declaration', () => {
    expect(filterProvenFreeModels('agnes-ai', [
      { id: 'agnes/chat' },
      { id: 'agnes/paid', pricing: { prompt: '0.01', completion: '0' } },
    ]).map((entry) => entry.id)).toEqual(['agnes/chat']);
  });

  it('matches declared free suffixes only at trailing segment boundaries', () => {
    expect(filterProvenFreeModels('orcarouter', [
      { id: 'orcarouter/free' },
      { id: 'orcarouter/notfree' },
      { id: 'orcarouter/free-router' },
    ]).map((entry) => entry.id)).toEqual(['orcarouter/free']);
  });

  it('returns an empty list when a catalog has no free evidence', () => {
    expect(filterProvenFreeModels('openrouter', [{ id: 'orcarouter/free' }])).toEqual([]);
  });

  it('rejects malformed catalog entries instead of silently showing an incomplete catalog', () => {
    expect(() => filterProvenFreeModels('openrouter', [{ id: '' }])).toThrow();
  });
});
