import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { FakeProviderAdapter } from '@moderado/providers';
import { createDefaultToolRegistry } from '@moderado/tools';
import { AgentEvent, IApprovalHandler } from '@moderado/contracts';

describe('E2E Integration: Security Jail Enforcement', () => {
  let tempDir: string;
  let provider: FakeProviderAdapter;
  let tools: ReturnType<typeof createDefaultToolRegistry>;
  let loop: AgentLoop;
  let events: AgentEvent[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-e2e-security-'));
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

  it('rejects path traversal attempts across tool calls', async () => {
    // Turn 1: Model tries to escape jail via read_file
    provider.queueToolCallResponse('read_file', { path: '../../etc/shadow' });
    // Turn 2: Assistant acknowledges failure
    provider.queueTextResponse('I could not read outside the workspace jail.');

    const result = await loop.run('Inspect root files', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === 'tool_result') {
      expect(toolResultEvent.result.status).toBe('error');
      expect(toolResultEvent.result.output).toContain('escapes workspace jail');
    }
  });

  it('rejects tampering with protected .git and .env metadata', async () => {
    // Turn 1: Model tries to write .env
    provider.queueToolCallResponse('write_file', { path: '.env', content: 'SECRET=123' });
    // Turn 2: Assistant acknowledges failure
    provider.queueTextResponse('I could not modify .env.');

    const result = await loop.run('Update env secrets', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(fs.existsSync(path.join(tempDir, '.env'))).toBe(false);

    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    if (toolResultEvent && toolResultEvent.type === 'tool_result') {
      expect(toolResultEvent.result.status).toBe('error');
      expect(toolResultEvent.result.output).toContain('protected or sensitive metadata');
    }
  });
});
