import readline from 'node:readline';
import {
  ApprovalDecision,
  ApprovalRequest,
  IApprovalHandler,
} from '@moderado/contracts';
import { renderBox } from './box.js';

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

    const lines: string[] = [];

    if (request.exactPayload.targetFile) {
      lines.push(`\x1b[38;5;245mTarget File\x1b[0m   \x1b[38;5;253m${request.exactPayload.targetFile}\x1b[0m`);
    }

    if (request.exactPayload.command) {
      lines.push(`\x1b[38;5;245mCommand\x1b[0m       \x1b[1;38;5;75m${request.exactPayload.command.join(' ')}\x1b[0m`);
      if (request.exactPayload.cwd) {
        lines.push(`\x1b[38;5;245mWorking Dir\x1b[0m   \x1b[38;5;242m${request.exactPayload.cwd}\x1b[0m`);
      }
    }

    if (request.exactPayload.diffPreview) {
      lines.push('---');
      lines.push('\x1b[1;38;5;250mDiff Preview\x1b[0m');
      for (const line of request.exactPayload.diffPreview.split('\n').slice(0, 15)) {
        if (line.startsWith('+')) {
          lines.push(`  \x1b[38;5;114m${line}\x1b[0m`);
        } else if (line.startsWith('-')) {
          lines.push(`  \x1b[38;5;203m${line}\x1b[0m`);
        } else {
          lines.push(`  \x1b[38;5;244m${line}\x1b[0m`);
        }
      }
    }

    lines.push('---');
    lines.push(`\x1b[38;5;114m[Y] Approve\x1b[0m   \x1b[38;5;222m[N] Deny\x1b[0m   \x1b[38;5;203m[Q] Quit session\x1b[0m`);

    this.stdout.write(
      '\n' +
        renderBox(lines, {
          title: `⚠️ Permission Required: ${request.toolName}`,
          minWidth: 58,
          borderColor: '\x1b[38;5;214m',
          titleColor: '\x1b[1;38;5;222m',
        }) +
        '\n'
    );

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
