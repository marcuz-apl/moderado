/**
 * The interactive composer: raw-mode keypress handling, the prompt line, the
 * suggestion and mention boxes, popup delegation, and history navigation.
 *
 * Split out of `ui/welcome.ts`, which now owns only layout and painting.
 */
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import type { UsageEvent } from '@moderado/contracts';
import { activeMentionToken, filterMentionCandidates } from './file_mentions.js';
import {
  KEY_MODIFIER_REPORT_OFF,
  KEY_MODIFIER_REPORT_ON,
  MOUSE_REPORT_OFF,
  MOUSE_REPORT_ON,
  MOUSE_REPORT_PATTERN,
  composerCaretIndex,
  composerView,
  exitCleanly,
  getChatComposerRows,
  getChatLayout,
  getChatCardWidth,
  getComposerInputMaxRows,
  getMatchingCommands,
  getWelcomeBottomPadding,
  getWelcomeCardWidth,
  getWelcomeIndent,
  navigateQuestionHistory,
  renderCenteredWelcomeScreen,
  renderFullWelcomeScreen,
  renderHelpPopupBox,
  renderAboutPopupBox,
  renderWelcomePopupLayer,
  windowChatTranscriptAt,
  buildChatTranscriptRows,
  chatTranscriptOffsetForRow,
  getChatTranscriptWidth,
} from './welcome.js';
import type { ChatActivityBlock, ChatHistoryTurn, WelcomeLayoutOptions } from './welcome.js';

async function animateChatWordmark(stdout: NodeJS.WriteStream): Promise<void> {
  const wordmark = 'MODERADO';
  const frames = 6;
  for (let frame = 0; frame <= frames; frame += 1) {
    const columns = stdout.columns || 80;
    const rows = stdout.rows || 24;
    const width = Math.min(columns, wordmark.length);
    const startColumn = Math.max(1, Math.floor((columns - width) / 2) + 1);
    const endColumn = Math.max(1, columns - width + 1);
    const progress = frame / frames;
    const column = Math.round(startColumn + (endColumn - startColumn) * progress);
    const startRow = Math.max(1, Math.floor(rows / 2) - 5);
    const row = Math.round(startRow + (1 - startRow) * progress);
    stdout.write(`\x1b[H\x1b[J\x1b[${row};${column}H\x1b[1;38;5;75m${wordmark.slice(0, width)}\x1b[0m`);
    if (frame < frames) await new Promise<void>((resolve) => setTimeout(resolve, 30));
  }
}


/**
 * Open a file in the user's pager. Returns false when no pager could be run, so
 * the caller can print the path instead of pretending something was shown.
 */
function openInPager(file: string): boolean {
  const configured = process.env.PAGER?.trim();
  const command = configured
    ? configured.split(/\s+/).filter(Boolean)
    : process.platform === 'win32' ? [] : ['less', '-R'];
  if (command.length === 0) return false;
  const result = spawnSync(command[0], [...command.slice(1), file], { stdio: 'inherit' });
  return !result.error;
}

export interface InteractiveTurnResult {
  text: string;
  mode: 'Plan' | 'Execute';
  autoApprove: boolean;
  workflowAction?: 'build';
}

export interface PromptInteractiveTurnOptions {
  model: string;
  getProviderName?: () => string | undefined;
  tokens: number;
  cost: string;
  usageAvailable?: boolean;
  usageEstimated?: boolean;
  workspace: string;
  version?: string;
  initialMode?: 'Plan' | 'Execute';
  initialAutoApprove?: boolean;
  isFirstTurn?: boolean;
  signal?: AbortSignal;
  /** Previous turn's question/answer — when question is set, render the full chat window (no logo). */
  chatQuestion?: string;
  chatAnswer?: string;
  chatHistory?: readonly ChatHistoryTurn[];
  chatThoughtTime?: number;
  chatTaskDone?: boolean;
  outputTokenRate?: number;
  tokenUsage?: UsageEvent;
  questionHistory?: string[];
  /**
   * Called whenever the transcript is scrolled, with the new offset measured in
   * rows up from the tail (0 is the live view).
   *
   * The turn loop paints the transcript on every streamed delta, so without
   * this it would repaint at offset 0 and drag a reader who scrolled up back to
   * the bottom mid-sentence. The offset is the composer's; the loop only needs
   * to be told when it changes.
   */
  onTranscriptScroll?: (offset: number) => void;
  /**
   * Live activity for the turn that is running right now.
   *
   * The composer owns the scroll position, so it also owns the scroll range —
   * and the range has to cover the activity log as well as the answer, because
   * the two are one transcript. The turn loop holds the activity; this is how
   * the composer reads it without the two sharing mutable state.
   */
  getChatActivity?: () => ChatActivityBlock | undefined;
  /**
   * Called when user selects a model via /model. Receives a `drawFrame`
   * callback that composites popup content as a floating layer on top of the
   * main TUI window (background stays as-is). The callback owns the selection
   * UI and returns the new model id, or undefined if cancelled.
   */
  onModelSelect?: (drawFrame: (popupLines: string[]) => void) => Promise<string | undefined>;
  /** Returns a queued prompt that should start immediately after a popup closes. */
  takeAutoContinuePrompt?: () => string | undefined;
  /** Called when user issues /connect. Returns the model label to display. */
  onConnect?: (drawFrame: (popupLines: string[]) => void) => Promise<string | undefined>;
  /** Called when user issues /clear so caller can reset conversation history. */
  onClear?: () => void;
  onExit?: () => string;
  onMcp?: (command: string, drawFrame: (popupLines: string[]) => void) => Promise<void>;
  onSession?: (command: string, drawFrame: (popupLines: string[]) => void) => Promise<void>;
  /**
   * Called for /transcript. Writes the whole conversation to a file and returns
   * its path, which the composer then opens in the pager.
   */
  onTranscript?: () => Promise<string | undefined>;
  onQueue?: (command: string, drawFrame: (popupLines: string[]) => void) => Promise<void>;
  onBtw?: (
    command: string,
    drawFrame: (popupLines: string[], options?: { waitDismiss?: boolean }) => void | Promise<void>,
    signal?: AbortSignal
  ) => Promise<void>;
  onWorkflow?: (command: string, drawFrame: (popupLines: string[]) => void) => Promise<'build' | undefined>;
  onInit?: (drawFrame: (popupLines: string[]) => void) => Promise<void>;
  onMentionComplete?: (token: string) => Promise<string[]>;
  queuedCommands?: readonly string[];
}

function isMcpCommandInput(value: string): boolean {
  const command = value.trim();
  return command === '/mcp' || command.startsWith('/mcp ');
}

/**
 * Modified keys the terminal reports as escape sequences once XTMODKEYS is on:
 * `CSI 27;modifier;key~` (xterm family) or `CSI key;modifier u` (kitty
 * protocol). readline decodes those byte by byte, so the raw chunk is matched
 * here instead and the derived keypresses are dropped.
 */
const MODIFIED_KEY_PATTERN = /\x1b\[(?:27;(\d+);(\d+)~|(\d+);(\d+)u)/;

function decodeModifiedKey(text: string): 'newline' | 'toggle-auto-approve' | 'cancel' | undefined {
  const match = MODIFIED_KEY_PATTERN.exec(text);
  if (!match) return undefined;
  const modifier = Number(match[1] ?? match[4]);
  const keyCode = Number(match[2] ?? match[3]);
  const bits = modifier - 1; // 1 = Shift, 2 = Alt, 4 = Ctrl
  if (keyCode === 13 && (bits & 1)) return 'newline';
  if (keyCode === 9 && (bits & 1)) return 'toggle-auto-approve';
  if (keyCode === 99 && (bits & 4)) return 'cancel';
  return undefined;
}

export async function promptInteractiveTurn(
  options: PromptInteractiveTurnOptions
): Promise<InteractiveTurnResult> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  let currentModel = options.model;
  let currentMode: 'Plan' | 'Execute' = options.initialMode ?? 'Execute';
  let currentAutoApprove = options.initialAutoApprove ?? true;
  let input = '';
  /** Caret index inside `input` (0 .. input.length) - the composer is editable. */
  let caret = 0;
  /** True while keypress events derived from a mouse report are being dropped. */
  let ignoreComposerKeypress = false;
  /** Terminal height, with the same fallback the renderer uses. */
  const getRows = (): number => stdout.rows || 24;
  let commandSelection = 0;
  const questionHistory = options.questionHistory ?? [];
  let questionHistoryIndex = questionHistory.length;
  let questionHistoryDraft = '';
  let cachedFiles: string[] = [];
  if (options.onMentionComplete) {
    Promise.resolve(options.onMentionComplete('')).then((files) => {
      cachedFiles = Array.isArray(files) ? files : [];
      updateMentions();
    }).catch(() => { cachedFiles = []; });
  }
  let mentionFiles: string[] = [];
  let mentionSelection = 0;
  /**
   * Rows the answer is scrolled up from its tail. 0 follows the newest line;
   * PgUp/PgDn and the mouse wheel move it, and every new turn starts at 0.
   */
  let answerOffset = 0;

  const updateMentions = (): void => {
    const mention = activeMentionToken(input, caret);
    if (mention && cachedFiles.length > 0) {
      mentionFiles = filterMentionCandidates(cachedFiles, mention.token, 5);
      mentionSelection = Math.min(mentionSelection, Math.max(0, mentionFiles.length - 1));
    } else {
      mentionFiles = [];
      mentionSelection = 0;
    }
  };



  /** Replace the composer text, leaving the caret at the end of the new value. */
  const setInput = (value: string): void => {
    input = value;
    caret = value.length;
  };

  const getOptions = (): WelcomeLayoutOptions => ({
    model: currentModel,
    provider: options.getProviderName?.(),
    tokens: options.tokens,
    cost: options.cost,
    usageAvailable: options.usageAvailable,
    usageEstimated: options.usageEstimated,
    workspace: options.workspace,
    mode: currentMode,
    autoApprove: currentAutoApprove,
    input,
    inputCaret: caret,
    commandSelection,
    chatQuestion: options.chatQuestion,
    chatAnswer: options.chatAnswer,
    chatHistory: options.chatHistory,
    chatAnswerOffset: answerOffset,
    // Live activity for the running turn, so a composer-driven repaint shows
    // the transcript the loop is painting rather than an empty answer area.
    chatActivity: options.getChatActivity?.(),
    chatThoughtTime: options.chatThoughtTime,
    chatTaskDone: options.chatTaskDone,
    outputTokenRate: options.outputTokenRate,
    tokenUsage: options.tokenUsage,
    queuedCommands: options.queuedCommands,
    // The @ completion list lives in the card, so the composer must be told
    // about it — without these the keypress handler maintained a selection that
    // was never painted.
    mentionFiles,
    mentionSelection,
    isTurnSettled: true,
  });

  // ── Non-TTY fallback ──────────────────────────────────────────────────────
  if (!stdin.isTTY) {
    stdout.write('\x1b]0;Moderado\x07');
    stdout.write(renderFullWelcomeScreen(getOptions()));
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question('\x1b[1;38;5;75m❯\x1b[0m ', (answer) => {
        rl.close();
        resolve({ text: answer.trim(), mode: currentMode, autoApprove: currentAutoApprove });
      });
    });
  }

  // ── TTY Interactive Loop ───────────────────────────────────────────────────
  readline.emitKeypressEvents(stdin);
  // A previous turn's cleanup() pauses stdin — resume it so keystrokes keep
  // flowing after an answer (the main app must never appear dead post-answer).
  stdin.resume();
  stdin.setRawMode(true);

  const getExtraLines = () => mentionFiles.length > 0 ? mentionFiles.length + 2 : 0;

  /** Columns of the card the input is painted in. */
  const getCardWidth = (): number => getOptions().chatQuestion !== undefined
    ? getChatCardWidth(stdout.columns)
    : getWelcomeCardWidth(stdout.columns);

  /** Painted rows of the input box plus where the caret sits in them. */
  const getInputView = () => composerView(input, caret, getCardWidth(), getComposerInputMaxRows(getRows()));

  /** Rows between the input's first row and the terminal's last row. */
  const getComposerOffset = (): number =>
    getWelcomeBottomPadding(getOptions(), getRows()) + 3 + getInputView().rows.length + getExtraLines();

  /** Screen row and 1-based column of the caret's cell in the input box. */
  const getComposerAnchor = (caretRow = getInputView().caretRow): { row: number; column: number } => {
    const options = getOptions();
    const column = getWelcomeIndent(getCardWidth(), stdout.columns) + 3;
    if (options.chatQuestion !== undefined) {
      // Chat frames place the composer at a computed row. Measure the card that
      // is actually painted — a queued-commands box or a wrapped prompt makes it
      // taller — so the caret never lands on the mode row or inside the box.
      const layout = getChatLayout(stdout.columns, getRows(), options.chatQuestion, getChatComposerRows(options));
      return { row: layout.composerTop + 1 + caretRow, column };
    }
    return { row: getRows() - getComposerOffset() + caretRow, column };
  };


  /**
   * Move cursor to the ❯ input line (Line 2 inside the centered card).
   * Absolute addressing (`row;column H`) works no matter where the cursor
   * currently sits — relative "move up N" escapes the input line when
   * pressed repeatedly, e.g. browsing history with Left/Right.
   */
  const positionCursorOnInput = () => {
    const view = getInputView();
    const { row, column } = getComposerAnchor(view.caretRow);
    stdout.write(`\x1b[1 q\x1b[?25h\x1b[${row};${column + view.caretColumn}H`);
  };

  /** Full-screen redraw: clear everything, repaint welcome TUI, reposition cursor. */
  const redrawFull = () => {
    stdout.write('\x1b[H\x1b[J');
    stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
    positionCursorOnInput();
  };

  /** Repaint the welcome view so it remains centered after every edit or resize. */
  const redrawCard = () => {
    redrawFull();
  };

  const onResize = () => redrawFull();

  /** Layout of the chat frame as it is painted right now. */
  const currentChatLayout = () => getChatLayout(
    stdout.columns,
    getRows(),
    options.chatQuestion ?? '',
    getChatComposerRows(getOptions()),
  );

  /**
   * How many rows of transcript sit above the tail view — the scroll range.
   *
   * The range covers the whole transcript, not just the answer: the activity log
   * and the answer are one list, so scrolling up reaches what the agent did as
   * well as what it said.
   */
  const answerScrollLimit = (): number => {
    const answer = options.chatAnswer;
    const activity = options.getChatActivity?.();
    if ((!answer || answer.trim().length === 0) && !activity) return 0;
    const layout = currentChatLayout();
    if (layout.answerRows <= 0) return 0;
    return windowChatTranscriptAt(
      buildChatTranscriptRows(activity, answer ?? '', getChatTranscriptWidth(layout), options.chatHistory, options.chatQuestion).rows,
      layout.answerRows,
      0,
    ).hiddenAbove;
  };

  /**
   * Move the transcript view; positive scrolls up towards older lines.
   *
   * A long turn is taller than the transcript area, so the tail view hides its
   * opening rows. This is the way back: the whole turn stays in the buffer, the
   * status row reports the position, and the turn loop is told so its next
   * incremental paint does not yank the reader back to the bottom.
   */
  const scrollAnswer = (delta: number): void => {
    const limit = answerScrollLimit();
    if (limit <= 0) return;
    const next = Math.max(0, Math.min(limit, answerOffset + delta));
    if (next === answerOffset) return;
    answerOffset = next;
    options.onTranscriptScroll?.(next);
    redrawFull();
  };

  const jumpAnswerToRow = (row: number): void => {
    const layout = currentChatLayout();
    const rows = buildChatTranscriptRows(options.getChatActivity?.(), options.chatAnswer ?? '', getChatTranscriptWidth(layout), options.chatHistory, options.chatQuestion).rows;
    if (rows.length <= layout.answerRows) return;
    const next = chatTranscriptOffsetForRow(rows.length, layout.answerRows, row);
    if (next === answerOffset) return;
    answerOffset = next;
    options.onTranscriptScroll?.(next);
    redrawFull();
  };

  /** One page is one screenful of answer rows, minus the overflow note. */
  const answerPage = (): number => Math.max(1, currentChatLayout().answerRows - 1);

  /** Insert a line break at the caret — Shift+Enter and Ctrl+J land here. */
  const insertLineFeed = (): void => {
    input = input.slice(0, caret) + '\n' + input.slice(caret);
    caret += 1;
    commandSelection = 0;
    questionHistoryIndex = questionHistory.length;
    updateMentions();
    redrawCard();
  };

  /** Toggle Plan/Execute; kept callable from a decoded escape sequence too. */
  const toggleMode = (): void => {
    currentMode = currentMode === 'Plan' ? 'Execute' : 'Plan';
    redrawCard();
  };

  /**
   * Cancel the session from a decoded escape sequence (Ctrl+C reported as a
   * modified key). Assigned once the cleanup path exists.
   */
  let cancelSession = (): void => {};

  /**
   * Place the caret where the user clicked inside the input box. Only a primary
   * press is honoured; releases, drags, wheel and other buttons are ignored.
   */
  const onComposerData = (chunk: string | Buffer): void => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let reported = false;
    // Shift+Enter arrives as one of these sequences once the terminal reports
    // modified keys; readline would otherwise type it out as literal garbage.
    const modified = decodeModifiedKey(text);
    if (modified === 'newline') insertLineFeed();
    else if (modified === 'toggle-auto-approve') toggleMode();
    else if (modified === 'cancel') cancelSession();
    if (modified) reported = true;

    for (const report of text.matchAll(MOUSE_REPORT_PATTERN)) {
      reported = true;
      // Wheel up (64) / down (65): three rows a notch, like every other pager.
      if (report[4] === 'M' && (Number(report[1]) === 64 || Number(report[1]) === 65)) {
        scrollAnswer(Number(report[1]) === 64 ? 3 : -3);
        continue;
      }
      if (report[4] !== 'M' || Number(report[1]) !== 0) continue;
      if (options.chatQuestion !== undefined) {
        const layout = currentChatLayout();
        const scrollbarColumn = layout.area.startColumn + getChatTranscriptWidth(layout);
        const clickedRow = Number(report[3]) - layout.answerTop;
        if (Number(report[2]) === scrollbarColumn && clickedRow >= 0 && clickedRow < layout.answerRows) {
          jumpAnswerToRow(clickedRow);
          continue;
        }
      }
      const view = getInputView();
      const { row, column } = getComposerAnchor(0);
      const rowOffset = Number(report[3]) - row;
      if (rowOffset < 0 || rowOffset >= view.rows.length) continue;
      caret = composerCaretIndex(input, view.rows, rowOffset, Number(report[2]) - column);
      positionCursorOnInput();
    }
    if (reported) {
      // readline turns the same bytes into keypress events ("0", ";", "5", "M").
      ignoreComposerKeypress = true;
      setImmediate(() => { ignoreComposerKeypress = false; });
    }
  };
  // Registered before readline's decoder so a report is consumed before it is
  // mistaken for typed text.
  stdin.prependListener('data', onComposerData);
  stdout.on('resize', onResize);

  // Initial paint
  if (options.isFirstTurn) {
    stdout.write('\x1b]0;Moderado\x07');
    stdout.write('\x1b[2J\x1b[3J\x1b[H');
  } else {
    // After an AI response the screen has content below — clear and repaint the full TUI.
    stdout.write('\x1b[H\x1b[J');
  }
  stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
  positionCursorOnInput();

  return new Promise((resolve) => {
    const cleanup = () => {
      unbindComposerInput();
      stdin.removeListener('data', onComposerData);
      stdout.removeListener('resize', onResize);
      stdout.write(`${KEY_MODIFIER_REPORT_OFF}${MOUSE_REPORT_OFF}\x1b[0 q\x1b[?25h`);
      if (stdin.isTTY) {
        try { stdin.setRawMode(false); } catch { /* ignore */ }
      }
      try { stdin.pause(); } catch { /* ignore */ }
    };

    cancelSession = () => {
      cleanup();
      void exitCleanly('\x1b[33mSession cancelled.\x1b[0m');
    };

    const onAbort = () => {
      cleanup();
      resolve({ text: '', mode: currentMode, autoApprove: currentAutoApprove });
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    // ── Async keypress handler ────────────────────────────────────────────────
    // Using a void async IIFE so we can await async operations (model selector)
    // inside a synchronous event listener.  For any async branch we first
    // remove ourselves from stdin so no duplicate events fire during the await.
    const onKeypress = (str: string, key: any) => {
      void (async () => {

        // Keystrokes decoded from a mouse report were already handled above.
        if (ignoreComposerKeypress) return;

        // Intercept XTMODKEYS modified keys that readline cannot decode.
        // The raw byte chunk `str` carries the escape sequence (e.g. CSI 27;1;13~
        // for Shift+Enter); readline decodes those byte-by-byte and drops them,
        // so we match the pattern directly and derive the keypress ourselves.
        const modified = decodeModifiedKey(str);
        if (modified === 'newline') {
          insertLineFeed();
          return;
        }
        if (modified === 'toggle-auto-approve') {
          currentAutoApprove = !currentAutoApprove;
          redrawCard();
          return;
        }
        if (modified === 'cancel') {
          cleanup();
          return await exitCleanly('\\x1b[33mSession cancelled.\\x1b[0m');
        }

        // Enter submits; a line feed (Ctrl+J, or Shift+Enter where the terminal
        // reports it) breaks the line instead.
        const isEnter = Boolean(key) && (key.name === 'return' || key.name === 'enter');
        const isLineFeed = isEnter && (key.shift === true || key.meta === true || key.ctrl === true);
        const isSubmit = isEnter && !isLineFeed;

        if (options.signal?.aborted) {
          cleanup();
          resolve({ text: '', mode: currentMode, autoApprove: currentAutoApprove });
          return;
        }

        // ── Ctrl+C ────────────────────────────────────────────────────────────
        if (key && key.ctrl && key.name === 'c') {
          cleanup();
          return await exitCleanly('\x1b[33mSession cancelled.\x1b[0m');
        }

        // ── Answer scrollback ─────────────────────────────────────────────────
        // PgUp/PgDn browse the answer without leaving the composer. The turn
        // summary is often taller than the answer area, and the terminal's own
        // scrollback is not available to a full-screen TUI.
        if (key && (key.name === 'pageup' || key.name === 'pagedown')) {
          scrollAnswer(key.name === 'pageup' ? answerPage() : -answerPage());
          return;
        }

        // ── /help overlay popup ───────────────────────────────────────────────
        // Triggered when Enter is pressed with "/help" already in the input box.
        // We keep the main TUI as background and layer the help box on top.
        if (isSubmit && input.trim() === '/help') {
          setInput('');
          unbindComposerInput(); // pause main handler

          // Paint: full welcome TUI (background) + help box on top
          const helpLines = renderHelpPopupBox(options.version ?? 'v0.1', options.workspace);
          const paintHelp = (): void => {
            stdout.write('\x1b[H\x1b[J');
            stdout.write(renderWelcomePopupLayer(getOptions(), helpLines, stdout.columns, stdout.rows));
          };
          // The composer's own resize repaint clears the box off screen, so the
          // overlay has to repaint itself at the new geometry.
          const onHelpResize = (): void => paintHelp();
          stdout.on('resize', onHelpResize);
          paintHelp();

          // Wait for Esc / Enter / q to dismiss
          await new Promise<void>((dismissResolve) => {
            const onDismiss = (s: string, k: any) => {
              if (
                (k && (k.name === 'escape' || k.name === 'return' || k.name === 'enter')) ||
                s === 'q' || s === 'Q' ||
                (k && k.ctrl && k.name === 'c')
              ) {
                stdin.removeListener('keypress', onDismiss);
                stdout.removeListener('resize', onHelpResize);
                dismissResolve();
              }
            };
            stdin.on('keypress', onDismiss);
          });

          // Restore: repaint the full welcome TUI, show cursor, position on input line
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();

          bindComposerInput(); // re-attach main handler
          return;
        }

        // ── /about overlay popup ──────────────────────────────────────────────
        // Triggered when Enter is pressed with "/about" already in the input box.
        if (isSubmit && input.trim() === '/about') {
          setInput('');
          unbindComposerInput();

          const aboutLines = renderAboutPopupBox(options.version ?? 'v0.1');
          const paintAbout = (): void => {
            stdout.write('\x1b[H\x1b[J');
            stdout.write(renderWelcomePopupLayer(getOptions(), aboutLines, stdout.columns, stdout.rows));
          };
          const onAboutResize = (): void => paintAbout();
          stdout.on('resize', onAboutResize);
          paintAbout();

          await new Promise<void>((dismissResolve) => {
            const onDismiss = (s: string, k: any) => {
              if (
                (k && (k.name === 'escape' || k.name === 'return' || k.name === 'enter')) ||
                s === 'q' || s === 'Q' ||
                (k && k.ctrl && k.name === 'c')
              ) {
                stdin.removeListener('keypress', onDismiss);
                stdout.removeListener('resize', onAboutResize);
                dismissResolve();
              }
            };
            stdin.on('keypress', onDismiss);
          });

          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();
          bindComposerInput();
          return;
        }

        // ── /model overlay popup ──────────────────────────────────────────────
        // Triggered when Enter is pressed with "/model" in the input box.
        // We temporarily detach the main keypress listener and hand the model
        // selector a drawFrame callback. drawFrame repaints the background TUI
        // exactly as-is and composites the popup content as a centered floating
        // layer on top of it (Cline/OpenCode style) — the popup never scrolls
        // the background because every step redraws the whole frame.
        // After it returns, we repaint the full welcome TUI and reposition cursor.
        if (isSubmit && input.trim() === '/model') {
          setInput('');
          unbindComposerInput(); // pause main handler

          if (options.onModelSelect) {
            const drawFrame = (popupLines: string[]): void => {
              stdout.write('\x1b[H\x1b[J');
              stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
            };
            const newId = await options.onModelSelect(drawFrame);
            if (newId && newId !== currentModel) {
              currentModel = newId;
            }
            const autoContinuePrompt = options.takeAutoContinuePrompt?.();
            if (autoContinuePrompt) {
              options.signal?.removeEventListener('abort', onAbort);
              cleanup();
              resolve({ text: autoContinuePrompt, mode: currentMode, autoApprove: currentAutoApprove });
              return;
            }
          }

          // Selection flow left stdin in non-raw mode — restore it for our TUI
          readline.emitKeypressEvents(stdin);
          stdin.resume();
          stdin.setRawMode(true);
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();

          bindComposerInput(); // re-attach main handler
          return;
        }

        if (isSubmit && input.trim() === '/connect') {
          setInput('');
          unbindComposerInput();

          const drawFrame = (popupLines: string[]): void => {
            stdout.write('\x1b[H\x1b[J');
            stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
          };

          if (options.onConnect) {
            const newModel = await options.onConnect(drawFrame);
            if (newModel) currentModel = newModel;
          }

          readline.emitKeypressEvents(stdin);
          stdin.resume();
          stdin.setRawMode(true);
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();
          bindComposerInput();
          return;
        }

        if (isSubmit && input.trim() === '/transcript') {
          setInput('');
          unbindComposerInput();
          stdout.write('\x1b[H\x1b[J');
          const file = await options.onTranscript?.();
          if (file) {
            // The pager needs the terminal in cooked mode and no mouse reporting;
            // both are process state, so they are restored before repainting.
            try { stdin.setRawMode(false); } catch { /* ignore */ }
            stdout.write(MOUSE_REPORT_OFF);
            const opened = openInPager(file);
            stdout.write(MOUSE_REPORT_ON);
            try { stdin.setRawMode(true); } catch { /* ignore */ }
            if (!opened) stdout.write(`\x1b[38;5;244mTranscript written to ${file}\x1b[0m\n`);
          } else {
            stdout.write('\x1b[38;5;244mNo transcript to show yet — finish a turn first.\x1b[0m\n');
          }
          readline.emitKeypressEvents(stdin);
          stdin.resume();
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();
          bindComposerInput();
          return;
        }

        if (isSubmit && input.trim().startsWith('/session')) {
          const command = input.trim();
          setInput('');
          unbindComposerInput();
          if (options.onSession) {
            await options.onSession(command, (popupLines) => {
              stdout.write('\x1b[H\x1b[J');
              stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
            });
          }
          const autoContinuePrompt = options.takeAutoContinuePrompt?.();
          if (autoContinuePrompt) {
            options.signal?.removeEventListener('abort', onAbort);
            cleanup();
            resolve({ text: autoContinuePrompt, mode: currentMode, autoApprove: currentAutoApprove });
            return;
          }
          readline.emitKeypressEvents(stdin);
          stdin.resume();
          stdin.setRawMode(true);
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();
          bindComposerInput();
          return;
        }

        if (isSubmit && input.trim().startsWith('/queue')) {
          const command = input.trim();
          setInput('');
          unbindComposerInput();
          if (options.onQueue) {
            await options.onQueue(command, async (popupLines) => {
              stdout.write('\x1b[H\x1b[J');
              stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
              await new Promise<void>((dismissResolve) => {
                const onDismiss = (s: string, k: any) => {
                  if (
                    (k && (k.name === 'escape' || k.name === 'return' || k.name === 'enter')) ||
                    s === 'q' || s === 'Q' || s === '\x1b'
                  ) {
                    stdin.removeListener('keypress', onDismiss);
                    dismissResolve();
                  }
                };
                stdin.on('keypress', onDismiss);
              });
            });
          }
          readline.emitKeypressEvents(stdin);
          stdin.resume();
          stdin.setRawMode(true);
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();
          bindComposerInput();
          return;
        }

        if (isSubmit && input.trim().startsWith('/btw')) {
          const command = input.trim();
          setInput('');
          unbindComposerInput();
          if (options.onBtw) {
            const ac = new AbortController();
            const onBtwKey = (s: string, k: any) => {
              if ((k && k.name === 'escape') || s === '\x1b') {
                ac.abort();
              }
            };
            stdin.on('keypress', onBtwKey);

            try {
              await options.onBtw(command, async (popupLines, frameOpts) => {
                stdout.write('\x1b[H\x1b[J');
                stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
                if (frameOpts?.waitDismiss !== false && !ac.signal.aborted) {
                  await new Promise<void>((dismissResolve) => {
                    const onDismiss = (s: string, k: any) => {
                      if (
                        (k && (k.name === 'escape' || k.name === 'return' || k.name === 'enter')) ||
                        s === 'q' || s === 'Q' || s === '\x1b'
                      ) {
                        stdin.removeListener('keypress', onDismiss);
                        dismissResolve();
                      }
                    };
                    stdin.on('keypress', onDismiss);
                  });
                }
              }, ac.signal);
            } finally {
              stdin.removeListener('keypress', onBtwKey);
            }
          }
          readline.emitKeypressEvents(stdin);
          stdin.resume();
          stdin.setRawMode(true);
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();
          bindComposerInput();
          return;
        }

        if (isSubmit && isMcpCommandInput(input)) {
          const command = input.trim();
          setInput('');
          unbindComposerInput();
          if (options.onMcp) {
            await options.onMcp(command, (popupLines) => {
              stdout.write('\x1b[H\x1b[J');
              stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
            });
          }
          if (options.signal?.aborted) return;
          readline.emitKeypressEvents(stdin);
          stdin.resume();
          stdin.setRawMode(true);
          redrawFull();
          bindComposerInput();
          return;
        }

        if (isSubmit && input.trim() === '/init') {
          setInput('');
          unbindComposerInput();
          if (options.onInit) {
            await options.onInit((popupLines) => {
              stdout.write('\x1b[H\x1b[J');
              stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
            });
          }
          if (options.signal?.aborted) return;
          readline.emitKeypressEvents(stdin);
          stdin.resume();
          stdin.setRawMode(true);
          redrawFull();
          bindComposerInput();
          return;
        }

        if (isSubmit && input.trim().startsWith('/workflow')) {
          const command = input.trim(); setInput(''); unbindComposerInput();
          const action = options.onWorkflow ? await options.onWorkflow(command, (popupLines) => { stdout.write('\x1b[H\x1b[J'); stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows)); }) : undefined;
          if (action === 'build') { cleanup(); resolve({ text: '', mode: 'Execute', autoApprove: currentAutoApprove, workflowAction: 'build' }); return; }
          readline.emitKeypressEvents(stdin); stdin.resume(); stdin.setRawMode(true); redrawFull(); bindComposerInput(); return;
        }


        // ── /clear ────────────────────────────────────────────────────────────
        if (isSubmit && input.trim() === '/clear') {
          setInput('');
          options.onClear?.();
          redrawFull();
          return;
        }

        // ── /exit ─────────────────────────────────────────────────────────────
        if (isSubmit &&
            (input.trim() === '/exit' || input.trim() === '/quit')) {
          cleanup();
          if (options.signal) options.signal.removeEventListener('abort', onAbort);
          return await exitCleanly(options.onExit?.() ?? '\x1b[32mGoodbye! Stay Tuned with Moderado!\x1b[0m');
        }

        // ── Normal keys ───────────────────────────────────────────────────────
        if (!key) {
          if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
            input = input.slice(0, caret) + str + input.slice(caret);
            caret += 1;
            updateMentions();
            redrawCard();
          }
          return;
        }

        // Shift+Tab — toggle auto-approve
        if ((key.name === 'tab' && key.shift) || key.sequence === '\x1b[Z') {
          currentAutoApprove = !currentAutoApprove;
          redrawCard();
          return;
        }

        // Tab — autocomplete mention, autocomplete slash command or toggle mode
        if (key.name === 'tab' && !key.shift) {
          const mention = activeMentionToken(input, caret);
          if (mention && mentionFiles.length > 0) {
            const chosen = mentionFiles[Math.min(mentionSelection, mentionFiles.length - 1)];
            const before = input.slice(0, mention.start);
            const after = input.slice(caret);
            const insert = `@${chosen} `;
            input = before + insert + after;
            caret = before.length + insert.length;
            updateMentions();
            redrawCard();
            return;
          }
          if (input.startsWith('/')) {
            const matching = getMatchingCommands(input);
            if (matching.length > 0) {
              setInput(matching[Math.min(commandSelection, matching.length - 1)].name);
              commandSelection = 0;
              redrawCard();
              return;
            }
          }
          currentMode = currentMode === 'Plan' ? 'Execute' : 'Plan';
          redrawCard();
          return;
        }

        if (mentionFiles.length > 0 && (key.name === 'up' || key.name === 'down')) {
          mentionSelection = ((mentionSelection + (key.name === 'up' ? -1 : 1)) % mentionFiles.length + mentionFiles.length) % mentionFiles.length;
          redrawCard();
          return;
        }

        if (input.startsWith('/') && (key.name === 'up' || key.name === 'down')) {
          const matching = getMatchingCommands(input);
          if (matching.length > 0) {
            commandSelection = ((commandSelection + (key.name === 'up' ? -1 : 1)) % matching.length + matching.length) % matching.length;
            redrawCard();
            return;
          }
        }

        if (!input.startsWith('/') && (key.name === 'up' || key.name === 'down') && questionHistory.length > 0) {
          if (questionHistoryIndex === questionHistory.length) questionHistoryDraft = input;
          const recalled = navigateQuestionHistory(questionHistory, key.name === 'up' ? -1 : 1, questionHistoryIndex, questionHistoryDraft);
          setInput(recalled.input);
          questionHistoryIndex = recalled.index;
          redrawCard();
          return;
        }

        // Enter — submit real user message
        if (isLineFeed) {
          insertLineFeed();
          return;
        }

        if (isSubmit) {
          const matching = getMatchingCommands(input);
          if (input.startsWith('/') && matching.length > 0 && !matching.some((command) => command.name === input.trim())) {
            setInput(matching[Math.min(commandSelection, matching.length - 1)].name);
            commandSelection = 0;
            redrawCard();
            return;
          }
          const trimmed = input.trim();
          const animateFirstChat = options.chatQuestion === undefined && trimmed.length > 0;
          cleanup();
          if (options.signal) options.signal.removeEventListener('abort', onAbort);
          if (animateFirstChat) await animateChatWordmark(stdout as NodeJS.WriteStream);
          // Move past the rows below the caret's row, so the frame that follows
          // starts under the card however tall the input box grew.
          const inputView = getInputView();
          const moveDown = (inputView.rows.length - 1 - inputView.caretRow) + 4 + getExtraLines();
          stdout.write(`\x1b[${moveDown}B\r\n\x1b[0 q\x1b[?25h`);
          resolve({ text: trimmed, mode: currentMode, autoApprove: currentAutoApprove });
          return;
        }

        // Caret movement (cursor-only hop) and forward delete (repaint: the
        // line shrank, so the old trailing character must be cleared).
        if (key.name === 'left' || key.name === 'right' || key.name === 'delete') {
          if (key.name === 'left') {
            caret = Math.max(0, caret - 1);
            updateMentions();
            redrawCard();
          } else if (key.name === 'right') {
            caret = Math.min(input.length, caret + 1);
            updateMentions();
            redrawCard();
          } else if (caret < input.length) {
            input = input.slice(0, caret) + input.slice(caret + 1);
            updateMentions();
            redrawCard();
          }
          return;
        }

        // Backspace
        if (key.name === 'backspace') {
          if (caret > 0) {
            input = input.slice(0, caret - 1) + input.slice(caret);
            caret = Math.max(0, caret - 1);
            commandSelection = 0;
            updateMentions();
            redrawCard();
          }
          return;
        }

        // Printable character
        if (str && str.length === 1 && str.charCodeAt(0) >= 32 && !key.ctrl && !key.meta) {
          input = input.slice(0, caret) + str + input.slice(caret);
          caret += 1;
          commandSelection = 0;
          questionHistoryIndex = questionHistory.length;
          updateMentions();
          redrawCard();
        }

      })();
    };

    /**
     * Mouse reporting is only useful while the composer owns the keyboard: a
     * click on the composer line places the caret. Popups and sub-prompts take
     * the keyboard over with mouse reporting off, so they keep the terminal's
     * normal text selection, and clicks never leak into their filter fields.
     */
    const bindComposerInput = (): void => {
      stdout.write(MOUSE_REPORT_ON + KEY_MODIFIER_REPORT_ON);
      stdin.on('keypress', onKeypress);
    };
    const unbindComposerInput = (): void => {
      stdin.removeListener('keypress', onKeypress);
      // Key-modifier reporting is scoped to the composer: popups read plain
      // legacy keys, and leaving XTMODKEYS on would change what they receive.
      stdout.write(KEY_MODIFIER_REPORT_OFF + MOUSE_REPORT_OFF);
    };

    bindComposerInput();
  });
}
