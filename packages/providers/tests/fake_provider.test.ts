import { describe, it, expect } from 'vitest';
import { FakeProviderAdapter } from '../src/fake/fake_provider.js';

describe('FakeProviderAdapter', () => {
  it('returns default mock models on discovery', async () => {
    const provider = new FakeProviderAdapter();
    const models = await provider.discoverModels();
    expect(models.length).toBe(3);
    expect(models.some((m) => m.id === 'mock/free-tool-model')).toBe(true);
  });

  it('streams queued text response', async () => {
    const provider = new FakeProviderAdapter();
    provider.queueTextResponse('Hello world');

    const chunks = [];
    for await (const chunk of provider.streamChat({
      modelId: 'mock/free-tool-model',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0].contentDelta).toBe('Hello world');
    expect(chunks[1].finishReason).toBe('stop');
    expect(provider.recordedCalls.length).toBe(1);
  });

  it('streams queued tool call response', async () => {
    const provider = new FakeProviderAdapter();
    provider.queueToolCallResponse(
      'read_file',
      { path: 'package.json' },
      'Let me inspect package.json'
    );

    const chunks = [];
    for await (const chunk of provider.streamChat({
      modelId: 'mock/free-tool-model',
      messages: [{ role: 'user', content: 'Read package.json' }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0].contentDelta).toBe('Let me inspect package.json');
    expect(chunks[1].toolCallChunks?.[0].name).toBe('read_file');
    expect(chunks[1].toolCallChunks?.[0].argumentsDelta).toContain('package.json');
  });

  it('throws queued error', async () => {
    const provider = new FakeProviderAdapter();
    provider.queueError(new Error('Simulated network drop'));

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.streamChat({
        modelId: 'mock/free-tool-model',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        // noop
      }
    }).rejects.toThrow('Simulated network drop');
  });
});
