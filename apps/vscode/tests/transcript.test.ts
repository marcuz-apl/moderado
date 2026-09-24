import { describe, it, expect } from 'vitest';
import {
  initialTranscriptState,
  applyHostEvent,
  type TranscriptState,
} from '../src/webview/transcript.js';
import type { HostEventEnvelope } from '../src/protocol.js';

function createEnvelope(sequence: number, event: any, sessionId = 'sess-1'): HostEventEnvelope {
  return {
    protocolVersion: 1,
    sessionId,
    sequence,
    timestamp: 1000 + sequence,
    event,
  };
}

describe('Transcript Reducer', () => {
  it('initializes with default idle state', () => {
    const state = initialTranscriptState();
    expect(state.lastSequence).toBe(0);
    expect(state.turns).toHaveLength(0);
    expect(state.currentTurn).toBeUndefined();
    expect(state.status).toBe('idle');
    expect(state.hasSequenceGap).toBe(false);
  });

  it('starts a turn on first assistant or progress event and appends assistant deltas', () => {
    let state = initialTranscriptState();

    state = applyHostEvent(
      state,
      createEnvelope(1, {
        type: 'assistant_delta',
        delta: 'Hello, ',
        timestamp: 1001,
      }),
    );

    expect(state.currentTurn).toBeDefined();
    expect(state.currentTurn!.assistantText).toBe('Hello, ');
    expect(state.lastSequence).toBe(1);

    state = applyHostEvent(
      state,
      createEnvelope(2, {
        type: 'assistant_delta',
        delta: 'world!',
        timestamp: 1002,
      }),
    );

    expect(state.currentTurn!.assistantText).toBe('Hello, world!');
    expect(state.lastSequence).toBe(2);
  });

  it('does NOT render reasoning_delta events in assistantText', () => {
    let state = initialTranscriptState();

    state = applyHostEvent(
      state,
      createEnvelope(1, {
        type: 'reasoning_delta',
        delta: 'Hidden reasoning process...',
        timestamp: 1001,
      }),
    );

    // Current turn assistantText should NOT contain reasoning
    expect(state.currentTurn?.assistantText ?? '').toBe('');
  });

  it('updates progress state on active turn', () => {
    let state = initialTranscriptState();

    state = applyHostEvent(
      state,
      createEnvelope(1, {
        type: 'progress',
        step: 2,
        maxSteps: 10,
        status: 'Reading files',
        timestamp: 1001,
      }),
    );

    expect(state.currentTurn).toBeDefined();
    expect(state.currentTurn!.progress).toEqual({
      step: 2,
      maxSteps: 10,
      status: 'Reading files',
    });
  });

  it('tracks tool calls and resolves them on tool_result', () => {
    let state = initialTranscriptState();

    state = applyHostEvent(
      state,
      createEnvelope(1, {
        type: 'tool_call_initiated',
        toolCallId: 'call-1',
        toolName: 'read_file',
        parameters: { path: 'src/app.ts' },
        timestamp: 1001,
      }),
    );

    expect(state.currentTurn!.tools).toHaveLength(1);
    expect(state.currentTurn!.tools[0].id).toBe('call-1');
    expect(state.currentTurn!.tools[0].status).toBe('running');

    state = applyHostEvent(
      state,
      createEnvelope(2, {
        type: 'tool_result',
        toolCallId: 'call-1',
        result: { status: 'success', toolName: 'read_file', output: 'console.log("ready");' },
        timestamp: 1002,
      }),
    );

    expect(state.currentTurn!.tools[0].status).toBe('completed');
    expect(state.currentTurn!.tools[0].resultPreview).toContain('console.log');
  });

  it('records approval_request once and updates on approval_resolved', () => {
    let state = initialTranscriptState();

    const approvalReq = {
      type: 'approval_request',
      request: {
        requestId: 'req-appr-1',
        toolName: 'write_file',
        actionSummary: 'write to src/app.ts',
        exactPayload: { targetFile: 'src/app.ts', diffPreview: '+test' },
        timestamp: 1001,
      },
      timestamp: 1001,
    };

    state = applyHostEvent(state, createEnvelope(1, approvalReq));
    expect(state.currentTurn!.approvals).toHaveLength(1);
    expect(state.currentTurn!.approvals[0].requestId).toBe('req-appr-1');
    expect(state.currentTurn!.approvals[0].status).toBe('pending');

    // Duplicate event with same sequence or requestId does not duplicate
    state = applyHostEvent(state, createEnvelope(1, approvalReq));
    expect(state.currentTurn!.approvals).toHaveLength(1);

    // Resolve approval
    state = applyHostEvent(
      state,
      createEnvelope(2, {
        type: 'approval_resolved',
        requestId: 'req-appr-1',
        status: 'approved',
        timestamp: 1002,
      }),
    );

    expect(state.currentTurn!.approvals[0].status).toBe('approved');
  });

  it('ignores old or repeated sequence numbers', () => {
    let state = initialTranscriptState();

    state = applyHostEvent(
      state,
      createEnvelope(5, {
        type: 'assistant_delta',
        delta: 'First',
        timestamp: 1005,
      }),
    );

    expect(state.lastSequence).toBe(5);
    expect(state.currentTurn!.assistantText).toBe('First');

    // Received sequence 3 (old)
    state = applyHostEvent(
      state,
      createEnvelope(3, {
        type: 'assistant_delta',
        delta: 'Old',
        timestamp: 1003,
      }),
    );

    // Ignored, state remains unchanged
    expect(state.lastSequence).toBe(5);
    expect(state.currentTurn!.assistantText).toBe('First');
  });

  it('detects sequence gaps and flags hasSequenceGap', () => {
    let state = initialTranscriptState();

    state = applyHostEvent(
      state,
      createEnvelope(1, {
        type: 'assistant_delta',
        delta: 'First',
        timestamp: 1001,
      }),
    );

    expect(state.hasSequenceGap).toBe(false);

    // Gap: jumps from 1 to 4
    state = applyHostEvent(
      state,
      createEnvelope(4, {
        type: 'assistant_delta',
        delta: 'Gap',
        timestamp: 1004,
      }),
    );

    expect(state.hasSequenceGap).toBe(true);
    expect(state.lastSequence).toBe(4);
  });

  it('moves current turn to turns list on completion, cancellation, or error', () => {
    let state = initialTranscriptState();

    state = applyHostEvent(
      state,
      createEnvelope(1, {
        type: 'assistant_delta',
        delta: 'Done with work',
        timestamp: 1001,
      }),
    );

    state = applyHostEvent(
      state,
      createEnvelope(2, {
        type: 'completion',
        summary: 'Work finished cleanly',
        timestamp: 1002,
      }),
    );

    expect(state.currentTurn).toBeUndefined();
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].status).toBe('completed');
    expect(state.turns[0].assistantText).toBe('Done with work');
    expect(state.status).toBe('idle');
  });
});
