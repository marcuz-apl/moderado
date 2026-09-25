import { z } from 'zod';
import {
  HostChatContextSchema,
  HostChatSelectionContextSchema,
  HostEventEnvelopeSchema,
} from '../protocol.js';

export const WebviewSendMsgSchema = z.object({
  type: z.literal('send'),
  text: z.string().min(1).max(100_000),
  context: HostChatContextSchema.optional(),
});

export const WebviewCancelMsgSchema = z.object({
  type: z.literal('cancel'),
});

export const WebviewNewSessionMsgSchema = z.object({
  type: z.literal('newSession'),
});

export const WebviewResumeSessionMsgSchema = z.object({
  type: z.literal('resumeSession'),
  sessionId: z.string().min(1),
});

export const WebviewApproveMsgSchema = z.object({
  type: z.literal('approve'),
  requestId: z.string().min(1),
});

export const WebviewRejectMsgSchema = z.object({
  type: z.literal('reject'),
  requestId: z.string().min(1),
  reason: z.string().optional(),
});

export const WebviewAttachSelectionMsgSchema = z.object({
  type: z.literal('attachSelection'),
});

export const WebviewSelectModelMsgSchema = z.object({
  type: z.literal('selectModel'),
});

export const WebviewSelectProviderMsgSchema = z.object({
  type: z.literal('selectProvider'),
});

export const WebviewRetrySidecarMsgSchema = z.object({
  type: z.literal('retrySidecar'),
});

export const WebviewAttachFileMsgSchema = z.object({
  type: z.literal('attachFile'),
});

export const WebviewToHostMessageSchema = z.discriminatedUnion('type', [
  WebviewSendMsgSchema,
  WebviewCancelMsgSchema,
  WebviewNewSessionMsgSchema,
  WebviewResumeSessionMsgSchema,
  WebviewApproveMsgSchema,
  WebviewRejectMsgSchema,
  WebviewAttachSelectionMsgSchema,
  WebviewAttachFileMsgSchema,
  WebviewSelectModelMsgSchema,
  WebviewSelectProviderMsgSchema,
  WebviewRetrySidecarMsgSchema,
]);
export type WebviewToHostMessage = z.infer<typeof WebviewToHostMessageSchema>;

export const HostStateMsgSchema = z.object({
  type: z.literal('state'),
  state: z.unknown(),
});

export const HostEventMsgSchema = z.object({
  type: z.literal('event'),
  envelope: HostEventEnvelopeSchema,
});

export const HostActiveEditorContextMsgSchema = z.object({
  type: z.literal('activeEditorContext'),
  context: HostChatSelectionContextSchema.optional(),
});

export const HostErrorMsgSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
});

/**
 * The sidecar could not be started at all (missing CLI and no bundled copy).
 * Carries no credential or environment detail, only what the user must act on.
 */
export const HostSidecarUnavailableMsgSchema = z.object({
  type: z.literal('sidecarUnavailable'),
  message: z.string().max(2000),
  /** The command that was attempted, so the message is actionable. */
  attemptedExecutable: z.string().max(512).optional(),
  canRetry: z.boolean().optional(),
});

export const HostSidecarReadyMsgSchema = z.object({
  type: z.literal('sidecarReady'),
});

/**
 * Current provider/model for the composer status line. Carries ids and labels
 * only; never an API key or any credential material.
 */
export const HostModelStatusMsgSchema = z.object({
  type: z.literal('modelStatus'),
  providerId: z.string().max(64).optional(),
  providerLabel: z.string().max(120).optional(),
  modelId: z.string().max(300).optional(),
  /** True when the provider still needs an API key before any turn can run. */
  needsApiKey: z.boolean().optional(),
});

/** Append text to the composer, used by the attach-file flow. */
export const HostAppendComposerTextMsgSchema = z.object({
  type: z.literal('appendComposerText'),
  text: z.string().max(4096),
});

export const HostToWebviewMessageSchema = z.discriminatedUnion('type', [
  HostStateMsgSchema,
  HostEventMsgSchema,
  HostActiveEditorContextMsgSchema,
  HostErrorMsgSchema,
  HostSidecarUnavailableMsgSchema,
  HostSidecarReadyMsgSchema,
  HostModelStatusMsgSchema,
  HostAppendComposerTextMsgSchema,
]);
export type HostToWebviewMessage = z.infer<typeof HostToWebviewMessageSchema>;
