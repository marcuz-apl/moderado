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
