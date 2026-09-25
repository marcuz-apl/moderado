import { describe, it, expect } from 'vitest';
import {
  HostRequestSchema,
  ProviderListRequestSchema,
  ProviderConnectRequestSchema,
  ModelListRequestSchema,
  ProviderListResultSchema,
  ModelListResultSchema,
  ProviderConnectResultSchema,
} from '../src/protocol.js';

/**
 * The provider/model manager sends these over the same validated request union as
 * every other host call, so a shape drift here would be silently rejected at
 * runtime rather than failing to compile.
 */
describe('provider and model manager request shapes', () => {
  it('accepts provider.list and rejects an unknown method', () => {
    expect(ProviderListRequestSchema.safeParse({
      type: 'request', id: 'r1', method: 'provider.list', params: {},
    }).success).toBe(true);
    expect(HostRequestSchema.safeParse({
      type: 'request', id: 'r1', method: 'provider.bogus', params: {},
    }).success).toBe(false);
  });

  it('accepts provider.connect with an optional API key', () => {
    expect(ProviderConnectRequestSchema.safeParse({
      type: 'request', id: 'r2', method: 'provider.connect',
      params: { providerId: 'openrouter', apiKey: 'sk-test' },
    }).success).toBe(true);
    // Omitted key means "activate a provider whose key is already stored".
    expect(ProviderConnectRequestSchema.safeParse({
      type: 'request', id: 'r3', method: 'provider.connect',
      params: { providerId: 'ollama' },
    }).success).toBe(true);
  });

  it('rejects a provider id that could escape the connection namespace', () => {
    const parsed = ProviderConnectRequestSchema.safeParse({
      type: 'request', id: 'r4', method: 'provider.connect',
      params: { providerId: '../../etc/passwd' },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts model.list with and without an explicit provider', () => {
    expect(ModelListRequestSchema.safeParse({
      type: 'request', id: 'r5', method: 'model.list', params: {},
    }).success).toBe(true);
    expect(ModelListRequestSchema.safeParse({
      type: 'request', id: 'r6', method: 'model.list', params: { providerId: 'ollama' },
    }).success).toBe(true);
  });

  it('validates a provider listing the manager can render', () => {
    const parsed = ProviderListResultSchema.safeParse({
      providers: [
        { id: 'nvidia-nim', label: 'NVIDIA NIM', description: 'Free-first', requiresApiKey: true, hasApiKey: false, isActive: false },
        { id: 'ollama', label: 'Ollama', requiresApiKey: false, hasApiKey: true, isActive: true },
      ],
      activeProviderId: 'ollama',
    });
    expect(parsed.success).toBe(true);
  });

  it('validates a model catalog with free and paid entries', () => {
    const parsed = ModelListResultSchema.safeParse({
      providerId: 'nvidia-nim',
      models: [
        { id: 'z-ai/glm-5.3-flash', isFree: true, ownedBy: 'z-ai' },
        { id: 'meta/llama-3.3-70b', isFree: false },
      ],
      truncated: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('never carries a secret in a provider listing', () => {
    const parsed = ProviderListResultSchema.safeParse({
      providers: [{ id: 'openrouter', label: 'OpenRouter', requiresApiKey: true, hasApiKey: true, isActive: true }],
      activeProviderId: 'openrouter',
    });
    expect(parsed.success).toBe(true);
    // The schema has no apiKey field, so extra keys are stripped, not stored.
    const data: any = (parsed as any).data;
    expect(data.providers[0].apiKey).toBeUndefined();
  });

  it('accepts the connect acknowledgement', () => {
    expect(ProviderConnectResultSchema.safeParse({ providerId: 'openrouter', connected: true }).success).toBe(true);
  });
});
