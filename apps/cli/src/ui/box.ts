// Strips ANSI escape sequences to compute visual display width
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/** Code points that occupy two terminal cells (East Asian wide/fullwidth, emoji). */
function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/**
 * One terminal cluster: a code point plus any trailing variation selectors or
 * combining marks, with the cells it occupies.
 *
 * The variation selector matters more than it looks: `⚠` is a narrow glyph, but
 * `⚠️` (U+26A0 U+FE0F) asks for emoji presentation and terminals draw it two
 * cells wide. Counting it as one made every approval-box border one cell short
 * of its own top row — the box appeared to spill out of the frame.
 */
function nextCluster(text: string, index: number): { text: string; cells: number } {
  const code = text.codePointAt(index) ?? 0;
  let cluster = String.fromCodePoint(code);
  let cursor = index + cluster.length;
  let emojiPresentation = false;
  while (cursor < text.length) {
    const next = text.codePointAt(cursor) ?? 0;
    const isVariationSelector = next >= 0xfe00 && next <= 0xfe0f;
    const isCombining = next >= 0x0300 && next <= 0x036f;
    if (!isVariationSelector && !isCombining) break;
    if (next === 0xfe0f) emojiPresentation = true;
    const piece = String.fromCodePoint(next);
    cluster += piece;
    cursor += piece.length;
  }
  const cells = code === 0x200b ? 0 : emojiPresentation || isWideCodePoint(code) ? 2 : 1;
  return { text: cluster, cells };
}

/**
 * Terminal cells occupied by a string. Wide (CJK, emoji) glyphs count as two
 * columns and combining marks as zero, so box borders stay aligned when the
 * workspace path or the task text is not ASCII.
 */
export function displayWidth(text: string): number {
  const plain = stripAnsi(text);
  let width = 0;
  for (let index = 0; index < plain.length;) {
    const cluster = nextCluster(plain, index);
    width += cluster.cells;
    index += cluster.text.length;
  }
  return width;
}

export function getVisibleWidth(text: string): number {
  return displayWidth(text);
}

/** Match an ANSI escape sequence at the start of `text`, if any. */
const ANSI_AT_START = /^\x1b\[[0-9;?]*[a-zA-Z]/;

/**
 * Keep the first `max` terminal cells of `text`.
 *
 * `String#slice` counts UTF-16 units, so a CJK or emoji line looks short to it
 * while occupying twice the cells — which is how a status line used to spill
 * past the card and wrap onto the row below. Escape sequences are copied
 * through without being counted.
 */
export function sliceToWidth(text: string, max: number): string {
  if (max <= 0) return '';
  let width = 0;
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '\x1b') {
      const escape = ANSI_AT_START.exec(text.slice(i));
      if (escape) {
        out += escape[0];
        i += escape[0].length;
        continue;
      }
    }
    const cluster = nextCluster(text, i);
    if (width + cluster.cells > max) break;
    width += cluster.cells;
    out += cluster.text;
    i += cluster.text.length;
  }
  return out;
}

/** Keep the last `max` terminal cells of `text`. */
export function sliceTailToWidth(text: string, max: number): string {
  if (max <= 0) return '';
  const plain = stripAnsi(text);
  const clusters: Array<{ text: string; cells: number }> = [];
  for (let index = 0; index < plain.length;) {
    const cluster = nextCluster(plain, index);
    clusters.push(cluster);
    index += cluster.text.length;
  }
  let width = 0;
  let out = '';
  for (let index = clusters.length - 1; index >= 0; index -= 1) {
    if (width + clusters[index].cells > max) break;
    width += clusters[index].cells;
    out = clusters[index].text + out;
  }
  return out;
}

/** Clamp to `max` cells, appending an ellipsis when anything was cut. */
export function truncateToWidth(text: string, max: number): string {
  if (max <= 0) return '';
  if (displayWidth(text) <= max) return text;
  if (max === 1) return '…';
  return `${sliceToWidth(text, max - 1)}…`;
}

export interface BoxOptions {
  title?: string;
  minWidth?: number;
  /**
   * Hard cap in terminal cells, borders included. Content wider than the cap is
   * truncated, so a single long diff line can no longer widen the box past the
   * terminal and wrap the whole frame out of alignment.
   */
  maxWidth?: number;
  borderColor?: string;
  titleColor?: string;
}

/**
 * Renders an enclosed Unicode box with mathematically guaranteed alignment
 * regardless of ANSI color escape codes or string lengths.
 */
export function renderBox(lines: string[], options: BoxOptions = {}): string {
  const border = options.borderColor ?? '\x1b[38;5;240m';
  const reset = '\x1b[0m';
  const titleColor = options.titleColor ?? '\x1b[1;38;5;75m';

  // `maxWidth` is the whole box, borders included; `innerWidth` counts only the
  // cells between them, which is what the border and padding arithmetic uses.
  const innerCap = options.maxWidth ? Math.max(20, options.maxWidth - 2) : Number.POSITIVE_INFINITY;
  // Content budget: two cells of padding on each content line.
  const contentCap = innerCap - 4;
  const clamp = (line: string): string => {
    if (line === '---' || getVisibleWidth(line) <= contentCap) return line;
    // Re-assert the reset: truncation can cut a line before its own `\x1b[0m`.
    return `${truncateToWidth(line, contentCap)}${reset}`;
  };
  const shown = lines.map(clamp);
  const title = options.title ? truncateToWidth(options.title, Math.max(10, contentCap - 4)) : undefined;

  // Calculate required width
  let maxContentWidth = title ? getVisibleWidth(title) + 4 : 0;
  for (const line of shown) {
    if (line !== '---') {
      const w = getVisibleWidth(line);
      if (w > maxContentWidth) {
        maxContentWidth = w;
      }
    }
  }

  const requested = Math.max(maxContentWidth + 4, options.minWidth ?? 60);
  const innerWidth = Math.min(requested, innerCap);

  let output = '';

  // 1. Top border
  if (title) {
    const titleVis = getVisibleWidth(title);
    const rightDashes = innerWidth - titleVis - 3;
    output += `${border}╭─ ${titleColor}${title}${reset}${border} ${'─'.repeat(Math.max(0, rightDashes))}╮${reset}\n`;
  } else {
    output += `${border}╭${'─'.repeat(innerWidth)}╮${reset}\n`;
  }

  // 2. Content lines
  for (const line of shown) {
    if (line === '---') {
      output += `${border}├${'─'.repeat(innerWidth)}┤${reset}\n`;
      continue;
    }

    const vis = getVisibleWidth(line);
    const padRight = Math.max(0, innerWidth - vis - 2);
    output += `${border}│${reset}  ${line}${' '.repeat(padRight)}${border}│${reset}\n`;
  }

  // 3. Bottom border
  output += `${border}╰${'─'.repeat(innerWidth)}╯${reset}\n`;

  return output;
}
