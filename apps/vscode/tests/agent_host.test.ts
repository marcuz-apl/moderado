import { describe, expect, it } from 'vitest';
import type {
  ApprovalRequest, ChatCompletionChunk, HostEventEnvelope, IProviderAdapter, IToolRegistry,
  ModelInventoryEntry, ToolResult,
} from '@moderado/contracts';
import { createDefaultToolRegistry } from '@moderado/tools';
import { createAgentHost, type AgentHost, type HostServices } from '../src/agent_host.js';

function intent(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: 1, requestId: `req-${type}`, type, ...extra };
}

class FakeProvider implements IProviderAdapter {
  readonly id = 'fake';
  readonly name = 'Fake';
  constructor(private readonly catalog: ModelInventoryEntry[]) {}
  async discoverModels(): Promise<ModelInventoryEntry[]> { return this.catalog; }
  async *streamChat(options: { signal?: AbortSignal }): AsyncIterable<ChatCompletionChunk> {
    const script = scriptFor(options.signal);
    for (const chunk of script) {
      if (options.signal?.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 1));
      yield chunk;
    }
  }
}

/** Set per test; the fake provider has no conversation of its own. */
let scriptFor: (signal?: AbortSignal) => ChatCompletionChunk[] = () => [{ contentDelta: 'ok', finishReason: 'stop' }];

function toolCall(name: string, args: Record<string, unknown>): ChatCompletionChunk {
  return { toolCallChunks: [{ index: 0, id: 'call-1', name, argumentsDelta: JSON.stringify(args) }], finishReason: 'tool_calls' };
}

/**
 * The agent calls the provider again after every tool result, so a script must
 * stop asking for its tool after the first turn or the loop never converges.
 */
function once(call: ChatCompletionChunk, done: ChatCompletionChunk = { contentDelta: 'done', finishReason: 'stop' }): ChatCompletionChunk[] {
  let asked = false;
  return () => (asked ? [done] : ((asked = true), [call]));
}

/** A model id the fake catalog lists and NVIDIA NIM declares free outright. */
const FREE_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct';

function services(overrides: Partial<HostServices> = {}): HostServices {
  return { workspaceRoot: process.cwd(), createTools: () => createDefaultToolRegistry(), ...overrides };
}

/** A connected, model-pinned host plus the id of its one live session. */
async function readyHost(
  overrides: Partial<HostServices> = {},
  script: ChatCompletionChunk[] | (() => ChatCompletionChunk[]) = [{ contentDelta: 'ok', finishReason: 'stop' }],
  catalog: ModelInventoryEntry[] = [{ id: FREE_MODEL }],
): Promise<{ host: AgentHost; session: string }> {
  scriptFor = typeof script === 'function' ? script : () => script;
  const host = createAgentHost(services({
    createProvider: async () => new FakeProvider(catalog),
    ...overrides,
  }));
  const session = host.newSession();
  await host.selectProvider('nvidia-nim');
  await host.selectModel('nvidia-nim', catalog[0]?.id ?? FREE_MODEL);
  return { host, session };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

describe('agent host', () => {
  it('streams a turn and forwards ordered host event envelopes', async () => {
    const events: string[] = [];
    const { host, session } = await readyHost({ onEvent: (envelope) => events.push(`${envelope.sequence}:${envelope.event.type}`) },
      [{ contentDelta: 'hi' }, { contentDelta: ' there', finishReason: 'stop' }]);
    expect((await host.handle(intent('start_turn', { sessionId: session, prompt: 'Hello', mode: 'Execute' }))))
      .toMatchObject({ ok: true, result: { type: 'turn_started', sessionId: session } });
    await host.waitForIdle();
    expect(events.some((entry) => entry.endsWith(':completion'))).toBe(true);
    expect(events.map((entry) => Number(entry.split(':')[0]))).toEqual(events.map((_, index) => index + 1));
    host.dispose();
  });

  it('fails closed on malformed, stale, and unknown-session intents', async () => {
    const { host } = await readyHost();
    expect((await host.handle({ protocolVersion: 2, requestId: 'a', type: 'list_providers' })).ok).toBe(false);
    expect((await host.handle({ protocolVersion: 1, requestId: '', type: 'list_providers' })).ok).toBe(false);
    expect((await host.handle({ protocolVersion: 1, requestId: 'a', type: 'shell_exec', command: 'rm -rf /' })).ok).toBe(false);
    expect((await host.handle(intent('cancel_turn', { sessionId: 'not-active' }))).ok).toBe(false);
    expect((await host.handle(intent('start_turn', { sessionId: 'ghost', prompt: 'x', mode: 'Plan' }))).ok).toBe(false);
    host.dispose();
  });

  it('refuses a second turn while one is running', async () => {
    const { host, session } = await readyHost({}, Array.from({ length: 30 }, () => ({ contentDelta: 'x' })));
    expect((await host.handle(intent('start_turn', { sessionId: session, prompt: 'Hi', mode: 'Execute' }))).ok).toBe(true);
    expect(await host.handle(intent('start_turn', { sessionId: session, prompt: 'Again', mode: 'Execute' })))
      .toMatchObject({ ok: false, error: { code: 'TURN_ACTIVE' } });
    await host.handle(intent('cancel_turn', { sessionId: session }));
    await host.waitForIdle();
    host.dispose();
  });

  it('cancels on request and aborts on disposal', async () => {
    const { host, session } = await readyHost({}, Array.from({ length: 40 }, () => ({ contentDelta: 'x' })));
    await host.handle(intent('start_turn', { sessionId: session, prompt: 'Hi', mode: 'Execute' }));
    expect((await host.handle(intent('cancel_turn', { sessionId: session }))).ok).toBe(true);
    await host.waitForIdle();
    const other = await readyHost({}, Array.from({ length: 40 }, () => ({ contentDelta: 'x' })));
    await other.host.handle(intent('start_turn', { sessionId: other.session, prompt: 'Hi', mode: 'Execute' }));
    other.host.dispose();
    await other.host.waitForIdle();
  });

  it('pauses on a disabled category and settles it only for its own session', async () => {
    const pending: ApprovalRequest[] = [];
    const executed: string[] = [];
    const tools: IToolRegistry = createDefaultToolRegistry();
    const runCommand = tools.get('run_command')!;
    tools.register({
      ...runCommand,
      execute: async (): Promise<ToolResult> => {
        executed.push('run_command');
        return { toolName: 'run_command', status: 'success', output: 'ok' };
      },
    });
    const { host, session } = await readyHost({
      createTools: () => tools,
      onApproval: (request) => pending.push(request),
    }, once(toolCall('run_command', { command: 'echo', args: ['hi'] })));
    await host.handle(intent('start_turn', { sessionId: session, prompt: 'Run it', mode: 'Execute' }));
    await settle();
    const request = pending[0];
    expect(request?.toolName).toBe('run_command');
    // Another session's decision must not release this request.
    expect(await host.handle(intent('resolve_approval', { sessionId: 'other', approvalRequestId: request!.requestId, status: 'approved' })))
      .toMatchObject({ ok: false, error: { code: 'STALE_DECISION' } });
    expect((await host.handle(intent('resolve_approval', { sessionId: session, approvalRequestId: request!.requestId, status: 'denied' }))).ok).toBe(true);
    await host.waitForIdle();
    expect(executed).toEqual([]);
    host.dispose();
  });

  it('runs an enabled category without asking, but still reports it as activity', async () => {
    const pending: ApprovalRequest[] = [];
    const executed: string[] = [];
    const events: HostEventEnvelope[] = [];
    const tools: IToolRegistry = createDefaultToolRegistry();
    const readFile = tools.get('read_file')!;
    tools.register({
      ...readFile,
      execute: async (): Promise<ToolResult> => {
        executed.push('read_file');
        return { toolName: 'read_file', status: 'success', output: 'ok' };
      },
    });
    const { host, session } = await readyHost(
      { createTools: () => tools, onApproval: (request) => pending.push(request), onEvent: (envelope) => events.push(envelope) },
      once(toolCall('read_file', { path: 'README.md' })),
    );
    await host.handle(intent('start_turn', { sessionId: session, prompt: 'Read it', mode: 'Execute' }));
    await host.waitForIdle();
    expect(pending).toEqual([]);
    expect(executed).toEqual(['read_file']);
    // An auto-approved edit is still visible in the timeline, just never asked.
    const kinds = events.map((envelope) => envelope.event.type);
    expect(kinds).toContain('tool_call_initiated');
    expect(kinds).toContain('tool_result');
    expect(kinds).not.toContain('approval_request');
    host.dispose();
  });

  it('turning on one category leaves the other four untouched', async () => {
    const { host } = await readyHost();
    for (const [category, enabled] of [['mcp', true], ['edit', false], ['read', false]] as const) {
      expect((await host.handle(intent('update_settings', { category, enabled }))).ok).toBe(true);
    }
    expect(host.getApprovalSettings()).toEqual({ read: false, edit: false, web_fetch: true, execute: false, mcp: true });
    host.dispose();
  });

  it('forces edit approval in Plan mode even when the checkbox is on', async () => {
    const pending: ApprovalRequest[] = [];
    const executed: string[] = [];
    const tools: IToolRegistry = createDefaultToolRegistry();
    const writeFile = tools.get('write_file')!;
    tools.register({
      ...writeFile,
      execute: async (): Promise<ToolResult> => {
        executed.push('write_file');
        return { toolName: 'write_file', status: 'success', output: 'ok' };
      },
    });
    const { host, session } = await readyHost({ createTools: () => tools, onApproval: (request) => pending.push(request) },
      once(toolCall('write_file', { path: 'out.txt', content: 'x' })));
    await host.handle(intent('update_settings', { category: 'edit', enabled: true }));
    await host.handle(intent('start_turn', { sessionId: session, prompt: 'Write it', mode: 'Plan' }));
    await settle();
    // Edit is auto-approved in Act mode, but Plan must still ask.
    expect(pending.map((item) => item.toolName)).toEqual(['write_file']);
    await host.handle(intent('cancel_turn', { sessionId: session }));
    await host.waitForIdle();
    expect(executed).toEqual([]);
    host.dispose();
  });

  it('refuses an approval decision with no session in flight', async () => {
    const { host, session } = await readyHost();
    expect(await host.handle(intent('resolve_approval', { sessionId: session, approvalRequestId: 'r1', status: 'approved' })))
      .toMatchObject({ ok: false });
    host.dispose();
  });

  it('applies one approval toggle without disturbing the other categories', async () => {
    const { host } = await readyHost();
    expect((await host.handle(intent('update_settings', { category: 'execute', enabled: true }))).ok).toBe(true);
    expect(host.getApprovalSettings()).toEqual({ read: true, edit: true, web_fetch: true, execute: true, mcp: false });
    expect((await host.handle(intent('update_settings', { category: 'shell', enabled: true }))).ok).toBe(false);
    host.dispose();
  });

  it('drops a model that the newly selected provider cannot prove free', async () => {
    const host = createAgentHost(services({
      createProvider: async (connection: string) => new FakeProvider([{ id: `${connection}-only` }]),
    }));
    host.newSession();
    await host.selectProvider('nvidia-nim');
    await host.selectModel('nvidia-nim', 'nvidia-nim-only');
    expect(host.getSelectedModel()).toEqual({ providerId: 'nvidia-nim', modelId: 'nvidia-nim-only' });
    // OpenRouter has no free declaration, so its catalog proves nothing free.
    await expect(host.selectModel('openrouter', 'nvidia-nim-only')).rejects.toThrow(/verified free/);
    await host.selectProvider('openrouter');
    expect(host.getSelectedModel()).toBeUndefined();
    host.dispose();
  });

  it('stores a credential write-only and never echoes the key', async () => {
    const store = new Map<string, string>();
    const { host } = await readyHost({
      credentials: {
        get: async (id) => store.get(id),
        set: async (id, key) => { store.set(id, key); },
        delete: async (id) => { store.delete(id); },
      },
      hasCredential: async (id) => store.has(id),
    });
    const response = await host.handle(intent('set_credential', { providerId: 'nvidia-nim', apiKey: 'sk-secret' }));
    expect(response).toMatchObject({ ok: true, result: { type: 'credential_updated', providerId: 'nvidia-nim' } });
    expect(JSON.stringify(response)).not.toContain('sk-secret');
    expect(store.get('nvidia-nim')).toBe('sk-secret');
    await host.handle(intent('clear_credential', { providerId: 'nvidia-nim' }));
    expect(store.has('nvidia-nim')).toBe(false);
    host.dispose();
  });

  it('fails closed on a blank credential and when no secret store is wired', async () => {
    const { host } = await readyHost();
    expect((await host.handle(intent('set_credential', { providerId: 'nvidia-nim', apiKey: '   ' }))).ok).toBe(false);
    expect(await host.handle(intent('set_credential', { providerId: 'nvidia-nim', apiKey: 'k' })))
      .toMatchObject({ ok: false, error: { code: 'NO_SECRET_STORE' } });
    host.dispose();
  });

  it('asks for a missing credential instead of attempting the connection', async () => {
    const { host } = await readyHost({ hasCredential: async () => false });
    expect(await host.handle(intent('test_connection', { providerId: 'nvidia-nim' })))
      .toMatchObject({ ok: true, result: { ok: false, message: expect.stringContaining('API key') } });
    host.dispose();
  });

  it('reports the connection result and its proven-free model count', async () => {
    const { host } = await readyHost({ hasCredential: async () => true },
      [{ contentDelta: 'x' }], [{ id: FREE_MODEL }, { id: 'paid-model', pricing: { prompt: '0.5', completion: '1' } }]);
    // NVIDIA NIM declares the whole catalog free, yet a reported nonzero price
    // outranks that declaration, so only the free entry is counted.
    expect(await host.handle(intent('test_connection', { providerId: 'nvidia-nim' })))
      .toMatchObject({ ok: true, result: { type: 'connection_tested', ok: true, modelCount: 1 } });
    expect((await host.handle(intent('test_connection', { providerId: 'nope' }))).ok).toBe(false);
    host.dispose();
  });

  it('lists no models when a provider substantiates none as free', async () => {
    const host = createAgentHost(services({
      createProvider: async () => new FakeProvider([
        { id: 'free-one' },
        { id: 'paid-one', pricing: { prompt: '0.2', completion: '0.4' } },
      ]),
    }));
    await host.selectProvider('openrouter');
    expect(await host.handle(intent('list_models', { providerId: 'openrouter' })))
      .toMatchObject({ ok: true, result: { models: [] } });
    host.dispose();
  });

  it('serves About metadata only when the host supplies it', async () => {
    const about = {
      type: 'about', version: '0.3.10', license: 'MIT', description: 'x',
      documentation: 'https://d', repository: 'https://r', issues: 'https://i',
    } as const;
    const { host } = await readyHost({ about: () => about });
    expect(await host.handle(intent('get_about'))).toMatchObject({ ok: true, result: about });
    const bare = createAgentHost(services({ createProvider: async () => new FakeProvider([]) }));
    expect((await bare.handle(intent('get_about'))).ok).toBe(false);
    bare.dispose();
    host.dispose();
  });
});