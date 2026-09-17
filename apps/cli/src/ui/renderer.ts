import { AgentEvent } from '@moderado/contracts';

export interface TerminalRendererOptions {
  stdout?: NodeJS.WritableStream;
  verbose?: boolean;
  isChatMode?: boolean;
}

export class TerminalRenderer {
  private readonly stdout: NodeJS.WritableStream;
  private readonly verbose: boolean;
  private readonly isChatMode: boolean;
  private isStreamingAssistant = false;
  private hasTransientProgress = false;

  constructor(options: TerminalRendererOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.verbose = options.verbose ?? false;
    this.isChatMode = options.isChatMode ?? false;
  }

  handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'model_change': {
        this.finishAssistantStream();
        this.clearTransientProgress();

        // In interactive chat mode, model is already configured.
        // Only print if there is an unexpected fallback.
        if (
          this.isChatMode &&
          (event.reason === 'initial_selection' || event.reason === 'user_pinned')
        ) {
          break;
        }

        const reasonText =
          event.reason === 'initial_selection'
            ? 'Selected'
            : event.reason === 'user_pinned'
            ? 'Pinned'
            : `Fallback (${event.reason})`;
        this.stdout.write(
          `\x1b[38;5;141m● Model:\x1b[0m ${reasonText} \x1b[1;38;5;75m${event.newModelId}\x1b[0m \x1b[38;5;244m(${event.accessClass})\x1b[0m\n`
        );
        break;
      }

      case 'progress': {
        if (this.verbose) {
          this.finishAssistantStream();
          this.clearTransientProgress();
          this.stdout.write(`\x1b[38;5;244m◇ ${event.status}\x1b[0m\n`);
        } else {
          this.stdout.write(`\r\x1b[K\x1b[38;5;245m⠋ Thinking...\x1b[0m`);
          this.hasTransientProgress = true;
        }
        break;
      }

      case 'reasoning_delta': {
        // Do not display internal thinking process. Keep subtle transient spinner.
        if (!this.hasTransientProgress) {
          this.stdout.write('\r\x1b[K\x1b[38;5;245m⠋ Thinking...\x1b[0m');
          this.hasTransientProgress = true;
        }
        break;
      }

      case 'assistant_delta': {
        this.clearTransientProgress();
        if (!this.isStreamingAssistant) {
          this.isStreamingAssistant = true;
        }
        this.stdout.write(event.delta);
        break;
      }

      case 'tool_call_initiated': {
        this.finishAssistantStream();
        this.clearTransientProgress();
        const icon = this.getToolIcon(event.toolName);
        const argsStr = JSON.stringify(event.parameters);
        const truncatedArgs = argsStr.length > 65 ? argsStr.slice(0, 62) + '...' : argsStr;

        this.stdout.write(
          `\x1b[38;5;242m╭─\x1b[0m ${icon} \x1b[38;5;75m${event.toolName}\x1b[0m \x1b[38;5;244m${truncatedArgs}\x1b[0m\n`
        );
        break;
      }

      case 'tool_result': {
        this.finishAssistantStream();
        this.clearTransientProgress();
        const isSuccess = event.result.status === 'success';
        const statusColor = isSuccess
          ? '\x1b[38;5;114m'
          : event.result.status === 'denied'
          ? '\x1b[38;5;222m'
          : '\x1b[38;5;203m';
        const statusIcon = isSuccess ? '✔' : event.result.status === 'denied' ? '⚠' : '✖';

        const lines = event.result.output.trim().split('\n');
        const preview = lines[0] + (lines.length > 1 ? ` ... (+${lines.length - 1} lines)` : '');

        this.stdout.write(
          `\x1b[38;5;242m╰─\x1b[0m ${statusColor}${statusIcon}\x1b[0m \x1b[38;5;244m${preview.slice(0, 75)}\x1b[0m\n\n`
        );
        break;
      }

      case 'completion': {
        this.finishAssistantStream();
        this.clearTransientProgress();

        if (this.isChatMode) {
          // Clean finish without large batch completion card
          this.stdout.write('\n\n');
          break;
        }

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
        break;
      }

      case 'error': {
        this.finishAssistantStream();
        this.clearTransientProgress();
        this.stdout.write(`\n\x1b[1;31m✖ [Error ${event.code}]\x1b[0m ${event.message}\n`);
        break;
      }

      case 'cancellation': {
        this.finishAssistantStream();
        this.clearTransientProgress();
        this.stdout.write(`\n\x1b[1;33m⚠ [Cancelled]\x1b[0m ${event.reason}\n`);
        break;
      }

      default:
        break;
    }
  }

  private finishAssistantStream(): void {
    this.clearTransientProgress();
    if (this.isStreamingAssistant) {
      this.stdout.write('\n');
      this.isStreamingAssistant = false;
    }
  }

  private clearTransientProgress(): void {
    if (this.hasTransientProgress) {
      this.stdout.write('\r\x1b[K');
      this.hasTransientProgress = false;
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
