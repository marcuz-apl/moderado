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

    expect(captured).toContain('Thinking...');
    expect(captured).not.toContain('Analyzing user inquiry...');
    expect(captured).toContain('Here is the answer.');
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
