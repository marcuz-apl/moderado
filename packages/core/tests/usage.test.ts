import { describe, expect, it, vi } from 'vitest';
import { AgentEvent, AgentEventSchema, IProviderAdapter, RateLimitError } from '@moderado/contracts';
import { FakeProviderAdapter } from '@moderado/providers';
import { createDefaultToolRegistry } from '@moderado/tools';
import { AgentLoop } from '../src/agent.js';
import { Router } from '../src/router.js';

describe('task token usage', () => {
  const run = async (provider: IProviderAdapter, router?: Router) => {
    const events: AgentEvent[] = [];
    const result = await new AgentLoop().run('Answer', {
      workspaceRoot: process.cwd(), provider, router, tools: createDefaultToolRegistry(),
      approvalHandler: { async requestApproval(request) { return { requestId: request.requestId, status: 'approved' }; } },
      eventListener: event => events.push(event),
    });
    return { result, usage: events.filter(event => event.type === 'usage') };
  };

  it('emits estimates from text length and reasoning, then replaces cumulative provider snapshots', async () => {
    const provider = new FakeProviderAdapter();
    provider.queueResponse([
      { reasoningDelta: '1234' }, { contentDelta: '12345678' },
      { usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } },
      { usage: { promptTokens: 10, completionTokens: 6, totalTokens: 16 } },
    ]);
    const { result, usage } = await run(provider);
    expect(usage[1]?.usage.completionTokens).toBe(3);
    expect(usage[1]?.estimated).toBe(true);
    expect(usage.at(-1)).toMatchObject({ final: true, estimated: false, usage: { totalTokens: 16 } });
    expect(result.usage?.totalTokens).toBe(16);
    for (const event of usage) expect(AgentEventSchema.safeParse(event).success).toBe(true);
  });

  it('sums tool-followup requests without counting repeated snapshots twice', async () => {
    const provider = new FakeProviderAdapter();
    provider.queueResponse([
      { toolCallChunks: [{ index: 0, id: 'one', name: 'unknown', argumentsDelta: '{}' }] },
      { usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 } },
    ]);
    provider.queueResponse([{ contentDelta: 'Done.' }, { usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } }]);
    const { result, usage } = await run(provider);
    expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 8, totalTokens: 38 });
    expect(usage.at(-1)?.usage).toEqual(result.usage);
  });

  it('keeps estimates out of reported result usage when any request has no usage', async () => {
    const provider = new FakeProviderAdapter();
    provider.queueToolCallResponse('unknown', {});
    provider.queueResponse([{ contentDelta: 'Done.' }, { usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } }]);
    const { result, usage } = await run(provider);
    expect(result.usage).toBeUndefined();
    expect(usage.at(-1)?.estimated).toBe(true);
    expect(usage.at(-1)?.usage.totalTokens).toBeGreaterThan(25);
  });

  it('measures from first generated delta and retains partial usage on inference failure', async () => {
    const provider = new FakeProviderAdapter();
    const clock = vi.spyOn(Date, 'now');
    let now = 0;
    clock.mockImplementation(() => now);
    provider.streamChat = async function* () {
      now = 10000;
      yield { contentDelta: '1234' };
      now = 11000;
      yield { reasoningDelta: '5678' };
      now = 12000;
      throw new Error('stream failed');
    };
    try {
      const { result, usage } = await run(provider);
      expect(result.status).toBe('failed');
      expect(usage.at(-1)).toMatchObject({ final: true, estimated: true, generationMs: 1000, outputTokensPerSecond: 2 });
      expect(result.usage).toBeUndefined();
    } finally { clock.mockRestore(); }
  });

  it('excludes a slow usage-only trailer from generation duration and final rate', async () => {
    const provider = new FakeProviderAdapter();
    const clock = vi.spyOn(Date, 'now');
    let now = 0;
    clock.mockImplementation(() => now);
    provider.streamChat = async function* () {
      now = 10000;
      yield { contentDelta: '1234' };
      now = 11000;
      yield { contentDelta: '5678' };
      now = 16000;
      yield { usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } };
      now = 18000;
    };
    try {
      const { usage } = await run(provider);
      expect(usage.at(-1)).toMatchObject({ generationMs: 1000, outputTokensPerSecond: 2 });
    } finally { clock.mockRestore(); }
  });

  it('retains a partial failed attempt in cumulative estimates after model failover', async () => {
    const provider = new FakeProviderAdapter();
    provider.models = ['model-a', 'model-b'].map(id => ({ id, object: 'model', owned_by: 'test' }));
    let requests = 0;
    provider.streamChat = async function* () {
      if (requests++ === 0) {
        yield { contentDelta: '12345678' };
        throw new RateLimitError('limited');
      }
      yield { contentDelta: 'Done.' };
      yield { usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } };
    };
    const { result, usage } = await run(provider, new Router({
      'model-a': { accessTier: 'free_trial', toolSupport: 'supported' },
      'model-b': { accessTier: 'free_trial', toolSupport: 'supported' },
    }));
    expect(result.status).toBe('completed');
    expect(result.usage).toBeUndefined();
    expect(usage.at(-1)?.usage.completionTokens).toBe(7);
    expect(usage.filter(event => event.final)).toHaveLength(2);
  });

  it('publishes the final partial snapshot when cancelled during streaming', async () => {
    const provider = new FakeProviderAdapter();
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    provider.streamChat = async function* () {
      yield { contentDelta: '12345678' };
      controller.abort();
      yield { contentDelta: 'ignored' };
    };
    const result = await new AgentLoop().run('Answer', {
      workspaceRoot: process.cwd(), provider, tools: createDefaultToolRegistry(),
      approvalHandler: { async requestApproval(request) { return { requestId: request.requestId, status: 'approved' }; } },
      signal: controller.signal, eventListener: event => events.push(event),
    });
    expect(result.status).toBe('cancelled');
    expect(events.filter(event => event.type === 'usage').at(-1)).toMatchObject({ final: true, estimated: true, usage: { completionTokens: 2 } });
  });

  it('accepts reported zero usage for an empty response without inventing generation speed', async () => {
    const provider = new FakeProviderAdapter();
    provider.queueResponse([{ usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }]);
    const { usage } = await run(provider);
    expect(usage[0]).toMatchObject({ estimated: false, generationMs: 0, outputTokensPerSecond: 0 });
  });

  it('includes delegated child requests in parent task snapshots and reported totals', async () => {
    const provider = new FakeProviderAdapter();
    provider.queueResponse([
      { toolCallChunks: [{ index: 0, name: 'subagent', argumentsDelta: '{"detail":"Answer"}' }] },
      { usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 } },
    ]);
    provider.queueResponse([
      { toolCallChunks: [{ index: 0, name: 'unknown', argumentsDelta: '{}' }] },
      { usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 } },
    ]);
    provider.queueResponse([{ contentDelta: 'Child.' }, { usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } }]);
    const { result, usage } = await run(provider);
    expect(result.usage).toEqual({ promptTokens: 37, completionTokens: 10, totalTokens: 47 });
    expect(usage.at(-1)?.usage).toEqual(result.usage);
  });
});
