import { z } from 'zod';
import { AccessTierSchema } from './models.js';
import { ToolResultSchema } from './tools.js';
import { ApprovalRequestSchema, ApprovalStatusSchema } from './approvals.js';

export const ProgressEventSchema = z.object({
  type: z.literal('progress'),
  step: z.number().int().nonnegative(),
  maxSteps: z.number().int().positive(),
  status: z.string(),
  timestamp: z.number().int().nonnegative(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

export const ModelChangeEventSchema = z.object({
  type: z.literal('model_change'),
  previousModelId: z.string().optional(),
  newModelId: z.string().min(1),
  reason: z.enum(['initial_selection', 'fallback_rate_limit', 'fallback_unavailable', 'user_pinned']),
  accessClass: AccessTierSchema,
  timestamp: z.number().int().nonnegative(),
});
export type ModelChangeEvent = z.infer<typeof ModelChangeEventSchema>;

export const AssistantDeltaEventSchema = z.object({
  type: z.literal('assistant_delta'),
  delta: z.string(),
  timestamp: z.number().int().nonnegative(),
});
export type AssistantDeltaEvent = z.infer<typeof AssistantDeltaEventSchema>;

export const ReasoningDeltaEventSchema = z.object({
  type: z.literal('reasoning_delta'),
  delta: z.string(),
  timestamp: z.number().int().nonnegative(),
});
export type ReasoningDeltaEvent = z.infer<typeof ReasoningDeltaEventSchema>;

export const ToolCallInitiatedEventSchema = z.object({
  type: z.literal('tool_call_initiated'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  parameters: z.record(z.unknown()),
  timestamp: z.number().int().nonnegative(),
});
export type ToolCallInitiatedEvent = z.infer<typeof ToolCallInitiatedEventSchema>;

export const ApprovalRequestEventSchema = z.object({
  type: z.literal('approval_request'),
  request: ApprovalRequestSchema,
  timestamp: z.number().int().nonnegative(),
});
export type ApprovalRequestEvent = z.infer<typeof ApprovalRequestEventSchema>;

export const ApprovalResolvedEventSchema = z.object({
  type: z.literal('approval_resolved'),
  requestId: z.string().min(1),
  status: ApprovalStatusSchema,
  reason: z.string().optional(),
  timestamp: z.number().int().nonnegative(),
});
export type ApprovalResolvedEvent = z.infer<typeof ApprovalResolvedEventSchema>;

export const ToolResultEventSchema = z.object({
  type: z.literal('tool_result'),
  toolCallId: z.string().min(1),
  result: ToolResultSchema,
  timestamp: z.number().int().nonnegative(),
});
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;

export const CompletionEventSchema = z.object({
  type: z.literal('completion'),
  status: z.enum(['completed', 'step_limit_reached', 'timeout', 'cancelled', 'failed']),
  totalSteps: z.number().int().nonnegative(),
  summary: z.string().optional(),
  timestamp: z.number().int().nonnegative(),
});
export type CompletionEvent = z.infer<typeof CompletionEventSchema>;

export const ErrorEventSchema = z.object({
  type: z.literal('error'),
  code: z.string().min(1),
  message: z.string(),
  recoverable: z.boolean().default(false),
  timestamp: z.number().int().nonnegative(),
});
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export const CancellationEventSchema = z.object({
  type: z.literal('cancellation'),
  reason: z.string(),
  timestamp: z.number().int().nonnegative(),
});
export type CancellationEvent = z.infer<typeof CancellationEventSchema>;

export const AgentEventSchema = z.discriminatedUnion('type', [
  ProgressEventSchema,
  ModelChangeEventSchema,
  AssistantDeltaEventSchema,
  ReasoningDeltaEventSchema,
  ToolCallInitiatedEventSchema,
  ApprovalRequestEventSchema,
  ApprovalResolvedEventSchema,
  ToolResultEventSchema,
  CompletionEventSchema,
  ErrorEventSchema,
  CancellationEventSchema,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export type AgentEventListener = (event: AgentEvent) => void;
