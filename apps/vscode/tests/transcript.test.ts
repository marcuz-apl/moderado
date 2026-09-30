import { describe, expect, it } from 'vitest';
import type { AgentEvent, HostEventEnvelope } from '@moderado/contracts';
import { createTranscript } from '../src/transcript.js';

function envelope(event: AgentEvent, sequence = 1, sessionId = 'session-1'): HostEventEnvelope {
  return { protocolVersion: 1, sessionId, sequence, timestamp: 1, event };
}

describe('transcript', () => {
  it('accumulates streamed assistant text into the running turn', () => {
    const transcript = createTranscript('session-1');
    transcript.beginTurn('Explain this');
    transcript.apply(envelope({ type: 'assistant_delta', delta: 'Hel', timestamp: 1 }));
    transcript.apply(envelope({ type: 'assistant_delta', delta: 'lo', timestamp: 2 }, 2));
    const state = transcript.snapshot();
    expect(state.status).toBe('busy');
    expect(state.currentTurn?.assistantText).toBe('Hello');
    expect(state.turns).toEqual([]);
  });

  it('files the turn on completion and returns to idle', () => {
    const transcript = createTranscript('session-1');
    transcript.beginTurn('Hi');
    transcript.apply(envelope({ type: 'assistant_delta', delta: 'done', timestamp: 1 }));
    transcript.apply(envelope({ type: 'completion', status: 'completed', totalSteps: 1, timestamp: 2 }, 2));
    const state = transcript.snapshot();
    expect(state.status).toBe('idle');
    expect(state.currentTurn).toBeUndefined();
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]).toMatchObject({ userPrompt: 'Hi', assistantText: 'done', status: 'completed' });
  });

  it('tracks tool activity from call through result', () => {
    const transcript = createTranscript('session-1');
    transcript.beginTurn('Read it');
    transcript.apply(envelope({ type: 'tool_call_initiated', toolCallId: 'c1', toolName: 'read_file', parameters: {}, timestamp: 1 }));
    transcript.apply(envelope({ type: 'tool_result', toolCallId: 'c1', result: { toolName: 'read_file', status: 'success', output: 'ok' }, timestamp: 2 }, 2));
    expect(transcript.snapshot().currentTurn?.tools).toEqual([
      expect.objectContaining({ toolCallId: 'c1', toolName: 'read_file', status: 'success' }),
    ]);
  });

  it('surfaces pending approvals and clears them once resolved', () => {
    const transcript = createTranscript('session-1');
    transcript.beginTurn('Run it');
    transcript.apply(envelope({
      type: 'approval_request',
      request: { requestId: 'r1', toolName: 'run_command', actionSummary: 'echo hi', exactPayload: { command: ['echo', 'hi'] }, timestamp: 1 },
      timestamp: 1,
    }));
    expect(transcript.snapshot().pendingApprovals).toEqual([
      expect.objectContaining({ requestId: 'r1', status: 'pending' }),
    ]);
    transcript.apply(envelope({ type: 'approval_resolved', requestId: 'r1', status: 'approved', timestamp: 2 }, 2));
    expect(transcript.snapshot().pendingApprovals).toEqual([]);
    expect(transcript.snapshot().currentTurn?.approvals).toEqual([
      expect.objectContaining({ requestId: 'r1', status: 'approved' }),
    ]);
  });

  it('reports token usage and generation rate', () => {
    const transcript = createTranscript('session-1');
    transcript.beginTurn('Hi');
    transcript.apply(envelope({
      type: 'usage',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      estimated: false,
      outputTokensPerSecond: 12.5,
      generationMs: 100,
      final: true,
      timestamp: 1,
    }));
    expect(transcript.snapshot().usage).toEqual({ totalTokens: 30, tokensPerSecond: 12.5 });
  });

  it('ignores events from another session so a stale view cannot rewrite this one', () => {
    const transcript = createTranscript('session-1');
    transcript.beginTurn('Hi');
    transcript.apply(envelope({ type: 'assistant_delta', delta: 'mine', timestamp: 1 }, 1, 'session-1'));
    transcript.apply(envelope({ type: 'assistant_delta', delta: 'theirs', timestamp: 2 }, 2, 'other-session'));
    expect(transcript.snapshot().currentTurn?.assistantText).toBe('mine');
  });

  it('ignores an event that arrives with no turn in flight', () => {
    const transcript = createTranscript('session-1');
    transcript.apply(envelope({ type: 'assistant_delta', delta: 'stray', timestamp: 1 }));
    expect(transcript.snapshot().currentTurn).toBeUndefined();
    expect(transcript.snapshot().turns).toEqual([]);
  });

  it('records an error on the turn and stops the busy state', () => {
    const transcript = createTranscript('session-1');
    transcript.beginTurn('Hi');
    transcript.apply(envelope({ type: 'error', code: 'ERR_X', message: 'boom', timestamp: 1 }));
    const state = transcript.snapshot();
    expect(state.currentTurn?.errorMessage).toBe('boom');
    expect(state.status).toBe('busy');
    transcript.apply(envelope({ type: 'completion', status: 'failed', totalSteps: 1, timestamp: 2 }, 2));
    expect(transcript.snapshot().status).toBe('idle');
  });

  it('treats a cancelled completion as stopped, not completed', () => {
    const transcript = createTranscript('session-1');
    transcript.beginTurn('Hi');
    transcript.apply(envelope({ type: 'completion', status: 'cancelled', totalSteps: 1, timestamp: 1 }));
    expect(transcript.snapshot().turns[0].status).toBe('cancelled');
  });

  it('records the active model so the composer indicator stays accurate', () => {
    const transcript = createTranscript('session-1');
    transcript.apply(envelope({ type: 'model_change', newModelId: 'm1', reason: 'user_pinned', accessTier: 'free_trial', timestamp: 1 }));
    expect(transcript.snapshot().modelId).toBe('m1');
  });
});