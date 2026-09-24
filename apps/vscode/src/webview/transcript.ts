import type { HostEventEnvelope } from '../protocol.js';

export interface ToolActivity {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  resultPreview?: string;
  timestamp: number;
}

export interface PendingApprovalCard {
  requestId: string;
  toolName: string;
  actionSummary: string;
  exactPayload: {
    targetFile?: string;
    diffPreview?: string;
    contentPreview?: string;
    command?: string[];
    cwd?: string;
  };
  status: 'pending' | 'approved' | 'denied' | 'aborted';
  timestamp: number;
}

export interface ProgressState {
  step: number;
  maxSteps: number;
  status: string;
}

export interface TurnState {
  id: string;
  userPrompt?: string;
  assistantText: string;
  modelId?: string;
  progress?: ProgressState;
  tools: ToolActivity[];
  approvals: PendingApprovalCard[];
  status: 'running' | 'completed' | 'cancelled' | 'error';
  errorMessage?: string;
  timestamp: number;
}

export interface TranscriptState {
  sessionId?: string;
  lastSequence: number;
  turns: TurnState[];
  currentTurn?: TurnState;
  hasSequenceGap: boolean;
  status: 'idle' | 'busy' | 'error';
}

export function initialTranscriptState(sessionId?: string): TranscriptState {
  return {
    sessionId,
    lastSequence: 0,
    turns: [],
    currentTurn: undefined,
    hasSequenceGap: false,
    status: 'idle',
  };
}

function ensureCurrentTurn(state: TranscriptState, timestamp: number): TurnState {
  if (state.currentTurn) {
    return state.currentTurn;
  }
  return {
    id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    assistantText: '',
    tools: [],
    approvals: [],
    status: 'running',
    timestamp,
  };
}

export function applyHostEvent(state: TranscriptState, envelope: HostEventEnvelope): TranscriptState {
  // Ignore repeated or old sequence numbers
  if (envelope.sequence <= state.lastSequence) {
    return state;
  }

  // Detect sequence gap
  const hasSequenceGap =
    state.hasSequenceGap || (state.lastSequence > 0 && envelope.sequence > state.lastSequence + 1);

  const event = envelope.event;
  const next: TranscriptState = {
    ...state,
    sessionId: envelope.sessionId ?? state.sessionId,
    lastSequence: envelope.sequence,
    hasSequenceGap,
    turns: [...state.turns],
  };

  switch (event.type) {
    case 'assistant_delta': {
      const turn = ensureCurrentTurn(next, event.timestamp);
      next.currentTurn = {
        ...turn,
        assistantText: turn.assistantText + event.delta,
        status: 'running',
      };
      next.status = 'busy';
      break;
    }

    case 'reasoning_delta': {
      // Intentionally omit reasoning events in alpha UI
      break;
    }

    case 'progress': {
      const turn = ensureCurrentTurn(next, event.timestamp);
      next.currentTurn = {
        ...turn,
        progress: {
          step: event.step,
          maxSteps: event.maxSteps,
          status: event.status,
        },
        status: 'running',
      };
      next.status = 'busy';
      break;
    }

    case 'model_change': {
      const turn = ensureCurrentTurn(next, event.timestamp);
      next.currentTurn = {
        ...turn,
        modelId: event.newModelId,
      };
      break;
    }

    case 'tool_call_initiated': {
      const turn = ensureCurrentTurn(next, event.timestamp);
      const existingToolIdx = turn.tools.findIndex((t) => t.id === event.toolCallId);
      const newTool: ToolActivity = {
        id: event.toolCallId,
        toolName: event.toolName,
        parameters: event.parameters,
        status: 'running',
        timestamp: event.timestamp,
      };

      const updatedTools = [...turn.tools];
      if (existingToolIdx >= 0) {
        updatedTools[existingToolIdx] = newTool;
      } else {
        updatedTools.push(newTool);
      }

      next.currentTurn = {
        ...turn,
        tools: updatedTools,
        status: 'running',
      };
      next.status = 'busy';
      break;
    }

    case 'tool_result': {
      const turn = ensureCurrentTurn(next, event.timestamp);
      const existingToolIdx = turn.tools.findIndex((t) => t.id === event.toolCallId);
      const isSuccess = event.result.status === 'success';
      const outputPreview =
        typeof event.result.output === 'string'
          ? event.result.output
          : JSON.stringify(event.result.output ?? '');

      const updatedTools = [...turn.tools];
      if (existingToolIdx >= 0) {
        updatedTools[existingToolIdx] = {
          ...updatedTools[existingToolIdx],
          status: isSuccess ? 'completed' : 'failed',
          resultPreview: outputPreview,
        };
      } else {
        updatedTools.push({
          id: event.toolCallId,
          toolName: event.result.toolName,
          parameters: {},
          status: isSuccess ? 'completed' : 'failed',
          resultPreview: outputPreview,
          timestamp: event.timestamp,
        });
      }

      next.currentTurn = {
        ...turn,
        tools: updatedTools,
      };
      break;
    }

    case 'approval_request': {
      const turn = ensureCurrentTurn(next, event.timestamp);
      const req = event.request;
      const existingIdx = turn.approvals.findIndex((a) => a.requestId === req.requestId);

      const approvalCard: PendingApprovalCard = {
        requestId: req.requestId,
        toolName: req.toolName,
        actionSummary: req.actionSummary,
        exactPayload: req.exactPayload,
        status: 'pending',
        timestamp: event.timestamp,
      };

      const updatedApprovals = [...turn.approvals];
      if (existingIdx >= 0) {
        updatedApprovals[existingIdx] = approvalCard;
      } else {
        updatedApprovals.push(approvalCard);
      }

      next.currentTurn = {
        ...turn,
        approvals: updatedApprovals,
      };
      break;
    }

    case 'approval_resolved': {
      const turn = ensureCurrentTurn(next, event.timestamp);
      const updatedApprovals = turn.approvals.map((a) =>
        a.requestId === event.requestId ? { ...a, status: event.status } : a,
      );

      next.currentTurn = {
        ...turn,
        approvals: updatedApprovals,
      };
      break;
    }

    case 'completion': {
      if (next.currentTurn) {
        const completedTurn: TurnState = {
          ...next.currentTurn,
          status: 'completed',
        };
        next.turns.push(completedTurn);
        next.currentTurn = undefined;
      }
      next.status = 'idle';
      break;
    }

    case 'error': {
      if (next.currentTurn) {
        const errorTurn: TurnState = {
          ...next.currentTurn,
          status: 'error',
          errorMessage: event.message,
        };
        next.turns.push(errorTurn);
        next.currentTurn = undefined;
      }
      next.status = 'error';
      break;
    }

    case 'cancellation': {
      if (next.currentTurn) {
        const cancelledTurn: TurnState = {
          ...next.currentTurn,
          status: 'cancelled',
        };
        next.turns.push(cancelledTurn);
        next.currentTurn = undefined;
      }
      next.status = 'idle';
      break;
    }
  }

  return next;
}
