import { overlayCentered, dimLines, shadowUnder } from './popup.js';

export interface WelcomeLayoutOptions {
  model: string;
  tokens: number;
  cost: string;
  usageAvailable?: boolean;
  workspace: string;
  mode: 'Plan' | 'Execute';
  autoApprove: boolean;
  input?: string;
  width?: number;
  /** When set, render the full chat window (question row 1 + answer) instead of the logo header. */
  chatQuestion?: string;
  chatAnswer?: string;
  chatThoughtTime?: number;
  /** Generated completion tokens per second for the preceding response. */
  outputTokenRate?: number;
}

export const MODERADO_ASCII_LOGO = [
  '\x1b[38;5;75m    __  _______  ____  __________  ___    ____  ____ \x1b[0m',
  '\x1b[38;5;75m   /  |/  / __ \\/ __ \\/ ____/ __ \\/   |  / __ \\/ __ \\\x1b[0m',
  '\x1b[38;5;81m  / /|_/ / / / / / / / __/ / /_/ / /| | / / / / / / /\x1b[0m',
  '\x1b[38;5;81m / /  / / /_/ / /_/ / /___/ _, _/ ___ |/ /_/ / /_/ / \x1b[0m',
  '\x1b[38;5;87m/_/  /_/\\____/_____/_____/_/ |_/_/  |_/_____/\\____/  \x1b[0m',
];

export const COMMAND_HINT =
  '\x1b[38;5;242mUse \x1b[38;5;75m/\x1b[38;5;242m for slash commands, \x1b[38;5;75m@\x1b[38;5;242m for file mentions\x1b[0m';

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/** Visible (ANSI-stripped) length of a line. */
function visibleLen(str: string): number {
  return stripAnsi(str).length;
}

/** Card width: nearly full terminal width, like OpenCode/Cline. */
export function getWelcomeCardWidth(width?: number): number {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  return Math.max(70, Math.min(terminalWidth - 2, 120));
}

/** Left indent that centers a block of `blockWidth` visible columns on the terminal. */
export function getWelcomeIndent(blockWidth: number, width?: number): number {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  return Math.max(0, Math.floor((terminalWidth - blockWidth) / 2));
}

/** Center each line of a block independently (used for the ASCII logo / hints). */
function centerBlock(lines: string[], width?: number): string[] {
  return lines.map((line) => {
    const pad = getWelcomeIndent(visibleLen(line), width);
    return ' '.repeat(pad) + line;
  });
}

export function renderWelcomeCard(options: WelcomeLayoutOptions): string {
  const width = getWelcomeCardWidth(options.width);
  const indent = ' '.repeat(getWelcomeIndent(width, options.width));
  const hr = `\x1b[38;5;238m${'─'.repeat(width)}\x1b[0m`;

  const displayInput =
    options.input && options.input.length > 0
      ? options.input
      : '\x1b[38;5;242mAsk anything, I am all ears...\x1b[0m';

  const textBox = `\x1b[1;38;5;75m❯\x1b[0m ${displayInput}`;

  // Line 4: model & tokens / cost (left) ... Plan / Execute (Tab) (right)
  const outputRate = options.outputTokenRate === undefined ? '' : ` · ${Math.round(options.outputTokenRate)} tok/s`;
  const usageLabel = options.usageAvailable === false ? 'Usage unavailable' : `${options.tokens} tokens`;
  const left4Raw = `${options.model}  ${usageLabel} / ${options.cost}${outputRate}`;
  const left4 = `\x1b[38;5;180m${options.model}\x1b[0m  \x1b[38;5;244m${usageLabel} / ${options.cost}${outputRate}\x1b[0m`;
  
  const right4 =
    options.mode === 'Plan'
      ? '\x1b[1;38;5;75m[Plan]\x1b[0m / Execute (Tab)'
      : 'Plan / \x1b[1;38;5;75m[Execute]\x1b[0m (Tab)';
  const right4Raw = options.mode === 'Plan' ? '[Plan] / Execute (Tab)' : 'Plan / [Execute] (Tab)';

  const spaces4Count = Math.max(1, width - left4Raw.length - right4Raw.length);
  const line4 = left4 + ' '.repeat(spaces4Count) + right4;

  // Line 5: Working directory (left) ... Auto-approve (right)
  const shortWs =
    options.workspace.length > 36
      ? '...' + options.workspace.slice(-33)
      : options.workspace;
  const left5 = `\x1b[38;5;245m${shortWs}\x1b[0m`;

  const right5 = options.autoApprove
    ? '\x1b[38;5;114mAuto-approve all enabled (Shift+Tab)\x1b[0m'
    : '\x1b[38;5;242mAuto-approve off (Shift+Tab)\x1b[0m';
  const right5Raw = options.autoApprove
    ? 'Auto-approve all enabled (Shift+Tab)'
    : 'Auto-approve off (Shift+Tab)';
  const spaces5Count = Math.max(1, width - shortWs.length - right5Raw.length);
  const line5 = left5 + ' '.repeat(spaces5Count) + right5;

  const cardLines = [
    hr,
    textBox,
    hr,
    line4,
    line5,
  ].map((line) => indent + line);

  if (options.input && options.input.startsWith('/')) {
    const matching = getMatchingCommands(options.input);
    if (matching.length > 0) {
      cardLines.push(...renderSuggestionsBox(matching).map((line) => indent + line));
    }
  }

  return cardLines.join('\n');
}

export interface SlashCommand {
  name: string;
  desc: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/connect', desc: 'Connect a model provider' },
  { name: '/model', desc: 'Switch active AI model' },
  { name: '/session', desc: 'Create, list, resume, export, or compact sessions' },
  { name: '/clear', desc: 'Reset conversation memory' },
  { name: '/help', desc: 'Display commands, shortcuts & version' },
  { name: '/exit', desc: 'Exit Moderado' },
];

export function getMatchingCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  const q = input.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(q));
}

export function selectCommandCandidate(input: string, currentIndex: number, direction: number): SlashCommand | undefined {
  const commands = getMatchingCommands(input);
  if (commands.length === 0) return undefined;
  const index = ((currentIndex + direction) % commands.length + commands.length) % commands.length;
  return commands[index];
}

export function renderSuggestionsBox(commands: SlashCommand[]): string[] {
  if (commands.length === 0) return [];
  const lines: string[] = [];
  lines.push('\x1b[38;5;240m  ╭─ Commands (Press Tab to autocomplete) ──────────────╮\x1b[0m');
  for (const cmd of commands) {
    const nameStr = `\x1b[1;38;5;75m${cmd.name.padEnd(8)}\x1b[0m`;
    const descStr = `\x1b[38;5;244m${cmd.desc.padEnd(38)}\x1b[0m`;
    lines.push(`\x1b[38;5;240m  │\x1b[0m  ${nameStr} ${descStr}\x1b[38;5;240m│\x1b[0m`);
  }
  lines.push('\x1b[38;5;240m  ╰─────────────────────────────────────────────────────╯\x1b[0m');
  return lines;
}

export function renderModeradoHeader(): string {
  return [
    '',
    ...centerBlock(MODERADO_ASCII_LOGO),
    '',
    ...centerBlock([COMMAND_HINT]),
  ].join('\n');
}

/** Word-wrap plain text to `maxWidth` visible columns. */
function wrapText(text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.length <= maxWidth) {
      out.push(rawLine);
      continue;
    }
    let current = '';
    for (const word of rawLine.split(' ')) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= maxWidth) {
        current += ' ' + word;
      } else {
        out.push(current);
        current = word;
      }
    }
    if (current.length > 0) out.push(current);
  }
  return out;
}

/**
 * Full chat window (after a question is submitted): no logo — the question is
 * displayed on the first row, the multi-line model answer below it, then the
 * same input card as the welcome window at the bottom.
 */
export function renderChatScreen(options: WelcomeLayoutOptions, height?: number): string {
  const terminalWidth = options.width ?? (process.stdout.columns || 80);
  const terminalHeight = height ?? process.stdout.rows ?? 24;
  const maxWidth = Math.max(40, terminalWidth - 4);
  const width = Math.max(40, terminalWidth - 2);
  const hr = `\x1b[38;5;238m${'─'.repeat(width)}\x1b[0m`;

  const lines: string[] = [];

  lines.push(...renderModeradoHeader().split('\n'));
  lines.push('');
  lines.push(hr);

  // Row 1: the user's question
  lines.push(`\x1b[1;38;5;75m❯\x1b[0m ${options.chatQuestion ?? ''}`);
  lines.push(hr);
  const thoughtTime = options.chatThoughtTime ?? 0;
  const thoughtTimeLabel = thoughtTime > 0 && thoughtTime < 1 ? '<1s' : `${Math.round(thoughtTime)}s`;
  lines.push(`\x1b[38;5;244mThought for ${thoughtTimeLabel}\x1b[0m`);

  // Answer section: multi-line model answer
  if (options.chatAnswer && options.chatAnswer.trim().length > 0) {
    lines.push('');
    for (const answerLine of wrapText(options.chatAnswer.trim(), maxWidth)) {
      lines.push(`\x1b[38;5;253m${answerLine}\x1b[0m`);
    }
  }

  const composer = renderWelcomeCard(options).split('\n');
  lines.push(...Array(Math.max(1, terminalHeight - lines.length - composer.length - 1)).fill(''));
  lines.push(...composer);

  return lines.join('\n') + '\n';
}

export function renderFullWelcomeScreen(options: WelcomeLayoutOptions, height?: number): string {
  if (options.chatQuestion !== undefined) {
    return renderChatScreen(options, height);
  }
  return [
    renderModeradoHeader(),
    '',
    renderWelcomeCard(options),
  ].join('\n') + '\n';
}

/** Keep the initial welcome screen centered as the terminal viewport changes. */
export function getWelcomeBottomPadding(options: WelcomeLayoutOptions, height?: number): number {
  if (options.chatQuestion !== undefined) return 0;
  const terminalHeight = height ?? process.stdout.rows ?? 24;
  const contentLines = renderFullWelcomeScreen(options).trimEnd().split('\n').length;
  return Math.max(0, Math.ceil((terminalHeight - contentLines) / 2));
}

export function renderCenteredWelcomeScreen(options: WelcomeLayoutOptions, height?: number): string {
  if (options.chatQuestion !== undefined) return renderFullWelcomeScreen(options, height);

  const terminalHeight = height ?? process.stdout.rows ?? 24;
  const content = renderFullWelcomeScreen(options).trimEnd();
  const contentLines = content.split('\n').length;
  const remainingRows = Math.max(0, terminalHeight - contentLines);
  const topPadding = Math.floor(remainingRows / 2);
  const bottomPadding = Math.ceil(remainingRows / 2);

  return '\n'.repeat(topPadding) + content + '\n'.repeat(bottomPadding + 1);
}

/** Compose an OpenCode-style popup layer without losing the welcome background. */
export function renderWelcomePopupLayer(
  options: WelcomeLayoutOptions,
  popupLines: string[],
  width?: number,
  height?: number
): string {
  const cols = width ?? process.stdout.columns ?? 80;
  const rows = height ?? process.stdout.rows ?? 24;
  const background = dimLines(renderCenteredWelcomeScreen(options, rows).split('\n')).join('\n');
  const surface = '\x1b[48;5;236m\x1b[38;5;255m';
  const lightPopup = popupLines.map((line) =>
    surface + line.replace(/\x1b\[0m/g, `\x1b[0m${surface}`) + '\x1b[0m'
  );
  return background + shadowUnder(lightPopup, cols, rows) + overlayCentered(lightPopup, cols, rows);
}

export function renderHelpPopupBox(version: string, workspace: string, width?: number): string[] {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  const boxWidth = Math.min(terminalWidth, 74);
  const padLeft = Math.max(0, Math.floor((terminalWidth - boxWidth) / 2));
  const indent = ' '.repeat(padLeft);
  const innerW = boxWidth - 4;
  const shortWs = workspace.length > 38 ? '...' + workspace.slice(-35) : workspace;

  const titleStr = 'Moderado Help & Shortcuts';
  const remainingDashes = Math.max(0, boxWidth - titleStr.length - 5);

  const content: string[] = [
    '\x1b[1;38;5;75mSlash Commands:\x1b[0m',
    '\x1b[1m/model\x1b[0m       Switch active AI model (Free, Paid, or Custom)',
    '\x1b[1m/connect\x1b[0m     Connect NVIDIA NIM or another compatible provider',
    '\x1b[1m/session\x1b[0m   Create, list, resume, export, or compact sessions',
    '\x1b[1m/clear\x1b[0m       Reset conversation memory and context history',
    '\x1b[1m/help\x1b[0m        Display this commands, shortcuts & version guide',
    '\x1b[1m/exit\x1b[0m        Exit Moderado session cleanly',
    '',
    '\x1b[1;38;5;114mKeyboard Shortcuts:\x1b[0m',
    '\x1b[1mTab\x1b[0m          Toggle between [Plan] and [Execute] mode',
    '\x1b[1mShift+Tab\x1b[0m    Toggle Auto-approval on / off for actions',
    '\x1b[1mCtrl+C\x1b[0m       Cancel active inference or exit session',
    '',
    `\x1b[38;5;245mWorkspace:\x1b[0m  \x1b[38;5;253m${shortWs}\x1b[0m`,
    `\x1b[38;5;245mVersion:\x1b[0m    \x1b[1;38;5;75m${version}\x1b[0m`,
    '',
    '\x1b[38;5;244mPress \x1b[1;38;5;75m[Esc]\x1b[0;38;5;244m or \x1b[1;38;5;75m[Enter]\x1b[0;38;5;244m to close\x1b[0m',
  ];

  const lines: string[] = [];
  lines.push(indent + '\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + titleStr + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m');
  for (const item of content) {
    const plain = item.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const spaces = Math.max(0, innerW - plain.length);
    lines.push(indent + '\x1b[38;5;240m│\x1b[0m  ' + item + ' '.repeat(spaces) + '\x1b[38;5;240m│\x1b[0m');
  }
  lines.push(indent + '\x1b[38;5;240m╰' + '─'.repeat(boxWidth - 2) + '╯\x1b[0m');
  return lines;
}

export let terminalCleanExitDone = false;

/** Mark that a clean exit already restored + cleared the terminal (guards the process 'exit' hook). */
export function notifyCleanExit(): void {
  terminalCleanExitDone = true;
}

/**
 * Exit Moderado cleanly: restore cursor visibility & style, leave the alternate
 * screen buffer, disable raw mode, fully clear the OS terminal, print the
 * farewell message, and terminate the process.
 */
export function exitCleanly(message: string): never {
  notifyCleanExit();
  const stdout = process.stdout;
  if (stdout.isTTY) {
    stdout.write(
      '\x1b[?25h\x1b[?1049l\x1b[0 q\x1b[0m\x1b[2J\x1b[3J\x1b[H' + message + '\n\n'
    );
  } else {
    stdout.write(message + '\n\n');
  }
  const stdin = process.stdin;
  if (stdin.isTTY) {
    try { stdin.setRawMode(false); } catch { /* ignore */ }
  }
  process.exit(0);
}

export interface InteractiveTurnResult {
  text: string;
  mode: 'Plan' | 'Execute';
  autoApprove: boolean;
}

export interface PromptInteractiveTurnOptions {
  model: string;
  tokens: number;
  cost: string;
  usageAvailable?: boolean;
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
  outputTokenRate?: number;
  /**
   * Called when user selects a model via /model. Receives a `drawFrame`
   * callback that composites popup content as a floating layer on top of the
   * main TUI window (background stays as-is). The callback owns the selection
   * UI and returns the new model id, or undefined if cancelled.
   */
  onModelSelect?: (drawFrame: (popupLines: string[]) => void) => Promise<string | undefined>;
  /** Called when user issues /connect. Returns the model label to display. */
  onConnect?: (drawFrame: (popupLines: string[]) => void) => Promise<string | undefined>;
  /** Called when user issues /clear so caller can reset conversation history. */
  onClear?: () => void;
  onSession?: (command: string, drawFrame: (popupLines: string[]) => void) => Promise<void>;
}

export async function promptInteractiveTurn(
  options: PromptInteractiveTurnOptions
): Promise<InteractiveTurnResult> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  let currentModel = options.model;
  let currentMode: 'Plan' | 'Execute' = options.initialMode ?? 'Execute';
  let currentAutoApprove = options.initialAutoApprove ?? false;
  let input = '';
  let commandSelection = 0;

  const getOptions = (): WelcomeLayoutOptions => ({
    model: currentModel,
    tokens: options.tokens,
    cost: options.cost,
    usageAvailable: options.usageAvailable,
    workspace: options.workspace,
    mode: currentMode,
    autoApprove: currentAutoApprove,
    input,
    chatQuestion: options.chatQuestion,
    chatAnswer: options.chatAnswer,
    chatThoughtTime: options.chatThoughtTime,
    outputTokenRate: options.outputTokenRate,
  });

  // ── Non-TTY fallback ──────────────────────────────────────────────────────
  if (!stdin.isTTY) {
    stdout.write('\x1b]0;Moderado\x07');
    stdout.write(renderFullWelcomeScreen(getOptions()));
    const readlineModule = await import('node:readline');
    return new Promise((resolve) => {
      const rl = readlineModule.createInterface({ input: stdin, output: stdout });
      rl.question('\x1b[1;38;5;75m❯\x1b[0m ', (answer) => {
        rl.close();
        resolve({ text: answer.trim(), mode: currentMode, autoApprove: currentAutoApprove });
      });
    });
  }

  // ── TTY Interactive Loop ───────────────────────────────────────────────────
  const readlineModule = await import('node:readline');
  readlineModule.emitKeypressEvents(stdin);
  // A previous turn's cleanup() pauses stdin — resume it so keystrokes keep
  // flowing after an answer (the main app must never appear dead post-answer).
  stdin.resume();
  stdin.setRawMode(true);

  const getExtraLines = () => {
    if (!input.startsWith('/')) return 0;
    const matching = getMatchingCommands(input);
    return matching.length > 0 ? matching.length + 2 : 0;
  };

  /** Move cursor to the ❯ input line (Line 2 inside the centered card). */
  const positionCursorOnInput = () => {
    const cardIndent = getWelcomeIndent(getWelcomeCardWidth());
    const cursorCol = cardIndent + 2 + input.length;
    const moveUp = getWelcomeBottomPadding(getOptions(), stdout.rows) + 4 + getExtraLines();
    stdout.write(`\x1b[1 q\x1b[?25h\x1b[${moveUp}A\r\x1b[${cursorCol}C`);
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
      stdin.removeListener('keypress', onKeypress);
      stdout.removeListener('resize', onResize);
      stdout.write('\x1b[0 q\x1b[?25h');
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

        if (options.signal?.aborted) {
          cleanup();
          resolve({ text: '', mode: currentMode, autoApprove: currentAutoApprove });
          return;
        }

        // ── Ctrl+C ────────────────────────────────────────────────────────────
        if (key && key.ctrl && key.name === 'c') {
          cleanup();
          exitCleanly('\x1b[33mSession cancelled.\x1b[0m');
        }

        // ── /help overlay popup ───────────────────────────────────────────────
        // Triggered when Enter is pressed with "/help" already in the input box.
        // We keep the main TUI as background and layer the help box on top.
        if (key && (key.name === 'return' || key.name === 'enter') && input.trim() === '/help') {
          input = '';
          stdin.removeListener('keypress', onKeypress); // pause main handler

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

          stdin.on('keypress', onKeypress); // re-attach main handler
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
          input = '';
          stdin.removeListener('keypress', onKeypress); // pause main handler

          if (options.onModelSelect) {
            const drawFrame = (popupLines: string[]): void => {
              stdout.write('\x1b[H\x1b[J');
              stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
            };
            const newId = await options.onModelSelect(drawFrame);
            if (newId && newId !== currentModel) {
              currentModel = newId;
            }
          }

          // Selection flow left stdin in non-raw mode — restore it for our TUI
          readlineModule.emitKeypressEvents(stdin);
          stdin.setRawMode(true);
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();

          stdin.on('keypress', onKeypress); // re-attach main handler
          return;
        }

        if (key && (key.name === 'return' || key.name === 'enter') && input.trim() === '/connect') {
          input = '';
          stdin.removeListener('keypress', onKeypress);

          const drawFrame = (popupLines: string[]): void => {
            stdout.write('\x1b[H\x1b[J');
            stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
          };

          if (options.onConnect) {
            const newModel = await options.onConnect(drawFrame);
            if (newModel) currentModel = newModel;
          }

          readlineModule.emitKeypressEvents(stdin);
          stdin.resume();
          stdin.setRawMode(true);
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();
          stdin.on('keypress', onKeypress);
          return;
        }

        if (key && (key.name === 'return' || key.name === 'enter') && input.trim().startsWith('/session')) {
          const command = input.trim();
          input = '';
          stdin.removeListener('keypress', onKeypress);
          if (options.onSession) {
            await options.onSession(command, (popupLines) => {
              stdout.write('\x1b[H\x1b[J');
              stdout.write(renderWelcomePopupLayer(getOptions(), popupLines, stdout.columns, stdout.rows));
            });
          }
          readlineModule.emitKeypressEvents(stdin);
          stdin.resume();
          stdin.setRawMode(true);
          stdout.write('\x1b[H\x1b[J');
          stdout.write(renderCenteredWelcomeScreen(getOptions(), stdout.rows));
          positionCursorOnInput();
          stdin.on('keypress', onKeypress);
          return;
        }


        // ── /clear ────────────────────────────────────────────────────────────
        if (key && (key.name === 'return' || key.name === 'enter') && input.trim() === '/clear') {
          input = '';
          options.onClear?.();
          redrawFull();
          return;
        }

        // ── /exit ─────────────────────────────────────────────────────────────
        if (key && (key.name === 'return' || key.name === 'enter') &&
            (input.trim() === '/exit' || input.trim() === '/quit')) {
          cleanup();
          if (options.signal) options.signal.removeEventListener('abort', onAbort);
          exitCleanly('\x1b[32mGoodbye! Stay Tuned with Moderado!\x1b[0m');
        }

        // ── Normal keys ───────────────────────────────────────────────────────
        if (!key) {
          if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
            input += str;
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

        // Tab — autocomplete slash command or toggle mode
        if (key.name === 'tab' && !key.shift) {
          if (input.startsWith('/')) {
            const matching = getMatchingCommands(input);
            if (matching.length > 0) {
              input = matching[Math.min(commandSelection, matching.length - 1)].name;
              commandSelection = 0;
              redrawCard();
              return;
            }
          }
          currentMode = currentMode === 'Plan' ? 'Execute' : 'Plan';
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

        // Enter — submit real user message
        if (key.name === 'return' || key.name === 'enter') {
          const matching = getMatchingCommands(input);
          if (input.startsWith('/') && matching.length > 0 && !matching.some((command) => command.name === input.trim())) {
            input = matching[Math.min(commandSelection, matching.length - 1)].name;
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

        // Backspace
        if (key.name === 'backspace') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            commandSelection = 0;
            redrawCard();
          }
          return;
        }

        // Printable character
        if (str && str.length === 1 && str.charCodeAt(0) >= 32 && !key.ctrl && !key.meta) {
          input += str;
          commandSelection = 0;
          redrawCard();
        }

      })();
    };

    stdin.on('keypress', onKeypress);
  });
}


