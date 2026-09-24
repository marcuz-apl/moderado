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

export const WebviewToHostMessageSchema = z.discriminatedUnion('type', [
  WebviewSendMsgSchema,
  WebviewCancelMsgSchema,
  WebviewNewSessionMsgSchema,
  WebviewResumeSessionMsgSchema,
  WebviewApproveMsgSchema,
  WebviewRejectMsgSchema,
  WebviewAttachSelectionMsgSchema,
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

export const HostToWebviewMessageSchema = z.discriminatedUnion('type', [
  HostStateMsgSchema,
  HostEventMsgSchema,
  HostActiveEditorContextMsgSchema,
  HostErrorMsgSchema,
]);
export type HostToWebviewMessage = z.infer<typeof HostToWebviewMessageSchema>;
