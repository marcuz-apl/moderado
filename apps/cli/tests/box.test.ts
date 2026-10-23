import { describe, it, expect } from 'vitest';
import {
  renderBox,
  stripAnsi,
  getVisibleWidth,
  displayWidth,
  truncateToWidth,
  sliceToWidth,
  sliceTailToWidth,
} from '../src/ui/box.js';

describe('Box UI Utility', () => {
  it('strips ANSI color codes accurately', () => {
    const colored = '\x1b[38;5;75mModerado\x1b[0m \x1b[32m● Active\x1b[0m';
    expect(stripAnsi(colored)).toBe('Moderado ● Active');
    expect(getVisibleWidth(colored)).toBe('Moderado ● Active'.length);
  });

  it('counts wide glyphs as two terminal cells', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('项目')).toBe(4);
    expect(displayWidth('\x1b[32m中文\x1b[0m ok')).toBe(7);
    expect(displayWidth('e\u0301')).toBe(1);
  });

  it('keeps borders aligned when content contains wide glyphs', () => {
    const box = renderBox(['Directory   E:\\项目\\moderado', 'Model       中文模型'], { title: 'Moderado', minWidth: 40 });
    const widths = box.trim().split('\n').map((line) => getVisibleWidth(line));
    expect(new Set(widths).size).toBe(1);
  });

  it('renders box with perfectly aligned borders regardless of ANSI codes', () => {
    const box = renderBox(
      [
        '\x1b[1;37mDirectory\x1b[0m   d:\\projects\\moderado',
        '\x1b[1;37mModel\x1b[0m       \x1b[38;5;141mz-ai/glm-5.3-flash\x1b[0m \x1b[38;5;114m● Free\x1b[0m',
        '---',
        '\x1b[90mCommands    /help · /model · /clear · /exit\x1b[0m',
      ],
      {
        title: 'Moderado',
        minWidth: 50,
      }
    );

    const lines = box.trim().split('\n');
    const visualLengths = lines.map((l) => getVisibleWidth(l));

    // Every line must have the EXACT same visual display width!
    const expectedWidth = visualLengths[0];
    for (const len of visualLengths) {
      expect(len).toBe(expectedWidth);
    }
  });

  it('clamps strings by terminal cells, not code units', () => {
    // `slice` would keep 4 CJK glyphs here and paint 8 cells.
    expect(displayWidth(sliceToWidth('项目目录内容', 4))).toBe(4);
    expect(sliceToWidth('abcdef', 3)).toBe('abc');
    // A truncated string still has to announce itself, and fit.
    expect(truncateToWidth('abcdef', 4)).toBe('abc…');
    expect(displayWidth(truncateToWidth('中文目录内容', 5))).toBeLessThanOrEqual(5);
    // The tail keeps the end of the string, which is the part still moving.
    expect(sliceTailToWidth('abcdef', 3)).toBe('def');
    expect(displayWidth(sliceTailToWidth('中文目录内容', 4))).toBe(4);
    // Escape sequences are copied without being counted as cells.
    expect(truncateToWidth('\x1b[32mabcdef\x1b[0m', 4)).toContain('\x1b[32m');
    expect(displayWidth(truncateToWidth('\x1b[32mabcdef\x1b[0m', 4))).toBe(4);
  });

  it('counts an emoji presentation selector as two cells', () => {
    // `⚠` is a narrow glyph, but `⚠️` (U+26A0 U+FE0F) asks for emoji
    // presentation and terminals draw it two cells wide. Counting it as one made
    // the approval box's title row one cell short of its own body — the box
    // looked like it had spilled out of the frame.
    expect(displayWidth('⚠')).toBe(1);
    expect(displayWidth('⚠️')).toBe(2);
    expect(displayWidth('⚠️ Permission')).toBe(13);
    // Truncation must not split the pair, and must not exceed the budget.
    expect(displayWidth(truncateToWidth('⚠️ Permission Required', 5))).toBeLessThanOrEqual(5);
    expect(truncateToWidth('⚠️ Permission Required', 5)).toContain('⚠️');
  });

  it('keeps every row of an emoji-titled dialog the same width', () => {
    const box = renderBox(['Command   npx tailwindcss init -p'], { title: '⚠️ Permission Required: run_command', minWidth: 58, maxWidth: 98 });
    const widths = stripAnsi(box).split('\n').filter(Boolean).map((line) => displayWidth(line));
    expect(new Set(widths).size).toBe(1);
  });

  it('never renders wider than maxWidth, whatever the content', () => {
    const longLine = `+${'const value = compute(); '.repeat(20)}`;
    for (const maxWidth of [40, 50, 60, 80]) {
      const box = renderBox(
        ['Target File   src/components/WeatherCard.tsx', '---', longLine, '---', '[Y] Approve (Enter)'],
        { title: '⚠️ Permission Required: write_file', minWidth: 58, maxWidth },
      );
      const widths = stripAnsi(box).split('\n').filter(Boolean).map((line) => displayWidth(line));
      expect(widths.every((width) => width <= maxWidth)).toBe(true);
      // Borders still line up, so the frame stays rectangular.
      expect(new Set(widths).size).toBe(1);
    }
  });
});
