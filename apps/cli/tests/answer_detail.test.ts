import { describe, expect, it } from 'vitest';
import { parseDetailCommand } from '../src/answer_detail.js';

describe('/detail answer detail toggle', () => {
  it('toggles the tone when the command has no argument', () => {
    const fromConcise = parseDetailCommand('/detail', 'concise');
    expect(fromConcise.detail).toBe('expanded');
    expect(fromConcise.message).toContain('expanded');

    const fromExpanded = parseDetailCommand('/detail', 'expanded');
    expect(fromExpanded.detail).toBe('concise');
    expect(fromExpanded.message).toContain('concise');
  });

  it('sets an explicit tone and keeps the other settings untouched', () => {
    expect(parseDetailCommand('/detail expanded', 'concise').detail).toBe('expanded');
    expect(parseDetailCommand('/detail concise', 'expanded').detail).toBe('concise');
    expect(parseDetailCommand('/detail EXPANDED', 'concise').detail).toBe('expanded');
  });

  it('rejects an unknown tone without changing the setting', () => {
    const rejected = parseDetailCommand('/detail verbose', 'concise');
    expect(rejected.detail).toBe('concise');
    expect(rejected.message).toContain('Usage: /detail');
  });

  it('states the current tone and that concise is the default', () => {
    expect(parseDetailCommand('/detail', 'concise').message).toContain('Answers');
    const status = parseDetailCommand('/detail concise', 'expanded');
    expect(status.message).toMatch(/concise/);
  });
});
