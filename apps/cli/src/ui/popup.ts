import { stripAnsi } from './welcome.js';

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
 * Return the ANSI escape sequence string that composites `popupLines` as a
 * centered floating layer on top of the current screen contents. The popup is
 * positioned horizontally centered and vertically slightly above center, at a
 * fixed position so it behaves like a stable popup window.
 */
export function overlayCentered(popupLines: string[], cols: number, rows: number): string {
  if (popupLines.length === 0) return '';

  const width = Math.min(popupWidth(popupLines), cols);
  const leftPad = Math.max(0, Math.floor((cols - width) / 2));
  const startRow = Math.max(0, Math.min(Math.floor((rows - popupLines.length) / 2) - 2, rows - popupLines.length));

  let out = '\x1b[?25l'; // hide cursor while the popup layer is on top
  for (let i = 0; i < popupLines.length; i++) {
    out += `\x1b[${startRow + i + 1};${leftPad + 1}H` + popupLines[i];
  }
  return out;
}

/**
 * Redraw the popup layer with a small prompt/status box. Used inside the
 * model selection flow so every interaction step keeps the popup window as a
 * stable layer on top of the unchanged main app window.
 */
export function layerPromptBox(
  layer: (popupLines: string[]) => void,
  message: string | string[]
): void {
  const cols = process.stdout.columns || 80;
  const boxWidth = Math.min(Math.max(50, Math.min(cols - 4, 66)), cols);
  const lines = Array.isArray(message) ? message : [message];
  layer(renderBoxLines('Model Selection Window', lines, boxWidth));
}
