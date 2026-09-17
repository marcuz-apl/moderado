import { stripAnsi } from './welcome.js';
import { emitKeypressEvents, type Key } from 'node:readline';

/**
 * Cline/OpenCode-style popup window primitives.
 *
 * A popup is rendered as a new LAYER on top of the currently displayed main
 * window: the background stays exactly as-is (it keeps rendering around the
 * box), and the popup box is composited centered on top of it. The caller
 * redraws the whole frame (background + popup) whenever the popup content
 * changes, so the layer never scrolls or corrupts the background.
 */

/** Build the bordered box lines for a popup window (title bar + content). */
export function renderBoxLines(title: string, lines: string[], boxWidth: number): string[] {
  const out: string[] = [];
  const titleStr = title;
  const remainingDashes = Math.max(0, boxWidth - titleStr.length - 5);
  out.push(
    '\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + titleStr + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m'
  );

  for (const line of lines) {
    if (line === '---') {
      out.push('\x1b[38;5;240m├─' + '─'.repeat(Math.max(0, boxWidth - 4)) + '─┤\x1b[0m');
      continue;
    }
    const plain = stripAnsi(line);
    const spaces = Math.max(0, boxWidth - 4 - plain.length);
    out.push('\x1b[38;5;240m│\x1b[0m  ' + line + ' '.repeat(spaces) + '\x1b[38;5;240m│\x1b[0m');
  }

  out.push('\x1b[38;5;240m╰' + '─'.repeat(Math.max(0, boxWidth - 2)) + '╯\x1b[0m');
  return out;
}

/** Plain-text width of the widest line in a set of popup lines. */
export function popupWidth(popupLines: string[]): number {
  return popupLines.reduce((max, l) => Math.max(max, stripAnsi(l).length), 0);
}

/**
 * Return the anchor position (1-based row/col) where a popup of the given
 * lines should be composited: horizontally centered, vertically slightly
 * above center, at a fixed position so it behaves like a stable popup window.
 */
export function popupPosition(
  popupLines: string[],
  cols: number,
  rows: number
): { startRow: number; leftPad: number } {
  const width = Math.min(popupWidth(popupLines), cols);
  const leftPad = Math.max(0, Math.floor((cols - width) / 2));
  const startRow = Math.max(
    0,
    Math.min(Math.floor((rows - popupLines.length) / 2) - 2, rows - popupLines.length)
  );
  return { startRow, leftPad };
}

/**
 * Return the ANSI escape sequence string that composites `popupLines` as a
 * centered floating layer on top of the current screen contents. The popup is
 * positioned horizontally centered and vertically slightly above center, at a
 * fixed position so it behaves like a stable popup window.
 */
export function overlayCentered(popupLines: string[], cols: number, rows: number): string {
  if (popupLines.length === 0) return '';

  const { startRow, leftPad } = popupPosition(popupLines, cols, rows);

  let out = '\x1b[?25l'; // hide cursor while the popup layer is on top
  for (let i = 0; i < popupLines.length; i++) {
    out += `\x1b[${startRow + i + 1};${leftPad + 1}H` + popupLines[i];
  }
  return out;
}

/**
 * Cline-style dimmed backdrop: dim the background window so the popup layer
 * visually "floats" above it with depth.
 */
export function dimLines(lines: string[]): string[] {
  return lines.map((l) => '\x1b[2m' + l + '\x1b[0m');
}

/**
 * Soft drop shadow rendered just under and to the right of the popup box,
 * giving the floating window a sense of elevation.
 */
export function shadowUnder(popupLines: string[], cols: number, rows: number): string {
  if (popupLines.length === 0) return '';

  const { startRow, leftPad } = popupPosition(popupLines, cols, rows);

  let out = '';
  for (let i = 0; i < popupLines.length; i++) {
    const plain = stripAnsi(popupLines[i]);
    if (!plain.trim()) continue;
    const shadow = plain.replace(/\S/g, '░');
    out += `\x1b[${startRow + i + 2};${leftPad + 3}H\x1b[38;5;236m${shadow}\x1b[0m`;
  }
  return out;
}

export interface PopupListItem {
  label: string;
  value: string;
  /** Short description shown under the highlighted row (Cline-style). */
  description?: string;
  /** Small colored badge rendered after the label (e.g. "Free", "Paid"). */
  tag?: string;
}

export interface ListPopupOptions {
  signal?: AbortSignal;
  /** When true, typing filters the list live (type-to-search). */
  filterable?: boolean;
  /** Pre-filled filter text. */
  initialFilter?: string;
  /** Number of visible list rows before scrolling (default 10). */
  pageSize?: number;
  /** Override the footer key-hint bar. */
  hint?: string;
  /**
   * Frame renderer: receives the full popup box lines on every redraw and must
   * composite them as a floating layer on top of the unchanged background.
   */
  drawFrame: (popupLines: string[]) => void;
}

/**
 * Cline/OpenCode-style interactive list popup: a floating window layer with a
 * type-to-filter input, `❯` cursor with a highlighted selection row, the
 * selected item's description shown beneath the list, scroll indicators, and a
 * footer key-hint bar. Navigable with ↑↓/jk, Home/End, PgUp/PgDn; Enter
 * selects; Esc cancels (resolves null). Returns the selected item's value.
 */
export async function selectListPopup(
  title: string,
  items: PopupListItem[],
  options: ListPopupOptions
): Promise<string | null> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const draw = options.drawFrame;
  const filterable = options.filterable ?? false;
  const pageSize = Math.max(3, options.pageSize ?? 10);

  let filter = options.initialFilter ?? '';
  let cursor = 0;
  let scroll = 0;

  const filteredItems = (): PopupListItem[] => {
    if (!filter.trim()) return items;
    const q = filter.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.value.toLowerCase().includes(q) ||
        (i.tag ?? '').toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q)
    );
  };
  const renderPopup = (): void => {
    const list = filteredItems();
    if (cursor >= list.length) cursor = Math.max(0, list.length - 1);
    if (cursor < 0) cursor = 0;
    if (cursor < scroll) scroll = cursor;
    if (cursor >= scroll + pageSize) scroll = cursor - pageSize + 1;
    if (scroll < 0) scroll = 0;

    const cols = stdout.columns || 80;
    let boxWidth = 64;
    for (const i of list) {
      boxWidth = Math.max(boxWidth, 4 + i.label.length + (i.tag ? i.tag.length + 3 : 0));
    }
    boxWidth = Math.min(Math.max(boxWidth, filter.length + 10), Math.max(20, cols - 2));

    const lines: string[] = [];

    // Filter input line with a reverse-video block cursor.
    if (filterable) {
      lines.push(`  \x1b[1;38;5;75m❯\x1b[0m ${filter}\x1b[7m \x1b[0m`);
    }

    // Visible list window with scroll indicators.
    const visible = list.slice(scroll, scroll + pageSize);
    if (visible.length === 0) {
      lines.push('\x1b[38;5;244m  No matches — refine the filter or press Esc\x1b[0m');
    }
    if (scroll > 0) {
      lines.push(`\x1b[38;5;242m  ↑ ${scroll} more\x1b[0m`);
    }
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i];
      const selected = scroll + i === cursor;
      const tag = item.tag ? ` \x1b[36m${item.tag}\x1b[0m` : '';
      const plainLen = 4 + item.label.length + (item.tag ? item.tag.length + 1 : 0);
      const pad = Math.max(0, boxWidth - 4 - plainLen);
      if (selected) {
        lines.push(
          '  \x1b[48;5;236m\x1b[1;38;5;75m❯ \x1b[0m\x1b[48;5;236m' +
            item.label +
            (item.tag ? ' \x1b[36m' + item.tag + '\x1b[0m\x1b[48;5;236m' : '') +
            ' '.repeat(pad) +
            '\x1b[0m'
        );
      } else {
        lines.push('    \x1b[38;5;244m' + item.label + '\x1b[0m' + tag + ' '.repeat(pad));
      }
    }
    if (scroll + pageSize < list.length) {
      lines.push(`\x1b[38;5;242m  ↓ ${list.length - scroll - pageSize} more\x1b[0m`);
    }

    // Description of the highlighted item (Cline-style).
    const sel = list[cursor];
    if (sel?.description) {
      lines.push('');
      lines.push('\x1b[38;5;244m  ' + sel.description + '\x1b[0m');
    }

    // Footer key-hint bar.
    lines.push('---');
    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    const page = Math.min(totalPages, Math.floor(cursor / pageSize) + 1);
    const hint = options.hint ?? '↑↓ navigate · Enter select · Esc cancel';
    const count = filter.trim() ? `${list.length}/${items.length} matches` : `${items.length} items`;
    lines.push(`\x1b[38;5;244m${hint}  ·  ${count}  ·  Page ${page}/${totalPages}\x1b[0m`);

    draw(renderBoxLines(title, lines, boxWidth));
  };

  return new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      stdin.removeListener('keypress', onKeypress);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => finish(null);

    if (options.signal?.aborted) {
      resolve(null);
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    // Defensive: ensure keypress events are emitted and stdin is raw. The
    // caller (chat TUI) restores raw mode after the whole popup flow ends.
    emitKeypressEvents(stdin);
    if (stdin.isTTY && stdin.isRaw === false) {
      stdin.setRawMode(true);
    }

    const onKeypress = (str: string | undefined, key: Key | undefined): void => {
      const list = filteredItems();
      if (key && (key.name === 'return' || key.name === 'enter')) {
        finish(list[cursor] ? list[cursor].value : null);
        return;
      }
      if (key && key.name === 'escape') {
        finish(null);
        return;
      }
      if (key && (key.name === 'up' || (key.name === 'k' && !filterable))) {
        cursor--;
      } else if (key && (key.name === 'down' || (key.name === 'j' && !filterable))) {
        cursor++;
      } else if (key && key.name === 'home') {
        cursor = 0;
      } else if (key && key.name === 'end') {
        cursor = list.length - 1;
      } else if (key && key.name === 'pageup') {
        cursor -= pageSize;
      } else if (key && key.name === 'pagedown') {
        cursor += pageSize;
      } else if (key && key.name === 'backspace') {
        if (filterable) {
          filter = filter.slice(0, -1);
          cursor = 0;
          scroll = 0;
        }
      } else if (
        filterable &&
        str &&
        str.length === 1 &&
        str.charCodeAt(0) >= 32 &&
        !key?.ctrl &&
        !key?.meta
      ) {
        filter += str;
        cursor = 0;
        scroll = 0;
      }
      renderPopup();
    };

    stdin.on('keypress', onKeypress);
    renderPopup();
  });
}

/**
 * Cline-style confirmation popup: a small Yes/No list window layered on top of
 * the background. Resolves true for Yes, false for No, null when cancelled.
 */
export async function selectConfirmPopup(
  title: string,
  message: string[],
  options: ListPopupOptions
): Promise<boolean | null> {
  const box = renderBoxLines(title, message, 60);
  const baseDraw = options.drawFrame;
  const answer = await selectListPopup('Confirm', [
    { label: 'Yes', value: 'yes', description: 'Apply this choice' },
    { label: 'No', value: 'no', description: 'Keep things as they are' },
  ], {
    ...options,
    drawFrame: (popupLines) =>
      baseDraw([...box, '', ...popupLines.map((l) => '  ' + l)]),
  });
  if (answer === null) return null;
  return answer === 'yes';
}

export function layerPromptBox(
  layer: (popupLines: string[]) => void,
  message: string | string[]
): void {
  const cols = process.stdout.columns || 80;
  const boxWidth = Math.min(Math.max(50, Math.min(cols - 4, 66)), cols);
  const lines = Array.isArray(message) ? message : [message];
  layer(renderBoxLines('Model Selection Window', lines, boxWidth));
}
