import { describe, it, expect, vi } from 'vitest';
import { handleModelsCommand } from '../src/commands/models.js';
import { parseCliArgs } from '../src/args.js';

describe('Free Models Catalog (models command)', () => {
  it('discovers and outputs only free models across providers', async () => {
    const mockNvidiaAdapter = {
      discoverModels: async () => [
        { id: 'meta/llama-3.3-70b-instruct', created: 1700000000, owned_by: 'meta' },
        { id: 'mistralai/mistral-large-2-instruct', created: 1700000000, owned_by: 'mistralai' },
        { id: 'deepseek-ai/deepseek-r1', created: 1700000000, owned_by: 'deepseek' },
      ],
    } as any;

    const mockFetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('openrouter.ai')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'deepseek/deepseek-r1:free', pricing: { prompt: '0', completion: '0' } },
            { id: 'openai/gpt-4o', pricing: { prompt: '0.000005', completion: '0.000015' } },
          ],
        }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    let stdoutData = '';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutData += String(chunk);
      return true;
    });

    const args = parseCliArgs(['models', '--json', '--non-interactive']);
    const code = await handleModelsCommand(args, {
      nvidiaAdapter: mockNvidiaAdapter,
      fetchImpl: mockFetchImpl as unknown as typeof fetch,
    });

    writeSpy.mockRestore();

    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutData);

    expect(parsed['NVIDIA NIM']).toHaveLength(1);
    expect(parsed['NVIDIA NIM'][0].id).toBe('meta/llama-3.3-70b-instruct');
    expect(parsed['NVIDIA NIM'][0].accessTier).toBe('free_trial');

    expect(parsed['OpenRouter']).toHaveLength(1);
    expect(parsed['OpenRouter'][0].id).toBe('deepseek/deepseek-r1:free');
    expect(parsed['OpenRouter'][0].accessTier).toBe('free');

    expect(parsed['OpenCode Zen']).toBeUndefined();

    expect(parsed['Agnes AI']).toHaveLength(2);
    expect(parsed['Agnes AI'].map((m: any) => m.id)).toContain('agnes/code');
  });

  it('filters by --provider openrouter', async () => {
    const mockFetchImpl = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({
        data: [{ id: 'qwen/qwen-2.5-coder-32b-instruct:free', pricing: { prompt: '0', completion: '0' } }],
      }), { status: 200 });
    });

    let stdoutData = '';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutData += String(chunk);
      return true;
    });

    const args = parseCliArgs(['models', '--provider', 'openrouter', '--json', '--non-interactive']);
    const code = await handleModelsCommand(args, {
      fetchImpl: mockFetchImpl as unknown as typeof fetch,
    });

    writeSpy.mockRestore();

    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutData);

    expect(parsed['OpenRouter']).toHaveLength(1);
    expect(parsed['OpenRouter'][0].id).toBe('qwen/qwen-2.5-coder-32b-instruct:free');
    expect(parsed['NVIDIA NIM']).toBeUndefined();
    expect(parsed['OpenCode Zen']).toBeUndefined();
  });
});
