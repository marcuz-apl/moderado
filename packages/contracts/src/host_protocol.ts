import { z } from 'zod';
import { ApprovalStatusSchema } from './approvals.js';
import { HostEventEnvelopeSchema } from './events.js';

export function isSyntacticallySafeRelativePath(p: string): boolean {
  if (!p || typeof p !== 'string') return false;
  // Reject Windows drive-prefixed paths (e.g., C:, D:)
  if (/^[a-zA-Z]:/.test(p)) return false;
  // Reject absolute paths and UNC network shares
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  // Reject path traversal segments in either slash style
  const segments = p.split(/[/\\]/);
  for (const segment of segments) {
    if (segment === '..') return false;
  }
  return true;
}

export const HostChatSelectionContextSchema = z
  .object({
    relativePath: z.string().min(1).refine(isSyntacticallySafeRelativePath, {
      message: 'relativePath must be a relative path without traversal segments',
    }),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    text: z.string().max(20_000).optional(),
  })
  .refine((sel) => sel.endLine >= sel.startLine, {
    message: 'endLine must be greater than or equal to startLine',
  });
export type HostChatSelectionContext = z.infer<typeof HostChatSelectionContextSchema>;

export const HostChatContextSchema = z.object({
  selection: HostChatSelectionContextSchema.optional(),
});
export type HostChatContext = z.infer<typeof HostChatContextSchema>;

export const HOST_PROTOCOL_VERSION = 1;
export type HostProtocolVersion = typeof HOST_PROTOCOL_VERSION;
export const MAX_HOST_LINE_BYTES = 1024 * 1024;

export const InitializeParamsSchema = z.object({
  protocolVersion: z.literal(HOST_PROTOCOL_VERSION),
});
export type InitializeParams = z.infer<typeof InitializeParamsSchema>;

export const InitializeRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.literal('initialize'),
  params: InitializeParamsSchema,
});
export type InitializeRequest = z.infer<typeof InitializeRequestSchema>;

export const ChatSendParamsSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(100_000),
  context: HostChatContextSchema.optional(),
});
export type ChatSendParams = z.infer<typeof ChatSendParamsSchema>;

export const ChatSendRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.literal('chat.send'),
  params: ChatSendParamsSchema,
});
export type ChatSendRequest = z.infer<typeof ChatSendRequestSchema>;

export const ChatCancelParamsSchema = z.object({
  sessionId: z.string().min(1),
  /** Omit to abort whichever generation is currently in flight. */
  targetRequestId: z.string().min(1).optional(),
});
export type ChatCancelParams = z.infer<typeof ChatCancelParamsSchema>;

export const ChatCancelRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.literal('chat.cancel'),
  params: ChatCancelParamsSchema,
});
export type ChatCancelRequest = z.infer<typeof ChatCancelRequestSchema>;

export const ApprovalRespondParamsSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  status: ApprovalStatusSchema,
});
export type ApprovalRespondParams = z.infer<typeof ApprovalRespondParamsSchema>;

export const ApprovalRespondRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.literal('approval.respond'),
  params: ApprovalRespondParamsSchema,
});
export type ApprovalRespondRequest = z.infer<typeof ApprovalRespondRequestSchema>;

export const SessionNewParamsSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionNewParams = z.infer<typeof SessionNewParamsSchema>;

export const SessionNewRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.literal('session.new'),
  params: SessionNewParamsSchema,
});
export type SessionNewRequest = z.infer<typeof SessionNewRequestSchema>;

export const SessionResumeParamsSchema = z.object({
  sessionId: z.string().min(1),
  targetSessionId: z.string().min(1),
});
export type SessionResumeParams = z.infer<typeof SessionResumeParamsSchema>;

export const SessionResumeRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.literal('session.resume'),
  params: SessionResumeParamsSchema,
});
export type SessionResumeRequest = z.infer<typeof SessionResumeRequestSchema>;

/** Safe identifier shape shared by provider ids entering the host boundary. */
export const ProviderIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'providerId must be a connection identifier');

export const ProviderListParamsSchema = z.object({});
export type ProviderListParams = z.infer<typeof ProviderListParamsSchema>;

export const ProviderListRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.literal('provider.list'),
  params: ProviderListParamsSchema,
});
export type ProviderListRequest = z.infer<typeof ProviderListRequestSchema>;

/** A provider the sidecar can route to, with connection state (never secrets). */
export const ProviderInfoSchema = z.object({
  id: ProviderIdSchema,
  label: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  /** Local-only providers (Ollama, LM Studio) work without any API key. */
  requiresApiKey: z.boolean(),
  hasApiKey: z.boolean(),
  isActive: z.boolean(),
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ProviderListResultSchema = z.object({
  providers: z.array(ProviderInfoSchema),
  activeProviderId: ProviderIdSchema.optional(),
});
export type ProviderListResult = z.infer<typeof ProviderListResultSchema>;

export const ProviderConnectParamsSchema = z.object({
  providerId: ProviderIdSchema,
  /** Absent means "activate a provider whose key is already stored". */
  apiKey: z.string().min(1).max(4096).optional(),
});
export type ProviderConnectParams = z.infer<typeof ProviderConnectParamsSchema>;

export const ProviderConnectRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.literal('provider.connect'),
  params: ProviderConnectParamsSchema,
});
export type ProviderConnectRequest = z.infer<typeof ProviderConnectRequestSchema>;

export const ProviderConnectResultSchema = z.object({
  providerId: ProviderIdSchema,
  connected: z.literal(true),
});
export type ProviderConnectResult = z.infer<typeof ProviderConnectResultSchema>;

export const ModelListParamsSchema = z.object({
  providerId: ProviderIdSchema.optional(),
});
export type ModelListParams = z.infer<typeof ModelListParamsSchema>;

export const ModelListRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.literal('model.list'),
  params: ModelListParamsSchema,
});
export type ModelListRequest = z.infer<typeof ModelListRequestSchema>;

export const ModelOptionSchema = z.object({
  id: z.string().min(1).max(300),
  isFree: z.boolean(),
  ownedBy: z.string().max(120).optional(),
});
export type ModelOption = z.infer<typeof ModelOptionSchema>;

export const ModelListResultSchema = z.object({
  providerId: ProviderIdSchema,
  models: z.array(ModelOptionSchema),
  /** True when the catalog exceeded the response cap and was cut. */
  truncated: z.boolean().optional(),
});
export type ModelListResult = z.infer<typeof ModelListResultSchema>;

export const HostRequestSchema = z.discriminatedUnion('method', [
  InitializeRequestSchema,
  ChatSendRequestSchema,
  ChatCancelRequestSchema,
  ApprovalRespondRequestSchema,
  SessionNewRequestSchema,
  SessionResumeRequestSchema,
  ProviderListRequestSchema,
  ProviderConnectRequestSchema,
  ModelListRequestSchema,
]);
export type HostRequest = z.infer<typeof HostRequestSchema>;

export const ResumableSessionSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type ResumableSession = z.infer<typeof ResumableSessionSchema>;

export const InitializeResultSchema = z.object({
  protocolVersion: z.literal(1),
  sessionId: z.string().min(1),
  workspaceName: z.string().min(1),
  resumableSessions: z.array(ResumableSessionSchema),
});
export type InitializeResult = z.infer<typeof InitializeResultSchema>;

export const ChatSendResultSchema = z.object({
  accepted: z.literal(true),
});
export type ChatSendResult = z.infer<typeof ChatSendResultSchema>;

export const ChatCancelResultSchema = z.object({
  cancelled: z.literal(true),
});
export type ChatCancelResult = z.infer<typeof ChatCancelResultSchema>;

export const ApprovalRespondResultSchema = z.object({
  resolved: z.literal(true),
});
export type ApprovalRespondResult = z.infer<typeof ApprovalRespondResultSchema>;

export const SessionNewResultSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionNewResult = z.infer<typeof SessionNewResultSchema>;

export const SessionResumeResultSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionResumeResult = z.infer<typeof SessionResumeResultSchema>;

export const HostErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'UNSUPPORTED_VERSION',
  'WORKSPACE_DENIED',
  'SESSION_NOT_FOUND',
  'APPROVAL_STALE',
  'BUSY',
  'INTERNAL_ERROR',
]);
export type HostErrorCode = z.infer<typeof HostErrorCodeSchema>;

export const HostErrorSchema = z.object({
  code: HostErrorCodeSchema,
  message: z.string(),
});
export type HostError = z.infer<typeof HostErrorSchema>;

export const HostSuccessResponseSchema = z.object({
  type: z.literal('response'),
  id: z.string().min(1),
  ok: z.literal(true),
  result: z.unknown().optional(),
});
export type HostSuccessResponse = z.infer<typeof HostSuccessResponseSchema>;

export const HostErrorResponseSchema = z.object({
  type: z.literal('response'),
  id: z.string().min(1),
  ok: z.literal(false),
  error: HostErrorSchema,
});
export type HostErrorResponse = z.infer<typeof HostErrorResponseSchema>;

export const HostResponseSchema = z.discriminatedUnion('ok', [
  HostSuccessResponseSchema,
  HostErrorResponseSchema,
]);
export type HostResponse = z.infer<typeof HostResponseSchema>;

export const HostNotificationSchema = z.object({
  type: z.literal('event'),
  envelope: HostEventEnvelopeSchema,
});
export type HostNotification = z.infer<typeof HostNotificationSchema>;

export const HostMessageSchema = z.union([
  HostRequestSchema,
  HostResponseSchema,
  HostNotificationSchema,
]);
export type HostMessage = z.infer<typeof HostMessageSchema>;
