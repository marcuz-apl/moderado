import { describe, expect, it } from 'vitest';
import { renderChartBlock } from '../src/ui/chart.js';
import { displayWidth, stripAnsi } from '../src/ui/box.js';

describe('inline chart colors', () => {
  it('transitions line plots from blue to red', () => {
    const lines = renderChartBlock(JSON.stringify({
      type: 'line',
      data: [{ label: 'A', value: 1 }, { label: 'B', value: 3 }, { label: 'C', value: 2 }],
    }), 50, true)!;

    expect(lines.join('\n')).toContain('\x1b[38;5;21m');
    expect(lines.join('\n')).toContain('\x1b[38;5;196m');
  });

  it('colors bar magnitudes and preserves visible chart width', () => {
    const source = JSON.stringify({
      type: 'bar',
      data: [{ label: 'small', value: 1 }, { label: 'large', value: 10 }],
    });
    const colored = renderChartBlock(source, 50, true)!;
    const plain = renderChartBlock(source, 50, false)!;

    expect(colored[0]).toContain('\x1b[38;5;33m');
    expect(colored[1]).toContain('\x1b[38;5;196m');
    expect(colored.map(displayWidth)).toEqual(plain.map(displayWidth));
    expect(colored.map(stripAnsi)).toEqual(plain);
  });
});
