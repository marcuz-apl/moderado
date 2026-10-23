import { formatTokenUsage, describeActivity, wrapText } from './welcome.js';
import { AgentEvent, UsageEvent } from '@moderado/contracts';

export interface TerminalRendererOptions {
  stdout?: NodeJS.WritableStream;
  verbose?: boolean;
  isChatMode?: boolean;
}

/**
 * Body rows one log entry may occupy before the rest folds into a footer.
 *
 * A tool result used to be printed as `lines[0].slice(0, 75)`: one clipped line
 * that hid an entire payload behind “… (+37 lines)”. Five wrapped rows show
 * enough of a real output to be read while keeping the log scannable, and the
 * footer says exactly how much was left out.
 */
const LOG_ENTRY_MAX_ROWS = 5;

export class TerminalRenderer {
  private readonly stdout: NodeJS.WritableStream;
  private readonly verbose: boolean;
  private readonly isChatMode: boolean;
  private isStreamingAssistant = false;
  private hasTransientProgress = false;
  /** Latest progress sentence from the engine, shown as a short phase label. */
  private taskStatus = '';
  private sawTaskProgress = false;
  private latestUsage?: UsageEvent;
  private hasUsageTitle = false;
  private lastUsageTimestamp = -Infinity;
  /**
   * Raw engine status of the open row, or `undefined` when no row is open.
   *
   * This is the only row the renderer ever rewrites, and it is always the last
   * row on screen, so repainting it cannot destroy anything above it. Every
   * other write appends — which is what keeps the log scrollable.
   */
  private liveStatus?: string;
  /** Short display label of the open row. */
  private liveLabel?: string;
  private liveStartedAt = 0;
  /** Ticks the live row's clock while a phase runs; see startLiveClock. */
  private liveTimer?: NodeJS.Timeout;
  /** Whether the last write ended a row, so the next one starts on a clean line. */
  private atRowStart = true;

  constructor(options: TerminalRendererOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.verbose = options.verbose ?? false;
    this.isChatMode = options.isChatMode ?? false;
  }

  /** Append output, remembering whether the cursor is sitting at a row start. */
  private write(text: string): void {
    this.stdout.write(text);
    this.atRowStart = text.endsWith('\n');
  }

  /** Columns available for wrapping; a non-TTY stream reports no width. */
  private columns(): number {
    return Math.max(20, (this.stdout as NodeJS.WriteStream).columns || 80);
  }

  private elapsedLabel(): string {
    const seconds = (Date.now() - this.liveStartedAt) / 1000;
    return seconds < 1 ? '<1s' : `${Math.round(seconds)}s`;
  }

  handleEvent(event: AgentEvent): void {
    // The interactive chat command owns a full-screen frame and redraws it as
    // events arrive. Writing here would place output beneath the previous
    // welcome frame until the next prompt redraw.
    if (this.isChatMode) return;

    switch (event.type) {
      case 'usage': {
        this.latestUsage = event;
        const terminal = this.stdout as NodeJS.WriteStream;
        if (!terminal.isTTY || (!event.final && event.timestamp - this.lastUsageTimestamp < 400)) break;
        this.lastUsageTimestamp = event.timestamp;
        const text = formatTokenUsage(event).slice(0, Math.max(0, (terminal.columns || 80) - 1));
        if (this.isStreamingAssistant) {
          // Title updates cannot erase a partially written answer at the terminal bottom.
          this.stdout.write(`\x1b]0;Moderado | ${text}\x07`);
          this.hasUsageTitle = true;
        } else {
          this.write(`\r\x1b[K\x1b[38;5;244m${text}\x1b[0m`);
          this.hasTransientProgress = true;
          // The counters replaced the live row, so it is no longer ours to
          // rewrite: the next phase opens a fresh one instead of committing
          // text the reader can no longer see.
          this.liveStatus = undefined;
          this.liveLabel = undefined;
        }
        break;
      }
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
        this.write(
          `\x1b[38;5;141m● Model:\x1b[0m ${reasonText} \x1b[1;38;5;75m${event.newModelId}\x1b[0m \x1b[38;5;244m(${event.accessClass})\x1b[0m\n`
        );
        break;
      }

      case 'progress': {
        if (this.verbose) {
          this.finishAssistantStream();
          this.clearTransientProgress();
          this.write(`\x1b[38;5;244m◇ ${event.status}\x1b[0m\n`);
        } else {
          this.taskStatus = event.status;
          this.sawTaskProgress = true;
          this.paintTaskStatus();
        }
        break;
      }

      case 'reasoning_delta': {
        // Do not display internal thinking process. Keep subtle transient spinner.
        if (this.liveStatus === undefined) this.paintTaskStatus();
        break;
      }

      case 'assistant_delta': {
        this.clearTransientProgress();
        if (!this.isStreamingAssistant) {
          this.isStreamingAssistant = true;
        }
        this.stdout.write(event.delta);
        this.atRowStart = false;
        break;
      }

      case 'tool_call_initiated': {
        this.finishAssistantStream();
        this.clearTransientProgress();
        const summary = this.formatToolSummary(event.toolName, event.parameters);

        this.write(
          `\x1b[38;5;75m⏺\x1b[0m \x1b[1m${event.toolName}\x1b[0m \x1b[38;5;244m${summary}\x1b[0m\n`
        );
        break;
      }

      case 'diagnostic_result': {
        this.finishAssistantStream();
        this.clearTransientProgress();
        const visible = event.diagnostics.slice(0, 10);
        this.write(`\x1b[38;5;203mDiagnostics (exit ${event.exitCode}):\x1b[0m\n`);
        for (const diagnostic of visible) this.write(`  ${diagnostic.file ? `${diagnostic.file}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0} ` : ''}${diagnostic.code ? `${diagnostic.code} ` : ''}${diagnostic.message}\n`);
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

        // Wrap instead of clipping: the first line of a payload is rarely the
        // interesting one, and “… (+37 lines)” told the reader nothing about
        // what the agent actually saw.
        const width = Math.max(20, this.columns() - 4);
        const trimmed = event.result.output.trim();
        const rows = trimmed
          ? trimmed
              .split('\n')
              .flatMap((line) => (line.trim() ? wrapText(line, width) : ['']))
          : [];
        const shown = rows.slice(0, LOG_ENTRY_MAX_ROWS);
        const hidden = rows.length - shown.length;
        this.write(`  \x1b[38;5;240m└\x1b[0m ${statusColor}${statusIcon}\x1b[0m`);
        if (shown.length === 0) {
          this.write(` \x1b[38;5;244m(no output)\x1b[0m\n\n`);
          break;
        }
        for (const [index, row] of shown.entries()) {
          // `  └ ✔ ` is six cells, so continuation rows align under the text.
          const gutter = index === 0 ? ' ' : '      ';
          this.write(`${gutter}\x1b[38;5;244m${row}\x1b[0m\n`);
        }
        if (hidden > 0) {
          this.write(`    \x1b[38;5;240m… +${hidden} more line${hidden === 1 ? '' : 's'}\x1b[0m\n`);
        }
        this.write('\n');
        break;
      }

      case 'completion': {
        this.printUsageSummary();
        this.finishAssistantStream();
        this.clearTransientProgress();

        if (event.status === 'completed' && this.sawTaskProgress) {
          this.write(`\x1b[38;5;114m✔ Done (${event.totalSteps} ${event.totalSteps === 1 ? 'step' : 'steps'})\x1b[0m\n`);
        }
        this.sawTaskProgress = false;
        this.taskStatus = '';

        const bannerColor =
          event.status === 'completed'
            ? '\x1b[1;32m'
            : event.status === 'step_limit_reached'
            ? '\x1b[1;33m'
            : '\x1b[1;31m';
        const icon = event.status === 'completed' ? '✔' : '⚠';

        this.write(
          `\n\x1b[90m╭─────────────────────────────────────────────────────────────╮\x1b[0m\n` +
          `\x1b[90m│\x1b[0m  ${icon} ${bannerColor}=== Session Finished: ${event.status.toUpperCase()} (Total Steps: ${event.totalSteps}) ===\x1b[0m\n` +
          `\x1b[90m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n`
        );
        break;
      }

      case 'error': {
        this.printUsageSummary();
        this.finishAssistantStream();
        this.clearTransientProgress();
        this.write(`\n\x1b[1;31m✖ [Error ${event.code}]\x1b[0m ${event.message}\n`);
        break;
      }

      case 'cancellation': {
        this.printUsageSummary();
        this.finishAssistantStream();
        this.clearTransientProgress();
        this.write(`\n\x1b[1;33m⚠ [Cancelled]\x1b[0m ${event.reason}\n`);
        break;
      }

      default:
        break;
    }
  }

  private printUsageSummary(): void {
    if (this.hasUsageTitle) {
      this.stdout.write('\x1b]0;Moderado\x07');
      this.hasUsageTitle = false;
    }
    if (!this.latestUsage) return;
    this.finishAssistantStream();
    this.write(`${formatTokenUsage(this.latestUsage)}\n`);
    this.latestUsage = undefined;
  }

  private finishAssistantStream(): void {
    this.clearTransientProgress();
    if (this.isStreamingAssistant) {
      // Only add the line break the stream itself owes: committing a phase
      // already ended its row, and a second newline would print a blank line.
      if (!this.atRowStart) this.write('\n');
      this.isStreamingAssistant = false;
    }
  }

  private clearTransientProgress(): void {
    if (this.liveStatus !== undefined) {
      // The phase is over: keep it. Erasing the row (`\r\x1b[K`) is what made
      // the log unreadable — the sentence the reader was halfway through
      // vanished the moment the next phase started.
      this.commitLive();
      this.hasTransientProgress = false;
      return;
    }
    if (this.hasTransientProgress) {
      this.write('\r\x1b[K');
      this.hasTransientProgress = false;
    }
  }

  /**
   * Finalise the live row in place and close it, so it becomes scrollback.
   *
   * The row is repainted with its settled glyph and elapsed time and then a
   * newline pushes it up. Nothing above it is touched, so the terminal's own
   * scrollback — the mouse wheel, the slider, PgUp — reaches every phase the
   * agent went through.
   */
  private commitLive(): void {
    if (this.liveStatus === undefined) return;
    this.write(`\r\x1b[K\x1b[38;5;245m✔ ${this.liveLabel} · ${this.elapsedLabel()}\x1b[0m\n`);
    this.liveStatus = undefined;
    this.liveLabel = undefined;
    this.stopLiveClock();
  }

  /**
   * Transient single-line progress, kept live on the last row only.
   *
   * The engine's step counter is deliberately not printed: `Step 1/25` stayed
   * true for minutes while one inference ran, so it described the engine's loop
   * rather than anything the reader could use.
   */
  private paintTaskStatus(): void {
    const status = this.taskStatus || 'Working';
    const label = describeActivity(status);
    // A new engine phase commits the previous row first, so the log grows
    // instead of being overwritten — this is the whole difference between a
    // one-line spinner and a readable, scrollable activity log. Two phases that
    // map to the same short label ("Inferring…" and "Inferring next action…")
    // are still two rows, because the reader is following the work, not the
    // label.
    if (this.liveStatus !== status) {
      this.commitLive();
      this.liveStatus = status;
      this.liveLabel = label;
      this.liveStartedAt = Date.now();
    }
    this.write(`\r\x1b[K\x1b[38;5;245m⠋ ${label} · ${this.elapsedLabel()}\x1b[0m`);
    this.hasTransientProgress = true;
    this.startLiveClock();
  }

  /**
   * Keep the live row's clock moving while a phase runs.
   *
   * One inference can run for minutes with no event of any kind, and a row
   * frozen at `· 0s` reads as a hang. The timer is unref'd so it can never hold
   * the process open, and it stops the moment the row is committed.
   */
  private startLiveClock(): void {
    if (this.liveTimer || !(this.stdout as NodeJS.WriteStream).isTTY) return;
    this.liveTimer = setInterval(() => {
      if (this.liveStatus === undefined) { this.stopLiveClock(); return; }
      this.paintTaskStatus();
    }, 1000);
    this.liveTimer.unref?.();
  }

  private stopLiveClock(): void {
    if (!this.liveTimer) return;
    clearInterval(this.liveTimer);
    this.liveTimer = undefined;
  }

  /** Release the live-row timer; safe to call more than once. */
  dispose(): void {
    this.stopLiveClock();
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
