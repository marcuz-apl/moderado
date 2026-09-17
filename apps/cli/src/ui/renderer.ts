import { AgentEvent } from '@moderado/contracts';

export interface TerminalRendererOptions {
  stdout?: NodeJS.WritableStream;
  verbose?: boolean;
}

export class TerminalRenderer {
  private readonly stdout: NodeJS.WritableStream;
  private readonly verbose: boolean;
  private lastEventType?: string;

  constructor(options: TerminalRendererOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.verbose = options.verbose ?? false;
  }

  handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'model_change': {
        this.newlineIfNeeded();
        const reasonText =
          event.reason === 'initial_selection'
            ? 'Selected'
            : event.reason === 'user_pinned'
            ? 'Pinned'
            : `Fallback (${event.reason})`;
        this.stdout.write(
          `\x1b[35m[Model]\x1b[0m ${reasonText} \x1b[1m${event.newModelId}\x1b[0m (\x1b[32m${event.accessClass}\x1b[0m)\n`
        );
        this.lastEventType = 'model_change';
        break;
      }

      case 'progress': {
        if (this.verbose) {
          this.newlineIfNeeded();
          this.stdout.write(`\x1b[90m[Progress]\x1b[0m ${event.status}\n`);
          this.lastEventType = 'progress';
        }
        break;
      }

      case 'assistant_delta': {
        this.stdout.write(event.delta);
        this.lastEventType = 'assistant_delta';
        break;
      }

      case 'tool_call_initiated': {
        this.newlineIfNeeded();
        const argsStr = JSON.stringify(event.parameters);
        const truncatedArgs = argsStr.length > 80 ? argsStr.slice(0, 77) + '...' : argsStr;
        this.stdout.write(
          `\x1b[34m[Tool Call]\x1b[0m \x1b[1m${event.toolName}\x1b[0m(${truncatedArgs})\n`
        );
        this.lastEventType = 'tool_call_initiated';
        break;
      }

      case 'tool_result': {
        this.newlineIfNeeded();
        const statusColor =
          event.result.status === 'success'
            ? '\x1b[32m'
            : event.result.status === 'denied'
            ? '\x1b[33m'
            : '\x1b[31m';
        const lines = event.result.output.trim().split('\n');
        const preview = lines[0] + (lines.length > 1 ? ` ... (+${lines.length - 1} lines)` : '');
        this.stdout.write(
          `\x1b[34m[Tool Result]\x1b[0m ${statusColor}${event.result.status.toUpperCase()}\x1b[0m: ${preview}\n`
        );
        this.lastEventType = 'tool_result';
        break;
      }

      case 'completion': {
        this.newlineIfNeeded();
        const bannerColor =
          event.status === 'completed'
            ? '\x1b[1;32m'
            : event.status === 'step_limit_reached'
            ? '\x1b[1;33m'
            : '\x1b[1;31m';
        this.stdout.write(
          `\n${bannerColor}=== Session Finished: ${event.status.toUpperCase()} (Total Steps: ${event.totalSteps}) ===\x1b[0m\n`
        );
        this.lastEventType = 'completion';
        break;
      }

      case 'error': {
        this.newlineIfNeeded();
        this.stdout.write(`\x1b[1;31m[Error ${event.code}]\x1b[0m ${event.message}\n`);
        this.lastEventType = 'error';
        break;
      }

      case 'cancellation': {
        this.newlineIfNeeded();
        this.stdout.write(`\x1b[1;33m[Cancelled]\x1b[0m ${event.reason}\n`);
        this.lastEventType = 'cancellation';
        break;
      }

      default:
        break;
    }
  }

  private newlineIfNeeded(): void {
    if (this.lastEventType === 'assistant_delta') {
      this.stdout.write('\n');
    }
  }
}
