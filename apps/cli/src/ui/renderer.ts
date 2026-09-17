import { AgentEvent } from '@moderado/contracts';

export interface TerminalRendererOptions {
  stdout?: NodeJS.WritableStream;
  verbose?: boolean;
}

export class TerminalRenderer {
  private readonly stdout: NodeJS.WritableStream;
  private readonly verbose: boolean;
  private lastEventType?: string;
  private isStreamingAssistant = false;

  constructor(options: TerminalRendererOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.verbose = options.verbose ?? false;
  }

  handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'model_change': {
        this.finishAssistantStream();
        const reasonText =
          event.reason === 'initial_selection'
            ? 'Selected'
            : event.reason === 'user_pinned'
            ? 'Pinned'
            : `Fallback (${event.reason})`;
        this.stdout.write(
          `\x1b[35m[Model]\x1b[0m ${reasonText} \x1b[1;36m${event.newModelId}\x1b[0m (\x1b[32m${event.accessClass}\x1b[0m)\n`
        );
        this.lastEventType = 'model_change';
        break;
      }

      case 'progress': {
        if (this.verbose) {
          this.finishAssistantStream();
          this.stdout.write(`\x1b[90m◇ ${event.status}\x1b[0m\n`);
          this.lastEventType = 'progress';
        }
        break;
      }

      case 'assistant_delta': {
        if (!this.isStreamingAssistant) {
          if (this.lastEventType && this.lastEventType !== 'assistant_delta') {
            this.stdout.write('\n');
          }
          this.stdout.write('\x1b[1;35m◆ Moderado:\x1b[0m\n');
          this.isStreamingAssistant = true;
        }
        this.stdout.write(event.delta);
        this.lastEventType = 'assistant_delta';
        break;
      }

      case 'tool_call_initiated': {
        this.finishAssistantStream();
        const icon = this.getToolIcon(event.toolName);
        const argsStr = JSON.stringify(event.parameters);
        const truncatedArgs = argsStr.length > 70 ? argsStr.slice(0, 67) + '...' : argsStr;

        this.stdout.write(
          `\n\x1b[90m╭─\x1b[0m \x1b[1;34m[Tool Call]\x1b[0m ${icon} \x1b[1m${event.toolName}\x1b[0m \x1b[90m${truncatedArgs}\x1b[0m\n`
        );
        this.lastEventType = 'tool_call_initiated';
        break;
      }

      case 'tool_result': {
        this.finishAssistantStream();
        const isSuccess = event.result.status === 'success';
        const statusColor = isSuccess
          ? '\x1b[32m'
          : event.result.status === 'denied'
          ? '\x1b[33m'
          : '\x1b[31m';
        const statusIcon = isSuccess ? '✔' : event.result.status === 'denied' ? '⚠' : '✖';

        const lines = event.result.output.trim().split('\n');
        const preview = lines[0] + (lines.length > 1 ? ` ... (+${lines.length - 1} lines)` : '');

        this.stdout.write(
          `\x1b[90m╰─\x1b[0m \x1b[34m[Tool Result]\x1b[0m ${statusIcon} ${statusColor}${event.result.status.toUpperCase()}\x1b[0m: \x1b[90m${preview}\x1b[0m\n\n`
        );
        this.lastEventType = 'tool_result';
        break;
      }

      case 'completion': {
        this.finishAssistantStream();
        const bannerColor =
          event.status === 'completed'
            ? '\x1b[1;32m'
            : event.status === 'step_limit_reached'
            ? '\x1b[1;33m'
            : '\x1b[1;31m';
        const icon = event.status === 'completed' ? '✔' : '⚠';

        this.stdout.write(
          `\n\x1b[90m╭─────────────────────────────────────────────────────────────╮\x1b[0m\n` +
          `\x1b[90m│\x1b[0m  ${icon} ${bannerColor}=== Session Finished: ${event.status.toUpperCase()} (Total Steps: ${event.totalSteps}) ===\x1b[0m\n` +
          `\x1b[90m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n`
        );
        this.lastEventType = 'completion';
        break;
      }

      case 'error': {
        this.finishAssistantStream();
        this.stdout.write(`\n\x1b[1;31m✖ [Error ${event.code}]\x1b[0m ${event.message}\n`);
        this.lastEventType = 'error';
        break;
      }

      case 'cancellation': {
        this.finishAssistantStream();
        this.stdout.write(`\n\x1b[1;33m⚠ [Cancelled]\x1b[0m ${event.reason}\n`);
        this.lastEventType = 'cancellation';
        break;
      }

      default:
        break;
    }
  }

  private finishAssistantStream(): void {
    if (this.isStreamingAssistant) {
      this.stdout.write('\n');
      this.isStreamingAssistant = false;
    }
  }

  private getToolIcon(name: string): string {
    switch (name) {
      case 'read_file':
        return '📖';
      case 'write_file':
        return '✎';
      case 'edit_file':
        return '✂';
      case 'list_files':
        return '📁';
      case 'search_files':
        return '🔍';
      case 'run_command':
        return '⚙';
      case 'git_diff':
        return '⎇';
      default:
        return '⚙';
    }
  }
}
