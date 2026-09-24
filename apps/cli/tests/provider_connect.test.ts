import { describe, expect, it } from 'vitest';
import { buildConnection, buildProviderPresets, findReusableConnection, isAuthenticationFailure, PROVIDER_PRESETS, renderConnectionPrompt } from '../src/ui/provider_connect.js';

const openRouter = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  kind: 'openai-compatible' as const,
  baseUrl: 'https://openrouter.ai/api/v1',
  credentialReference: 'moderado/provider/openrouter',
  defaultModel: 'openrouter/free',
};

describe('provider connection setup', () => {
  it('offers NVIDIA NIM, OpenRouter, and Agnes AI presets', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.value)).toEqual([
      'nvidia-nim', 'openrouter', 'agnes-ai', 'orcarouter', 'ollama', 'lm-studio', 'openai-compatible',
    ]);
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'openrouter')?.baseUrl)
      .toBe('https://openrouter.ai/api/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'agnes-ai')?.baseUrl)
      .toBe('https://apihub.agnes-ai.com/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'orcarouter')?.baseUrl).toBe('https://api.orcarouter.ai/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'ollama')?.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'lm-studio')?.baseUrl).toBe('http://127.0.0.1:1234/v1');
  });

  it('finds the saved profile for a named provider preset', () => {
    expect(findReusableConnection('openrouter', { openrouter: openRouter })).toEqual(openRouter);
    expect(findReusableConnection('agnes-ai', { openrouter: openRouter })).toBeUndefined();
    expect(findReusableConnection('openai-compatible', { openrouter: openRouter })).toBeUndefined();
  });

  it('uses configured built-ins and custom provider entries for the connect menu', () => {
    const presets = buildProviderPresets({
      enabled: ['openrouter'],
      custom: [{ id: 'company-gateway', name: 'Company Gateway', baseUrl: 'https://llm.example.test/v1', defaultModel: 'coder-small' }],
    });
    expect(presets.map(({ value }) => value)).toEqual(['openrouter', 'custom:company-gateway']);
    expect(presets[1]).toMatchObject({
      label: 'Company Gateway',
      displayName: 'Company Gateway',
      baseUrl: 'https://llm.example.test/v1',
      defaultModel: 'coder-small',
    });
    expect(findReusableConnection('custom:company-gateway', { 'company-gateway': { ...openRouter, id: 'company-gateway' } }))
      .toMatchObject({ id: 'company-gateway' });
  });

  it('shows all built-in choices when no provider list is configured', () => {
    expect(buildProviderPresets().map(({ value }) => value)).toEqual(PROVIDER_PRESETS.map(({ value }) => value));
  });

  it('defaults OrcaRouter to its free routing model', () => {
    const orcarouter = PROVIDER_PRESETS.find((preset) => preset.value === 'orcarouter');
    expect(orcarouter?.defaultModel).toBe('orcarouter/free');
  });
  it('builds local providers without an API key', () => {
    expect(buildConnection({ kind: 'openai-compatible', displayName: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen2.5-coder' })).toMatchObject({ id: 'ollama', apiKey: undefined });
    expect(buildConnection({ kind: 'openai-compatible', displayName: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'local-model' })).toMatchObject({ id: 'lm-studio', apiKey: undefined });
  });

  it('recognizes provider authentication failures without exposing a key', () => {
    expect(isAuthenticationFailure(new Error('OpenRouter authentication failed (401) during chat'))).toBe(true);
    expect(isAuthenticationFailure(new Error('request failed with status 429'))).toBe(false);
  });

  it('renders credential entry as a popup, masking secrets', () => {
    const plain = renderConnectionPrompt('NVIDIA API key', 'nvapi-secret', true).join('\n').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    expect(plain).toContain('NVIDIA API key');
    expect(plain).toContain('************');
    expect(plain).not.toContain('nvapi-secret');
  });

  it('builds a NVIDIA NIM profile with free-first AUTO routing', () => {
    expect(buildConnection({ kind: 'nvidia-nim', apiKey: 'nvapi-test' })).toEqual({
      id: 'nvidia-nim',
      displayName: 'NVIDIA NIM',
      kind: 'nvidia-nim',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test',
    });
  });

  it('normalizes an OpenAI-compatible endpoint and requires a model', () => {
    expect(buildConnection({
      kind: 'openai-compatible',
      displayName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-test',
      defaultModel: 'openrouter/free',
    })).toMatchObject({
      id: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'openrouter/free',
    });
    expect(() => buildConnection({ kind: 'openai-compatible', baseUrl: 'https://example.com/v1' }))
      .toThrow('model');
  });
});
