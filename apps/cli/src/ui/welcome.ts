import { overlayCentered, dimLines, shadowUnder } from './popup.js';
import { activeMentionToken, filterMentionCandidates } from './file_mentions.js';

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
  mentionFiles?: string[];
  mentionSelection?: number;
  commandSelection?: number;
  queuedCommands?: readonly string[];
  isTurnSettled?: boolean;
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

export function renderQueuedCommandsBox(commands: readonly string[], width: number): string[] {
  if (!commands || commands.length === 0) return [];
  const title = `Queued Commands (${commands.length})`;
  const remainingDashes = Math.max(0, width - title.length - 5);
  const lines: string[] = [];

  lines.push('\x1b[38;5;240m╭─ \x1b[1;38;5;221m' + title + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m');
  const maxItems = Math.min(commands.length, 4);
  for (let i = 0; i < maxItems; i++) {
    const cmd = commands[i];
    const itemPrefix = `${i + 1}. `;
    const availCmdWidth = Math.max(20, width - 4 - itemPrefix.length);
    const shortCmd = cmd.length > availCmdWidth ? cmd.slice(0, availCmdWidth - 3) + '...' : cmd;
    const content = `\x1b[38;5;221m${itemPrefix}\x1b[0m\x1b[38;5;252m${shortCmd}\x1b[0m`;
    const plainLen = itemPrefix.length + shortCmd.length;
    const padding = Math.max(0, width - 4 - plainLen);
    lines.push(`\x1b[38;5;240m│\x1b[0m  ${content}${' '.repeat(padding)}\x1b[38;5;240m│\x1b[0m`);
  }
  if (commands.length > 4) {
    const moreText = `(+${commands.length - 4} more - type /queue to inspect)`;
    const padding = Math.max(0, width - 4 - moreText.length);
    lines.push(`\x1b[38;5;240m│\x1b[0m  \x1b[38;5;244m${moreText}\x1b[0m${' '.repeat(padding)}\x1b[38;5;240m│\x1b[0m`);
  }
  lines.push('\x1b[38;5;240m╰' + '─'.repeat(Math.max(0, width - 2)) + '╯\x1b[0m');
  return lines;
}

export function renderWelcomeCard(options: WelcomeLayoutOptions): string {
  const width = getWelcomeCardWidth(options.width);
  const indent = ' '.repeat(getWelcomeIndent(width, options.width));

  const displayInput =
    options.input && options.input.length > 0
      ? options.input
      : '\x1b[38;5;242mAsk anything, I am all ears...\x1b[0m';

  const promptMarker = '\x1b[1;38;5;75m' + String.fromCodePoint(0x276F) + '\x1b[0;48;5;236m';
  const textBox = `${promptMarker} ${displayInput}`;
  const surface = '\x1b[48;5;236m';
  const surfaceLine = (content: string = '') => {
    const preserved = content.replace(/\x1b\[0m/g, '\x1b[0;48;5;236m');
    return surface + preserved + ' '.repeat(Math.max(0, width - visibleLen(content))) + '\x1b[0m';
  };

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
    ? '\x1b[38;5;114mAuto-approve enabled (Shift+Tab)\x1b[0m'
    : '\x1b[38;5;242mAuto-approve off (Shift+Tab)\x1b[0m';
  const right5Raw = options.autoApprove
    ? 'Auto-approve enabled (Shift+Tab)'
    : 'Auto-approve off (Shift+Tab)';
  const spaces5Count = Math.max(1, width - shortWs.length - right5Raw.length);
  const line5 = left5 + ' '.repeat(spaces5Count) + right5;

  const cardLines: string[] = [];
  const queuedBox = renderQueuedCommandsBox(options.queuedCommands ?? [], width);
  if (queuedBox.length > 0) {
    cardLines.push(...queuedBox.map((line) => indent + line));
    cardLines.push('');
  }

  if (!options.mentionFiles?.length && options.input?.startsWith('/')) {
    const matching = getMatchingCommands(options.input);
    if (matching.length > 0) {
      cardLines.push(...renderSuggestionsBox(matching, width).map((line) => indent + line));
    }
  }

  cardLines.push(
    indent + surfaceLine(),
    indent + surfaceLine(textBox),
    indent + surfaceLine(),
    indent + line4,
    indent + line5,
  );

  if (options.mentionFiles && options.mentionFiles.length > 0) {
    cardLines.push(...renderMentionSuggestionsBox(options.mentionFiles, options.mentionSelection ?? 0).map((line) => indent + line));
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
  { name: '/init', desc: 'Scaffold AGENTS.md from workspace scan' },
  { name: '/btw', desc: 'Ask an ephemeral side question (no session pollution)' },
  { name: '/mcp', desc: 'Manage local MCP servers' },
  { name: '/session', desc: 'Create, resume, undo, redo, share, export, or compact sessions' },
  { name: '/queue', desc: 'Add, inspect, or clear queued follow-up commands' },
  { name: '/workflow', desc: 'Inspect Git, build plans, or undo agent changes' },
  { name: '/skills', desc: 'List installed user skills and reload them' },
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

export function renderSuggestionsBox(commands: SlashCommand[], width?: number): string[] {
  if (commands.length === 0) return [];
  const terminalWidth = width ?? (process.stdout?.columns || 80);
  const targetWidth = 82;
  const boxWidth = Math.max(78, Math.min(terminalWidth, targetWidth));
  const innerW = boxWidth - 4;
  const title = 'Commands (Press Tab to autocomplete)';
  const remainingDashes = Math.max(0, boxWidth - title.length - 5);
  const nameColWidth = 10;
  const availDescWidth = Math.max(20, innerW - nameColWidth - 2);

  const lines: string[] = [];
  lines.push('\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + title + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m');
  for (const cmd of commands) {
    const nameStr = `\x1b[1;38;5;75m${cmd.name.padEnd(nameColWidth)}\x1b[0m`;
    let desc = cmd.desc;
    if (desc.length > availDescWidth) {
      desc = desc.slice(0, availDescWidth - 1) + '…';
    }
    const descStr = `\x1b[38;5;244m${desc.padEnd(availDescWidth)}\x1b[0m`;
    lines.push(`\x1b[38;5;240m│\x1b[0m  ${nameStr}  ${descStr}\x1b[38;5;240m│\x1b[0m`);
  }
  lines.push('\x1b[38;5;240m╰' + '─'.repeat(boxWidth - 2) + '╯\x1b[0m');
  return lines;
}

export function renderMentionSuggestionsBox(files: string[], selectedIndex = 0): string[] {
  if (files.length === 0) return [];
  const lines: string[] = [];
  lines.push('\x1b[38;5;240m  ╭─ Files (@ to mention, Tab to insert) ──────────────╮\x1b[0m');
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const isSelected = i === selectedIndex;
    const marker = isSelected ? '\x1b[1;38;5;75m❯ \x1b[0m' : '  ';
    const nameStr = isSelected ? `\x1b[1;38;5;75m@${file}\x1b[0m` : `\x1b[38;5;250m@${file}\x1b[0m`;
    const lineContent = `${marker}${nameStr}`;
    const plainLen = visibleLen(lineContent);
    const pad = Math.max(0, 52 - plainLen);
    lines.push(`\x1b[38;5;240m  │\x1b[0m ${lineContent}${' '.repeat(pad)}\x1b[38;5;240m│\x1b[0m`);
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
export function wrapText(text: string, maxWidth: number): string[] {
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

  const lines: string[] = [];

  lines.push(...renderModeradoHeader().split('\n'));
  lines.push('');

  // Row 1: the user's question
  const questionMarker = '\x1b[1;38;5;75m' + String.fromCodePoint(0x276F) + '\x1b[0;48;5;236m';
  const questionText = `${questionMarker} ${options.chatQuestion ?? ''}`;
  lines.push(String.fromCharCode(27) + '[48;5;236m' + questionText + ' '.repeat(Math.max(0, width - visibleLen(questionText))) + String.fromCharCode(27) + '[0m');
  const thoughtTime = options.chatThoughtTime ?? 0;
  const thoughtTimeLabel = thoughtTime > 0 && thoughtTime < 1 ? '<1s' : `${Math.round(thoughtTime)}s`;
  lines.push(options.chatAnswer?.trim() ? `\x1b[38;5;244mThought for ${thoughtTimeLabel}\x1b[0m` : '');

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

/** Place the terminal cursor on the first row of the bottom composer. */
export function renderChatComposerCursor(options: Pick<WelcomeLayoutOptions, 'width'>, inputLength: number): string {
  const column = getWelcomeIndent(getWelcomeCardWidth(options.width), options.width) + 2 + inputLength;
  return `\x1b[1 q\x1b[?25h\x1b[4A\r\x1b[${column}C`;
}

export function navigateQuestionHistory(history: string[], direction: -1 | 1, index: number, draft: string): { input: string; index: number; draft: string } {
  const nextIndex = Math.max(0, Math.min(history.length, index + direction));
  return { input: nextIndex === history.length ? draft : history[nextIndex], index: nextIndex, draft };
}

/** Update the fixed chat elapsed-time row without repainting the terminal. */
export function renderChatThoughtTimeUpdate(thoughtTime: number): string {
  const label = thoughtTime > 0 && thoughtTime < 1 ? '<1s' : `${Math.round(thoughtTime)}s`;
  return `\x1b7\x1b[13;1H\r\x1b[K\x1b[38;5;244mThought for ${label}\x1b[0m\x1b8`;
}

export interface ChatAnswerPosition { row: number; column: number; }

/** Write one streamed fragment into the answer area without repainting the chat frame. */
export function renderChatAnswerDelta(delta: string, start: ChatAnswerPosition, width: number): ChatAnswerPosition & { sequence: string } {
  let row = start.row;
  let column = start.column;
  for (const character of delta) {
    if (character === '\n') { row++; column = 1; continue; }
    column++;
    if (column > width) { row++; column = 1; }
  }
  return { sequence: `\x1b[${start.row};${start.column}H\x1b[38;5;253m${delta}\x1b[0m`, row, column };
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
  const surface = '\x1b[48;5;236m';
  const lightPopup = popupLines.map((line) =>
    surface + line.replace(/\x1b\[0m/g, `\x1b[0m${surface}`) + '\x1b[0m'
  );
  return background + shadowUnder(lightPopup, cols, rows) + overlayCentered(lightPopup, cols, rows);
}

export function renderHelpPopupBox(version: string, workspace: string, width?: number): string[] {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  const targetWidth = 82;
  const boxWidth = Math.max(76, Math.min(terminalWidth, targetWidth));
  const innerW = boxWidth - 4;
  const shortWs = workspace.length > 38 ? '...' + workspace.slice(-35) : workspace;

  const titleStr = 'Moderado Help & Shortcuts';
  const remainingDashes = Math.max(0, boxWidth - titleStr.length - 5);

  const content: string[] = [
    '\x1b[1;38;5;75mSlash Commands:\x1b[0m',
    '\x1b[1m/init\x1b[0m       Scaffold AGENTS.md from workspace scan',
    '\x1b[1m/model\x1b[0m      Switch active AI model (Free, Paid, or Custom)',
    '\x1b[1m/connect\x1b[0m    Connect NVIDIA NIM or another compatible provider',
    '\x1b[1m/btw\x1b[0m        Ask an ephemeral side question (no session pollution)',
    '\x1b[1m/mcp\x1b[0m       Manage local MCP servers',
    '\x1b[1m/session\x1b[0m   Create, resume, undo, redo, share, export, or compact sessions',
    '\x1b[1m/queue\x1b[0m     Add, inspect, or clear queued follow-up commands',
    '\x1b[1m/workflow\x1b[0m  Inspect Git, build plans, or undo agent changes',
    '\x1b[1m/skills\x1b[0m   List installed user skills and reload them',
    '\x1b[1m/clear\x1b[0m      Reset conversation memory and context history',
    '\x1b[1m/help\x1b[0m       Display this commands, shortcuts & version guide',
    '\x1b[1m/exit\x1b[0m       Exit Moderado session cleanly',
    '',
    '\x1b[1;38;5;114mKeyboard Shortcuts:\x1b[0m',
    '\x1b[1mTab\x1b[0m          Toggle between [Plan] and [Execute] mode',
    '\x1b[1mShift+Tab\x1b[0m    Toggle Auto-approval on / off for actions',
    '\x1b[1mCtrl+C\x1b[0m       Cancel active inference or exit session',
    '\x1b[1mLeft/Right\x1b[0m   Move the caret inside the bottom input line',
    '\x1b[1mMouse click\x1b[0m  Place the caret on the input line',
    '',
    `\x1b[38;5;245mWorkspace:\x1b[0m  \x1b[38;5;253m${shortWs}\x1b[0m`,
    `\x1b[38;5;245mVersion:\x1b[0m    \x1b[1;38;5;75m${version}\x1b[0m`,
    '',
    '\x1b[38;5;244mPress \x1b[1;38;5;75m[Esc]\x1b[0;38;5;244m or \x1b[1;38;5;75m[Enter]\x1b[0;38;5;244m to close\x1b[0m',
  ];

  const lines: string[] = [];
  lines.push('\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + titleStr + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m');
  for (const item of content) {
    const plain = item.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    let displayItem = item;
    if (plain.length > innerW) {
      displayItem = plain.slice(0, innerW - 1) + '…';
    }
    const displayPlain = displayItem.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const spaces = Math.max(0, innerW - displayPlain.length);
    lines.push('\x1b[38;5;240m│\x1b[0m  ' + displayItem + ' '.repeat(spaces) + '\x1b[38;5;240m│\x1b[0m');
  }
  lines.push('\x1b[38;5;240m╰' + '─'.repeat(boxWidth - 2) + '╯\x1b[0m');
  return lines;
}

export let terminalCleanExitDone = false;

/** Mark that a clean exit already restored + cleared the terminal (guards the process 'exit' hook). */
export function notifyCleanExit(): void {
  terminalCleanExitDone = true;
}

export function renderExitMessage(message: string): string {
  return `${MODERADO_ASCII_LOGO.join('\n')}\n\n${message}\n\n`;
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
      MOUSE_REPORT_OFF + '\x1b[?25h\x1b[?1049l\x1b[0 q\x1b[0m\x1b[2J\x1b[3J\x1b[H' + renderExitMessage(message)
    );
  } else {
    stdout.write(renderExitMessage(message));
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
  workflowAction?: 'build';
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
  questionHistory?: string[];
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

/**
 * SGR mouse report, e.g. "\x1b[<0;12;5M" for a primary-button press on column 12
 * of row 5. readline splits that escape into several keypress events ("0", ";",
 * "5", "M"), so the raw data chunk is parsed instead of the derived keystrokes.
 */
const MOUSE_REPORT_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
const MOUSE_REPORT_ON = '\x1b[?1000h\x1b[?1006h';
const MOUSE_REPORT_OFF = '\x1b[?1000l\x1b[?1006l';


export async function promptInteractiveTurn(
  options: PromptInteractiveTurnOptions
): Promise<InteractiveTurnResult> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  let currentModel = options.model;
  let currentMode: 'Plan' | 'Execute' = options.initialMode ?? 'Execute';
  let currentAutoApprove = options.initialAutoApprove ?? false;
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
    queuedCommands: options.queuedCommands,
    isTurnSettled: true,
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
    return mentionFiles.length > 0 ? mentionFiles.length + 2 : 0;
  };

  /** Rows between the painted composer line and the terminal's last row. */
  const getComposerOffset = (): number => getWelcomeBottomPadding(getOptions(), getRows()) + 4 + getExtraLines();

  /** Screen row and 1-based column of the composer's first text cell. */
  const getComposerAnchor = (): { row: number; column: number } => ({
    row: getRows() - getComposerOffset(),
    column: getWelcomeIndent(getWelcomeCardWidth()) + 3,
  });


  /**
   * Move cursor to the ❯ input line (Line 2 inside the centered card).
   * Absolute addressing (`row;column H`) works no matter where the cursor
   * currently sits — relative "move up N" escapes the input line when
   * pressed repeatedly, e.g. browsing history with Left/Right.
   */
  const positionCursorOnInput = () => {
    const { row, column } = getComposerAnchor();
    stdout.write(`\x1b[1 q\x1b[?25h\x1b[${row};${column + caret}H`);
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
          exitCleanly('\x1b[33mSession cancelled.\x1b[0m');
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
          }

          // Selection flow left stdin in non-raw mode — restore it for our TUI
          readlineModule.emitKeypressEvents(stdin);
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

          readlineModule.emitKeypressEvents(stdin);
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
          readlineModule.emitKeypressEvents(stdin);
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
          readlineModule.emitKeypressEvents(stdin);
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
          readlineModule.emitKeypressEvents(stdin);
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
          readlineModule.emitKeypressEvents(stdin);
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
          readlineModule.emitKeypressEvents(stdin);
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
          readlineModule.emitKeypressEvents(stdin); stdin.resume(); stdin.setRawMode(true); redrawFull(); bindComposerInput(); return;
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
          exitCleanly('\x1b[32mGoodbye! Stay Tuned with Moderado!\x1b[0m');
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


