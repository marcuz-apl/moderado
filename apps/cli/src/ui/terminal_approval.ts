import readline from 'node:readline';
import {
  ApprovalDecision,
  ApprovalRequest,
  IApprovalHandler,
} from '@moderado/contracts';

export interface TerminalApprovalOptions {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

export class TerminalApprovalHandler implements IApprovalHandler {
  private readonly stdin: NodeJS.ReadableStream;
  private readonly stdout: NodeJS.WritableStream;

  constructor(options: TerminalApprovalOptions = {}) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
  }

  async requestApproval(
    request: ApprovalRequest,
    signal?: AbortSignal
  ): Promise<ApprovalDecision> {
    if (signal?.aborted) {
      return { requestId: request.requestId, status: 'aborted', reason: 'Aborted' };
    }

    this.stdout.write('\n\x1b[1;33m╭── ⚠ [APPROVAL REQUIRED] \x1b[1;37m' + request.toolName + '\x1b[1;33m ──────────────────────────╮\x1b[0m\n');

    if (request.exactPayload.targetFile) {
      this.stdout.write(`\x1b[1;33m│\x1b[0m  \x1b[1;36mTarget File:\x1b[0m ${request.exactPayload.targetFile}\n`);
    }

    if (request.exactPayload.command) {
      this.stdout.write(`\x1b[1;33m│\x1b[0m  \x1b[1;36mCommand:\x1b[0m     ${request.exactPayload.command.join(' ')}\n`);
      if (request.exactPayload.cwd) {
        this.stdout.write(`\x1b[1;33m│\x1b[0m  \x1b[90mWorking Dir:\x1b[0m ${request.exactPayload.cwd}\n`);
      }
    }

    if (request.exactPayload.diffPreview) {
      this.stdout.write('\x1b[1;33m│\x1b[0m\n\x1b[1;33m│\x1b[0m  \x1b[1mDiff Preview:\x1b[0m\n');
      for (const line of request.exactPayload.diffPreview.split('\n')) {
        if (line.startsWith('+')) {
          this.stdout.write(`\x1b[1;33m│\x1b[0m    \x1b[32m${line}\x1b[0m\n`);
        } else if (line.startsWith('-')) {
          this.stdout.write(`\x1b[1;33m│\x1b[0m    \x1b[31m${line}\x1b[0m\n`);
        } else {
          this.stdout.write(`\x1b[1;33m│\x1b[0m    \x1b[90m${line}\x1b[0m\n`);
        }
      }
    }

    this.stdout.write('\x1b[1;33m│\x1b[0m\n');
    this.stdout.write('\x1b[1;33m│\x1b[0m  \x1b[32m[Y] Approve\x1b[0m   \x1b[33m[N] Deny\x1b[0m   \x1b[31m[Q] Quit session\x1b[0m\n');
    this.stdout.write('\x1b[1;33m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n');

    const answer = await this.prompt('\x1b[1mApprove this action? [y/N/q]: \x1b[0m', signal);
    const normalized = answer.trim().toLowerCase();

    if (normalized === 'y' || normalized === 'yes') {
      return { requestId: request.requestId, status: 'approved' };
    }

    if (normalized === 'q' || normalized === 'quit') {
      return { requestId: request.requestId, status: 'aborted', reason: 'User quit session' };
    }

    return { requestId: request.requestId, status: 'denied', reason: 'User denied approval' };
  }

  private prompt(query: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve) => {
      try {
        if (this.stdin === process.stdin && typeof (this.stdin as any).read === 'function') {
          while ((this.stdin as any).read() !== null) {}
        }
      } catch {
        // ignore
      }

      const rl = readline.createInterface({
        input: this.stdin,
        output: this.stdout,
      });

      const onAbort = () => {
        rl.close();
        resolve('q');
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      rl.question(query, (answer) => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        rl.close();
        resolve(answer);
      });
    });
  }
}
