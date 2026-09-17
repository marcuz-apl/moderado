// Strips ANSI escape sequences to compute visual display width
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function getVisibleWidth(text: string): number {
  return stripAnsi(text).length;
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
