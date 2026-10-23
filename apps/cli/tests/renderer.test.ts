import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { TerminalRenderer } from '../src/ui/renderer.js';

describe('TerminalRenderer', () => {
  it('renders model_change, tool_call, tool_result, and completion events', () => {
    let captured = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString('utf8');
        callback();
      },
    });

    const renderer = new TerminalRenderer({ stdout, verbose: true });

    renderer.handleEvent({
      type: 'model_change',
      newModelId: 'meta/llama-3.3-70b-instruct',
      reason: 'initial_selection',
      accessClass: 'free_trial',
      timestamp: Date.now(),
    });

    renderer.handleEvent({
      type: 'assistant_delta',
      delta: 'Inspecting files...',
      timestamp: Date.now(),
    });

    renderer.handleEvent({
      type: 'tool_call_initiated',
      toolCallId: 'call_1',
      toolName: 'read_file',
      parameters: { path: 'package.json' },
      timestamp: Date.now(),
    });

    renderer.handleEvent({
      type: 'tool_result',
      toolCallId: 'call_1',
      result: {
        toolName: 'read_file',
        status: 'success',
        output: '{\n  "name": "moderado"\n}',
      },
      timestamp: Date.now(),
    });

    renderer.handleEvent({
      type: 'completion',
      status: 'completed',
      totalSteps: 2,
      timestamp: Date.now(),
    });

    expect(captured).toContain('Model:');
    expect(captured).toContain('meta/llama-3.3-70b-instruct');
    expect(captured).toContain('Inspecting files...');
    expect(captured).toContain('read_file');
    expect(captured).toContain('✔');
    expect(captured).toContain('=== Session Finished: COMPLETED');
  });

  it('renders reasoning_delta stream and transient progress', () => {
    let captured = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString('utf8');
        callback();
      },
    });

    const renderer = new TerminalRenderer({ stdout, verbose: false });

    // Transient progress
    renderer.handleEvent({
      type: 'progress',
      step: 1,
      maxSteps: 10,
      status: 'Inferring with z-ai/glm-5.3-flash...',
      timestamp: Date.now(),
    });

    // Reasoning stream
    renderer.handleEvent({
      type: 'reasoning_delta',
      delta: 'Analyzing user inquiry...',
      timestamp: Date.now(),
    });

    // Assistant response finishes reasoning
    renderer.handleEvent({
      type: 'assistant_delta',
      delta: 'Here is the answer.',
      timestamp: Date.now(),
    });

    expect(captured).toContain('⠋ Thinking');
    // The step counter is gone: it described the engine's loop, not the work.
    expect(captured).not.toContain('Step 1/10');
    // The model id belongs in the header, not in the status line.
    expect(captured).not.toContain('z-ai/glm-5.3-flash');
    expect(captured).not.toContain('Analyzing user inquiry...');
    expect(captured).toContain('Here is the answer.');
  });

  it('marks the task Done when a completed run finishes', () => {
    let captured = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString('utf8');
        callback();
      },
    });

    const renderer = new TerminalRenderer({ stdout, verbose: false });
    renderer.handleEvent({ type: 'progress', step: 2, maxSteps: 3, status: 'Step 2/3: Inferring next action...', timestamp: 0 });
    renderer.handleEvent({ type: 'completion', status: 'completed', totalSteps: 3, timestamp: 0 });

    expect(captured).toContain('✔ Done (3 steps)');
    expect(captured.indexOf('✔ Done')).toBeLessThan(captured.indexOf('=== Session Finished: COMPLETED'));
  });

  it('does not mark Done when the run is cancelled or fails', () => {
    let captured = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString('utf8');
        callback();
      },
    });

    const renderer = new TerminalRenderer({ stdout, verbose: false });
    renderer.handleEvent({ type: 'progress', step: 1, maxSteps: 10, status: 'Inferring...', timestamp: 0 });
    renderer.handleEvent({ type: 'completion', status: 'cancelled', totalSteps: 1, timestamp: 0 });
    renderer.handleEvent({ type: 'progress', step: 1, maxSteps: 10, status: 'Inferring...', timestamp: 0 });
    renderer.handleEvent({ type: 'completion', status: 'failed', totalSteps: 1, timestamp: 0 });

    expect(captured).not.toContain('✔ Done');
  });

  it('names the phase instead of a step counter when a delegation has no budget', () => {
    let captured = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString('utf8');
        callback();
      },
    });

    const renderer = new TerminalRenderer({ stdout, verbose: false });
    renderer.handleEvent({ type: 'progress', step: 1, maxSteps: 10, status: 'Inferring...', timestamp: 0 });
    renderer.handleEvent({ type: 'progress', step: -1, status: 'Delegating sub-task: inspect tests...', timestamp: 0 } as any);

    expect(captured).toContain('⠋ Delegating a sub-task');
    expect(captured).not.toContain('Step -1');
    expect(captured).not.toContain('Processing task…');
  });

  it('does not write agent events outside the chat frame in chat mode', () => {
    let captured = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString('utf8');
        callback();
      },
    });

    const renderer = new TerminalRenderer({ stdout, isChatMode: true });

    // Initial selection should be suppressed in chat mode (shown in prompt instead)
    renderer.handleEvent({
      type: 'model_change',
      newModelId: 'z-ai/glm-5.3-flash',
      reason: 'user_pinned',
      accessClass: 'free_trial',
      timestamp: Date.now(),
    });

    renderer.handleEvent({
      type: 'assistant_delta',
      delta: 'Hello from Moderado!',
      timestamp: Date.now(),
    });

    renderer.handleEvent({
      type: 'completion',
      status: 'completed',
      totalSteps: 1,
      timestamp: Date.now(),
    });

    expect(captured).toBe('');
  });
});

const usageSnapshot = { type: 'usage' as const, usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 }, estimated: true, outputTokensPerSecond: 10, generationMs: 2000, final: true, timestamp: 0 };
it('defers non-TTY usage to task termination and suppresses chat output', () => {
  let captured = '';
  const stdout = new Writable({ write(chunk, _encoding, callback) { captured += chunk.toString(); callback(); } });
  const renderer = new TerminalRenderer({ stdout });
  renderer.handleEvent(usageSnapshot);
  expect(captured).toBe('');
  renderer.handleEvent({ type: 'completion', status: 'completed', totalSteps: 1, timestamp: 0 });
  expect(captured).toContain('Input ~100 | Output ~20 | Total ~120 | ~10 tok/s');
  captured = '';
  new TerminalRenderer({ stdout, isChatMode: true }).handleEvent(usageSnapshot);
  expect(captured).toBe('');
});
it('uses only terminal title updates during assistant streaming', () => {
  let captured = '';
  const stdout = new Writable({ write(chunk, _encoding, callback) { captured += chunk.toString(); callback(); } });
  Object.assign(stdout, { isTTY: true, columns: 80 });
  const renderer = new TerminalRenderer({ stdout });
  renderer.handleEvent({ type: 'assistant_delta', delta: 'Hello', timestamp: 0 });
  renderer.handleEvent(usageSnapshot);
  expect(captured).toBe('Hello\x1b]0;Moderado | Input ~100 | Output ~20 | Total ~120 | ~10 tok/s\x07');
  renderer.handleEvent({ type: 'assistant_delta', delta: ' world', timestamp: 0 });
  expect(captured.endsWith('\x07 world')).toBe(true);
  renderer.handleEvent({ type: 'completion', status: 'completed', totalSteps: 1, timestamp: 0 });
  expect(captured).toContain('\x1b]0;Moderado\x07');
});

it('throttles live usage but always refreshes the final request snapshot', () => {
  let captured = '';
  const stdout = new Writable({ write(chunk, _encoding, callback) { captured += chunk.toString(); callback(); } });
  Object.assign(stdout, { isTTY: true, columns: 80 });
  const renderer = new TerminalRenderer({ stdout });
  renderer.handleEvent({ ...usageSnapshot, final: false });
  captured = '';
  renderer.handleEvent({ ...usageSnapshot, final: false, timestamp: 100 });
  expect(captured).toBe('');
  renderer.handleEvent({ ...usageSnapshot, timestamp: 101 });
  expect(captured).toContain('Input ~100');
});
it.each(['error', 'cancellation'] as const)('prints the latest usage on %s', (type) => {
  let captured = '';
  const stdout = new Writable({ write(chunk, _encoding, callback) { captured += chunk.toString(); callback(); } });
  const renderer = new TerminalRenderer({ stdout });
  renderer.handleEvent(usageSnapshot);
  renderer.handleEvent(type === 'error' ? { type, code: 'TEST', message: 'Failed', timestamp: 0 } : { type, reason: 'Stopped', timestamp: 0 });
  expect(captured).toContain('Input ~100');
  expect(captured).not.toContain('\x1b7');
});

it('updates the transient reasoning line without revealing reasoning', () => {
  let captured = '';
  const stdout = new Writable({ write(chunk, _encoding, callback) { captured += chunk.toString(); callback(); } });
  Object.assign(stdout, { isTTY: true, columns: 80 });
  const renderer = new TerminalRenderer({ stdout });
  renderer.handleEvent({ type: 'reasoning_delta', delta: 'hidden reasoning', timestamp: 0 });
  renderer.handleEvent(usageSnapshot);
  expect(captured).toContain('\r\x1b[K\x1b[38;5;244mInput ~100');
  expect(captured).not.toContain('hidden reasoning');
  expect(captured).not.toContain('\x1b[1B');
});

describe('the run log is multi-line and scrollable', () => {
  const longOutput = Array.from({ length: 12 }, (_, index) => `line ${index}: ${'x'.repeat(60)}`).join('\n');

  const capture = (columns = 80) => {
    let captured = '';
    const stdout = new Writable({ write(chunk, _encoding, callback) { captured += chunk.toString('utf8'); callback(); } });
    Object.assign(stdout, { isTTY: true, columns });
    const renderer = new TerminalRenderer({ stdout });
    return { renderer, read: () => captured };
  };

  it('shows five wrapped rows of a tool result instead of one clipped line', () => {
    const { renderer, read } = capture();
    renderer.handleEvent({
      type: 'tool_result',
      toolCallId: 'call_1',
      result: { toolName: 'read_file', status: 'success', output: longOutput },
      timestamp: 0,
    });

    const body = read();
    // The old behaviour was `lines[0].slice(0, 75)` plus "… (+11 lines)".
    expect(body).not.toContain('(+11 lines)');
    // Wrapped, not clipped: the first row keeps its full sentence.
    expect(body).toContain('line 0: ' + 'x'.repeat(60));
    expect(body).toContain('line 1: ' + 'x'.repeat(60));
    // Five body rows, then a footer that names what was left out.
    expect(body).toContain('… +7 more lines');
    const shown = body.split('\n').filter((line) => /line \d+:/.test(line));
    expect(shown.length).toBe(5);
  });

  it('commits a phase instead of erasing it when the next one starts', () => {
    const { renderer, read } = capture();
    renderer.handleEvent({ type: 'progress', step: 1, maxSteps: 5, status: 'Inferring...', timestamp: 0 });
    renderer.handleEvent({ type: 'progress', step: 2, maxSteps: 5, status: 'Inferring next action...', timestamp: 0 });

    const body = read();
    // Phase one is settled and pushed into the scrollback rather than erased.
    expect(body).toContain('✔ Thinking · <1s');
    // Two phases produced two live rows: the log grows, it is not overwritten.
    expect(body.split('⠋ Thinking').length - 1).toBe(2);
    // The newest live row is still open at the bottom of the screen.
    expect(body.endsWith('\n')).toBe(false);
  });

  it('leaves every entry in the scrollback with a trailing newline', () => {
    const { renderer, read } = capture();
    renderer.handleEvent({ type: 'progress', step: 1, maxSteps: 5, status: 'Inferring...', timestamp: 0 });
    renderer.handleEvent({ type: 'tool_call_initiated', toolCallId: 'c', toolName: 'list_files', parameters: {}, timestamp: 0 });
    renderer.handleEvent({ type: 'tool_result', toolCallId: 'c', result: { toolName: 'list_files', status: 'success', output: 'a\nb' }, timestamp: 0 });
    renderer.handleEvent({ type: 'completion', status: 'completed', totalSteps: 1, timestamp: 0 });

    const body = read();
    // Every committed row ends a line, so the terminal's own scrollback (wheel,
    // slider, PgUp) can reach all of it.
    for (const marker of ['✔ Thinking', 'list_files', '✔ Done (1 step)', 'Session Finished']) {
      expect(body, marker).toContain(marker);
    }
    expect(body.endsWith('\n')).toBe(true);
  });

  it('reports no output without printing a bare status glyph', () => {
    const { renderer, read } = capture();
    renderer.handleEvent({ type: 'tool_result', toolCallId: 'c', result: { toolName: 'list_files', status: 'success', output: '   ' }, timestamp: 0 });
    expect(read()).toContain('(no output)');
  });
});
