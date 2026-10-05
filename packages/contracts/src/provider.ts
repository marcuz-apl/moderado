import { z } from 'zod';
import type { ChatMessage, ToolCallChunk } from './messages.js';
import type { ModelInventoryEntry } from './models.js';

// --- Error Taxonomy ---

export class ProviderError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

const GATEWAY_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Moderado Cloud rejected the API key. Run /login to authorize again.',
  scope_denied: 'This Moderado Cloud key is not authorized for the selected model. Choose an allowed model or use another key.',
  invalid_request: 'Moderado Cloud rejected the request. Check the model, messages, tools, and token limit.',
  model_unavailable: 'The selected Moderado Cloud model is unavailable. Choose another available model.',
  quota_exceeded: 'Moderado Cloud quota is exhausted. Wait before trying again.',
  hosted_routes_unavailable: 'Moderado Cloud has no hosted routes available right now.',
  provider_rate_limited: 'The hosted provider is rate limited. Try again later.',
  provider_protocol_error: 'The hosted provider returned an invalid response.',
  provider_error: 'The hosted provider could not complete the request.',
  service_unavailable: 'Moderado Cloud is temporarily unavailable. Try again later.',
};
export const GATEWAY_ERROR_CODES = Object.keys(GATEWAY_ERROR_MESSAGES);

/** Sanitized, non-retryable Gateway response. Provider bodies are never surfaced. */
export class GatewayError extends ProviderError {
  public readonly gatewayCode: string;
  public readonly retryAfterSeconds?: number;

  constructor(gatewayCode: string, statusCode: number, retryAfterSeconds?: number) {
    const message = GATEWAY_ERROR_MESSAGES[gatewayCode] ?? 'Moderado Cloud request failed. Try again later.';
    const actionableMessage = gatewayCode === 'quota_exceeded' && retryAfterSeconds !== undefined
      ? `${message} Retry after ${retryAfterSeconds} seconds.`
      : message;
    super(actionableMessage, `ERR_GATEWAY_${gatewayCode.toUpperCase()}`, statusCode);
    this.gatewayCode = gatewayCode;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = 'GatewayError';
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message = 'Authentication failed: invalid or expired provider API key', statusCode = 401) {
    super(message, 'ERR_PROVIDER_AUTHENTICATION', statusCode);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    message = 'Rate limit exceeded',
    public readonly retryAfterSeconds?: number,
    statusCode = 429
  ) {
    super(message, 'ERR_PROVIDER_RATE_LIMIT', statusCode);
    this.name = 'RateLimitError';
  }
}

export class ModelUnavailableError extends ProviderError {
  constructor(message = 'Requested model is currently unavailable', statusCode = 503) {
    super(message, 'ERR_MODEL_UNAVAILABLE', statusCode);
    this.name = 'ModelUnavailableError';
  }
}

export class EmptyResponseError extends ProviderError {
  constructor(message = 'Provider returned no assistant content or tool calls') {
    super(message, 'ERR_EMPTY_RESPONSE');
    this.name = 'EmptyResponseError';
  }
}

export class MalformedResponseError extends ProviderError {
  constructor(message = 'Provider returned malformed or unparseable response') {
    super(message, 'ERR_MALFORMED_RESPONSE');
    this.name = 'MalformedResponseError';
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message = 'Provider request timed out') {
    super(message, 'ERR_PROVIDER_TIMEOUT', 408);
    this.name = 'ProviderTimeoutError';
  }
}

// --- Streaming Contracts ---

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof GatewayError) return false;
  if (error instanceof AuthenticationError || error instanceof MalformedResponseError || error instanceof EmptyResponseError) return false;
  return error instanceof RateLimitError || error instanceof ModelUnavailableError || error instanceof ProviderTimeoutError ||
    (error instanceof ProviderError && (error.statusCode ?? 0) >= 500);
}

export const ChatUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type ChatUsage = z.infer<typeof ChatUsageSchema>;

const GatewayRouteIdSchema = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._:/_-]*$/);
export const GatewayFallbackStatusSchema = z.object({
  fromProvider: GatewayRouteIdSchema.optional(),
  fromModel: GatewayRouteIdSchema,
  toProvider: GatewayRouteIdSchema.optional(),
  toModel: GatewayRouteIdSchema,
  reason: z.literal('rate_limited_or_unavailable'),
}).strict();
export type GatewayFallbackStatus = z.infer<typeof GatewayFallbackStatusSchema>;

export const ChatCompletionChunkSchema = z.object({
  contentDelta: z.string().optional(),
  reasoningDelta: z.string().optional(),
  toolCallChunks: z.array(z.custom<ToolCallChunk>()).optional(),
  finishReason: z.enum(['stop', 'tool_calls', 'length', 'error']).nullable().optional(),
  usage: ChatUsageSchema.optional(),
  gatewayStatus: GatewayFallbackStatusSchema.optional(),
});
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;

export interface ProviderChatOptions {
  modelId: string;
  messages: ChatMessage[];
  tools?: ProviderToolDeclaration[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface IProviderAdapter {
  readonly id: string;
  readonly name: string;
  discoverModels(signal?: AbortSignal, forceRefresh?: boolean): Promise<ModelInventoryEntry[]>;
  streamChat(options: ProviderChatOptions): AsyncIterable<ChatCompletionChunk>;
}
