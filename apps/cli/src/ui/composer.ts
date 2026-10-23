/**
 * The interactive composer: raw-mode keypress handling, the prompt line, the
 * suggestion and mention boxes, popup delegation, and history navigation.
 *
 * Split out of `ui/welcome.ts`, which now owns only layout and painting.
 */
import readline from 'node:readline';
import type { UsageEvent } from '@moderado/contracts';
import { activeMentionToken, filterMentionCandidates } from './file_mentions.js';
import {
  MOUSE_REPORT_OFF,
  MOUSE_REPORT_ON,
  MOUSE_REPORT_PATTERN,
  composerInputWindow,
  exitCleanly,
  getChatComposerRows,
  getChatLayout,
  getMatchingCommands,
  getWelcomeBottomPadding,
  getWelcomeCardWidth,
  getWelcomeIndent,
  navigateQuestionHistory,
  renderCenteredWelcomeScreen,
  renderFullWelcomeScreen,
  renderHelpPopupBox,
  renderWelcomePopupLayer,
} from './welcome.js';
import type { WelcomeLayoutOptions } from './welcome.js';


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
  chatThoughtTime?: number;
  chatTaskDone?: boolean;
  outputTokenRate?: number;
  tokenUsage?: UsageEvent;
  questionHistory?: string[];
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

  /** Rows between the painted composer line and the terminal's last row. */
  const getComposerOffset = (): number => getWelcomeBottomPadding(getOptions(), getRows()) + 4 + getExtraLines();

  /** Screen row and 1-based column of the composer's first text cell. */
  const getComposerAnchor = (): { row: number; column: number } => {
    const options = getOptions();
    const column = getWelcomeIndent(getWelcomeCardWidth()) + 3;
    if (options.chatQuestion !== undefined) {
      // Chat frames place the composer at a computed row. Measure the card that
      // is actually painted — a queued-commands or mention box makes it taller —
      // so the caret never lands on the mode row or inside the box.
      const layout = getChatLayout(stdout.columns, getRows(), options.chatQuestion, getChatComposerRows(options));
      return { row: layout.composerTop + 1, column };
    }
    return { row: getRows() - getComposerOffset(), column };
  };


  /**
   * Move cursor to the ❯ input line (Line 2 inside the centered card).
   * Absolute addressing (`row;column H`) works no matter where the cursor
   * currently sits — relative "move up N" escapes the input line when
   * pressed repeatedly, e.g. browsing history with Left/Right.
   */
  const positionCursorOnInput = () => {
    const { row, column } = getComposerAnchor();
    const { caretColumn } = composerInputWindow(input, caret, getWelcomeCardWidth());
    stdout.write(`\x1b[1 q\x1b[?25h\x1b[${row};${column + caretColumn}H`);
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

  /**
   * Place the caret where the user clicked on the composer line. Only a primary
   * press is honoured; releases, drags, wheel and other buttons are ignored.
   */
  const onMouseData = (chunk: string | Buffer): void => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let reported = false;
    for (const report of text.matchAll(MOUSE_REPORT_PATTERN)) {
      reported = true;
      if (report[4] !== 'M' || Number(report[1]) !== 0) continue;
      const { row, column } = getComposerAnchor();
      if (Number(report[3]) !== row) continue;
      caret = Math.max(0, Math.min(input.length, Number(report[2]) - column));
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
  stdin.prependListener('data', onMouseData);
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
      stdin.removeListener('data', onMouseData);
      stdout.removeListener('resize', onResize);
      stdout.write(`${MOUSE_REPORT_OFF}\x1b[0 q\x1b[?25h`);
      if (stdin.isTTY) {
        try { stdin.setRawMode(false); } catch { /* ignore */ }
      }
      try { stdin.pause(); } catch { /* ignore */ }
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

        // ── /help overlay popup ───────────────────────────────────────────────
        // Triggered when Enter is pressed with "/help" already in the input box.
        // We keep the main TUI as background and layer the help box on top.
        if (key && (key.name === 'return' || key.name === 'enter') && input.trim() === '/help') {
          setInput('');
          unbindComposerInput(); // pause main handler

          // Paint: full welcome TUI (background) + help box on top
          const helpLines = renderHelpPopupBox(options.version ?? 'v0.1', options.workspace);
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderWelcomePopupLayer(getOptions(), helpLines, stdout.columns, stdout.rows));

          // Wait for Esc / Enter / q to dismiss
          await new Promise<void>((dismissResolve) => {
            const onDismiss = (s: string, k: any) => {
              if (
                (k && (k.name === 'escape' || k.name === 'return' || k.name === 'enter')) ||
                s === 'q' || s === 'Q' ||
                (k && k.ctrl && k.name === 'c')
              ) {
                stdin.removeListener('keypress', onDismiss);
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

        // ── /model overlay popup ──────────────────────────────────────────────
        // Triggered when Enter is pressed with "/model" in the input box.
        // We temporarily detach the main keypress listener and hand the model
        // selector a drawFrame callback. drawFrame repaints the background TUI
        // exactly as-is and composites the popup content as a centered floating
        // layer on top of it (Cline/OpenCode style) — the popup never scrolls
        // the background because every step redraws the whole frame.
        // After it returns, we repaint the full welcome TUI and reposition cursor.
        if (key && (key.name === 'return' || key.name === 'enter') && input.trim() === '/model') {
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

        if (key && (key.name === 'return' || key.name === 'enter') && input.trim() === '/connect') {
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

        if (key && (key.name === 'return' || key.name === 'enter') && input.trim().startsWith('/session')) {
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

        if (key && (key.name === 'return' || key.name === 'enter') && input.trim().startsWith('/queue')) {
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

        if (key && (key.name === 'return' || key.name === 'enter') && input.trim().startsWith('/btw')) {
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

        if (key && (key.name === 'return' || key.name === 'enter') && isMcpCommandInput(input)) {
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

        if (key && (key.name === 'return' || key.name === 'enter') && input.trim() === '/init') {
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

        if (key && (key.name === 'return' || key.name === 'enter') && input.trim().startsWith('/workflow')) {
          const command = input.trim(); setInput(''); unbindComposerInput();
          const action = options.onWorkflow ? await options.onWorkflow(command, (popupLines) => { stdout.write('\x1b[H\x1b[J'); stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows)); }) : undefined;
          if (action === 'build') { cleanup(); resolve({ text: '', mode: 'Execute', autoApprove: currentAutoApprove, workflowAction: 'build' }); return; }
          readline.emitKeypressEvents(stdin); stdin.resume(); stdin.setRawMode(true); redrawFull(); bindComposerInput(); return;
        }


        // ── /clear ────────────────────────────────────────────────────────────
        if (key && (key.name === 'return' || key.name === 'enter') && input.trim() === '/clear') {
          setInput('');
          options.onClear?.();
          redrawFull();
          return;
        }

        // ── /exit ─────────────────────────────────────────────────────────────
        if (key && (key.name === 'return' || key.name === 'enter') &&
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
        if (key.name === 'return' || key.name === 'enter') {
          const matching = getMatchingCommands(input);
          if (input.startsWith('/') && matching.length > 0 && !matching.some((command) => command.name === input.trim())) {
            setInput(matching[Math.min(commandSelection, matching.length - 1)].name);
            commandSelection = 0;
            redrawCard();
            return;
          }
          const trimmed = input.trim();
          cleanup();
          if (options.signal) options.signal.removeEventListener('abort', onAbort);
          const moveDown = 4 + getExtraLines();
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
      stdout.write(MOUSE_REPORT_ON);
      stdin.on('keypress', onKeypress);
    };
    const unbindComposerInput = (): void => {
      stdin.removeListener('keypress', onKeypress);
      stdout.write(MOUSE_REPORT_OFF);
    };

    bindComposerInput();
  });
}