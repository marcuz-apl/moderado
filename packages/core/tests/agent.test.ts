import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentLoop } from '../src/agent.js';
import { PolicyManager } from '../src/policy.js';
import { Router } from '../src/router.js';
import { FakeProviderAdapter } from '@moderado/providers';
import { createDefaultToolRegistry } from '@moderado/tools';
import { AgentEvent, HostEventEnvelope, IApprovalHandler } from '@moderado/contracts';

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

  it('advertises the core-owned subagent declaration to tool-capable models', async () => {
    provider.queueTextResponse('Done.');

    await loop.run('Delegate a focused investigation when useful.', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
    });

    expect(provider.recordedCalls[0]?.tools).toContainEqual({
      name: 'subagent',
      description: 'Delegate one focused sub-task to a bounded child agent that follows the same workspace and approval policies.',
      parameters: {
        type: 'object',
        properties: {
          detail: { type: 'string' },
        },
        required: ['detail'],
      },
    });
  });

  it('rejects an invalid subagent detail without starting a child loop', async () => {
    provider.queueToolCallResponse('subagent', { detail: '   ' });
    const result = await loop.run('Delegate a task.', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      eventListener: (event) => events.push(event),
    });

    expect(provider.recordedCalls).toHaveLength(1);
    expect(result.finalMessage).toBe('');
    expect(events.some((event) => event.type === 'tool_result' && event.result.output.startsWith('Invalid subagent detail:'))).toBe(true);
  });

  it('forwards child events to the parent host event listener', async () => {
    provider.queueToolCallResponse('subagent', { detail: 'Answer the focused question.' });
    provider.queueTextResponse('Child answer.');
    provider.queueTextResponse('Parent answer.');
    const hostEvents: HostEventEnvelope[] = [];

    await loop.run('Delegate a task.', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      hostEventListener: (event) => hostEvents.push(event),
    });

    expect(hostEvents.some((event) => event.event.type === 'assistant_delta' && event.event.delta === 'Child answer.')).toBe(true);
  });

  it('returns provider-reported usage from a completed run', async () => {
    provider.queueResponse([
      { contentDelta: 'Done.' },
      { usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 } },
      { finishReason: 'stop' },
    ]);

    const result = await loop.run('Answer', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
    });

    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
  });

  it('fails visibly instead of completing when a model returns no content or tool calls', async () => {
    provider.queueResponse([{ finishReason: 'stop' }]);

    const result = await loop.run('Who are you?', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('failed');
    expect(result.finalMessage).toBeNull();
    expect(events.some((event) => event.type === 'completion' && event.status === 'completed')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'ERR_EMPTY_RESPONSE',
      recoverable: false,
    }));
  });

  it('retries an empty AUTO response with the next eligible model', async () => {
    provider.models = [
      { id: 'model-a', object: 'model', owned_by: 'test' },
      { id: 'model-b', object: 'model', owned_by: 'test' },
    ];
    provider.queueResponse([{ finishReason: 'stop' }]);
    provider.queueTextResponse('A fallback model answered this request.');
    const router = new Router({
      'model-a': { accessTier: 'free_trial', toolSupport: 'supported' },
      'model-b': { accessTier: 'free_trial', toolSupport: 'supported' },
    });

    const result = await loop.run('Who are you?', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      router,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    expect(result.selectedModel.id).toBe('model-b');
    expect(result.finalMessage).toContain('fallback model');
    expect(provider.recordedCalls.map((call) => call.modelId)).toEqual(['model-a', 'model-b']);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'model_change',
      previousModelId: 'model-a',
      newModelId: 'model-b',
      reason: 'fallback_unavailable',
    }));
  });

  it('does not send tools to a model classified as tool-unsupported', async () => {
    provider.queueTextResponse('I can answer without tools.');

    const result = await loop.run('Who are you?', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      routeOptions: { pinnedModelId: 'mock/text-only-model' },
    });

    expect(result.status).toBe('completed');
    expect(provider.recordedCalls).toHaveLength(1);
    expect(provider.recordedCalls[0].tools).toBeUndefined();
  });

  it('honours provider-advertised lack of tool support for an otherwise unknown model', async () => {
    provider.models = [{
      id: 'z-ai/glm-5.2-free',
      object: 'model',
      owned_by: 'openrouter',
      supported_parameters: ['temperature', 'max_tokens'],
    }];
    provider.queueTextResponse('I can answer this as plain chat.');

    const result = await loop.run('Who are you?', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      routeOptions: { pinnedModelId: 'z-ai/glm-5.2-free' },
    });

    expect(result.status).toBe('completed');
    expect(provider.recordedCalls[0].tools).toBeUndefined();
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

  it('intercepts unsolicited write_file("README.md") during a conversational task without triggering approval', async () => {
    let approvalCalled = false;
    const trackingHandler: IApprovalHandler = {
      async requestApproval(req) {
        approvalCalled = true;
        return { requestId: req.requestId, status: 'approved' };
      },
    };

    // Turn 1: Model errantly tries to write README.md for a conversational query
    provider.queueToolCallResponse('write_file', { path: 'README.md', content: '# My Project' });
    // Turn 2: After loop rejects it, model answers with conversational text
    provider.queueTextResponse('Hello! I am Moderado, your coding assistant. How can I help?');

    const result = await loop.run('Hello, what can you do?', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: trackingHandler,
      eventListener: (e) => events.push(e),
    });

    expect(approvalCalled).toBe(false);
    expect(fs.existsSync(path.join(tempDir, 'README.md'))).toBe(false);
    expect(result.status).toBe('completed');
    expect(result.finalMessage).toContain('Hello! I am Moderado');

    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === 'tool_result') {
      expect(toolResultEvent.result.status).toBe('error');
      expect(toolResultEvent.result.output).toContain('Do not create or edit README');
    }
  });

  it('allows write_file("README.md") when user explicitly asks for README in prompt', async () => {
    let approvalCalled = false;
    const trackingHandler: IApprovalHandler = {
      async requestApproval(req) {
        approvalCalled = true;
        return { requestId: req.requestId, status: 'approved' };
      },
    };

    provider.queueToolCallResponse('write_file', { path: 'README.md', content: '# Documentation' });
    provider.queueTextResponse('Created the requested README.md.');

    const result = await loop.run('Please create a README.md for this repo', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: trackingHandler,
      eventListener: (e) => events.push(e),
    });

    expect(approvalCalled).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'README.md'))).toBe(true);
    expect(result.status).toBe('completed');
  });

  it('retains multi-turn context when conversationHistory is supplied', async () => {
    // Turn 1: User says my name is Alice
    provider.queueTextResponse('Hello Alice!');
    const turn1 = await loop.run('My name is Alice', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
    });
    expect(turn1.status).toBe('completed');
    expect(turn1.messages).toBeDefined();

    // Turn 2: User asks what is my name?
    provider.queueTextResponse('Your name is Alice.');
    const turn2 = await loop.run('What is my name?', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      conversationHistory: turn1.messages,
    });
    expect(turn2.status).toBe('completed');
    expect(turn2.finalMessage).toContain('Alice');
    // Ensure history contains turns from both messages
    expect(turn2.messages.length).toBeGreaterThan(turn1.messages.length);
  });

  it('emits reasoning_delta events when provider streams reasoning chunks', async () => {
    provider.queueResponse([
      { reasoningDelta: 'Thinking deeply...' },
      { contentDelta: 'Here is the direct answer.' },
      { finishReason: 'stop' },
    ]);

    const result = await loop.run('Think and answer', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      eventListener: (e) => events.push(e),
    });

    expect(result.status).toBe('completed');
    const reasoningEvents = events.filter((e) => e.type === 'reasoning_delta');
    expect(reasoningEvents.length).toBe(1);
    expect((reasoningEvents[0] as any).delta).toBe('Thinking deeply...');

    const assistantEvents = events.filter((e) => e.type === 'assistant_delta');
    expect(assistantEvents.length).toBe(1);
    expect((assistantEvents[0] as any).delta).toBe('Here is the direct answer.');
  });

  it('calls mutation lifecycle hooks only for an approved write', async () => {
    provider.queueToolCallResponse('write_file', { path: 'tracked.txt', content: 'new' });
    provider.queueTextResponse('Done.');
    const lifecycle: string[] = [];

    await loop.run('Write tracked.txt', {
      workspaceRoot: tempDir, provider, tools, approvalHandler: autoApproveHandler,
      onMutationApproved: (toolName) => { lifecycle.push(`approved:${toolName}`); },
      onMutationCompleted: (toolName, _parameters, result) => { lifecycle.push(`completed:${toolName}:${result.status}`); },
    });

    expect(lifecycle).toEqual(['approved:write_file', 'completed:write_file:success']);
  });

  it('does not call mutation lifecycle hooks when a write is denied', async () => {
    provider.queueToolCallResponse('write_file', { path: 'denied.txt', content: 'new' });
    provider.queueTextResponse('Denied.');
    const lifecycle: string[] = [];
    const deny: IApprovalHandler = { async requestApproval(request) { return { requestId: request.requestId, status: 'denied' }; } };

    await loop.run('Write denied.txt', {
      workspaceRoot: tempDir, provider, tools, approvalHandler: deny,
      onMutationApproved: () => { lifecycle.push('approved'); },
      onMutationCompleted: () => { lifecycle.push('completed'); },
    });

    expect(lifecycle).toEqual([]);
  });

  it('enforces Layer 1 conciseness directives in the default system prompt', async () => {
    provider.queueTextResponse('Compact response.');

    await loop.run('What is 2+2?', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
    });

    expect(provider.recordedCalls.length).toBe(1);
    const systemMessage = provider.recordedCalls[0].messages.find((m) => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage?.content).toContain('CONCISENESS & TOKEN EFFICIENCY (DEFAULT MODE)');
    expect(systemMessage?.content).toContain('Zero conversational filler');
    expect(systemMessage?.content).toContain('Answer in the fewest tokens possible');
  });

  it('bounds output tokens via maxTokens (Layer 3) with default or custom cap', async () => {
    provider.queueTextResponse('Response with default limit.');

    await loop.run('Quick test', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
    });

    expect(provider.recordedCalls[0].maxTokens).toBe(1024);

    provider.queueTextResponse('Response with custom limit.');
    await loop.run('Custom limit test', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      maxOutputTokens: 256,
    });

    expect(provider.recordedCalls[1].maxTokens).toBe(256);
  });

  it('truncates older tool output payloads in conversation history (Layer 4) to protect token budget', async () => {
    const hugeToolOutput = 'A'.repeat(5000);
    provider.queueTextResponse('Next answer.');

    await loop.run('Follow up question', {
      workspaceRoot: tempDir,
      provider,
      tools,
      approvalHandler: autoApproveHandler,
      conversationHistory: [
        { role: 'user', content: 'First request' },
        { role: 'assistant', content: 'Let me run a tool' },
        { role: 'tool', content: hugeToolOutput },
        { role: 'assistant', content: 'First answer' },
      ],
    });

    const callMessages = provider.recordedCalls[0].messages;
    expect(callMessages[0].role).toBe('system');
    const toolMsg = callMessages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect((toolMsg?.content as string).length).toBeLessThan(1600);
    expect(toolMsg?.content).toContain('earlier tool output truncated for token efficiency');
  });
});
