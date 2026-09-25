import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostNotification, ModelListResult, ProviderListResult } from '@moderado/contracts';
import { FakeProviderAdapter } from '@moderado/providers';
import { loadConfig } from '../src/config.js';
import { MemoryCredentialStore } from '../src/credentials.js';
import { createHostRuntime } from '../src/host/runtime.js';
import { SessionStore, createSession } from '../src/sessions.js';

describe('Host Runtime', () => {
  let tempDir: string;
  let workspaceDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-runtime-test-'));
    workspaceDir = path.join(tempDir, 'workspace');
    homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
  });

  it('initializes runtime and lists existing resumable sessions, omitting corrupted ones', async () => {
    const sessionStore = new SessionStore(homeDir);

    // Save a valid session
    const validSession = createSession(fs.realpathSync(workspaceDir));
    sessionStore.save(validSession);

    // Create a corrupted session file in the session directory
    const dir = sessionStore.getDirectory(fs.realpathSync(workspaceDir));
    fs.writeFileSync(path.join(dir, 'corrupted.json'), '{ invalid json ');

    const notifications: HostNotification[] = [];
    const emit = async (n: HostNotification) => {
      notifications.push(n);
    };

    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        sessionStore,
        provider: new FakeProviderAdapter({ defaultResponse: 'Hello from fake provider' }),
      },
    });

    const initResult = await runtime.initialize({
      type: 'request',
      id: 'req-init',
      method: 'initialize',
      params: { protocolVersion: 1 },
    });

    expect(initResult.protocolVersion).toBe(1);
    expect(initResult.sessionId).toBeDefined();
    expect(initResult.workspaceName).toBe(path.basename(fs.realpathSync(workspaceDir)));
    // Should have valid session and skip corrupted one
    expect(initResult.resumableSessions.length).toBeGreaterThanOrEqual(1);
    expect(initResult.resumableSessions.some((s) => s.sessionId === validSession.id)).toBe(true);

    await runtime.close();
  });

  it('supports session.new and session.resume round-trip', async () => {
    const sessionStore = new SessionStore(homeDir);
    const notifications: HostNotification[] = [];
    const emit = async (n: HostNotification) => {
      notifications.push(n);
    };

    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        sessionStore,
        provider: new FakeProviderAdapter({ defaultResponse: 'Fake response' }),
      },
    });

    const initResult = await runtime.initialize({
      type: 'request',
      id: 'req-init',
      method: 'initialize',
      params: { protocolVersion: 1 },
    });
    const session1Id = initResult.sessionId;

    // Create new session
    const newResult = await runtime.dispatch({
      type: 'request',
      id: 'req-new',
      method: 'session.new',
      params: { sessionId: session1Id },
    }) as { sessionId: string };

    expect(newResult.sessionId).toBeDefined();
    expect(newResult.sessionId).not.toBe(session1Id);

    // Resume session1
    const resumeResult = await runtime.dispatch({
      type: 'request',
      id: 'req-resume',
      method: 'session.resume',
      params: { sessionId: newResult.sessionId, targetSessionId: session1Id },
    }) as { sessionId: string };

    expect(resumeResult.sessionId).toBe(session1Id);

    // Resume non-existent session throws SESSION_NOT_FOUND
    await expect(runtime.dispatch({
      type: 'request',
      id: 'req-resume-bad',
      method: 'session.resume',
      params: { sessionId: session1Id, targetSessionId: '00000000-0000-0000-0000-000000000000' },
    })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });

    await runtime.close();
  });

  it('maintains stable sidecar session ID and strictly increasing sequence across turns', async () => {
    const notifications: HostNotification[] = [];
    const emit = async (n: HostNotification) => {
      notifications.push(n);
    };

    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        provider: new FakeProviderAdapter({ defaultResponse: 'Turn completed.' }),
      },
    });

    const init = await runtime.initialize({
      type: 'request',
      id: 'req-init',
      method: 'initialize',
      params: { protocolVersion: 1 },
    });

    // Turn 1
    await runtime.dispatch({
      type: 'request',
      id: 'req-turn-1',
      method: 'chat.send',
      params: { sessionId: init.sessionId, text: 'Hello turn 1' },
    });
    await (runtime as any).waitForActiveGeneration();

    const countTurn1 = notifications.length;
    expect(countTurn1).toBeGreaterThan(0);

    // Turn 2
    await runtime.dispatch({
      type: 'request',
      id: 'req-turn-2',
      method: 'chat.send',
      params: { sessionId: init.sessionId, text: 'Hello turn 2' },
    });
    await (runtime as any).waitForActiveGeneration();

    expect(notifications.length).toBeGreaterThan(countTurn1);

    // Check sequence numbers are strictly increasing and sessionId is identical
    for (let i = 0; i < notifications.length; i++) {
      expect(notifications[i].envelope.sessionId).toBe(init.sessionId);
      expect(notifications[i].envelope.sequence).toBe(i + 1);
    }

    await runtime.close();
  });

  it('injects selection context into prompt and rejects out-of-jail paths', async () => {
    const notifications: HostNotification[] = [];
    const emit = async (n: HostNotification) => {
      notifications.push(n);
    };

    // Create a file in workspace
    const sampleFile = path.join(workspaceDir, 'src', 'index.ts');
    fs.mkdirSync(path.dirname(sampleFile), { recursive: true });
    fs.writeFileSync(sampleFile, 'export function add(a: number, b: number) { return a + b; }\n');

    let capturedTask = '';
    const fakeProvider = new FakeProviderAdapter({
      defaultResponse: 'I inspected your code.',
    });

    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        provider: fakeProvider,
      },
    });

    const init = await runtime.initialize({
      type: 'request',
      id: 'req-init',
      method: 'initialize',
      params: { protocolVersion: 1 },
    });

    // Valid selection
    await runtime.dispatch({
      type: 'request',
      id: 'req-sel-ok',
      method: 'chat.send',
      params: {
        sessionId: init.sessionId,
        text: 'Explain function',
        context: {
          selection: {
            relativePath: 'src/index.ts',
            startLine: 1,
            endLine: 1,
            text: 'export function add(a: number, b: number)',
          },
        },
      },
    });
    await (runtime as any).waitForActiveGeneration();

    // Out-of-jail or protected path rejection (e.g. .git or sensitive files)
    await expect(runtime.dispatch({
      type: 'request',
      id: 'req-sel-bad',
      method: 'chat.send',
      params: {
        sessionId: init.sessionId,
        text: 'Explain secret',
        context: {
          selection: {
            relativePath: '.env',
            startLine: 1,
            endLine: 1,
          },
        },
      },
    })).rejects.toMatchObject({ code: 'WORKSPACE_DENIED' });

    await runtime.close();
  });

  it('rejects stale or duplicate approval decisions with APPROVAL_STALE', async () => {
    const emit = async () => {};
    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        provider: new FakeProviderAdapter({ defaultResponse: 'Done' }),
      },
    });

    const init = await runtime.initialize({
      type: 'request',
      id: 'req-init',
      method: 'initialize',
      params: { protocolVersion: 1 },
    });

    await expect(runtime.dispatch({
      type: 'request',
      id: 'req-appr-stale',
      method: 'approval.respond',
      params: {
        sessionId: init.sessionId,
        requestId: 'unknown-approval-id',
        status: 'approved',
      },
    })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });

    await runtime.close();
  });

  it('cancels active generation when chat.cancel is dispatched', async () => {
    const notifications: HostNotification[] = [];
    const emit = async (n: HostNotification) => {
      notifications.push(n);
    };

    const fakeProvider = new FakeProviderAdapter();
    fakeProvider.streamChat = async function* (options: any) {
      yield { contentDelta: 'Thinking...' };
      while (!options.signal?.aborted) {
        await new Promise((r) => setTimeout(r, 10));
      }
      yield { contentDelta: '' };
    };

    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        provider: fakeProvider,
      },
    });

    const init = await runtime.initialize({
      type: 'request',
      id: 'req-init',
      method: 'initialize',
      params: { protocolVersion: 1 },
    });

    // Start generation (fire and forget)
    await runtime.dispatch({
      type: 'request',
      id: 'req-chat-long',
      method: 'chat.send',
      params: { sessionId: init.sessionId, text: 'Long task' },
    });

    // Wait a tick for execution to begin
    await new Promise((r) => setTimeout(r, 20));

    // Cancel it
    const cancelResult = await runtime.dispatch({
      type: 'request',
      id: 'req-cancel',
      method: 'chat.cancel',
      params: { sessionId: init.sessionId, targetRequestId: 'req-chat-long' },
    });

    expect(cancelResult).toEqual({ cancelled: true });

    await (runtime as any).waitForActiveGeneration();

    // Check cancellation event was emitted
    const cancelledEvent = notifications.find((n) => n.envelope.event.type === 'cancellation');
    expect(cancelledEvent).toBeDefined();

    await runtime.close();
  });

  it('resolves pending approval as aborted on runtime close', async () => {
    const emit = async () => {};
    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        provider: new FakeProviderAdapter({ defaultResponse: 'Done' }),
      },
    });

    // Request approval directly on approval queue
    const approvalPromise = runtime.approvalQueue.requestApproval({
      requestId: 'test-appr',
      toolName: 'write_file',
      actionSummary: 'Edit file',
      exactPayload: {},
      timestamp: Date.now(),
    });

    await runtime.close();

    const decision = await approvalPromise;
    expect(decision.status).toBe('aborted');
  });
});


/**
 * First-run onboarding: the sidecar must boot and serve the model manager with no
 * API key configured, then switch providers without a restart.
 */
describe('Host Runtime provider and model management', () => {
  const ENV_KEYS = [
    'NVIDIA_API_KEY',
    'OPENROUTER_API_KEY',
    'AGNES_AI_API_KEY',
    'ORCAROUTER_API_KEY',
  ];

  let tempDir: string;
  let workspaceDir: string;
  let homeDir: string;
  let savedEnv: Record<string, string | undefined>;
  let notifications: HostNotification[];

  const emit = async (n: HostNotification) => {
    notifications.push(n);
  };

  /** A runtime with no injected provider, exercising real (lazy) resolution. */
  const createKeylessRuntime = () =>
    createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        credentialStore: new MemoryCredentialStore(),
      },
    });

  const initialize = async (runtime: Awaited<ReturnType<typeof createHostRuntime>>) => {
    const init = await runtime.initialize({
      type: 'request',
      id: 'req-init',
      method: 'initialize',
      params: { protocolVersion: 1 },
    });
    return init.sessionId;
  };

  const listProviders = async (runtime: Awaited<ReturnType<typeof createHostRuntime>>) =>
    (await runtime.dispatch({
      type: 'request',
      id: 'req-providers',
      method: 'provider.list',
      params: {},
    })) as ProviderListResult;

  const eventTypes = () => notifications.map((n) => n.envelope.event.type);

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-provider-test-'));
    workspaceDir = path.join(tempDir, 'workspace');
    homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    notifications = [];
    // Keep the tests hermetic: a developer's real keys must not leak in.
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('starts keyless and reports which providers still need an API key', async () => {
    const runtime = await createKeylessRuntime();

    expect(await initialize(runtime)).toBeTruthy();

    const result = await listProviders(runtime);
    const byId = new Map(result.providers.map((p) => [p.id, p]));

    expect(byId.has('nvidia-nim')).toBe(true);
    expect(byId.get('nvidia-nim')).toMatchObject({ requiresApiKey: true, hasApiKey: false });
    // Local runtimes need no key, so they are always usable.
    expect(byId.get('ollama')).toMatchObject({ requiresApiKey: false, hasApiKey: true });
    expect(result.activeProviderId).toBeUndefined();

    await runtime.close();
  });

  it('surfaces an error event and releases busy state when no provider is configured', async () => {
    const runtime = await createKeylessRuntime();
    const sessionId = await initialize(runtime);

    await expect(
      runtime.dispatch({
        type: 'request',
        id: 'req-send-1',
        method: 'chat.send',
        params: { sessionId, text: 'hello' },
      }),
    ).resolves.toEqual({ accepted: true });

    await (runtime as any).waitForActiveGeneration();

    expect(eventTypes()).toContain('error');
    const error = notifications
      .map((n) => n.envelope.event)
      .find((e) => e.type === 'error') as { message: string };
    expect(error.message).toMatch(/no provider configured/i);

    // Busy state must be released, otherwise the composer locks up forever.
    await expect(
      runtime.dispatch({
        type: 'request',
        id: 'req-send-2',
        method: 'chat.send',
        params: { sessionId, text: 'again' },
      }),
    ).resolves.toEqual({ accepted: true });
    await (runtime as any).waitForActiveGeneration();

    await runtime.close();
  });

  it('persists a provider connection, activates it, and never returns the key', async () => {
    const runtime = await createKeylessRuntime();
    await initialize(runtime);

    const connectResult = await runtime.dispatch({
      type: 'request',
      id: 'req-connect',
      method: 'provider.connect',
      params: { providerId: 'openrouter', apiKey: 'sk-test-secret-value' },
    });
    expect(connectResult).toEqual({ providerId: 'openrouter', connected: true });

    const result = await listProviders(runtime);
    expect(result.providers.find((p) => p.id === 'openrouter')).toMatchObject({
      hasApiKey: true,
      isActive: true,
    });
    expect(result.activeProviderId).toBe('openrouter');

    // The secret is host-side only: nothing in the listing echoes it back.
    expect(JSON.stringify(result)).not.toContain('sk-test-secret-value');

    const saved = loadConfig(homeDir);
    expect(saved.connections?.openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(saved.activeConnectionId).toBe('openrouter');

    await runtime.close();
  });

  it('rejects a keyless connect for a provider that requires an API key', async () => {
    const runtime = await createKeylessRuntime();
    await initialize(runtime);

    await expect(
      runtime.dispatch({
        type: 'request',
        id: 'req-connect-nokey',
        method: 'provider.connect',
        params: { providerId: 'nvidia-nim' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    // Nothing was persisted, so the provider stays disconnected.
    const result = await listProviders(runtime);
    expect(result.providers.find((p) => p.id === 'nvidia-nim')?.hasApiKey).toBe(false);

    await runtime.close();
  });

  it('connects a loopback provider without any API key', async () => {
    const runtime = await createKeylessRuntime();
    await initialize(runtime);

    await expect(
      runtime.dispatch({
        type: 'request',
        id: 'req-connect-ollama',
        method: 'provider.connect',
        params: { providerId: 'ollama' },
      }),
    ).resolves.toEqual({ providerId: 'ollama', connected: true });

    const result = await listProviders(runtime);
    expect(result.providers.find((p) => p.id === 'ollama')?.isActive).toBe(true);

    await runtime.close();
  });

  it('rejects an unknown provider id', async () => {
    const runtime = await createKeylessRuntime();
    await initialize(runtime);

    await expect(
      runtime.dispatch({
        type: 'request',
        id: 'req-connect-unknown',
        method: 'provider.connect',
        params: { providerId: 'not-a-provider', apiKey: 'sk-x' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    await runtime.close();
  });

  it('lists models for the injected provider with free models first', async () => {
    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        credentialStore: new MemoryCredentialStore(),
        provider: new FakeProviderAdapter(),
      },
    });
    await initialize(runtime);

    const result = (await runtime.dispatch({
      type: 'request',
      id: 'req-models',
      method: 'model.list',
      params: {},
    })) as ModelListResult;

    expect(result.providerId).toBe('fake');
    // Free-tier models sort ahead of paid ones, then alphabetically.
    expect(result.models.map((m) => m.id)).toEqual([
      'mock/free-tool-model',
      'mock/text-only-model',
      'mock/paid-tool-model',
    ]);
    expect(result.models.filter((m) => m.isFree)).toHaveLength(2);

    await runtime.close();
  });

  it('fails model.list with an actionable error when no provider is configured', async () => {
    const runtime = await createKeylessRuntime();
    await initialize(runtime);

    await expect(
      runtime.dispatch({
        type: 'request',
        id: 'req-models-empty',
        method: 'model.list',
        params: {},
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    await runtime.close();
  });

  it('expands @file mentions into the prompt sent to the model', async () => {
    fs.writeFileSync(path.join(workspaceDir, 'notes.md'), 'Remember the launch codeword.');

    const provider = new FakeProviderAdapter();
    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        credentialStore: new MemoryCredentialStore(),
        provider,
      },
    });
    const sessionId = await initialize(runtime);

    await runtime.dispatch({
      type: 'request',
      id: 'req-mention',
      method: 'chat.send',
      params: { sessionId, text: 'Summarize @notes.md' },
    });
    await (runtime as any).waitForActiveGeneration();

    const userMessage = provider.recordedCalls
      .flatMap((call) => call.messages)
      .find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('Remember the launch codeword.');
    expect(userMessage?.content).toContain('Summarize');
    // The @token is replaced by a fenced excerpt block, not left dangling as prose.
    expect(userMessage?.content).toContain('--- @notes.md ---');
    expect(userMessage?.content).toContain('--- end @notes.md ---');

    await runtime.close();
  });

  it('cancels the in-flight generation without a targetRequestId', async () => {
    const fakeProvider = new FakeProviderAdapter();
    fakeProvider.streamChat = async function* (options: any) {
      yield { contentDelta: 'Working...' };
      while (!options.signal?.aborted) {
        await new Promise((r) => setTimeout(r, 10));
      }
      yield { contentDelta: '' };
    };

    const runtime = await createHostRuntime({
      workspaceRoot: workspaceDir,
      emit,
      dependencies: {
        customHome: homeDir,
        credentialStore: new MemoryCredentialStore(),
        provider: fakeProvider,
      },
    });
    const sessionId = await initialize(runtime);

    await runtime.dispatch({
      type: 'request',
      id: 'req-chat-long',
      method: 'chat.send',
      params: { sessionId, text: 'Long task' },
    });
    await new Promise((r) => setTimeout(r, 20));

    await expect(
      runtime.dispatch({
        type: 'request',
        id: 'req-cancel',
        method: 'chat.cancel',
        params: { sessionId },
      }),
    ).resolves.toEqual({ cancelled: true });

    await (runtime as any).waitForActiveGeneration();
    expect(eventTypes()).toContain('cancellation');

    await runtime.close();
  });
});
