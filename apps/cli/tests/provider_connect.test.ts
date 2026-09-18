import { describe, expect, it } from 'vitest';
import { buildConnection, PROVIDER_PRESETS, renderConnectionPrompt } from '../src/ui/provider_connect.js';

describe('provider connection setup', () => {
  it('offers NVIDIA NIM, OpenRouter, and Agnes AI presets', () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.value)).toEqual([
      'nvidia-nim', 'openrouter', 'agnes-ai', 'openai-compatible',
    ]);
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'openrouter')?.baseUrl)
      .toBe('https://openrouter.ai/api/v1');
    expect(PROVIDER_PRESETS.find((preset) => preset.value === 'agnes-ai')?.baseUrl)
      .toBe('https://apihub.agnes-ai.com/v1');
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
