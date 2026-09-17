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
    expect(captured).toContain('success');
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
    expect(captured).toContain('Thought');
    expect(captured).toContain('Analyzing user inquiry...');
    expect(captured).toContain('Moderado');
    expect(captured).toContain('Here is the answer.');
  });

  it('suppresses redundant model badges and completion boxes in chat mode', () => {
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

    expect(captured).not.toContain('● Model:');
    expect(captured).not.toContain('=== Session Finished');
    expect(captured).toContain('Moderado');
    expect(captured).toContain('Hello from Moderado!');
  });
});
