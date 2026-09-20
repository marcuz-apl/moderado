import { describe, it, expect } from 'vitest';
import { fetchOpenRouterFreeModels, isFreeModelEntry, partitionFreeModels } from '../src/model_discovery.js';
import type { ModelInventoryEntry } from '@moderado/contracts';

const entry = (id: string, promptPrice = '0'): ModelInventoryEntry => ({
  id,
  object: 'model',
  owned_by: 'openrouter',
  pricing: { prompt: promptPrice, completion: promptPrice },
});

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('model discovery', () => {
  it('classifies free models by zero prompt pricing', () => {
    expect(isFreeModelEntry(entry('a/b:free', '0'))).toBe(true);
    expect(isFreeModelEntry(entry('a/b', '0.000001'))).toBe(false);
    expect(isFreeModelEntry({ id: 'x', object: 'model', owned_by: 'v' })).toBe(false);
  });

  it('partitions a listing into free-first and paid buckets', () => {
    const { free, paid } = partitionFreeModels([entry('free1'), entry('paid1', '0.01'), entry('free2')]);
    expect(free.map((m) => m.id)).toEqual(['free1', 'free2']);
    expect(paid.map((m) => m.id)).toEqual(['paid1']);
  });

  it('fetches and filters the OpenRouter free catalog offline', async () => {
    const payloads = [
      { data: [{ id: 'deepseek/deepseek-r1:free', object: 'model', owned_by: 'deepseek', pricing: { prompt: '0', completion: '0' } }] },
      { data: [{ id: 'openai/gpt-5', object: 'model', owned_by: 'openai', pricing: { prompt: '0.000002', completion: '0.000008' } }] },
    ];
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse(payloads[calls.length - 1]);
    };
    const models = await fetchOpenRouterFreeModels({ fetchImpl });
    expect(calls).toEqual(['https://openrouter.ai/api/v1/models']);
    expect(models.map((m) => m.id)).toEqual(['deepseek/deepseek-r1:free']);
  });

  it('throws a ProviderError on HTTP failure', async () => {
    const fetchImpl: typeof fetch = async () => new Response('no', { status: 503 });
    await expect(fetchOpenRouterFreeModels({ fetchImpl })).rejects.toThrow(/status 503/);
  });

  it('throws a ProviderError on malformed payloads', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ unexpected: true });
    await expect(fetchOpenRouterFreeModels({ fetchImpl })).rejects.toThrow(/Expected array/);
  });
});
