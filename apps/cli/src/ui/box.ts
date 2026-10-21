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
 * Terminal cells occupied by a string. Wide (CJK, emoji) glyphs count as two
 * columns and combining marks as zero, so box borders stay aligned when the
 * workspace path or the task text is not ASCII.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of stripAnsi(text)) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x200b || (code >= 0x0300 && code <= 0x036f) || (code >= 0xfe00 && code <= 0xfe0f)) continue;
    width += isWideCodePoint(code) ? 2 : 1;
  }
  return width;
}

export function getVisibleWidth(text: string): number {
  return displayWidth(text);
}

export interface BoxOptions {
  title?: string;
  minWidth?: number;
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

  // Calculate required width
  let maxContentWidth = options.title ? getVisibleWidth(options.title) + 4 : 0;
  for (const line of lines) {
    if (line !== '---') {
      const w = getVisibleWidth(line);
      if (w > maxContentWidth) {
        maxContentWidth = w;
      }
    }
  }

  const innerWidth = Math.max(maxContentWidth + 4, options.minWidth ?? 60);

  let output = '';

  // 1. Top border
  if (options.title) {
    const titleVis = getVisibleWidth(options.title);
    const rightDashes = innerWidth - titleVis - 3;
    output += `${border}╭─ ${titleColor}${options.title}${reset}${border} ${'─'.repeat(Math.max(0, rightDashes))}╮${reset}\n`;
  } else {
    output += `${border}╭${'─'.repeat(innerWidth)}╮${reset}\n`;
  }

  // 2. Content lines
  for (const line of lines) {
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
