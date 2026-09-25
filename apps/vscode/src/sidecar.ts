import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  HOST_PROTOCOL_VERSION,
  MAX_HOST_LINE_BYTES,
  HostRequestSchema,
  HostResponseSchema,
  HostNotificationSchema,
  type HostRequest,
  type HostResponse,
  type HostNotification,
  type HostEventEnvelope,
  type InitializeResult,
  type HostErrorCode,
  type ApprovalRequest,
} from './protocol.js';

export type PendingApproval = ApprovalRequest;

export interface SidecarClientOptions {
  workspaceRoot: string;
  /** Absolute path to the installed extension, used to find the bundled sidecar. */
  extensionPath?: string;
  executablePath?: string;
  provider?: string;
  model?: string;
  spawnFn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  onMessage?: (message: HostResponse | HostNotification) => void;
  onEvent?: (envelope: HostEventEnvelope) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError?: (error: Error) => void;
  gracePeriodMs?: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  method: string;
  onAbort?: () => void;
}

export class SidecarError extends Error {
  constructor(
    message: string,
    public readonly code?: HostErrorCode | 'NOT_FOUND' | 'PROTOCOL_MISMATCH' | 'LINE_TOO_LARGE' | 'CLOSED',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SidecarError';
  }
}

export class SidecarClient {
  public readonly options: SidecarClientOptions;
  private child: ChildProcess | null = null;
  private closed = false;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(options: SidecarClientOptions) {
    this.options = options;
  }

  /** The sidecar shipped inside the VSIX, preferred so no CLI install is required. */
  private bundledSidecarPath(): string | undefined {
    if (!this.options.extensionPath) return undefined;
    return path.join(this.options.extensionPath, 'dist', 'sidecar', 'index.js');
  }

  /** A globally installed CLI, used when the extension bundles none. */
  private globalCliPath(): string | undefined {
    if (process.platform !== 'win32' || !process.env.APPDATA) return undefined;
    return path.join(process.env.APPDATA, 'npm', 'node_modules', 'moderado', 'dist', 'index.js');
  }

  /** The monorepo build, so running the extension from source keeps working. */
  private monorepoCliPath(): string {
    return path.join(this.options.workspaceRoot, 'apps', 'cli', 'dist', 'index.js');
  }

  /**
   * Decide what to launch, in precedence order:
   *   1. an explicit `executablePath` (a deliberate user override, so it wins);
   *   2. the sidecar bundled inside the extension, so the IDE works with no CLI install;
   *   3. a globally installed CLI;
   *   4. the monorepo build, for running the extension from source;
   *   5. bare `moderado` on PATH.
   * Any `.js` entry is prefixed with `node` and never handed to a shell.
   *
   * `probeFilesystem` is false for injected test spawns, which assert the spawn
   * contract itself and must not depend on what happens to exist on disk.
   */
  public resolveLaunch(probeFilesystem = true): { executable: string; args: string[] } {
    const configured = this.options.executablePath?.trim();

    let executable = configured || 'moderado';
    let args = ['host', '--workspace', this.options.workspaceRoot, '--protocol', String(HOST_PROTOCOL_VERSION)];

    if (executable.startsWith('node ') || executable.startsWith('node.exe ')) {
      const parts = executable.split(/\s+/);
      executable = parts[0];
      args = [...parts.slice(1), ...args];
    } else if (executable.endsWith('.js') || executable.endsWith('.mjs') || executable.endsWith('.cjs')) {
      args = [executable, ...args];
      executable = 'node';
    } else if (!configured && probeFilesystem) {
      const candidates = [this.bundledSidecarPath(), this.globalCliPath(), this.monorepoCliPath()].filter(
        (candidate): candidate is string => !!candidate,
      );
      const resolved = candidates.find((candidate) => existsSync(candidate));
      if (resolved) {
        args = [resolved, ...args];
        executable = 'node';
      }
    }

    if (this.options.provider?.trim()) {
      args.push('--provider', this.options.provider.trim());
    }
    if (this.options.model?.trim()) {
      args.push('--model', this.options.model.trim());
    }

    return { executable, args };
  }

  public start(): void {
    if (this.child) {
      throw new Error('Sidecar client has already been started');
    }

    const spawnFn = this.options.spawnFn || spawn;
    const { executable, args } = this.resolveLaunch(!this.options.spawnFn);

    if (this.options.provider?.trim()) {
      args.push('--provider', this.options.provider.trim());
    }
    if (this.options.model?.trim()) {
      args.push('--model', this.options.model.trim());
    }

    try {
      this.child = spawnFn(executable, args, {
        cwd: this.options.workspaceRoot,
        shell: false,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      const error = this.formatSpawnError(executable, err);
      this.options.onError?.(error);
      throw error;
    }

    this.child.on('error', (err: any) => {
      const formatted = this.formatSpawnError(executable, err);
      this.rejectAllPending(formatted);
      this.options.onError?.(formatted);
    });

    this.child.on('exit', (code, signal) => {
      const exitError = new SidecarError(
        `Sidecar process exited unexpectedly with code ${code ?? signal}`,
        'CLOSED',
      );
      this.rejectAllPending(exitError);
      this.options.onExit?.(code, signal);
    });

    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    this.child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.stderrBuffer += text;
      // Cap diagnostic stderr buffer at 64 KiB
      if (this.stderrBuffer.length > 65_536) {
        this.stderrBuffer = this.stderrBuffer.slice(-65_536);
      }
    });
  }

  public async initialize(): Promise<InitializeResult> {
    const result = await this.request<InitializeResult>('initialize', {
      protocolVersion: HOST_PROTOCOL_VERSION,
    });

    if (result.protocolVersion !== HOST_PROTOCOL_VERSION) {
      throw new SidecarError(
        `Unsupported host protocol version ${result.protocolVersion}, expected ${HOST_PROTOCOL_VERSION}`,
        'PROTOCOL_MISMATCH',
      );
    }

    return result;
  }

  public async request<T = unknown>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    if (this.closed || !this.child || !this.child.stdin || this.child.stdin.destroyed) {
      throw new SidecarError('Sidecar is not running or has been closed', 'CLOSED');
    }

    if (signal?.aborted) {
      throw signal.reason || new Error('Request aborted');
    }

    const id = randomUUID();
    const reqPayload: HostRequest = {
      type: 'request',
      id,
      method: method as any,
      params: params as any,
    };

    // Strict contract boundary check
    const validation = HostRequestSchema.safeParse(reqPayload);
    if (!validation.success) {
      throw new SidecarError(
        `Invalid host request: ${validation.error.message}`,
        'INVALID_REQUEST',
        validation.error.issues,
      );
    }

    return new Promise<T>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      if (signal) {
        onAbort = () => {
          this.pendingRequests.delete(id);
          reject(signal.reason || new Error('Request aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pendingRequests.set(id, {
        resolve: (val) => {
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          resolve(val);
        },
        reject: (err) => {
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          reject(err);
        },
        method,
        onAbort,
      });

      const line = JSON.stringify(validation.data) + '\n';
      try {
        this.child!.stdin!.write(line, 'utf8', (err) => {
          if (err) {
            this.pendingRequests.delete(id);
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
            reject(err);
          }
        });
      } catch (err) {
        this.pendingRequests.delete(id);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    });
  }

  public getPendingApprovals(): PendingApproval[] {
    return Array.from(this.pendingApprovals.values());
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public getRecentStderr(): string {
    return this.stderrBuffer;
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Fail closed: clear pending approvals (all settle as aborted/cancelled)
    this.pendingApprovals.clear();

    const closeError = new SidecarError('Sidecar client closed', 'CLOSED');
    this.rejectAllPending(closeError);

    if (this.child) {
      try {
        if (this.child.stdin && !this.child.stdin.destroyed) {
          this.child.stdin.end();
        }
      } catch {
        // Ignore stdin close errors
      }

      const gracePeriod = this.options.gracePeriodMs ?? 500;
      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout | null = null;
        let killed = false;

        const onProcessExit = () => {
          if (timer) clearTimeout(timer);
          resolve();
        };

        if (this.child!.exitCode !== null || this.child!.signalCode !== null) {
          resolve();
          return;
        }

        this.child!.once('exit', onProcessExit);

        timer = setTimeout(() => {
          if (!killed && this.child && this.child.exitCode === null) {
            killed = true;
            try {
              this.child.kill('SIGTERM');
            } catch {
              // Ignore kill errors
            }
            setTimeout(() => {
              if (this.child && this.child.exitCode === null) {
                try {
                  this.child.kill('SIGKILL');
                } catch {
                  // Ignore
                }
              }
              resolve();
            }, 200);
          } else {
            resolve();
          }
        }, gracePeriod);
      });
    }
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8');

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) {
        if (this.stdoutBuffer.length > MAX_HOST_LINE_BYTES) {
          const err = new SidecarError(
            `Line length exceeds maximum limit of ${MAX_HOST_LINE_BYTES} bytes`,
            'LINE_TOO_LARGE',
          );
          this.stdoutBuffer = '';
          this.options.onError?.(err);
        }
        break;
      }

      const rawLine = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (rawLine.length > MAX_HOST_LINE_BYTES) {
        const err = new SidecarError(
          `Line length exceeds maximum limit of ${MAX_HOST_LINE_BYTES} bytes`,
          'LINE_TOO_LARGE',
        );
        this.options.onError?.(err);
        continue;
      }

      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      this.processIncomingLine(trimmed);
    }
  }

  private processIncomingLine(line: string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (err: any) {
      this.options.onError?.(new Error(`Failed to parse NDJSON line from sidecar: ${err.message}`));
      return;
    }

    if (parsed && typeof parsed === 'object') {
      if (parsed.type === 'response') {
        const validated = HostResponseSchema.safeParse(parsed);
        if (!validated.success) {
          this.options.onError?.(new Error(`Invalid response envelope: ${validated.error.message}`));
          return;
        }

        const response = validated.data;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (!response.ok) {
            pending.reject(
              new SidecarError(
                response.error.message,
                response.error.code,
              ),
            );
          } else {
            pending.resolve(response.result);
          }
        }
        this.options.onMessage?.(response);
      } else if (parsed.type === 'event') {
        const validated = HostNotificationSchema.safeParse(parsed);
        if (!validated.success) {
          this.options.onError?.(new Error(`Invalid event envelope: ${validated.error.message}`));
          return;
        }

        const envelope = validated.data.envelope;
        if (envelope.event.type === 'approval_request') {
          this.pendingApprovals.set(envelope.event.request.requestId, envelope.event.request);
        } else if (envelope.event.type === 'approval_resolved') {
          this.pendingApprovals.delete(envelope.event.requestId);
        } else if (envelope.event.type === 'completion' || envelope.event.type === 'cancellation') {
          this.pendingApprovals.clear();
        }

        this.options.onEvent?.(envelope);
        this.options.onMessage?.(validated.data);
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private formatSpawnError(executable: string, err: any): SidecarError {
    const isEnoent = err?.code === 'ENOENT' || String(err?.message || '').includes('ENOENT');
    if (isEnoent) {
      return new SidecarError(
        `Moderado executable not found: "${executable}". Please install Moderado or configure "moderado.executablePath" in VS Code settings.`,
        'NOT_FOUND',
      );
    }
    return new SidecarError(`Failed to start Moderado sidecar: ${err?.message || err}`);
  }
}
