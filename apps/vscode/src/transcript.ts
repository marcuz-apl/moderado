import type { AgentEvent, HostEventEnvelope } from '@moderado/contracts';

export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  status: string;
}

export interface ApprovalView {
  requestId: string;
  toolName: string;
  actionSummary: string;
  exactPayload: unknown;
  status: 'pending' | 'approved' | 'denied' | 'aborted';
}

export interface TurnView {
  userPrompt: string;
  assistantText: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'step_limit_reached' | 'timeout';
  tools: ToolActivity[];
  approvals: ApprovalView[];
  errorMessage?: string;
}

export interface TranscriptState {
  sessionId: string;
  status: 'idle' | 'busy';
  turns: TurnView[];
  currentTurn?: TurnView;
  pendingApprovals: ApprovalView[];
  usage?: { totalTokens: number; tokensPerSecond: number };
  modelId?: string;
}

export interface Transcript {
  beginTurn(prompt: string): void;
  apply(envelope: HostEventEnvelope): void;
  reset(sessionId?: string): void;
  snapshot(): TranscriptState;
}

/**
 * Reduce agent events into the view state the webview renders.
 *
 * Kept free of `vscode` and of the DOM so the streaming rules are testable
 * offline. Events for another session are dropped: a reopened view must not
 * interleave a stale run into the current conversation.
 */
export function createTranscript(sessionId: string): Transcript {
  let current: string = sessionId;
  let turns: TurnView[] = [];
  let active: TurnView | undefined;
  let pending: ApprovalView[] = [];
  let usage: TranscriptState['usage'];
  let modelId: string | undefined;

  const emptyTurn = (prompt: string): TurnView => ({ userPrompt: prompt, assistantText: '', status: 'running', tools: [], approvals: [] });

  function apply(event: AgentEvent): void {
    if (event.type === 'model_change') { modelId = event.newModelId; return; }
    if (event.type === 'usage') {
      usage = { totalTokens: event.usage.totalTokens, tokensPerSecond: event.outputTokensPerSecond };
      return;
    }
    if (event.type === 'approval_request') {
      const view: ApprovalView = {
        requestId: event.request.requestId,
        toolName: event.request.toolName,
        actionSummary: event.request.actionSummary,
        exactPayload: event.request.exactPayload,
        status: 'pending',
      };
      pending = [...pending, view];
      active?.approvals.push(view);
      return;
    }
    if (event.type === 'approval_resolved') {
      pending = pending.filter((item) => item.requestId !== event.requestId);
      const seen = active?.approvals.find((item) => item.requestId === event.requestId);
      if (seen) seen.status = event.status;
      return;
    }
    if (event.type === 'assistant_delta') { if (active) active.assistantText += event.delta; return; }
    if (event.type === 'reasoning_delta') return;
    if (event.type === 'tool_call_initiated') {
      active?.tools.push({ toolCallId: event.toolCallId, toolName: event.toolName, status: 'running' });
      return;
    }
    if (event.type === 'tool_result') {
      const tool = active?.tools.find((item) => item.toolCallId === event.toolCallId);
      if (tool) tool.status = event.result.status;
      return;
    }
    if (event.type === 'error') { if (active) active.errorMessage = event.message; return; }
    if (event.type === 'cancellation') { if (active) active.assistantText += `\n${event.reason}`; return; }
    if (event.type === 'completion') {
      // A cancelled or failed run still files its partial answer.
      if (active) { active.status = event.status; turns = [...turns, active]; active = undefined; }
      pending = [];
      return;
    }
    // progress and diagnostic_result carry no transcript text.
  }

  return {
    beginTurn(prompt: string): void {
      active = emptyTurn(prompt);
    },
    apply(envelope: HostEventEnvelope): void {
      if (envelope.sessionId !== current) return;
      apply(envelope.event);
    },
    reset(next = current): void {
      current = next;
      turns = [];
      active = undefined;
      pending = [];
      usage = undefined;
    },
    snapshot(): TranscriptState {
      return {
        sessionId: current,
        status: active ? 'busy' : 'idle',
        turns,
        currentTurn: active,
        pendingApprovals: pending,
        usage,
        modelId,
      };
    },
  };
}