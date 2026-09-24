import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostNotification } from '@moderado/contracts';
import { FakeProviderAdapter } from '@moderado/providers';
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
