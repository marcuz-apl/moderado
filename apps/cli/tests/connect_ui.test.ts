import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, buildProviderPresets, renderConnectionPrompt } from '../src/ui/provider_connect.js';
import { maskSecret } from '../src/ui/prompt.js';

describe('provider preset list', () => {
  it('offers an OpenAI-compatible option last, after every built-in', () => {
    const presets = buildProviderPresets();
    expect(presets.at(-1)?.value).toBe('openai-compatible');
    expect(presets.filter((preset) => preset.value === 'openai-compatible')).toHaveLength(1);
    expect(PROVIDER_PRESETS.map((preset) => preset.value)).toEqual([
      'nvidia-nim', 'openrouter', 'agnes-ai', 'orcarouter', 'ollama', 'lm-studio', 'openai-compatible',
    ]);
  });

  it('keeps configured custom providers after the OpenAI-compatible entry', () => {
    const presets = buildProviderPresets({ custom: [{ id: 'gw', name: 'Gateway', baseUrl: 'https://gw.test/v1' }] });
    expect(presets.at(-1)?.value).toBe('custom:gw');
    expect(presets.map((preset) => preset.value)).toContain('openai-compatible');
  });
});

describe('secret masking', () => {
  it('never reveals the secret or its exact length', () => {
    // A fixed-length mask leaks how long the key is.
    expect(maskSecret('sk-abc123')).not.toContain('abc');
    expect(maskSecret('sk-abc123').length).toBeLessThan('sk-abc123'.length);
    expect(maskSecret('')).toBe('');
  });

  it('keeps a short constant mask so the field does not resize while typing', () => {
    expect(maskSecret('a')).toBe(maskSecret('a'.repeat(64)));
  });

  it('renders a masked connection prompt without echoing the secret', () => {
    const frame = renderConnectionPrompt('API Key', 'sk-super-secret', true).join('\n');
    expect(frame).not.toContain('sk-super-secret');
    expect(frame).not.toContain('secret');
    expect(frame).toContain('*');
  });

  it('renders a plain prompt for non-secret fields', () => {
    expect(renderConnectionPrompt('Base URL', 'https://x.test/v1', false).join('\n')).toContain('https://x.test/v1');
  });
});