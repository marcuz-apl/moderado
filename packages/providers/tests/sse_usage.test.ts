import { expect, it } from 'vitest';
import { ProviderError } from '@moderado/contracts';
import { parseSseStream } from '../src/nvidia/sse_parser.js';

async function readUsage(usage: unknown) {
  async function* bytes() {
    yield new TextEncoder().encode(`data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`);
  }
  const chunks = [];
  for await (const chunk of parseSseStream(bytes())) chunks.push(chunk);
  return chunks;
}

it('preserves reported usage in a final usage-only chunk', async () => {
  expect((await readUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }))[0].usage)
    .toEqual({ promptTokens: 10, completionTokens: 4, totalTokens: 14 });
});

it('derives an omitted total from reported input and output counts', async () => {
  expect((await readUsage({ prompt_tokens: 10, completion_tokens: 4 }))[0].usage?.totalTokens).toBe(14);
});

it.each([
  { prompt_tokens: -1, completion_tokens: 4, total_tokens: 3 },
  { prompt_tokens: '10', completion_tokens: 4, total_tokens: 14 },
  { prompt_tokens: 10, completion_tokens: 0.5, total_tokens: 10.5 },
  { prompt_tokens: 10, total_tokens: 14 },
  { completion_tokens: 4, total_tokens: 14 },
  { prompt_tokens: null, completion_tokens: 4, total_tokens: 14 },
  { prompt_tokens: 10, completion_tokens: 4, total_tokens: null },
])('rejects malformed or incomplete reported usage: %j', async (usage) => {
  await expect(readUsage(usage)).rejects.toThrow(ProviderError);
  await expect(readUsage(usage)).rejects.toThrow('Invalid provider token usage');
});

it('accepts null usage sent before the final usage report', async () => {
  expect((await readUsage(null))[0].usage).toBeUndefined();
});

it('parses validated Gateway fallback status events before content', async () => {
  async function* bytes() {
    yield new TextEncoder().encode(`event: moderado_status\ndata: ${JSON.stringify({ from_model: 'free/old', to_model: `free/model_${'a'.repeat(229)}`, reason: 'rate_limited_or_unavailable' })}\n\ndata: {"choices":[{"delta":{"content":"hello"}}]}\n\n`);
  }
  const chunks = [];
  for await (const chunk of parseSseStream(bytes(), { moderadoCloud: true })) chunks.push(chunk);
  expect(chunks).toEqual([
    { gatewayStatus: { fromModel: 'free/old', toModel: `free/model_${'a'.repeat(229)}`, reason: 'rate_limited_or_unavailable' } },
    { contentDelta: 'hello', finishReason: null },
  ]);
});

it('rejects unsafe Gateway fallback metadata', async () => {
  async function* bytes() {
    yield new TextEncoder().encode('event: moderado_status\ndata: {"from_provider":"\\u001b[31m","from_model":"old","to_provider":"provider-b","to_model":"new","reason":"untrusted text"}\n\n');
  }
  await expect(async () => { for await (const _ of parseSseStream(bytes(), { moderadoCloud: true })) { /* consume */ } }).rejects.toThrow('Invalid Gateway status event');
});

it('ignores Gateway status events on non-Cloud provider streams', async () => {
  async function* bytes() {
    yield new TextEncoder().encode('event: moderado_status\ndata: {"from_provider":"provider-a","from_model":"old","to_provider":"provider-b","to_model":"new","reason":"unexpected"}\n\ndata: {"choices":[{"delta":{"content":"BYOK answer"}}]}\n\n');
  }
  const chunks = [];
  for await (const chunk of parseSseStream(bytes())) chunks.push(chunk);
  expect(chunks).toEqual([{ contentDelta: 'BYOK answer', finishReason: null }]);
});

it('ignores malformed Gateway status JSON on non-Cloud provider streams', async () => {
  async function* bytes() {
    yield new TextEncoder().encode('event: moderado_status\ndata: {broken json\n\ndata: {"choices":[{"delta":{"content":"BYOK answer"}}]}\n\n');
  }
  const chunks = [];
  for await (const chunk of parseSseStream(bytes())) chunks.push(chunk);
  expect(chunks).toEqual([{ contentDelta: 'BYOK answer', finishReason: null }]);
});
