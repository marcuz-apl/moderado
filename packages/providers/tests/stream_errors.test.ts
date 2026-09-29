import { expect, it } from 'vitest';
import { AuthenticationError, MalformedResponseError, ModelUnavailableError, RateLimitError } from '@moderado/contracts';
import { parseSseStream } from '../src/nvidia/sse_parser.js';
import { isFreeModelEntry } from '../src/model_discovery.js';

async function read(line: string): Promise<void> {
  const bytes = (async function* () { yield Buffer.from(`data: ${line}\n\n`); })();
  for await (const chunk of parseSseStream(bytes)) void chunk;
}

it.each([
  ['{"error":{"status":"503","message":"busy"}}', ModelUnavailableError],
  ['{"error":{"status":"401","message":"invalid key"}}', AuthenticationError],
  ['{"error":{"status":"429","message":"throttled"}}', RateLimitError],
])('classifies injected stream failures %s', async (line, kind) => {
  await expect(read(line)).rejects.toBeInstanceOf(kind);
});

it('rejects malformed SSE without echoing its potentially sensitive payload', async () => {
  await expect(read('private-key-value')).rejects.toBeInstanceOf(MalformedResponseError);
  await expect(read('private-key-value')).rejects.not.toThrow('private-key-value');
});

it('does not treat free input as a free model when output is paid or unknown', () => {
  const base = { id: 'model', object: 'model', owned_by: 'test' } as const;
  expect(isFreeModelEntry({ ...base, pricing: { prompt: '0', completion: '1' } })).toBe(false);
  expect(isFreeModelEntry({ ...base, pricing: { prompt: '0' } })).toBe(false);
  expect(isFreeModelEntry({ ...base, pricing: { prompt: '0.0', completion: '0' } })).toBe(true);
});
