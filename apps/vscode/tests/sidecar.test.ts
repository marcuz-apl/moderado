import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { SidecarClient } from '../src/sidecar.js';
import {
  MAX_HOST_LINE_BYTES,
  type HostResponse,
  type HostNotification,
} from '../src/protocol.js';

interface MockProcess extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
  proc.kill = vi.fn((sig?: NodeJS.Signals | number) => {
    proc.killed = true;
    proc.signalCode = (typeof sig === 'string' ? sig : 'SIGTERM') as NodeJS.Signals;
    proc.exitCode = null;
    process.nextTick(() => proc.emit('exit', null, proc.signalCode));
    return true;
  });
  return proc;
}

describe('SidecarClient', () => {
  it('passes workspace path safely as separate arguments with shell: false even with spaces and metacharacters', async () => {
    const mockProc = createMockProcess();
    let capturedCmd = '';
    let capturedArgs: readonly string[] = [];
    let capturedOpts: any = null;

    const spawnFn = vi.fn((cmd: string, args: readonly string[], opts: any) => {
      capturedCmd = cmd;
      capturedArgs = args;
      capturedOpts = opts;
      return mockProc as unknown as ChildProcess;
    });

    const riskyPath = 'C:\\Users\\John Doe & Co\\Projects\\weird "quoted" $dir\\app';
    const client = new SidecarClient({
      workspaceRoot: riskyPath,
      spawnFn,
    });

    client.start();

    expect(capturedCmd).toBe('moderado');
    expect(capturedArgs).toEqual(['host', '--workspace', riskyPath, '--protocol', '1']);
    expect(capturedOpts.cwd).toBe(riskyPath);
    expect(capturedOpts.shell).toBe(false);
  });

  it('uses configured executable override when provided', async () => {
    const mockProc = createMockProcess();
    let capturedCmd = '';

    const spawnFn = vi.fn((cmd: string, _args: readonly string[], _opts: any) => {
      capturedCmd = cmd;
      return mockProc as unknown as ChildProcess;
    });

    const client = new SidecarClient({
      workspaceRoot: '/test/workspace',
      executablePath: '/opt/custom/moderado-bin',
      spawnFn,
    });

    client.start();

    expect(capturedCmd).toBe('/opt/custom/moderado-bin');
  });

  it('passes provider and model arguments when configured', async () => {
    const mockProc = createMockProcess();
    let capturedArgs: readonly string[] = [];

    const spawnFn = vi.fn((_cmd: string, args: readonly string[], _opts: any) => {
      capturedArgs = args;
      return mockProc as unknown as ChildProcess;
    });

    const client = new SidecarClient({
      workspaceRoot: '/test/workspace',
      provider: 'nvidia-nim',
      model: 'z-ai/glm-5.3-flash',
      spawnFn,
    });

    client.start();

    expect(capturedArgs).toContain('--provider');
    expect(capturedArgs).toContain('nvidia-nim');
    expect(capturedArgs).toContain('--model');
    expect(capturedArgs).toContain('z-ai/glm-5.3-flash');
  });

  it('provides an actionable error message when the executable is not found (ENOENT)', async () => {
    const mockProc = createMockProcess();
    const spawnFn = vi.fn(() => mockProc as unknown as ChildProcess);

    let reportedError: Error | null = null;
    const client = new SidecarClient({
      workspaceRoot: '/test/workspace',
      executablePath: 'missing-moderado',
      spawnFn,
      onError: (err) => {
        reportedError = err;
      },
    });

    client.start();

    const enoent = new Error('spawn missing-moderado ENOENT') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    mockProc.emit('error', enoent);

    expect(reportedError).not.toBeNull();
    expect(reportedError!.message).toContain('Moderado executable not found');
    expect(reportedError!.message).toContain('missing-moderado');
    expect(reportedError!.message).toContain('moderado.executablePath');
  });

  it('detects protocol mismatch during initialize and rejects with clear explanation', async () => {
    const mockProc = createMockProcess();
    const spawnFn = vi.fn(() => mockProc as unknown as ChildProcess);

    const client = new SidecarClient({
      workspaceRoot: '/test/workspace',
      spawnFn,
    });

    client.start();

    // Listen to what client writes to stdin and respond with unsupported protocolVersion: 99
    mockProc.stdin.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      if (!line) return;
      const parsed = JSON.parse(line);
      if (parsed.method === 'initialize') {
        const response: HostResponse = {
          type: 'response',
          id: parsed.id,
          ok: true,
          result: {
            protocolVersion: 99 as any,
            sessionId: 'sess-1',
            workspaceName: 'workspace',
            resumableSessions: [],
          },
        };
        mockProc.stdout.write(JSON.stringify(response) + '\n');
      }
    });

    await expect(client.initialize()).rejects.toThrow(/protocol version/i);
  });

  it('rejects pending requests when child process exits unexpectedly', async () => {
    const mockProc = createMockProcess();
    const spawnFn = vi.fn(() => mockProc as unknown as ChildProcess);

    let exitCodeReported: number | null = null;
    const client = new SidecarClient({
      workspaceRoot: '/test/workspace',
      spawnFn,
      onExit: (code) => {
        exitCodeReported = code;
      },
    });

    client.start();

    const pendingReq = client.request('initialize', { protocolVersion: 1 });

    // Child process crashes or exits with code 1
    mockProc.emit('exit', 1, null);

    await expect(pendingReq).rejects.toThrow(/exited/i);
    expect(exitCodeReported).toBe(1);
  });

  it('correctly parses chunked and multi-line NDJSON output and rejects lines exceeding size limit', async () => {
    const mockProc = createMockProcess();
    const spawnFn = vi.fn(() => mockProc as unknown as ChildProcess);

    const receivedMessages: Array<HostResponse | HostNotification> = [];
    const client = new SidecarClient({
      workspaceRoot: '/test/workspace',
      spawnFn,
      onMessage: (msg) => receivedMessages.push(msg),
    });

    client.start();

    const notif1: HostNotification = {
      type: 'event',
      envelope: {
        protocolVersion: 1,
        sessionId: 'sess-123',
        sequence: 1,
        timestamp: Date.now(),
        event: {
          type: 'progress',
          step: 1,
          maxSteps: 10,
          status: 'thinking',
          timestamp: Date.now(),
        },
      },
    };
    const notif2: HostNotification = {
      type: 'event',
      envelope: {
        protocolVersion: 1,
        sessionId: 'sess-123',
        sequence: 2,
        timestamp: Date.now(),
        event: {
          type: 'assistant_delta',
          delta: 'hello world',
          timestamp: Date.now(),
        },
      },
    };

    const line1 = JSON.stringify(notif1) + '\n';
    const line2 = JSON.stringify(notif2) + '\n';

    // Send chunk 1: part of line 1
    mockProc.stdout.write(line1.slice(0, 15));
    expect(receivedMessages).toHaveLength(0);

    // Send chunk 2: rest of line 1 + start of line 2
    mockProc.stdout.write(line1.slice(15) + line2.slice(0, 10));
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].type).toBe('event');

    // Send chunk 3: rest of line 2
    mockProc.stdout.write(line2.slice(10));
    expect(receivedMessages).toHaveLength(2);

    // Now test line exceeding MAX_HOST_LINE_BYTES
    let lineTooLargeError: Error | null = null;
    client.options.onError = (err) => {
      lineTooLargeError = err;
    };

    const oversizedLine = 'X'.repeat(MAX_HOST_LINE_BYTES + 50) + '\n';
    mockProc.stdout.write(oversizedLine);

    expect(lineTooLargeError).not.toBeNull();
    expect(lineTooLargeError!.message).toMatch(/limit|exceed/i);
  });

  it('settles any pending approval as aborted when client is closed while approval is pending', async () => {
    const mockProc = createMockProcess();
    const spawnFn = vi.fn(() => mockProc as unknown as ChildProcess);

    const client = new SidecarClient({
      workspaceRoot: '/test/workspace',
      spawnFn,
    });

    client.start();

    // Sidecar emits an approval_requested event
    const notif: HostNotification = {
      type: 'event',
      envelope: {
        protocolVersion: 1,
        sessionId: 'sess-123',
        sequence: 3,
        timestamp: Date.now(),
        event: {
          type: 'approval_request',
          request: {
            requestId: 'appr-abc',
            toolName: 'write_file',
            actionSummary: 'write to test.ts',
            exactPayload: { targetFile: 'test.ts', diffPreview: '+console.log(1);' },
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        },
      },
    };
    mockProc.stdout.write(JSON.stringify(notif) + '\n');

    expect(client.getPendingApprovals()).toHaveLength(1);
    expect(client.getPendingApprovals()[0].requestId).toBe('appr-abc');

    // Close the client while approval is pending
    await client.close();

    // Verify all pending approvals are aborted (no pending approval remains unresolved or approved)
    expect(client.getPendingApprovals()).toHaveLength(0);
    expect(client.isClosed()).toBe(true);
  });
});
