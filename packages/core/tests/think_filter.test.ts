import { describe, it, expect } from 'vitest';
import { ThinkTagStreamFilter } from '../src/think_filter.js';

describe('ThinkTagStreamFilter', () => {
  it('passes normal assistant content through directly', () => {
    const filter = new ThinkTagStreamFilter();
    const tokens = filter.process('Hello world!');
    tokens.push(...filter.flush());

    expect(tokens).toEqual([
      { type: 'assistant', delta: 'Hello world!' },
    ]);
  });

  it('filters complete <think>...</think> in a single chunk', () => {
    const filter = new ThinkTagStreamFilter();
    const tokens = filter.process('<think>Analyzing user request...</think>Here is the answer.');
    tokens.push(...filter.flush());

    expect(tokens).toEqual([
      { type: 'reasoning', delta: 'Analyzing user request...' },
      { type: 'assistant', delta: 'Here is the answer.' },
    ]);
  });

  it('filters <think> tag split across multiple chunks', () => {
    const filter = new ThinkTagStreamFilter();
    const tokens = [
      ...filter.process('<th'),
      ...filter.process('ink>First step'),
      ...filter.process(' is done.</th'),
      ...filter.process('ink>\n\nFinal answer.'),
      ...filter.flush(),
    ];

    expect(tokens).toEqual([
      { type: 'reasoning', delta: 'First step' },
      { type: 'reasoning', delta: ' is done.' },
      { type: 'assistant', delta: 'Final answer.' },
    ]);
  });

  it('discards leading whitespace before <think> tag', () => {
    const filter = new ThinkTagStreamFilter();
    const tokens = [
      ...filter.process('\n\n'),
      ...filter.process('<think>Thought</think>Answer'),
      ...filter.flush(),
    ];

    expect(tokens).toEqual([
      { type: 'reasoning', delta: 'Thought' },
      { type: 'assistant', delta: 'Answer' },
    ]);
  });

  it('handles code comparisons like "a < b" without misidentifying as think tag', () => {
    const filter = new ThinkTagStreamFilter();
    const tokens = [
      ...filter.process('if (a <'),
      ...filter.process(' b) { return true; }'),
      ...filter.flush(),
    ];

    const assistantText = tokens
      .filter((t) => t.type === 'assistant')
      .map((t) => t.delta)
      .join('');

    expect(assistantText).toBe('if (a < b) { return true; }');
  });

  it('handles <thought> and <reasoning> alternative tags', () => {
    const filter1 = new ThinkTagStreamFilter();
    const tokens1 = [
      ...filter1.process('<thought>Consider this.</thought>Result'),
      ...filter1.flush(),
    ];
    expect(tokens1).toEqual([
      { type: 'reasoning', delta: 'Consider this.' },
      { type: 'assistant', delta: 'Result' },
    ]);

    const filter2 = new ThinkTagStreamFilter();
    const tokens2 = [
      ...filter2.process('<reasoning>Logic check.</reasoning>Result'),
      ...filter2.flush(),
    ];
    expect(tokens2).toEqual([
      { type: 'reasoning', delta: 'Logic check.' },
      { type: 'assistant', delta: 'Result' },
    ]);
  });

  it('handles unclosed <think> tag at stream end', () => {
    const filter = new ThinkTagStreamFilter();
    const tokens = [
      ...filter.process('<think>Unfinished thoughts...'),
      ...filter.flush(),
    ];

    const reasoningText = tokens
      .filter((t) => t.type === 'reasoning')
      .map((t) => t.delta)
      .join('');
    const assistantText = tokens
      .filter((t) => t.type === 'assistant')
      .map((t) => t.delta)
      .join('');

    expect(reasoningText).toBe('Unfinished thoughts...');
    expect(assistantText).toBe('');
  });
});
