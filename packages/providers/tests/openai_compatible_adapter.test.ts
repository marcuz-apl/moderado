import { OpenAICompatibleAdapter } from '../src/openai_compatible_adapter.js';
import { expect, it } from 'vitest';

it('preserves provider identity while sharing OpenAI-compatible transport', () => {
  const adapter = new OpenAICompatibleAdapter({ providerId: 'openrouter', providerName: 'OpenRouter', baseUrl: 'http://127.0.0.1:1/v1' });
  expect(adapter.id).toBe('openrouter');
  expect(adapter.name).toBe('OpenRouter');
});
