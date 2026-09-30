import { z } from 'zod';
import { DiscoveredModelSchema } from './models.js';

const id = z.string().trim().min(1);
const envelope = { protocolVersion: z.literal(1), requestId: id };

export const HostApprovalCategorySchema = z.enum(['read', 'edit', 'web_fetch', 'execute', 'mcp']);
export type HostApprovalCategory = z.infer<typeof HostApprovalCategorySchema>;

/**
 * An About link is rendered as an anchor, so a bare `z.string().url()` would
 * accept `javascript:` and turn metadata into script execution. Only https
 * repository links are allowed.
 */
const httpsUrl = z.string().url().refine((value) => value.startsWith('https://'), 'About links must be https');

export const HostIntentSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('start_turn'), sessionId: id, prompt: id, mode: z.enum(['Plan', 'Execute']) }).strict(),
  z.object({ ...envelope, type: z.literal('cancel_turn'), sessionId: id }).strict(),
  z.object({ ...envelope, type: z.literal('list_providers') }).strict(),
  z.object({ ...envelope, type: z.literal('select_provider'), providerId: id }).strict(),
  z.object({ ...envelope, type: z.literal('list_models'), providerId: id }).strict(),
  z.object({ ...envelope, type: z.literal('select_model'), providerId: id, modelId: id }).strict(),
  z.object({ ...envelope, type: z.literal('set_credential'), providerId: id, apiKey: z.string().trim().min(1).max(4096) }).strict(),
  z.object({ ...envelope, type: z.literal('clear_credential'), providerId: id }).strict(),
  z.object({ ...envelope, type: z.literal('test_connection'), providerId: id }).strict(),
  z.object({ ...envelope, type: z.literal('get_about') }).strict(),
  z.object({ ...envelope, type: z.literal('resolve_approval'), sessionId: id, approvalRequestId: id, status: z.enum(['approved', 'denied']) }).strict(),
  z.object({ ...envelope, type: z.literal('update_settings'), category: HostApprovalCategorySchema, enabled: z.boolean() }).strict(),
  z.object({ ...envelope, type: z.literal('list_sessions') }).strict(),
  z.object({ ...envelope, type: z.literal('resume_session'), sessionId: id }).strict(),
]);
export type HostIntent = z.infer<typeof HostIntentSchema>;

export const HostResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn_started'), sessionId: id }).strict(),
  z.object({ type: z.literal('turn_cancelled'), sessionId: id }).strict(),
  z.object({ type: z.literal('providers'), providers: z.array(z.object({ id, name: id }).strict()) }).strict(),
  z.object({ type: z.literal('provider_selected'), providerId: id }).strict(),
  z.object({ type: z.literal('models'), providerId: id, models: z.array(DiscoveredModelSchema.extend({ verifiedFree: z.literal(true) })) }).strict(),
  z.object({ type: z.literal('connection_tested'), providerId: id, ok: z.boolean(), modelCount: z.number().int().nonnegative(), message: id }).strict(),
  z.object({ type: z.literal('credential_updated'), providerId: id }).strict(),
  z.object({
    type: z.literal('about'),
    version: id,
    license: id,
    description: id,
    documentation: httpsUrl,
    repository: httpsUrl,
    issues: httpsUrl,
  }).strict(),
  z.object({ type: z.literal('model_selected'), providerId: id, modelId: id }).strict(),
  z.object({ type: z.literal('approval_resolved'), sessionId: id, approvalRequestId: id, status: z.enum(['approved', 'denied']) }).strict(),
  z.object({ type: z.literal('settings_updated'), category: HostApprovalCategorySchema, enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('sessions'), sessions: z.array(z.object({ id, title: id.optional(), updatedAt: z.string().datetime(), providerId: id.optional(), modelId: id.optional() }).strict()) }).strict(),
  z.object({ type: z.literal('session_resumed'), sessionId: id }).strict(),
]);
export type HostResult = z.infer<typeof HostResultSchema>;

export const HostResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ...envelope, ok: z.literal(true), result: HostResultSchema }).strict(),
  z.object({ ...envelope, ok: z.literal(false), error: z.object({ code: id, message: id }).strict() }).strict(),
]);
export type HostResponse = z.infer<typeof HostResponseSchema>;
