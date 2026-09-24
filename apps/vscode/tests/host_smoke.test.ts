import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { SidecarClient } from '../src/sidecar.js';
import { ModeradoWebviewPanel } from '../src/webview/panel.js';
import type { HostResponse, HostNotification } from '../src/protocol.js';

interface MockProcess extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = vi.fn(() => true);
  return proc;
}

describe('Host Smoke Test: Protocol to UI Integration', () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = mkdtempSync(path.join(tmpdir(), 'moderado-smoke-'));
  });

  afterEach(() => {
    if (existsSync(tmpWorkspace)) {
      rmSync(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('orchestrates turn, code context, approval denial without file mutation, and session resume', async () => {
    const mockProc = createMockProcess();
    const spawnFn = vi.fn(() => mockProc as unknown as ChildProcess);

    const sessionId = 'smoke-sess-1';
    let sequence = 0;
    const sentResponses: any[] = [];

    // Simulate the sidecar NDJSON response and event server
    mockProc.stdin.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const req = JSON.parse(line);
        sentResponses.push(req);

        if (req.method === 'initialize') {
          const resp: HostResponse = {
            type: 'response',
            id: req.id,
            ok: true,
            result: {
              protocolVersion: 1,
              sessionId,
              workspaceName: 'smoke-workspace',
              resumableSessions: [{ sessionId, title: 'Previous Task', updatedAt: Date.now() }],
            },
          };
          mockProc.stdout.write(JSON.stringify(resp) + '\n');
        } else if (req.method === 'chat.send') {
          // Acknowledge chat.send
          const resp: HostResponse = {
            type: 'response',
            id: req.id,
            ok: true,
            result: { accepted: true },
          };
          mockProc.stdout.write(JSON.stringify(resp) + '\n');

          // Stream progress
          sequence++;
          const notifProgress: HostNotification = {
            type: 'event',
            envelope: {
              protocolVersion: 1,
              sessionId,
              sequence,
              timestamp: Date.now(),
              event: {
                type: 'progress',
                step: 1,
                maxSteps: 3,
                status: 'Inspecting context',
                timestamp: Date.now(),
              },
            },
          };
          mockProc.stdout.write(JSON.stringify(notifProgress) + '\n');

          // Stream assistant delta
          sequence++;
          const notifDelta: HostNotification = {
            type: 'event',
            envelope: {
              protocolVersion: 1,
              sessionId,
              sequence,
              timestamp: Date.now(),
              event: {
                type: 'assistant_delta',
                delta: 'I propose modifying src/app.ts to fix the issue.',
                timestamp: Date.now(),
              },
            },
          };
          mockProc.stdout.write(JSON.stringify(notifDelta) + '\n');

          // Request approval for write_file
          sequence++;
          const notifApproval: HostNotification = {
            type: 'event',
            envelope: {
              protocolVersion: 1,
              sessionId,
              sequence,
              timestamp: Date.now(),
              event: {
                type: 'approval_request',
                request: {
                  requestId: 'appr-smoke-1',
                  toolName: 'write_file',
                  actionSummary: 'write to src/app.ts',
                  exactPayload: {
                    targetFile: 'src/app.ts',
                    diffPreview: '+console.log("smoke test");',
                  },
                  timestamp: Date.now(),
                },
                timestamp: Date.now(),
              },
            },
          };
          mockProc.stdout.write(JSON.stringify(notifApproval) + '\n');
        } else if (req.method === 'approval.respond') {
          const resp: HostResponse = {
            type: 'response',
            id: req.id,
            ok: true,
            result: { resolved: true },
          };
          mockProc.stdout.write(JSON.stringify(resp) + '\n');

          // Emit approval_resolved event
          sequence++;
          const notifResolved: HostNotification = {
            type: 'event',
            envelope: {
              protocolVersion: 1,
              sessionId,
              sequence,
              timestamp: Date.now(),
              event: {
                type: 'approval_resolved',
                requestId: req.params.requestId,
                status: req.params.status,
                reason: req.params.reason,
                timestamp: Date.now(),
              },
            },
          };
          mockProc.stdout.write(JSON.stringify(notifResolved) + '\n');

          // Complete turn
          sequence++;
          const notifDone: HostNotification = {
            type: 'event',
            envelope: {
              protocolVersion: 1,
              sessionId,
              sequence,
              timestamp: Date.now(),
              event: {
                type: 'completion',
                status: 'completed',
                totalSteps: 1,
                summary: 'Turn concluded after approval decision.',
                timestamp: Date.now(),
              },
            },
          };
          mockProc.stdout.write(JSON.stringify(notifDone) + '\n');
        } else if (req.method === 'session.resume') {
          const resp: HostResponse = {
            type: 'response',
            id: req.id,
            ok: true,
            result: { sessionId: req.params.targetSessionId },
          };
          mockProc.stdout.write(JSON.stringify(resp) + '\n');

          process.nextTick(() => {
            sequence++;
            const notifContinuation: HostNotification = {
              type: 'event',
              envelope: {
                protocolVersion: 1,
                sessionId,
                sequence,
                timestamp: Date.now(),
                event: {
                  type: 'assistant_delta',
                  delta: 'Session resumed. Ready for next instruction.',
                  timestamp: Date.now(),
                },
              },
            };
            mockProc.stdout.write(JSON.stringify(notifContinuation) + '\n');
          });
        }
      }
    });

    const client = new SidecarClient({
      workspaceRoot: tmpWorkspace,
      spawnFn,
    });

    // Wire webview panel with sidecar
    const mockExtensionUri = { fsPath: tmpWorkspace, path: tmpWorkspace, scheme: 'file' } as any;
    const panel = new ModeradoWebviewPanel(mockExtensionUri, async () => client);

    client.options.onEvent = (env) => {
      panel.handleHostEvent(env);
    };

    client.start();
    const initResult = await client.initialize();
    panel.setSessionId(initResult.sessionId);

    // Mock resolving webview
    const mockWebview = {
      options: {},
      html: '',
      cspSource: 'https:',
      asWebviewUri: (uri: any) => uri,
      onDidReceiveMessage: vi.fn(),
      postMessage: vi.fn(),
    };

    panel.resolveWebviewView(
      {
        webview: mockWebview,
        onDidDispose: vi.fn(),
      } as any,
      {} as any,
      {} as any,
    );

    // 1. Send prompt with selection context
    await (panel as any).handleWebviewMessage({
      type: 'send',
      text: 'Please check src/app.ts',
      context: {
        selection: {
          relativePath: 'src/app.ts',
          startLine: 1,
          endLine: 5,
          text: 'const a = 1;',
        },
      },
    });

    // Check panel state after events processed
    let state = panel.getState();
    expect(state.currentTurn).toBeDefined();
    expect(state.currentTurn!.assistantText).toContain('I propose modifying src/app.ts');
    expect(state.currentTurn!.approvals).toHaveLength(1);
    expect(state.currentTurn!.approvals[0].requestId).toBe('appr-smoke-1');
    expect(state.currentTurn!.approvals[0].status).toBe('pending');

    // 2. Reject/Deny approval
    await (panel as any).handleWebviewMessage({
      type: 'reject',
      requestId: 'appr-smoke-1',
      reason: 'Unsafe modification',
    });

    state = panel.getState();
    // Verify turn completed and moved to turns history
    expect(state.currentTurn).toBeUndefined();
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].approvals[0].status).toBe('denied');

    // Verify no file mutation occurred in workspace
    expect(existsSync(path.join(tmpWorkspace, 'src', 'app.ts'))).toBe(false);

    // 3. Resume session and verify sequence continuation without gap
    await (panel as any).handleWebviewMessage({
      type: 'resumeSession',
      sessionId,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    state = panel.getState();
    expect(state.hasSequenceGap).toBe(false);
    expect(state.lastSequence).toBe(sequence);
    expect(state.currentTurn!.assistantText).toContain('Session resumed');

    await client.close();
  });
});
