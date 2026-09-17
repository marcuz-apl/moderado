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
  private lastEventType?: string;
  private isStreamingAssistant = false;
  private isStreamingReasoning = false;
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

        // In interactive chat mode, model is already visible in the prompt.
        // Only print if there is an unexpected fallback.
        if (
          this.isChatMode &&
          (event.reason === 'initial_selection' || event.reason === 'user_pinned')
        ) {
          this.lastEventType = 'model_change';
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
        this.lastEventType = 'model_change';
        break;
      }

      case 'progress': {
        if (this.verbose) {
          this.finishAssistantStream();
          this.clearTransientProgress();
          this.stdout.write(`\x1b[38;5;244m◇ ${event.status}\x1b[0m\n`);
          this.lastEventType = 'progress';
        } else {
          this.stdout.write(`\r\x1b[K\x1b[38;5;245m⠋ Thinking...\x1b[0m`);
          this.hasTransientProgress = true;
        }
        break;
      }

      case 'reasoning_delta': {
        this.clearTransientProgress();
        if (!this.isStreamingReasoning) {
          if (this.lastEventType && this.lastEventType !== 'reasoning_delta') {
            this.stdout.write('\n');
          }
          this.stdout.write('\x1b[38;5;240m╭─ 💭 \x1b[1;38;5;250mThought\x1b[0m\n\x1b[38;5;244m');
          this.isStreamingReasoning = true;
        }
        this.stdout.write(event.delta);
        this.lastEventType = 'reasoning_delta';
        break;
      }

      case 'assistant_delta': {
        this.clearTransientProgress();
        if (this.isStreamingReasoning) {
          this.finishReasoningStream();
        }
        if (!this.isStreamingAssistant) {
          if (this.lastEventType && this.lastEventType !== 'assistant_delta') {
            this.stdout.write('\n');
          }
          this.stdout.write('\x1b[1;38;5;75m● Moderado\x1b[0m\n\n');
          this.isStreamingAssistant = true;
        }
        this.stdout.write(event.delta);
        this.lastEventType = 'assistant_delta';
        break;
      }

      case 'tool_call_initiated': {
        this.finishAssistantStream();
        this.clearTransientProgress();
        const icon = this.getToolIcon(event.toolName);
        const argsStr = JSON.stringify(event.parameters);
        const truncatedArgs = argsStr.length > 65 ? argsStr.slice(0, 62) + '...' : argsStr;

        this.stdout.write(
          `\n\x1b[38;5;240m╭─ ${icon} \x1b[1;38;5;75m${event.toolName}\x1b[0m \x1b[38;5;245m${truncatedArgs}\x1b[0m\n`
        );
        this.lastEventType = 'tool_call_initiated';
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
          `\x1b[38;5;240m╰─\x1b[0m ${statusColor}${statusIcon} ${event.result.status}\x1b[0m \x1b[38;5;245m${preview.slice(0, 75)}\x1b[0m\n\n`
        );
        this.lastEventType = 'tool_result';
        break;
      }

      case 'completion': {
        this.finishAssistantStream();
        this.clearTransientProgress();

        if (this.isChatMode) {
          // Clean finish without large batch completion card
          this.stdout.write('\n');
          this.lastEventType = 'completion';
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
        this.lastEventType = 'completion';
        break;
      }

      case 'error': {
        this.finishAssistantStream();
        this.clearTransientProgress();
        this.stdout.write(`\n\x1b[1;31m✖ [Error ${event.code}]\x1b[0m ${event.message}\n`);
        this.lastEventType = 'error';
        break;
      }

      case 'cancellation': {
        this.finishAssistantStream();
        this.clearTransientProgress();
        this.stdout.write(`\n\x1b[1;33m⚠ [Cancelled]\x1b[0m ${event.reason}\n`);
        this.lastEventType = 'cancellation';
        break;
      }

      default:
        break;
    }
  }

  private finishAssistantStream(): void {
    this.clearTransientProgress();
    if (this.isStreamingReasoning) {
      this.finishReasoningStream();
    }
    if (this.isStreamingAssistant) {
      this.stdout.write('\n');
      this.isStreamingAssistant = false;
    }
  }

  private finishReasoningStream(): void {
    if (this.isStreamingReasoning) {
      this.stdout.write('\x1b[0m\n\x1b[38;5;240m╰──────────────────────────────────────────────\x1b[0m\n\n');
      this.isStreamingReasoning = false;
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
