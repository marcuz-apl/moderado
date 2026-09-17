import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { askQuestion, askSelect, SelectOption } from '../src/ui/prompt.js';

describe('CLI Terminal Prompts', () => {
  it('reads answer from stdin stream', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const promise = askQuestion('What is your name? ', { stdin, stdout });
    stdin.write('Moderado\n');

    const result = await promise;
    expect(result).toBe('Moderado');
  });

  it('selects option by index from choices', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const choices: SelectOption[] = [
      { label: 'Option 1', value: 'opt1' },
      { label: 'Option 2', value: 'opt2' },
    ];

    const promise = askSelect('Choose one:', choices, 0, { stdin, stdout });
    stdin.write('2\n');

    const result = await promise;
    expect(result.value).toBe('opt2');
  });

  it('returns default option if input is empty (enter pressed)', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const choices: SelectOption[] = [
      { label: 'Option 1', value: 'opt1' },
      { label: 'Option 2', value: 'opt2' },
    ];

    const promise = askSelect('Choose one:', choices, 0, { stdin, stdout });
    stdin.write('\n');

    const result = await promise;
    expect(result.value).toBe('opt1');
  });
});
