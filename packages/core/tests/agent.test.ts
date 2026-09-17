import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentLoop } from '../src/agent.js';
import { PolicyManager } from '../src/policy.js';
import { Router } from '../src/router.js';
import { FakeProviderAdapter } from '@moderado/providers';
import { createDefaultToolRegistry } from '@moderado/tools';
import { AgentEvent, IApprovalHandler } from '@moderado/contracts';

describe('AgentLoop (Core Execution Engine)', () => {
  let tempDir: string;
  let provider: FakeProviderAdapter;
  let tools: ReturnType<typeof createDefaultToolRegistry>;
  let loop: AgentLoop;
  let events: AgentEvent[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-agent-test-'));
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
    async requestApproval(request) {
      return { requestId: request.requestId, status: 'approved' };
    },
  };

  it('completes single-turn task when no tools are requested', async () => {
    provider.queueTextResponse('I have analyzed your request. Everything looks good!');

    const result = await loop.run('Analyze the repo', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(result.totalSteps).toBe(1);
    expect(result.finalMessage).toContain('Everything looks good!');

    const completionEvent = events.find((e) => e.type === 'completion');
    expect(completionEvent).toBeDefined();
  });

  it('executes tool call and follows up with assistant summary', async () => {
    fs.writeFileSync(path.join(tempDir, 'data.txt'), 'Secret 42');

    // Turn 1: Assistant calls read_file
    provider.queueToolCallResponse('read_file', { path: 'data.txt' }, 'Reading the file now.');
    // Turn 2: Assistant receives tool result and responds
    provider.queueTextResponse('The file contains Secret 42.');

    const result = await loop.run('Read data.txt', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(result.totalSteps).toBe(2);
    expect(result.finalMessage).toContain('Secret 42');

    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === 'tool_result') {
      expect(toolResultEvent.result.status).toBe('success');
      expect(toolResultEvent.result.output).toContain('Secret 42');
    }
  });

  it('requests interactive approval for write_file and succeeds on approval', async () => {
    provider.queueToolCallResponse('write_file', { path: 'output.txt', content: 'new output' });
    provider.queueTextResponse('Output written successfully.');

    let approvalRequested = false;
    const trackingHandler: IApprovalHandler = {
      async requestApproval(req) {
        approvalRequested = true;
        expect(req.toolName).toBe('write_file');
        return { requestId: req.requestId, status: 'approved' };
      },
    };

    const result = await loop.run('Write output.txt', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: trackingHandler,
      eventListener: (e) => events.push(e),
    });

    expect(approvalRequested).toBe(true);
    expect(result.status).toBe('completed');
    expect(fs.readFileSync(path.join(tempDir, 'output.txt'), 'utf8')).toBe('new output');
  });

  it('handles interactive approval denial gracefully', async () => {
    provider.queueToolCallResponse('write_file', { path: 'blocked.txt', content: 'content' });
    provider.queueTextResponse('I understand you denied the write operation.');

    const denyingHandler: IApprovalHandler = {
      async requestApproval(req) {
        return { requestId: req.requestId, status: 'denied', reason: 'User cancelled write' };
      },
    };

    const result = await loop.run('Write blocked.txt', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: denyingHandler,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(fs.existsSync(path.join(tempDir, 'blocked.txt'))).toBe(false);

    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === 'tool_result') {
      expect(toolResultEvent.result.status).toBe('denied');
      expect(toolResultEvent.result.output).toContain('denied by the user');
    }
  });

  it('denies write operation in read-only mode by policy', async () => {
    provider.queueToolCallResponse('write_file', { path: 'file.txt', content: 'c' });
    provider.queueTextResponse('Write was blocked.');

    const policy = new PolicyManager({ readOnly: true });

    const result = await loop.run('Write file', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      policy,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(fs.existsSync(path.join(tempDir, 'file.txt'))).toBe(false);

    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    if (toolResultEvent && toolResultEvent.type === 'tool_result') {
      expect(toolResultEvent.result.status).toBe('denied');
      expect(toolResultEvent.result.output).toContain('read-only mode');
    }
  });

  it('stops when step limit is reached', async () => {
    const policy = new PolicyManager({ maxSteps: 1 });

    // Turn 1 tries to call read_file, but maxSteps is 1
    provider.queueToolCallResponse('read_file', { path: 'x.txt' });

    const result = await loop.run('Loop forever', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      policy,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('step_limit_reached');
    expect(result.totalSteps).toBe(1);

    const completionEvent = events.find((e) => e.type === 'completion');
    expect(completionEvent).toBeDefined();
    if (completionEvent && completionEvent.type === 'completion') {
      expect(completionEvent.status).toBe('step_limit_reached');
    }
  });

  it('cancels execution on AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await loop.run('Cancelled task', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      signal: controller.signal,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('cancelled');
    const cancellationEvent = events.find((e) => e.type === 'cancellation');
    expect(cancellationEvent).toBeDefined();
  });

  it('gracefully handles and completes when model uses pseudo conversational tool (answer_directly)', async () => {
    provider.queueToolCallResponse('answer_directly', { text: 'I am Moderado AI coding agent.' });

    const result = await loop.run('who are you?', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(result.finalMessage).toContain('I am Moderado AI coding agent.');
  });
});
