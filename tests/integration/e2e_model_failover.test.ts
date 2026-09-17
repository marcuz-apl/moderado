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

  it('cascades to next ranked model when primary candidate fails with 503', async () => {
    provider.models = [
      { id: 'meta/llama-3.3-70b-instruct', object: 'model', owned_by: 'nvidia' },
      { id: 'meta/llama-3.1-70b-instruct', object: 'model', owned_by: 'nvidia' },
    ];

    // First call to primary model fails with ModelUnavailableError
    provider.queueError(new ModelUnavailableError('Service 503 Overloaded'));
    // Failover call to secondary candidate succeeds
    provider.queueTextResponse('Secondary candidate took over and finished the task.');

    const result = await loop.run('Complete task with fallback', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      router: new Router(),
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(result.finalMessage).toContain('Secondary candidate took over');

    // Verify model_change events
    const modelChangeEvents = events.filter((e) => e.type === 'model_change');
    expect(modelChangeEvents.length).toBe(2);
    expect((modelChangeEvents[0] as any).newModelId).toBe('meta/llama-3.3-70b-instruct');
    expect((modelChangeEvents[1] as any).newModelId).toBe('meta/llama-3.1-70b-instruct');
    expect((modelChangeEvents[1] as any).reason).toBe('fallback_unavailable');
  });
});
