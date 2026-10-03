import { OpenAICompatibleAdapter } from '../src/openai_compatible_adapter.js';
import { expect, it } from 'vitest';
import { parseSseStream } from '../src/nvidia/sse_parser.js';
import { NvidiaAdapter } from '../src/nvidia/nvidia_adapter.js';

it('preserves provider identity while sharing OpenAI-compatible transport', () => {
  const adapter = new OpenAICompatibleAdapter({ providerId: 'openrouter', providerName: 'OpenRouter', baseUrl: 'http://127.0.0.1:1/v1' });
  expect(adapter.id).toBe('openrouter');
  expect(adapter.name).toBe('OpenRouter');
});

it('keeps Moderado fallback status as metadata on the first streamed chunk', async () => {
  const bytes = new TextEncoder().encode('event: moderado_status\ndata: {"from_model":"openrouter:A","to_model":"nvidia:D","reason":"rate_limited_or_unavailable"}\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
  const chunks = [];
  for await (const chunk of parseSseStream((async function* () { yield bytes; })())) chunks.push(chunk);
  expect(chunks[0]).toMatchObject({ contentDelta: 'ok', gatewayFallback: { fromModel: 'openrouter:A', toModel: 'nvidia:D' } });
});

it('sends auto to Moderado Gateway only in server-routing mode', async () => {
  const originalFetch = globalThis.fetch;
  let body: any;
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response('data: [DONE]\n\n'); };
  try {
    const adapter = new NvidiaAdapter({ providerId: 'moderado-cloud', baseUrl: 'https://gateway.example/v1' });
    for await (const _chunk of adapter.streamChat({ modelId: 'openrouter:model-D', serverRouting: true, messages: [] })) { /* drain */ }
    expect(body.model).toBe('auto');
    for await (const _chunk of adapter.streamChat({ modelId: 'openrouter:model-D', messages: [] })) { /* drain */ }
    expect(body.model).toBe('openrouter:model-D');
  } finally { globalThis.fetch = originalFetch; }
});
