import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentLoop, Router } from '@moderado/core';
import { FakeProviderAdapter } from '@moderado/providers';
import { createDefaultToolRegistry } from '@moderado/tools';
import { AgentEvent, IApprovalHandler, ModelUnavailableError } from '@moderado/contracts';

describe('E2E Integration: Dynamic Model Failover Cascade', () => {
  let tempDir: string;
  let provider: FakeProviderAdapter;
  let tools: ReturnType<typeof createDefaultToolRegistry>;
  let loop: AgentLoop;
  let events: AgentEvent[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-e2e-failover-'));
    provider = new FakeProviderAdapter();
    tools = createDefaultToolRegistry();
    loop = new AgentLoop();
    events = [];
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const autoApproveHandler: IApprovalHandler = {
    async requestApproval(req) {
      return { requestId: req.requestId, status: 'approved' };
    },
  };

  it('cascades to next ranked model when primary candidate stays unavailable', async () => {
    provider.models = [
      { id: 'meta/llama-3.3-70b-instruct', object: 'model', owned_by: 'nvidia' },
      { id: 'meta/llama-3.1-70b-instruct', object: 'model', owned_by: 'nvidia' },
    ];

    // A single 503 is now retried on the same model first, so failover only
    // happens once the retry budget is spent. Exhaust it (1 attempt + 2 retries).
    for (let i = 0; i < 3; i++) {
      provider.queueError(new ModelUnavailableError('Service 503 Overloaded'));
    }
    // Failover call to secondary candidate succeeds
    provider.queueTextResponse('Secondary candidate took over and finished the task.');

    const result = await loop.run('Complete task with fallback', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      router: new Router(),
      retryDelaysMs: [0, 0],
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(result.finalMessage).toContain('Secondary candidate took over');
    expect(result.selectedModel.id).toBe('meta/llama-3.1-70b-instruct');

    // Verify model_change events
    const modelChangeEvents = events.filter((e) => e.type === 'model_change');
    expect(modelChangeEvents.length).toBe(2);
    expect((modelChangeEvents[0] as any).newModelId).toBe('meta/llama-3.3-70b-instruct');
    expect((modelChangeEvents[1] as any).newModelId).toBe('meta/llama-3.1-70b-instruct');
    expect((modelChangeEvents[1] as any).reason).toBe('fallback_unavailable');
  });

  it('recovers on the same model when a single transient failure is retried', async () => {
    provider.models = [
      { id: 'meta/llama-3.3-70b-instruct', object: 'model', owned_by: 'nvidia' },
      { id: 'meta/llama-3.1-70b-instruct', object: 'model', owned_by: 'nvidia' },
    ];

    // One blip, then success: the retry absorbs it and no failover occurs.
    provider.queueError(new ModelUnavailableError('Service 503 Overloaded'));
    provider.queueTextResponse('Retried the same model and finished the task.');

    const result = await loop.run('Complete task with fallback', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      router: new Router(),
      retryDelaysMs: [0, 0],
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(result.finalMessage).toContain('Retried the same model');
    expect(result.selectedModel.id).toBe('meta/llama-3.3-70b-instruct');
    // Only the initial model selection, so no cascade happened.
    expect(events.filter((e) => e.type === 'model_change')).toHaveLength(1);
  });
});
