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
    // The interactive chat command owns a full-screen frame and redraws it as
    // events arrive. Writing here would place output beneath the previous
    // welcome frame until the next prompt redraw.
    if (this.isChatMode) return;

    switch (event.type) {
      case 'model_change': {
        this.finishAssistantStream();
        this.clearTransientProgress();

        // In interactive chat mode, model is already configured.
        // Only print if there is an unexpected fallback.
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
        const summary = this.formatToolSummary(event.toolName, event.parameters);

        this.stdout.write(
          `\x1b[38;5;75m⏺\x1b[0m \x1b[1m${event.toolName}\x1b[0m \x1b[38;5;244m${summary}\x1b[0m\n`
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
          `  \x1b[38;5;240m└\x1b[0m ${statusColor}${statusIcon}\x1b[0m \x1b[38;5;244m${preview.slice(0, 75)}\x1b[0m\n\n`
        );
        break;
      }

      case 'completion': {
        this.finishAssistantStream();
        this.clearTransientProgress();

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

  private formatToolSummary(toolName: string, params: Record<string, any>): string {
    if (params.filePath) return String(params.filePath);
    if (params.command) return String(params.command);
    if (params.pattern) return `"${params.pattern}"`;
    if (toolName === 'list_files') return params.directoryPath ? String(params.directoryPath) : '.';
    const raw = JSON.stringify(params);
    return raw.length > 55 ? raw.slice(0, 52) + '...' : raw;
  }
}
