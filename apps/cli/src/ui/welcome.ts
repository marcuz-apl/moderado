import fs from 'node:fs';
import type { GatewayStatusEvent, UsageEvent } from '@moderado/contracts';
import { displayWidth, sliceTailToWidth, sliceToWidth, truncateToWidth } from './box.js';
import { renderChartBlock } from './chart.js';
import { SUMMARY_FENCE } from '../turn_summary.js';
import { closeHttpConnections } from '../http_shutdown.js';
import { overlayCentered, dimLines, shadowUnder } from './popup.js';
import { getHelpCommandGroups } from './help_content.js';

export interface WelcomeLayoutOptions {
  model: string;
  provider?: string;
  tokens: number;
  cost: string;
  usageAvailable?: boolean;
  usageEstimated?: boolean;
  workspace: string;
  mode: 'Plan' | 'Execute';
  autoApprove: boolean;
  input?: string;
  inputCaret?: number;
  width?: number;
  /** Input rows the composer may paint before it scrolls; defaults to the terminal height. */
  maxInputRows?: number;
  /** When set, render the full chat window (question row 1 + answer) instead of the logo header. */
  chatQuestion?: string;
  chatAnswer?: string;
  /** Completed exchanges before the question pinned at the top of this frame. */
  chatHistory?: readonly ChatHistoryTurn[];
  /** Rows the answer is scrolled up from its tail; 0 is the live view. */
  chatAnswerOffset?: number;
  /**
   * Live activity for this turn. When set, the status row carries the current
   * phase and the transcript below it starts with the activity log, so a full
   * frame repaint shows the same thing the incremental paints do.
   */
  chatActivity?: ChatActivityBlock;
  chatThoughtTime?: number;
  /** Settled turn completed successfully — render the "✔ Done" status marker. */
  chatTaskDone?: boolean;
  /** Generated completion tokens per second for the preceding response. */
  outputTokenRate?: number;
  tokenUsage?: UsageEvent;
  budgetStatus?: string;
  mentionFiles?: string[];
  mentionSelection?: number;
  commandSelection?: number;
  queuedCommands?: readonly string[];
  isTurnSettled?: boolean;
}

export const MODERADO_ASCII_LOGO = [
  '\x1b[38;5;75m    __  _______  ____  __________  ___    ____  ____ \x1b[0m',
  '\x1b[38;5;75m   /  |/  / __ \\/ __ \\/ ____/ __ \\/   |  / __ \\/ __ \x1b[0m',
  '\x1b[38;5;81m  / /|_/ / / / / / / / __/ / /_/ / /| | / / / / / / /\x1b[0m',
  '\x1b[38;5;81m / /  / / /_/ / /_/ / /___/ _, _/ ___ |/ /_/ / /_/ / \x1b[0m',
  '\x1b[38;5;87m/_/  /_/\\____/_____/_____/_/ |_/_/  |_/_____/\\____/  \x1b[0m',
];

export const COMMAND_HINT =
  '\x1b[38;5;242mUse \x1b[38;5;75m/\x1b[38;5;242m for slash commands, \x1b[38;5;75m@\x1b[38;5;242m for file mentions\x1b[0m';

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/** Visible (ANSI-stripped) display width of a line, counting wide glyphs as two cells. */
function visibleLen(str: string): number {
  return displayWidth(str);
}

/**
 * SGR mouse report, e.g. "\x1b[<0;12;5M" for a primary-button press on column 12
 * of row 5. readline splits that escape into several keypress events ("0", ";",
 * "5", "M"), so the raw data chunk is parsed instead of the derived keystrokes.
 *
 * These live here rather than in the composer because enabling and disabling
 * mouse reporting is terminal state: `exitCleanly` has to turn it off too.
 */
export const MOUSE_REPORT_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
export const MOUSE_REPORT_ON = '\x1b[?1000h\x1b[?1006h';
export const MOUSE_REPORT_OFF = '\x1b[?1000l\x1b[?1006l';

/**
 * Ask the terminal to report keys whose legacy encoding is ambiguous
 * (XTMODKEYS level 1), which is the only way Shift+Enter can be told apart from
 * Enter. Level 1 leaves unambiguous keys — plain Ctrl+C, Shift+Tab, shifted
 * letters — on their legacy bytes, so nothing else changes behaviour.
 */
export const KEY_MODIFIER_REPORT_ON = '\x1b[>4;1m';
export const KEY_MODIFIER_REPORT_OFF = '\x1b[>4;0m';

/**
 * One visual row of the composer input, as a slice of the raw text. Keeping the
 * offsets means the caret, a click, and a repaint all address the same string
 * instead of a re-flowed copy of it.
 */
export interface ComposerRow {
  text: string;
  /** Index in the raw input where the row starts. */
  start: number;
  /** Index where the row ends (exclusive). */
  end: number;
}

/**
 * Cells a composer row spends on its `❯ ` marker, plus one spare so a full row
 * never reaches the last column (a terminal that wraps on the final cell would
 * push the whole card down a row).
 */
const COMPOSER_ROW_OVERHEAD = 3;

/** Split the composer text into the rows the card paints, wrapping at words. */
export function wrapComposerInput(input: string, width: number): ComposerRow[] {
  const capacity = Math.max(1, width - COMPOSER_ROW_OVERHEAD);
  const rows: ComposerRow[] = [];
  let segmentStart = 0;
  for (;;) {
    const newline = input.indexOf('\n', segmentStart);
    const segmentEnd = newline === -1 ? input.length : newline;
    if (segmentStart === segmentEnd) {
      // An empty line (a bare line feed, or the tail after a trailing one) is
      // still a row: the caret has to have somewhere to sit.
      rows.push({ text: '', start: segmentStart, end: segmentStart });
    } else {
      let cursor = segmentStart;
      while (cursor < segmentEnd) {
        let end = cursor;
        let cells = 0;
        let lastSpace = -1;
        while (end < segmentEnd) {
          const char = String.fromCodePoint(input.codePointAt(end) as number);
          const charWidth = displayWidth(char);
          if (cells + charWidth > capacity) break;
          cells += charWidth;
          end += char.length;
          if (char === ' ') lastSpace = end;
        }
        if (end >= segmentEnd) {
          rows.push({ text: input.slice(cursor, segmentEnd), start: cursor, end: segmentEnd });
          break;
        }
        // Break after the last space so words stay whole; the space itself is
        // swallowed by the break rather than trailing the row. A row that would
        // come out empty (a space at the wrap point) falls through to a hard
        // break instead of emitting a blank row.
        if (lastSpace - 1 > cursor) {
          rows.push({ text: input.slice(cursor, lastSpace - 1), start: cursor, end: lastSpace - 1 });
          cursor = lastSpace;
        } else {
          rows.push({ text: input.slice(cursor, end), start: cursor, end });
          cursor = end;
        }
      }
    }
    if (newline === -1) return rows;
    segmentStart = newline + 1;
  }
}

export interface ComposerView {
  /** Rows to paint, already windowed to the rows the terminal can spare. */
  rows: ComposerRow[];
  /** Row index of the caret inside `rows`. */
  caretRow: number;
  /** Cell offset of the caret inside its row, 0 being the first text cell. */
  caretColumn: number;
  /** Rows scrolled out of view above and below the window. */
  hiddenAbove: number;
  hiddenBelow: number;
}

/**
 * Resolve the composer text into painted rows plus the caret's place in them.
 * The window follows the caret, so a long prompt scrolls inside the box instead
 * of growing the card past the bottom of the terminal.
 */
export function composerView(
  input: string,
  caret: number,
  width: number,
  maxRows: number = Number.POSITIVE_INFINITY,
): ComposerView {
  const all = wrapComposerInput(input, width);
  const clampedCaret = Math.max(0, Math.min(caret, input.length));
  // The last row whose slice contains the caret: at a hard wrap the caret
  // belongs to the row that starts there, at a swallowed space to the row that
  // ends there.
  let caretRow = 0;
  for (let index = 0; index < all.length; index += 1) {
    if (all[index].start <= clampedCaret && clampedCaret <= all[index].end) caretRow = index;
  }
  const limit = Math.max(1, Math.floor(maxRows));
  const start = Math.max(0, Math.min(caretRow - limit + 1, all.length - limit));
  const rows = all.slice(start, start + limit);
  const row = all[caretRow];
  return {
    rows,
    caretRow: caretRow - start,
    caretColumn: Math.min(
      Math.max(1, width - COMPOSER_ROW_OVERHEAD),
      displayWidth(input.slice(row.start, clampedCaret)),
    ),
    hiddenAbove: start,
    hiddenBelow: all.length - start - rows.length,
  };
}

/** Caret index for a click `cells` into a painted row. */
export function composerCaretIndex(input: string, rows: ComposerRow[], rowOffset: number, cells: number): number {
  const row = rows[Math.max(0, Math.min(rows.length - 1, rowOffset))];
  let index = row.start;
  let used = 0;
  while (index < row.end) {
    const char = String.fromCodePoint(input.codePointAt(index) as number);
    const charWidth = displayWidth(char);
    if (used + charWidth > cells) break;
    used += charWidth;
    index += char.length;
  }
  return index;
}

/**
 * Input rows the composer may show before it scrolls in place.
 *
 * The chat frame needs eight rows above the card (header, question, status,
 * answer) and the card keeps four rows of its own furniture, so anything taller
 * than this would scroll the composer off the screen.
 */
export function getComposerInputMaxRows(height?: number): number {
  const terminalHeight = height ?? process.stdout.rows ?? 24;
  return Math.max(1, terminalHeight - 13);
}

/** Card width: nearly full terminal width, like OpenCode/Cline. */
export function getWelcomeCardWidth(width?: number): number {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  return Math.max(70, Math.min(terminalWidth - 2, 120));
}

/** Chat fills the available columns; the startup Welcome card keeps its own width. */
export function getChatCardWidth(width?: number): number {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  return Math.max(1, terminalWidth - 2);
}

/** Left indent that centers a block of `blockWidth` visible columns on the terminal. */
export function getWelcomeIndent(blockWidth: number, width?: number): number {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  return Math.max(0, Math.floor((terminalWidth - blockWidth) / 2));
}

/** Center each line of a block inside the input card's columns (used for the ASCII logo / hints). */
function centerBlock(lines: string[], width?: number): string[] {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  const cardWidth = getWelcomeCardWidth(terminalWidth);
  const cardIndent = getWelcomeIndent(cardWidth, terminalWidth);
  return lines.map((line) => {
    const pad = Math.max(0, Math.floor((cardWidth - visibleLen(line)) / 2));
    return ' '.repeat(cardIndent + pad) + line;
  });
}

/**
 * Geometry of the answer area: it occupies the same columns as the composer
 * card, so the question row, the streamed answer, and the input box all share
 * one width instead of stretching across a wide terminal.
 */
export function getChatAnswerArea(width?: number): { indent: number; cardWidth: number; textWidth: number; startColumn: number; wrapWidth: number } {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  const cardWidth = getChatCardWidth(terminalWidth);
  const indent = getWelcomeIndent(cardWidth, terminalWidth);
  const textWidth = Math.max(1, cardWidth - 2);
  return { indent, cardWidth, textWidth, startColumn: indent + 1, wrapWidth: indent + textWidth };
}

/** The chat header is a single compact brand row. */
export const CHAT_HEADER_ROWS = 1;
/** Rows the composer card occupies: blank surface, input, blank surface, mode, workspace. */
export const CHAT_COMPOSER_ROWS = 5;

export interface ChatLayout {
  area: ReturnType<typeof getChatAnswerArea>;
  questionTop: number;
  questionRows: number;
  statusRow: number;
  answerTop: number;
  answerRows: number;
  composerTop: number;
  /** Real viewport width used to size the chat card. */
  terminalWidth: number;
}

/**
 * Fixed row geometry for the chat window. The answer area is bounded by the
 * composer: a long answer is windowed instead of pushing the input card, the
 * mode row, and the workspace row off screen (or painting over them).
 */
export function getChatLayout(width?: number, height?: number, question = '', composerRows = CHAT_COMPOSER_ROWS): ChatLayout {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  // Honor the real viewport: a hard floor here would emit a frame taller than a
  // short terminal and scroll the composer away. A very short terminal simply
  // shows fewer sections (the composer always wins — see renderChatScreen).
  const terminalHeight = Math.max(2, height ?? (process.stdout.rows || 24));
  const area = getChatAnswerArea(terminalWidth);
  const wrappedQuestion = wrapText(question, Math.max(1, area.textWidth - 2)).length;
  const questionTop = CHAT_HEADER_ROWS + 2;
  // Rows above the answer: header, blank, question rows, status, blank.
  const answerTopOffset = CHAT_HEADER_ROWS + 4;
  // The frame has to end on the second-to-last row: a trailing newline written
  // on the bottom row scrolls the viewport and drags the composer out of place.
  // So the composer is pinned to the viewport bottom and keeps every row it
  // needs — a queued-commands box makes it taller, and the answer area gives up
  // those rows instead of pushing the card off screen.
  const composerTop = Math.max(2, terminalHeight - Math.max(CHAT_COMPOSER_ROWS, composerRows));
  // A pathological question must never starve the answer or the composer; when
  // a tall composer leaves no room at all the question is dropped, not the card.
  const questionRows = Math.max(0, Math.min(wrappedQuestion, composerTop - answerTopOffset - 2));
  const statusRow = questionTop + questionRows;
  const answerTop = statusRow + 2;
  return {
    area,
    questionTop,
    questionRows,
    statusRow,
    answerTop,
    answerRows: Math.max(0, composerTop - 1 - answerTop),
    composerTop,
    terminalWidth,
  };
}

/** Rows the composer card occupies for a given layout, including any queued-commands box. */
export function getChatComposerRows(options: WelcomeLayoutOptions): number {
  return renderWelcomeCard(options).split('\n').length;
}

/** Invisible prefix that marks a rendered line as part of the turn summary. */
const SUMMARY_MARK = '\u0001';

/**
 * Wrap an answer for the card, marking the turn summary as it goes.
 *
 * The fence has to be resolved *before* wrapping, not after: a summary line that
 * wraps would lose its marker on the continuation, and a block whose opening
 * marker scrolled off the top would stop being styled exactly when it is
 * longest. Every wrapped line inside the fence carries `SUMMARY_MARK`, so the
 * renderer can tint any row on its own.
 */
export function wrapAnswerLines(text: string, textWidth: number): string[] {
  const lines: string[] = [];
  let inSummary = false;
  const answerLines = text.split('\n');
  for (let index = 0; index < answerLines.length; index += 1) {
    const rawLine = answerLines[index];
    const trimmed = rawLine.trim();
    if (trimmed === '```chart') {
      const closing = answerLines.findIndex((line, lineIndex) => lineIndex > index && line.trim() === '```');
      if (closing !== -1) {
        const chartLines = renderChartBlock(answerLines.slice(index + 1, closing).join('\n'), textWidth);
        if (chartLines) {
          lines.push(...chartLines);
          index = closing;
          continue;
        }
      }
    }
    if (!inSummary && trimmed === SUMMARY_FENCE) { inSummary = true; continue; }
    if (inSummary && trimmed === '```') { inSummary = false; continue; }
    if (!inSummary) { lines.push(...wrapText(rawLine, textWidth)); continue; }
    // The rail and its gap cost two cells, so summary prose wraps two cells early.
    for (const wrapped of wrapText(rawLine, Math.max(8, textWidth - 2))) lines.push(SUMMARY_MARK + wrapped);
  }
  return lines;
}

/**
 * Window the answer around an offset, measured in rows scrolled up from the
 * tail. `offset = 0` is the live view (newest rows). One row is reserved for the
 * "earlier lines hidden" note whenever anything is above the window.
 */
export function windowChatAnswerAt(
  text: string,
  maxRows: number,
  textWidth: number,
  offsetFromBottom = 0,
): { lines: string[]; hiddenAbove: number; hiddenBelow: number } {
  const wrapped = wrapAnswerLines(text.trimEnd(), textWidth);
  if (wrapped.length <= maxRows) return { lines: wrapped, hiddenAbove: 0, hiddenBelow: 0 };
  // The note costs a row, so the content capacity is one row smaller — and the
  // maximum offset follows from that capacity, not from the raw row count.
  const capacity = Math.max(1, maxRows - 1);
  const maxOffset = Math.max(0, wrapped.length - capacity);
  const offset = Math.max(0, Math.min(Math.round(offsetFromBottom), maxOffset));
  const end = wrapped.length - offset;
  const start = Math.max(0, end - capacity);
  return { lines: wrapped.slice(start, end), hiddenAbove: start, hiddenBelow: wrapped.length - end };
}

/**
 * Style one answer row.
 *
 * Inside the turn-summary fence every row becomes a band: a rail in the accent
 * colour, a tinted background that reaches the right edge of the card, and
 * headings in warm bold. This is what makes the report read as a different kind
 * of thing from the prose above it, rather than three more paragraphs.
 */
export function renderAnswerLine(line: string, textWidth: number): string {
  // Activity-log rows share the window with the answer but read as a record of
  // what happened: dim, no rail, no band. One function, two kinds of row.
  if (line.startsWith(LOG_MARK)) {
    return `\x1b[38;5;244m${truncateToWidth(line.slice(LOG_MARK.length), textWidth)}\x1b[0m`;
  }
  if (!line.startsWith(SUMMARY_MARK)) {
    const heading = line.match(/^\s*(?:#{1,6}\s+([^#]+?)|\*\*(.+?)\*\*)\s*$/);
    return heading
      ? `\x1b[1;38;5;25m${(heading[1] ?? heading[2]).trim()}\x1b[0m`
      : `\x1b[38;5;253m${line}\x1b[0m`;
  }
  const body = line.slice(SUMMARY_MARK.length);
  const heading = body.match(/^#{1,6}\s+(.+)$/);
  const bullet = body.match(/^[-*]\s+(.+)$/);
  const text = heading ? heading[1].trim() : bullet ? `· ${bullet[1].trim()}` : body;
  const tone = heading ? '1;38;5;222' : '38;5;253';
  // Pad to the card so the tint is a solid band instead of a ragged highlight.
  const padded = `${text}${' '.repeat(Math.max(0, textWidth - 2 - displayWidth(text)))}`;
  return `\x1b[48;5;236m\x1b[38;5;75m▍\x1b[0;48;5;236m\x1b[${tone}m ${padded}\x1b[0m`;
}

export function chatAnswerOverflowNote(hidden: number): string {
  // Short on purpose: the status row carries the scroll position, and this row
  // has to fit a 70-column card without wrapping.
  return `… +${hidden} earlier line${hidden === 1 ? '' : 's'} hidden · PgUp`;
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
  const width = options.chatQuestion === undefined
    ? getWelcomeCardWidth(options.width)
    : getChatCardWidth(options.width);
  const indent = ' '.repeat(getWelcomeIndent(width, options.width));

  const inputText = options.input ?? '';
  const inputView = composerView(
    inputText,
    options.inputCaret ?? inputText.length,
    width,
    options.maxInputRows ?? getComposerInputMaxRows(),
  );
  // The placeholder owns the first row only; a typed prompt is wrapped into as
  // many rows as it needs, so the box grows instead of scrolling sideways.
  const inputRows = inputText.length > 0
    ? inputView.rows.map((row) => row.text)
    : ['\x1b[38;5;242mAsk anything, I am all ears...\x1b[0m'];

  const promptMarker = '\x1b[1;38;5;75m' + String.fromCodePoint(0x276F) + '\x1b[0;48;5;236m';
  const surface = '\x1b[48;5;236m';
  const surfaceLine = (content: string = '') => {
    const preserved = content.replace(/\x1b\[0m/g, '\x1b[0;48;5;236m');
    return surface + preserved + ' '.repeat(Math.max(0, width - visibleLen(content))) + '\x1b[0m';
  };

  // Line 4: Plan / Execute (Tab) (right)
  const usageLabel = options.usageAvailable === false ? 'Usage unavailable' : `${options.usageEstimated ? "~" : ""}${options.tokens} tokens`;
  const processUsage = options.tokenUsage
    ? formatTokenUsage(options.tokenUsage)
    : options.outputTokenRate === undefined ? '' : `${Math.round(options.outputTokenRate)} tok/s`;
  const modeSpace = Math.max(0, width - 1 - (options.mode === 'Plan' ? '[Plan] / Execute (Tab)' : 'Plan / [Execute] (Tab)').length);
  const details = `${usageLabel} / ${options.cost}`;
  const processSuffix = options.chatQuestion ? ` | ${details}${options.budgetStatus ? ` | ${options.budgetStatus}` : ''}` : '';
  const processCapacity = Math.max(0, modeSpace - processSuffix.length);
  const processPrefix = processUsage.length > processCapacity
    ? `${processUsage.slice(0, Math.max(0, processCapacity - 1))}…`.slice(0, processCapacity)
    : processUsage;
  const processInfo = options.chatQuestion ? `${processPrefix}${processSuffix}` : details.slice(0, modeSpace);
  const left4 = processInfo ? `\x1b[38;5;244m${processInfo}\x1b[0m` : '';

  const compactChatFooter = options.chatQuestion !== undefined && width < 72;
  const right4Raw = compactChatFooter
    ? options.mode === 'Plan' ? '[Plan]' : '[Execute]'
    : options.mode === 'Plan' ? '[Plan] / Execute (Tab)' : 'Plan / [Execute] (Tab)';
  const compactMode = right4Raw.length > width ? (options.mode === 'Plan' ? 'P' : 'E') : right4Raw;
  const right4 = compactChatFooter
    ? `\x1b[1;38;5;75m${compactMode}\x1b[0m`
    : options.mode === 'Plan'
      ? '\x1b[1;38;5;75m[Plan]\x1b[0m / Execute (Tab)'
      : 'Plan / \x1b[1;38;5;75m[Execute]\x1b[0m (Tab)';
  const right4Visible = compactChatFooter ? compactMode : right4Raw;
  const left4Fit = compactChatFooter
    ? truncateToWidth(processInfo, Math.max(0, width - right4Visible.length - 1))
    : left4;
  const spaces4Count = Math.max(0, width - visibleLen(left4Fit) - right4Visible.length);
  const line4 = left4Fit + ' '.repeat(spaces4Count) + right4;

  // Line 5: Working directory (left) ... provider, model, and Auto-approve (right)
  const approvalLabelRaw = compactChatFooter
    ? width < 20 ? (options.autoApprove ? 'On' : 'Off') : (options.autoApprove ? 'Auto-approve on' : 'Auto-approve off')
    : options.autoApprove ? 'Auto-approve enabled (Shift+Tab)' : 'Auto-approve off (Shift+Tab)';
  const modelSpace = Math.max(8, width - approvalLabelRaw.length - 10);
  const provider = options.provider?.trim() ?? '';
  const providerSpace = Math.max(1, modelSpace - 6);
  const shortProvider = provider.length > providerSpace ? provider.slice(0, providerSpace - 1) + '…' : provider;
  const prefix = shortProvider ? `${shortProvider} | ` : '';
  const availableModelSpace = modelSpace - prefix.length;
  const shortModel = options.model.length > availableModelSpace
    ? availableModelSpace > 3 ? '...' + options.model.slice(-(availableModelSpace - 3)) : options.model.slice(-availableModelSpace)
    : options.model;
  const modelText = prefix + shortModel;
  const workspaceSpace = Math.max(3, width - approvalLabelRaw.length - modelText.length - 2);
  const shortWs =
    options.workspace.length > workspaceSpace
      ? '...' + options.workspace.slice(-(workspaceSpace - 3))
      : options.workspace;
  const left5 = `\x1b[38;5;245m${shortWs}\x1b[0m`;

  const approvalLabel = options.autoApprove
    ? '\x1b[38;5;114mAuto-approve enabled (Shift+Tab)\x1b[0m'
    : '\x1b[38;5;242mAuto-approve off (Shift+Tab)\x1b[0m';
  const modelLabel = `\x1b[38;5;180m${modelText}\x1b[0m`;
  const spaces5Count = Math.max(1, width - shortWs.length - modelText.length - approvalLabelRaw.length - 1);
  const line5 = compactChatFooter
    ? (() => {
      const fieldBudget = Math.max(0, width - approvalLabelRaw.length - 2);
      const workspaceBudget = Math.ceil(fieldBudget / 2);
      const modelBudget = fieldBudget - workspaceBudget;
      const workspaceText = sliceTailToWidth(options.workspace, workspaceBudget);
      const modelField = sliceTailToWidth(modelText, modelBudget);
      if (fieldBudget === 0) return truncateToWidth(approvalLabel, width);
      const fields = [
        workspaceText ? `\x1b[38;5;245m${workspaceText}\x1b[0m` : '',
        modelField ? `\x1b[38;5;180m${modelField}\x1b[0m` : '',
        `\x1b[38;5;242m${approvalLabelRaw}\x1b[0m`,
      ].filter(Boolean);
      return fields.join(' ');
    })()
    : left5 + ' '.repeat(spaces5Count) + modelLabel + ' ' + approvalLabel;

  const cardLines: string[] = [];
  const queuedBox = renderQueuedCommandsBox(options.queuedCommands ?? [], width);
  if (queuedBox.length > 0) {
    cardLines.push(...queuedBox.map((line) => indent + line));
    cardLines.push('');
  }

  if (!options.mentionFiles?.length && options.input?.startsWith('/')) {
    const matching = getMatchingCommands(options.input);
    if (matching.length) cardLines.push(...renderSuggestionsBox(matching, width, options.commandSelection ?? 0).map(line => indent + line));
  }

  cardLines.push(
    indent + surfaceLine(),
    // Continuation rows keep the marker's two cells, so wrapped text lines up
    // under the first row's text instead of under the ❯.
    ...inputRows.map((rowText, index) => indent + surfaceLine(`${index === 0 ? promptMarker : '  '} ${rowText}`)),
    indent + surfaceLine(),
    indent + line4,
    indent + line5,
  );

  if (options.mentionFiles && options.mentionFiles.length > 0) {
    cardLines.push(...renderMentionSuggestionsBox(options.mentionFiles, options.mentionSelection ?? 0, width).map((line) => indent + line));

  }

  return cardLines.join('\n');
}

export interface SlashCommand {
  name: string;
  desc: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/connect', desc: 'Choose a Gateway, hosted, or local provider' },
  { name: '/model', desc: 'Switch active AI model' },
  { name: '/init', desc: 'Scaffold AGENTS.md from workspace scan' },
  { name: '/btw', desc: 'Ask an ephemeral side question (no session pollution)' },
  { name: '/mcp', desc: 'Manage local MCP servers' },
  { name: '/session', desc: 'Create, resume, undo, redo, share, export, or compact sessions' },
  { name: '/queue', desc: 'Add, inspect, or clear queued follow-up commands' },
  { name: '/workflow', desc: 'Inspect Git, build plans, or undo agent changes' },
  { name: '/review', desc: 'Review current workspace changes for bugs' },
  { name: '/map', desc: 'Show a compact workspace file map' },
  { name: '/budget', desc: 'Set a per-task token limit' },
  { name: '/skills', desc: 'List skills; enable or disable user skills' },
  { name: '/clear', desc: 'Reset conversation memory' },
  { name: '/about', desc: 'Show version and copyright info' },
  { name: '/help', desc: 'Display commands & shortcuts' },
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

export function renderSuggestionsBox(commands: SlashCommand[], width?: number, selectedIndex = 0): string[] {
  if (commands.length === 0) return [];
  // Exactly the card width so the box shares the composer's columns instead of
  // forcing its own (previously a 78–82 fixed width that escaped narrow cards).
  const boxWidth = width ?? getWelcomeCardWidth(process.stdout?.columns || 80);
  const innerW = boxWidth - 4;
  const title = 'Commands (↑↓ browse, Tab to insert)';
  const remainingDashes = Math.max(0, boxWidth - title.length - 5);
  const nameColWidth = 10;
  const availDescWidth = Math.max(20, innerW - nameColWidth - 2);

  const lines: string[] = [];
  lines.push('\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + title + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m');
  for (const [index, cmd] of commands.entries()) {
    const isSelected = index === selectedIndex;
    let desc = cmd.desc;
    if (desc.length > availDescWidth) {
      desc = desc.slice(0, availDescWidth - 1) + '…';
    }
    const nameCell = cmd.name.padEnd(nameColWidth);
    const descCell = desc.padEnd(availDescWidth);
    if (isSelected) {
      // Highlight bar matches the app's list popups: a ❯ cursor plus a dark
      // background across the whole row, so the arrow-key selection is visible.
      lines.push(
        '\x1b[38;5;240m│\x1b[0m' +
        '\x1b[48;5;236m\x1b[1;38;5;75m❯ ' + nameCell +
        '\x1b[0;48;5;236;38;5;253m  ' + descCell + '\x1b[0m' +
        '\x1b[38;5;240m│\x1b[0m'
      );
    } else {
      lines.push(
        '\x1b[38;5;240m│\x1b[0m' +
        '  ' + `\x1b[1;38;5;75m${nameCell}\x1b[0m` + '  ' +
        `\x1b[38;5;244m${descCell}\x1b[0m` +
        '\x1b[38;5;240m│\x1b[0m'
      );
    }
  }
  lines.push('\x1b[38;5;240m╰' + '─'.repeat(boxWidth - 2) + '╯\x1b[0m');
  return lines;
}

export function renderMentionSuggestionsBox(files: string[], selectedIndex = 0, width?: number): string[] {
  if (files.length === 0) return [];
  // Sized to the composer card (like the queued/commands boxes) so it never
  // breaks the card's left/right boundary.
  const boxWidth = width ?? getWelcomeCardWidth(process.stdout?.columns || 80);
  const title = 'Files (@ to mention, Tab to insert)';
  const lines: string[] = [];
  const remainingDashes = Math.max(0, boxWidth - title.length - 5);
  lines.push('\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + title + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m');
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const isSelected = i === selectedIndex;
    const marker = isSelected ? '\x1b[1;38;5;75m❯ \x1b[0m' : '  ';
    // Visible budget: │ + space + marker(2) + label + pad + │ = boxWidth.
    const labelCapacity = Math.max(4, boxWidth - 5);
    let label = `@${file}`;
    if (label.length > labelCapacity) label = `@${file.slice(0, Math.max(1, labelCapacity - 4))}...`;
    const nameStr = isSelected ? `\x1b[1;38;5;75m${label}\x1b[0m` : `\x1b[38;5;250m${label}\x1b[0m`;
    const pad = Math.max(0, boxWidth - 5 - label.length);
    lines.push(`\x1b[38;5;240m│\x1b[0m ${marker}${nameStr}${' '.repeat(pad)}\x1b[38;5;240m│\x1b[0m`);
  }
  lines.push('\x1b[38;5;240m╰' + '─'.repeat(Math.max(0, boxWidth - 2)) + '╯\x1b[0m');
  return lines;
}

export function renderModeradoHeader(width?: number): string {
  return [
    '',
    ...centerBlock(MODERADO_ASCII_LOGO, width),
    '',
    ...centerBlock([COMMAND_HINT], width),
  ].join('\n');
}

/** Compact wordmark used after the welcome screen transitions into chat. */
export function renderChatHeader(width?: number): string {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  const label = 'MODERADO'.slice(0, Math.max(1, terminalWidth));
  return ' '.repeat(Math.max(0, terminalWidth - label.length)) + `\x1b[1;38;5;75m${label}\x1b[0m`;
}

/** Word-wrap plain text to `maxWidth` visible columns, hard-breaking long words. */
export function wrapText(text: string, maxWidth: number): string[] {
  const out: string[] = [];
  const pushWrapped = (word: string): void => {
    // A single word longer than the column budget is split so no line overflows.
    // Splitting by display width keeps CJK text (one unbroken run of glyphs)
    // inside the card instead of overflowing it by a factor of two.
    let current = '';
    for (const char of word) {
      if (current && displayWidth(current) + displayWidth(char) > maxWidth) {
        out.push(current);
        current = '';
      }
      current += char;
    }
    if (current) out.push(current);
  };
  for (const rawLine of text.split('\n')) {
    if (displayWidth(rawLine) <= maxWidth) {
      out.push(rawLine);
      continue;
    }
    let current = '';
    for (const word of rawLine.split(' ')) {
      if (displayWidth(word) > maxWidth) {
        if (current.length > 0) { out.push(current); current = ''; }
        pushWrapped(word);
        continue;
      }
      if (current.length === 0) {
        current = word;
      } else if (displayWidth(current) + 1 + displayWidth(word) <= maxWidth) {
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
  const question = options.chatQuestion ?? '';
  // The composer is measured before the layout: a queued-commands box or a
  // mention box makes the card taller, and the answer area must give up those
  // rows instead of pushing the card past the bottom of the viewport.
  const cardOptions = options.maxInputRows === undefined
    ? { ...options, maxInputRows: getComposerInputMaxRows(terminalHeight) }
    : options;
  const composer = renderWelcomeCard(cardOptions).split('\n');
  const layout = getChatLayout(terminalWidth, terminalHeight, question, composer.length);
  const area = layout.area;
  const indent = ' '.repeat(area.indent);
  const lines: string[] = [];
  lines.push(renderChatHeader(terminalWidth));
  lines.push('');
  // Row 1: the user's question, wrapped onto the same columns as the composer card.
  const questionMarker = '\x1b[1;38;5;75m' + String.fromCodePoint(0x276F) + '\x1b[0;48;5;236m';
  const questionLines = wrapText(question, Math.max(1, area.textWidth - 2));
  const visibleQuestion = questionLines.slice(0, layout.questionRows);
  for (const [index, questionLine] of visibleQuestion.entries()) {
    const clipped = index === layout.questionRows - 1 && questionLines.length > layout.questionRows
      ? `${questionLine.slice(0, Math.max(0, area.textWidth - 3))}…`
      : questionLine;
    const questionText = `${index === 0 ? questionMarker : '  '} ${clipped}`;
    lines.push(indent + String.fromCharCode(27) + '[48;5;236m' + questionText + ' '.repeat(Math.max(0, area.cardWidth - visibleLen(questionText))) + String.fromCharCode(27) + '[0m');
  }
  const thoughtTime = options.chatThoughtTime ?? 0;
  const thoughtTimeLabel = thoughtTime > 0 && thoughtTime < 1 ? '<1s' : `${Math.round(thoughtTime)}s`;
  const answerText = options.chatAnswer ?? '';
  const answerOffset = options.chatAnswerOffset ?? 0;
  // The activity log and the answer are one list, so both the scroll position
  // and the window are computed over the merged rows.
  const transcriptWidth = getChatTranscriptWidth(layout);
  const transcript = buildChatTranscriptRows(options.chatActivity, answerText, transcriptWidth, options.chatHistory);
  // While the reader is scrolled up, the status row belongs to the scroll
  // position: the turn clock is not what they are looking for.
  const scrollWindow = transcript.rows.length > 0 && layout.answerRows > 0 && answerOffset > 0
    ? windowChatTranscriptAt(transcript.rows, layout.answerRows, answerOffset)
    : undefined;
  const activityElapsed = options.chatActivity
    ? (options.chatActivity.elapsedLabel ?? formatElapsed(thoughtTime))
    : '';
  // An offset that no longer hides anything (the answer shrank, or the viewport
  // grew) must report the live view, not claim a scroll position that is gone.
  // Sitting at the very top still counts: rows are hidden *below* the window.
  const scrolled = scrollWindow !== undefined
    && (scrollWindow.hiddenAbove > 0 || scrollWindow.hiddenBelow > 0);
  const chatStatus = scrolled
    ? `${scrollWindow.hiddenAbove === 0 ? (options.chatHistory?.length ? 'Top of history' : 'Top of the turn') : `↑ ${scrollWindow.hiddenAbove} above`} · ↓ ${scrollWindow.hiddenBelow} below · PgUp/PgDn`
    : options.chatActivity
    ? truncateToWidth(`${options.chatActivity.glyph} ${options.chatActivity.label} · ${activityElapsed}`, transcriptWidth)
    : !answerText.trim()
    ? ''
    : options.chatTaskDone
    ? `✔ Done · Thought for ${thoughtTimeLabel}`
    : options.tokenUsage
    ? ''
    : `Thought for ${thoughtTimeLabel}`;
  lines.push(chatStatus
    ? indent + `\x1b[38;5;244m${chatStatus}\x1b[0m`
    : '');
  // Transcript section: the activity log followed by the answer, windowed to the
  // rows the composer leaves free. The log is never dropped to make room for the
  // answer — that trade is what produced the one-line view.
  if (transcript.rows.length > 0 && layout.answerRows > 0) {
    lines.push('');
    const { lines: transcriptLines, hiddenAbove } = windowChatTranscriptAt(transcript.rows, layout.answerRows, answerOffset);
    if (hiddenAbove > 0) lines.push(indent + `\x1b[38;5;244m${truncateToWidth(chatAnswerOverflowNote(hiddenAbove), transcriptWidth)}\x1b[0m`);
    for (const transcriptLine of transcriptLines) {
      lines.push(indent + renderAnswerLine(transcriptLine, getChatTranscriptWidth(layout)));
    }
  }
  // Hard guarantee: the composer starts at `composerTop` and the frame ends one
  // row above the viewport bottom, whatever the content did. This holds for any
  // composer the viewport can hold (rows >= card height + 2); a terminal too
  // short to show the card at all cannot be contained by layout arithmetic.
  while (lines.length < layout.composerTop - 1) lines.push('');
  if (lines.length > layout.composerTop - 1) lines.length = layout.composerTop - 1;
  lines.push(...composer);
  return lines.join('\n') + '\n';
}

/**
 * Place the terminal cursor on the caret's row inside the input box. Passing
 * the layout's `composerTop` addresses the row absolutely, which stays correct
 * when the card grows (a queued-commands box or a wrapped prompt); the relative
 * form is the legacy path.
 */
export function renderChatComposerCursor(
  options: Pick<WelcomeLayoutOptions, 'width'>,
  input: string,
  composerTop?: number,
): string {
  const width = getChatCardWidth(options.width);
  const indent = getWelcomeIndent(width, options.width);
  const view = composerView(input, input.length, width, getComposerInputMaxRows());
  const caretColumn = indent + 2 + view.caretColumn;
  if (composerTop !== undefined) return `\x1b[1 q\x1b[?25h\x1b[${composerTop + 1 + view.caretRow};${caretColumn + 1}H`;
  return `\x1b[1 q\x1b[?25h\x1b[${4 + view.caretRow}A\r\x1b[${caretColumn}C`;
}

export function navigateQuestionHistory(history: string[], direction: -1 | 1, index: number, draft: string): { input: string; index: number; draft: string } {
  const nextIndex = Math.max(0, Math.min(history.length, index + direction));
  return { input: nextIndex === history.length ? draft : history[nextIndex], index: nextIndex, draft };
}

export interface ChatActivity {
  /** Leading glyph: a spinner frame while the turn runs, a check when it settles. */
  glyph: string;
  /** What the agent is doing right now, for example `Editing src/app.ts`. */
  label: string;
  /**
   * The newest reasoning text, already collapsed to one line. Only the tail is
   * painted — enough to show the model is working through something, without
   * turning the status row into a transcript.
   */
  reasoning?: string;
  /**
   * Replaces the turn clock on the row. Used while waiting on the model, where
   * "no output for 30s" says more than the total turn time.
   */
  elapsedLabel?: string;
}

/** Silence before the row admits it is waiting on the model. */
export const WAIT_NOTICE_AFTER_MS = 10_000;

/** How often that notice is refreshed while the wait continues. */
export const WAIT_NOTICE_REPEAT_MS = 20_000;

export interface WaitNotice {
  /** Phase label for the row. */
  label: string;
  /** Clock replacement; only set once the wait has been re-announced. */
  elapsedLabel?: string;
}

/**
 * What to say while the model has produced nothing.
 *
 * Silent for the first ten seconds — that is normal inference. After that the
 * row says it is waiting, and re-announces every twenty seconds with the length
 * of the silence, so a long wait never looks like a hung process. The bucket is
 * quantised so the line changes on that cadence instead of every second.
 */
export function describeWait(silentForMs: number): WaitNotice | undefined {
  if (!Number.isFinite(silentForMs) || silentForMs < WAIT_NOTICE_AFTER_MS) return undefined;
  const repeats = Math.floor((silentForMs - WAIT_NOTICE_AFTER_MS) / WAIT_NOTICE_REPEAT_MS);
  if (repeats === 0) return { label: 'Waiting on the model' };
  const announcedAt = (WAIT_NOTICE_AFTER_MS + repeats * WAIT_NOTICE_REPEAT_MS) / 1000;
  return { label: 'Waiting on the model', elapsedLabel: `no output for ${announcedAt}s` };
}

/**
 * Elapsed time as a short label: `8s`, `1m 04s`.
 *
 * This replaced the step counter. `Step 1/25` was true for minutes at a time
 * while one inference ran, so it measured the engine's internal loop rather
 * than anything the person waiting could act on.
 */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 1) return '<1s';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
}

/**
 * Shorten the middle of a label, keeping the head (the verb) and the tail (the
 * filename, which is the part a person actually reads). Measured in terminal
 * cells, not code units, so a CJK path cannot overflow the card.
 */
export function elideMiddle(text: string, max: number): string {
  if (max <= 0) return '';
  if (displayWidth(text) <= max) return text;
  if (max <= 3) return truncateToWidth(text, max);
  const budget = max - 1;
  const head = Math.ceil(budget / 2);
  const tail = budget - head;
  return `${sliceToWidth(text, head)}…${sliceTailToWidth(text, tail)}`;
}

/**
 * Shorten the engine's progress sentence into a phase the user can follow.
 *
 * The status row is the only thing moving during a long, silent inference — the
 * reasoning stream is deliberately not displayed — so it names what the agent is
 * doing instead of repeating the step counter.
 */
export function describeActivity(status: string): string {
  const text = status
    .trim()
    .replace(/^step\s+\d+\s*\/\s*\d+\s*:\s*/i, '')
    .replace(/\s*\.{3}$/, '')
    .trim();
  if (/^inferring\b/i.test(text)) return 'Thinking';
  if (/^discovering and selecting models/i.test(text)) return 'Selecting model';
  if (/^retrying\b/i.test(text)) return 'Retrying request';
  if (/^delegating sub-task/i.test(text)) return 'Delegating a sub-task';
  return text || 'Working';
}

const TOOL_VERBS: Record<string, string> = {
  read_file: 'Reading',
  write_file: 'Writing',
  edit_file: 'Editing',
  apply_patch: 'Editing',
  list_files: 'Listing',
  search_files: 'Searching',
  run_command: 'Running',
  run_diagnostics: 'Running',
};

/**
 * Name the work a tool call is about to do, from its parameters.
 *
 * `Running read_file` told the person nothing they could not already see; the
 * path does. This is the part of the status row that keeps moving during a long
 * coding turn, so it carries the real target.
 */
export function describeToolActivity(toolName: string, parameters: Record<string, unknown> = {}): string {
  const text = (key: string): string | undefined => {
    const value = parameters[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  if (toolName === 'apply_patch') {
    const edits = Array.isArray(parameters.edits) ? parameters.edits : [];
    if (edits.length > 1) return `Editing ${edits.length} files`;
    const first = edits[0] as { path?: unknown } | undefined;
    const path = typeof first?.path === 'string' ? first.path : undefined;
    return path ? `Editing ${path}` : 'Editing files';
  }
  if (toolName === 'run_command') {
    const command = text('command');
    if (!command) return 'Running a command';
    const args = Array.isArray(parameters.args)
      ? parameters.args.filter((arg): arg is string => typeof arg === 'string')
      : [];
    return `Running ${[command, ...args].join(' ')}`;
  }
  if (toolName === 'search_files') {
    const query = text('query');
    return query ? `Searching "${query}"` : 'Searching the workspace';
  }
  if (toolName === 'list_files') {
    const subpath = text('subpath');
    return subpath && subpath !== '.' ? `Listing ${subpath}` : 'Listing the workspace';
  }
  if (toolName === 'run_diagnostics') {
    const script = text('script');
    return script ? `Running ${script}` : 'Running diagnostics';
  }
  if (toolName === 'web_search') return 'Searching the web';
  if (toolName === 'git_diff') return 'Checking changes';
  const verb = TOOL_VERBS[toolName];
  const path = text('path');
  if (verb && path) return `${verb} ${path}`;
  if (verb) return verb;
  return `Running ${toolName}`;
}

/**
 * Update the fixed chat elapsed-time row without repainting the terminal.
 * With an activity, the row is a live "still running" indicator that stays
 * visible after text starts streaming and during silent tool execution.
 */
export function renderChatThoughtTimeUpdate(
  thoughtTime: number,
  width?: number,
  activity?: ChatActivity,
  row = 13,
): string {
  const area = getChatAnswerArea(width);
  // A wait phase reports silence, not the turn clock; two timers side by side
  // would be ambiguous.
  const elapsed = activity?.elapsedLabel ?? formatElapsed(thoughtTime);
  const paint = (status: string): string =>
    `\x1b7\x1b[${row};${area.startColumn}H\x1b[K\x1b[38;5;244m${truncateToWidth(status, area.cardWidth)}\x1b[0m\x1b8`;
  if (!activity) return paint(`Thought for ${elapsed}`);
  // The timer is reserved before the label gets any room, so a long path can
  // never push the elapsed time off the row.
  const timer = ` · ${elapsed}`;
  const timerCells = displayWidth(timer);
  const label = elideMiddle(
    // The engine's sentence often carries its own step prefix; the row no longer
    // prints a counter, so drop it rather than showing engine internals.
    `${activity.glyph} ${activity.label.replace(/^step\s+\d+\s*\/\s*\d+\s*:\s*/i, '')}`,
    Math.max(12, area.cardWidth - timerCells - 2),
  );
  const reasoning = activity.reasoning?.replace(/\s+/g, ' ').trim() ?? '';
  // Everything here is measured in cells: a CJK reasoning tail is twice as wide
  // as its length suggests, and the overflow used to wrap outside the card.
  const room = area.cardWidth - displayWidth(label) - timerCells - 3;
  const excerpt = reasoning && room > 8
    ? (displayWidth(reasoning) > room ? `…${sliceTailToWidth(reasoning, room - 1)}` : reasoning)
    : '';
  // Clock first, then the message: the timer belongs to the phase, so the
  // trailing text can be cut without taking the time with it.
  return paint(excerpt ? `${label}${timer} · ${excerpt}` : `${label}${timer}`);
}

/** One tool call in the live activity log. */
export interface ActivityEntry {
  /** `⠼` while running, `✔` done, `✖` failed, `⊘` denied. */
  glyph: string;
  /** Already humanised: `Reading src/ui/welcome.ts`, not `read_file`. */
  label: string;
  tone: 'active' | 'done' | 'failed';
}

/** Everything the live activity block needs for one frame. */
export interface ChatActivityBlock {
  glyph: string;
  label: string;
  /** Newest reasoning tail, wrapped over as many rows as it can fill. */
  reasoning?: string;
  /** Replaces the turn clock while waiting on the model. */
  elapsedLabel?: string;
  /** Oldest first; the newest entry sits closest to the current phase. */
  history?: ActivityEntry[];
}

export interface ChatHistoryTurn {
  question: string;
  answer: string;
}


/**
 * Invisible prefix marking a rendered row as part of the live activity log.
 *
 * A second mark next to `SUMMARY_MARK` lets one renderer style both kinds of
 * row in the same scrollable list without them knowing about each other.
 */
const LOG_MARK = '\u0002';

/**
 * Cells the transcript may use on this layout.
 *
 * The card has a 70-column floor, the terminal does not: on a narrow window the
 * transcript still has to stop at the screen edge, not at the card's. Wrapping
 * to the card width and painting anyway is what let a long row spill past the
 * right border of the frame, so the wrap width is the narrower of the two and
 * every row is clamped to it.
 */
export function getChatTranscriptWidth(layout: ChatLayout): number {
  const { area } = layout;
  return Math.min(area.textWidth, Math.min(area.cardWidth, Math.max(8, layout.terminalWidth - area.startColumn + 1)));
}

/**
 * Rows of the live turn transcript: the activity log first, the answer after.
 *
 * This is the Cline model. Cline keeps one scrollable list where every action
 * and every message is a row, the newest pinned to the bottom and the rest
 * reachable by scrolling. Merging the two here is what fixes "the output
 * becomes one line again": the activity log used to be a separate block that
 * handed its rows back the moment the first token streamed, so a long fix
 * explanation left nothing on screen but a single clipped status row — exactly
 * when there was most to read.
 *
 * The log and the answer now share the window, so the record of what the agent
 * did and the answer it produced are read in one place and scroll together.
 */
export function buildChatTranscriptRows(
  activity: ChatActivityBlock | undefined,
  answer: string,
  textWidth: number,
  history: readonly ChatHistoryTurn[] = [],
): { rows: string[]; answerStart: number } {
  const rows: string[] = [];
  for (const turn of history) {
    rows.push(...wrapText(`❯ ${turn.question}`, textWidth).map((line) => LOG_MARK + line));
    rows.push(...wrapAnswerLines(turn.answer.trimEnd(), textWidth));
    rows.push('');
  }
  for (const entry of activity?.history ?? []) {
    rows.push(LOG_MARK + `${entry.glyph} ${entry.label}`);
  }
  const reasoning = activity?.reasoning?.replace(/\s+/g, ' ').trim();
  if (reasoning) {
    // Two columns of indent mark the thought as subordinate to the phase, and
    // wrapping (not truncating) is what turns one clipped line into prose.
    for (const line of wrapText(reasoning, Math.max(8, textWidth - 2))) rows.push(LOG_MARK + `  ${line}`);
  }
  const answerStart = rows.length;
  if (answer.trim().length > 0) rows.push(...wrapAnswerLines(answer.trimEnd(), textWidth));
  return { rows, answerStart };
}

/**
 * Window the transcript around an offset, measured in rows scrolled up from the
 * tail. `offset = 0` is the live view (newest rows). One row is reserved for
 * the "earlier lines hidden" note whenever anything is above the window.
 */
export function windowChatTranscriptAt(
  rows: readonly string[],
  maxRows: number,
  offsetFromBottom = 0,
): { lines: string[]; hiddenAbove: number; hiddenBelow: number } {
  if (rows.length <= maxRows) return { lines: [...rows], hiddenAbove: 0, hiddenBelow: 0 };
  // The note costs a row, so the content capacity is one row smaller — and the
  // maximum offset follows from that capacity, not from the raw row count.
  const capacity = Math.max(1, maxRows - 1);
  const maxOffset = Math.max(0, rows.length - capacity);
  const offset = Math.max(0, Math.min(Math.round(offsetFromBottom), maxOffset));
  const end = rows.length - offset;
  const start = Math.max(0, end - capacity);
  return { lines: [...rows.slice(start, end)], hiddenAbove: start, hiddenBelow: rows.length - end };
}

/** Rows the transcript occupies for a layout; 0 when the viewport is tiny. */
export function getChatTranscriptRows(layout: ChatLayout): number {
  return Math.max(0, layout.answerRows);
}

/**
 * Paint the pinned phase header on the status row.
 *
 * One row, always: the phase and its clock. Everything it used to squeeze into
 * that row now lives in the transcript below it.
 */
export function renderChatTranscriptHeader(
  activity: ChatActivityBlock,
  layout: ChatLayout,
  thoughtTime: number,
): string {
  const { area } = layout;
  const cells = getChatTranscriptWidth(layout);
  const elapsed = activity.elapsedLabel ?? formatElapsed(thoughtTime);
  const header = `\x1b[38;5;250m${truncateToWidth(`${activity.glyph} ${activity.label} · ${elapsed}`, cells)}\x1b[0m`;
  return `\x1b7\x1b[${layout.statusRow};${area.startColumn}H\x1b[2K${header}\x1b8`;
}

/**
 * Repaint the transcript in place: exactly the rows the layout reserves,
 * between the status row and the composer. The window scrolls (oldest rows
 * leave first) instead of writing over the composer, so a long turn can never
 * damage the bottom rows. The cursor is saved and restored, so the caller keeps
 * its position on the input line.
 *
 * Unlike the answer window it replaced, this never gives its rows up: the log
 * and the answer are one list, so the newest rows stay on screen and the rest
 * is one PgUp away. Every row is clamped to the card in terminal cells, so a
 * wide CJK glyph or a long path cannot push a row past the right border.
 */
export function renderChatTranscriptWindow(
  activity: ChatActivityBlock | undefined,
  answer: string,
  layout: ChatLayout,
  offsetFromBottom = 0,
  history: readonly ChatHistoryTurn[] = [],
): string {
  const { area } = layout;
  const cells = getChatTranscriptWidth(layout);
  const { rows } = buildChatTranscriptRows(activity, answer, cells, history);
  const { lines, hiddenAbove } = windowChatTranscriptAt(rows, layout.answerRows, offsetFromBottom);
  const visible = hiddenAbove > 0
    ? [`\x1b[38;5;244m${truncateToWidth(chatAnswerOverflowNote(hiddenAbove), cells)}\x1b[0m`, ...lines.map((line) => renderAnswerLine(line, cells))]
    : lines.map((line) => renderAnswerLine(line, cells));
  let sequence = '\x1b7';
  for (let index = 0; index < layout.answerRows; index++) {
    const row = layout.answerTop + index;
    sequence += `\x1b[${row};${area.startColumn}H\x1b[2K${visible[index] ?? ''}`;
  }
  return sequence + '\x1b8';
}

export function renderFullWelcomeScreen(options: WelcomeLayoutOptions, height?: number): string {
  if (options.chatQuestion !== undefined) {
    return renderChatScreen(options, height);
  }
  return [
    renderModeradoHeader(options.width),
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

export function renderHelpPopupBox(_version: string, workspace: string, width?: number): string[] {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  const targetWidth = 82;
  const boxWidth = Math.max(76, Math.min(terminalWidth, targetWidth));
  const innerW = boxWidth - 4;
  const shortWs = workspace.length > 38 ? '...' + workspace.slice(-35) : workspace;

  const titleStr = 'Moderado Help & Shortcuts';
  const remainingDashes = Math.max(0, boxWidth - titleStr.length - 5);

  const content: string[] = [
    '\x1b[1;38;5;75mSlash Commands:\x1b[0m',
    ...getHelpCommandGroups().flatMap(({ name, commands }) => [
      `\x1b[1;38;5;180m${name}:\x1b[0m`,
      ...commands.map(([command, description]) => `\x1b[1m${command.padEnd(11)}\x1b[0m${description}`),
    ]),
    '',
    '\x1b[1;38;5;114mKeyboard Shortcuts:\x1b[0m',
    '\x1b[1mTab\x1b[0m          Toggle between [Plan] and [Execute] mode',
    '\x1b[1mShift+Tab\x1b[0m    Toggle Auto-approval on / off for actions',
    '\x1b[1mShift+Enter\x1b[0m  Insert a line break (Ctrl+J works everywhere)',
    '\x1b[1mCtrl+C\x1b[0m       Cancel active inference or exit session',
    '\x1b[1mEsc\x1b[0m          Stop the active task',
    '\x1b[1mLeft/Right\x1b[0m   Move the caret inside the bottom input line',
    '\x1b[1mUp/Down\x1b[0m       Browse slash commands after "/", else recall history',
    '\x1b[1mPgUp/PgDn\x1b[0m     Browse earlier chat; the mouse wheel also scrolls',
    '\x1b[1mMouse click\x1b[0m  Place the caret on the input line',
    '',
    `\x1b[38;5;245mWorkspace:\x1b[0m  \x1b[38;5;253m${shortWs}\x1b[0m`,
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

/** Render a centered "About" popup with version and copyright info. */
export function renderAboutPopupBox(version: string): string[] {
  const boxWidth = 52;
  const innerW = boxWidth - 4;
  const titleStr = 'About Moderado';
  const remainingDashes = Math.max(0, boxWidth - titleStr.length - 5);

  // Strip the Alfazen build suffix (`+261024h`) so only `v<major.minor.patch>` shows.
  const semverOnly = version.split('+')[0];

  const content: string[] = [
    'Moderado CLI',
    semverOnly,
    '',
    '(c) 2026 Moderado AI, an Alfazen Product',
  ];

  const lines: string[] = [];
  lines.push('\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + titleStr + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m');
  for (const item of content) {
    const plain = item.replace(/\x1b\\[[0-9;]*[a-zA-Z]/g, '');
    const leftPad = Math.max(0, Math.floor((innerW - plain.length) / 2));
    const rightPad = Math.max(0, innerW - plain.length - leftPad);
    lines.push('\x1b[38;5;240m│\x1b[0m' + ' '.repeat(leftPad) + item + ' '.repeat(rightPad) + '\x1b[38;5;240m│\x1b[0m');
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
/**
 * Exit Moderado cleanly: restore cursor visibility & style, leave the alternate
 * screen buffer, disable raw mode, fully clear the OS terminal, print the
 * farewell message, and let the process end.
 *
 * A hard `process.exit()` here would race the Windows console handle and, with
 * an open undici pool, abort inside libuv (`win/async.c:94`). The farewell is
 * written synchronously, connections are closed, and the returned promise never
 * settles so callers stop while the event loop drains.
 */
export async function exitCleanly(message: string): Promise<never> {
  notifyCleanExit();
  const stdout = process.stdout;
  const payload = stdout.isTTY
    ? KEY_MODIFIER_REPORT_OFF + MOUSE_REPORT_OFF + '\x1b[?25h\x1b[?1049l\x1b[0 q\x1b[0m\x1b[2J\x1b[3J\x1b[H' + renderExitMessage(message)
    : renderExitMessage(message);
  try { fs.writeSync(1, payload); } catch { stdout.write(payload); }
  const stdin = process.stdin;
  if (stdin.isTTY) {
    try { stdin.setRawMode(false); } catch { /* ignore */ }
  }
  process.exitCode = 0;
  await closeHttpConnections();
  setTimeout(() => process.exit(0), 2000).unref();
  return new Promise<never>(() => {});
}

/** A cumulative task snapshot; a request ending does not mean the task ended. */
export function formatTokenUsage(event: UsageEvent): string {
  const marker = event.estimated ? '~' : '';
  const { promptTokens, completionTokens, totalTokens } = event.usage;
  const rate = event.generationMs > 0 && Number.isFinite(event.outputTokensPerSecond)
    ? ` | ${marker}${Math.round(event.outputTokensPerSecond)} tok/s` : '';
  return `Input ${marker}${promptTokens} | Output ${marker}${completionTokens} | Total ${marker}${totalTokens}${rate}`;
}

/** Update only the chat status row, preserving the answer/composer cursor. */
export function renderChatUsageUpdate(event: UsageEvent, width = process.stdout.columns || 80, budgetStatus?: string, usageDetails?: string, terminalHeight = process.stdout.rows || 24, mode?: 'Plan' | 'Execute'): string {
  const area = getChatAnswerArea(width);
  const usageText = formatTokenUsage(event);
  const suffix = `${usageDetails ? ` | ${usageDetails}` : ''}${budgetStatus ? ` | ${budgetStatus}` : ''}`;
  const modeLabel = mode === 'Plan' ? '\x1b[1;38;5;75m[Plan]\x1b[0m / Execute (Tab)' : 'Plan / \x1b[1;38;5;75m[Execute]\x1b[0m (Tab)';
  const modeText = mode === 'Plan' ? '[Plan] / Execute (Tab)' : 'Plan / [Execute] (Tab)';
  const rowWidth = area.cardWidth;
  const textLimit = Math.max(0, rowWidth - (mode ? modeText.length + 1 : 0));
  const usageLimit = Math.max(0, textLimit - suffix.length);
  const clippedUsage = mode && usageText.length > usageLimit
    ? `${usageText.slice(0, Math.max(0, usageLimit - 1))}…`.slice(0, usageLimit)
    : usageText;
  const text = `${clippedUsage}${suffix}`.slice(0, textLimit);
  const row = Math.max(1, terminalHeight - 2);
  return `\x1b7\x1b[${row};${area.startColumn}H\x1b[K\x1b[38;5;244m${text}\x1b[0m${mode ? `${' '.repeat(Math.max(1, rowWidth - text.length - modeText.length))}${modeLabel}` : ''}\x1b8`;
}

/** Show trusted, schema-validated Gateway route changes without provider supplied prose. */
export function renderGatewayFallbackUpdate(event: GatewayStatusEvent, width = process.stdout.columns || 80): string {
  const area = getChatAnswerArea(width);
  const destination = event.toProvider ? `${event.toProvider}/${event.toModel}` : event.toModel;
  const reason = event.reason === 'rate_limited_or_unavailable' ? 'after an upstream route was rate limited or unavailable' : 'after a fallback';
  const text = truncateToWidth(`Gateway route changed to ${destination} ${reason}`, area.cardWidth);
  const row = renderModeradoHeader().split('\n').length + 3;
  return `\x1b7\x1b[${row};${area.startColumn}H\x1b[K\x1b[38;5;244m${text}\x1b[0m\x1b8`;
}
