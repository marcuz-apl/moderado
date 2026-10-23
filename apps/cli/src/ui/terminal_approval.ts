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

/** Diff lines shown before the prompt collapses the rest into a count. */
const PREVIEW_LINES = 10;

/** Sentinel for "stdin closed before an answer", which must not read as Enter. */
const NO_INPUT = '\u0000no-input';

export class TerminalApprovalHandler implements IApprovalHandler {
  private readonly stdin: NodeJS.ReadableStream;
  private readonly stdout: NodeJS.WritableStream;
  private alwaysApprove = false;

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

    if (this.alwaysApprove) {
      return { requestId: request.requestId, status: 'approved' };
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
      // Summarise rather than dump: a minified file or a twenty-file patch used
      // to push the whole prompt off the screen, which is unreadable and was the
      // main reason an approval got denied by accident.
      const previewLines = request.exactPayload.diffPreview.split('\n');
      const added = previewLines.filter((line) => line.startsWith('+')).length;
      const removed = previewLines.filter((line) => line.startsWith('-')).length;
      const shown = previewLines.slice(0, PREVIEW_LINES);
      const hidden = previewLines.length - shown.length;
      const summary = [`+${added}`, `-${removed}`, hidden > 0 ? `${hidden} more line${hidden === 1 ? '' : 's'}` : '']
        .filter(Boolean)
        .join(', ');
      lines.push('---');
      lines.push(`\x1b[1;38;5;250mDiff Preview\x1b[0m \x1b[38;5;244m(${summary})\x1b[0m`);
      for (const line of shown) {
        if (line.startsWith('+')) {
          lines.push(`  \x1b[38;5;114m${line}\x1b[0m`);
        } else if (line.startsWith('-')) {
          lines.push(`  \x1b[38;5;203m${line}\x1b[0m`);
        } else {
          lines.push(`  \x1b[38;5;244m${line}\x1b[0m`);
        }
      }
      if (hidden > 0) lines.push(`  \x1b[38;5;244m… ${hidden} more line${hidden === 1 ? '' : 's'} not shown\x1b[0m`);
    }

    lines.push('---');
    lines.push(`\x1b[38;5;114m[Y] Approve (Enter)\x1b[0m   \x1b[38;5;114m[a] Always approve\x1b[0m   \x1b[38;5;222m[n] Deny\x1b[0m   \x1b[38;5;203m[q] Quit session\x1b[0m`);

    this.stdout.write(
      '\n' +
        renderBox(lines, {
          title: `⚠️ Permission Required: ${request.toolName}`,
          minWidth: 58,
          // Never wider than the terminal, whatever the diff contains.
          maxWidth: this.boxWidth(),
          borderColor: '\x1b[38;5;214m',
          titleColor: '\x1b[1;38;5;222m',
        }) +
        '\n'
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const answer = await this.prompt('\x1b[1mApprove this action? [Y/n/a/q]: \x1b[0m', signal);
      // A closed stdin resolves like a bare Enter; approving there would turn an
      // unattended session into an auto-approver, so it fails closed instead.
      if (answer === NO_INPUT) {
        return { requestId: request.requestId, status: 'aborted', reason: 'No input available for approval' };
      }
      const normalized = answer.trim().toLowerCase();

      // Enter approves once: the box advertises the capitalised key as the
      // default, and pressing Enter only to be told "denied" is the behaviour
      // that made an ordinary `npx` scaffold look like a permissions bug.
      if (normalized === '' || normalized === 'y' || normalized === 'yes') {
        return { requestId: request.requestId, status: 'approved' };
      }
      if (normalized === 'a' || normalized === 'all' || normalized === 'always') {
        this.alwaysApprove = true;
        return { requestId: request.requestId, status: 'approved' };
      }
      if (normalized === 'n' || normalized === 'no') {
        return { requestId: request.requestId, status: 'denied', reason: 'User denied approval' };
      }
      if (normalized === 'q' || normalized === 'quit') {
        return { requestId: request.requestId, status: 'aborted', reason: 'User quit session' };
      }
      // Anything else is a typo or a stray keystroke, not a decision.
      this.stdout.write('\x1b[38;5;222mPlease answer y, a, n, or q.\x1b[0m\n');
    }
    return { requestId: request.requestId, status: 'denied', reason: 'No valid answer after five prompts' };
  }

  /** Keep the prompt inside the terminal, with a floor so it stays readable. */
  private boxWidth(): number {
    const columns = (this.stdout as NodeJS.WriteStream).columns ?? 80;
    return Math.max(40, Math.min(columns - 2, 100));
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

      let settled = false;
      const finish = (value: string): void => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        rl.close();
        resolve(value);
      };

      const onAbort = () => finish('q');

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      // A stream that ends without a newline closes the interface without ever
      // calling the question callback. Report that distinctly from an empty
      // answer, which is a deliberate Enter.
      rl.on('close', () => finish(NO_INPUT));

      rl.question(query, (answer) => finish(answer));
    });
  }
}
