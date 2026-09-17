import { describe, it, expect } from 'vitest';
import { renderBox, stripAnsi, getVisibleWidth } from '../src/ui/box.js';

describe('Box UI Utility', () => {
  it('strips ANSI color codes accurately', () => {
    const colored = '\x1b[38;5;75mModerado\x1b[0m \x1b[32m● Active\x1b[0m';
    expect(stripAnsi(colored)).toBe('Moderado ● Active');
    expect(getVisibleWidth(colored)).toBe('Moderado ● Active'.length);
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
});
