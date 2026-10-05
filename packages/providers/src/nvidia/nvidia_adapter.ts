import {
  AuthenticationError,
  ChatCompletionChunk,
  GATEWAY_ERROR_CODES,
  GatewayError,
  IProviderAdapter,
  ModelInventoryEntry,
  ModelInventoryEntrySchema,
  ModelUnavailableError,
  ProviderChatOptions,
  ProviderError,
  RateLimitError,
} from '@moderado/contracts';
import { parseSseStream } from './sse_parser.js';

export interface NvidiaAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  /** Provider identity for OpenAI-compatible services using this transport. */
  providerId?: string;
  providerName?: string;
}

export class NvidiaAdapter implements IProviderAdapter {
  public readonly id: string;
  public readonly name: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private cachedInventory: ModelInventoryEntry[] | null = null;
  private cacheTimestamp = 0;
  private readonly cacheTtlMs = 15 * 60 * 1000;
  private readonly isModeradoCloud: boolean;

  constructor(config: NvidiaAdapterConfig = {}) {
    this.id = config.providerId || 'nvidia';
    this.name = config.providerName || 'NVIDIA NIM';
    this.isModeradoCloud = this.id === 'moderado-cloud';
    this.apiKey = config.apiKey || process.env.NVIDIA_API_KEY || '';
    this.baseUrl = (config.baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Connection: 'keep-alive',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async discoverModels(signal?: AbortSignal, forceRefresh = false): Promise<ModelInventoryEntry[]> {
    if (!forceRefresh && this.cachedInventory && Date.now() - this.cacheTimestamp < this.cacheTtlMs) {
      return this.cachedInventory;
    }

    const url = `${this.baseUrl}/models`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal,
      });
    } catch (err: any) {
      if (signal?.aborted) {
        throw new Error('Discovery request was aborted');
      }
      throw new ProviderError(`Network error while contacting ${url}: ${err.message}`, 'ERR_NETWORK_ERROR');
    }

    if (!response.ok) {
      await this.handleHttpError(response, 'discoverModels');
    }

    let json: any;
    try {
      json = await response.json();
    } catch (err: any) {
      throw new ProviderError(`Failed to parse models response: ${err.message}`, 'ERR_MALFORMED_RESPONSE');
    }

    const dataArray = Array.isArray(json) ? json : json.data;
    if (!Array.isArray(dataArray)) {
      throw new ProviderError("Expected array in models response ('data' field)", 'ERR_MALFORMED_RESPONSE');
    }

    const results: ModelInventoryEntry[] = [];
    for (const item of dataArray) {
      const parsed = ModelInventoryEntrySchema.safeParse(item);
      if (parsed.success) {
        results.push(parsed.data);
      }
    }

    this.cachedInventory = results;
    this.cacheTimestamp = Date.now();
    return results;
  }

  async *streamChat(options: ProviderChatOptions): AsyncIterable<ChatCompletionChunk> {
    const url = `${this.baseUrl}/chat/completions`;

    // Map contracts ChatMessage to OpenAI/NIM wire payload
    const wireMessages = options.messages.map((msg) => {
      if (msg.role === 'assistant') {
        const out: Record<string, unknown> = {
          role: 'assistant',
          content: msg.content ?? '',
        };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          out.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        return out;
      }

      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId,
          name: msg.name,
          content: msg.content,
        };
      }

      return {
        role: msg.role,
        content: msg.content,
      };
    });

    const payload: Record<string, unknown> = {
      model: options.modelId,
      messages: wireMessages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    if (options.temperature !== undefined) {
      payload.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      payload.max_tokens = options.maxTokens;
    }

    if (this.isModeradoCloud) {
      this.validateGatewayRequest(options, wireMessages, payload);
    }

    const body = JSON.stringify(payload);
    if (this.isModeradoCloud && Buffer.byteLength(body, 'utf8') > 32 * 1024) {
      throw new ProviderError('Moderado Cloud request exceeds the 32768-byte limit', 'ERR_GATEWAY_INVALID_REQUEST', 400);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          Accept: 'text/event-stream',
        },
        body,
        signal: options.signal,
      });
    } catch (err: any) {
      if (options.signal?.aborted) {
        throw new Error('Chat request was aborted');
      }
      throw new ProviderError(`Network error while contacting ${url}: ${err.message}`, 'ERR_NETWORK_ERROR');
    }

    if (!response.ok) {
      await this.handleHttpError(response, 'streamChat');
    }

    if (!response.body) {
      throw new ProviderError('Provider response has empty body', 'ERR_EMPTY_BODY');
    }

    // Node.js Response.body is a ReadableStream<Uint8Array> which is an AsyncIterable in modern Node
    yield* parseSseStream(response.body as any, { moderadoCloud: this.isModeradoCloud });
  }

  private validateGatewayRequest(
    options: ProviderChatOptions,
    wireMessages: Record<string, unknown>[],
    payload: Record<string, unknown>
  ): void {
    if (!Number.isInteger(options.maxTokens) || options.maxTokens! < 1 || options.maxTokens! > 2048) {
      throw new ProviderError('Moderado Cloud requires max_tokens between 1 and 2048', 'ERR_GATEWAY_INVALID_REQUEST', 400);
    }
    if (wireMessages.length < 1 || wireMessages.length > 32 || wireMessages.some((message) =>
      typeof message.content !== 'string' || (message.role === 'tool' && typeof message.tool_call_id !== 'string')
    )) {
      throw new ProviderError('Moderado Cloud accepts 1 to 32 text-only messages', 'ERR_GATEWAY_INVALID_REQUEST', 400);
    }
    const tools = payload.tools;
    if (Array.isArray(tools) && tools.length > 16) {
      throw new ProviderError('Moderado Cloud accepts at most 16 tools', 'ERR_GATEWAY_INVALID_REQUEST', 400);
    }
    if (Buffer.byteLength(JSON.stringify({ messages: wireMessages, tools }), 'utf8') > 4096) {
      throw new ProviderError('Moderado Cloud messages and tools exceed the 4096-byte limit', 'ERR_GATEWAY_INVALID_REQUEST', 400);
    }
  }

  private async handleHttpError(response: Response, action: string): Promise<never> {
    if (this.isModeradoCloud) {
      let code: string | undefined;
      try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
          && 'code' in body.error && typeof body.error.code === 'string') {
          code = body.error.code;
        }
      } catch {
        // Return a status-based, sanitized error when the Gateway body is invalid.
      }
      code ??= response.status === 401 ? 'unauthorized'
        : response.status === 403 ? 'scope_denied'
          : response.status === 400 ? 'invalid_request'
            : response.status === 404 ? 'model_unavailable'
              : response.status === 429 ? 'quota_exceeded'
                : response.status === 503 ? 'service_unavailable' : 'provider_error';
      if (!GATEWAY_ERROR_CODES.includes(code)) code = 'provider_error';
      const retrySeconds = parseRetryAfter(response.headers.get('Retry-After'));
      throw new GatewayError(code, response.status, retrySeconds);
    }
    let errorText = '';
    try {
      errorText = await response.text();
    } catch {
      // ignore
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError(
        `${this.name} authentication failed (${response.status}) during ${action}: ${errorText || 'Check the provider API key'}`
      );
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      let retryAfterSeconds: number | undefined;
      if (retryAfterHeader) {
        const parsed = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsed)) {
          retryAfterSeconds = parsed;
        }
      }
      let detail = errorText;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed?.error?.message) {
          detail = parsed.error.message;
        }
      } catch {
        // raw errorText
      }
      throw new RateLimitError(
        `${this.name} rate limit exceeded (429) during ${action}: ${detail}`,
        retryAfterSeconds
      );
    }

    if (
      response.status === 404 ||
      response.status === 410 ||
      response.status === 503 ||
      response.status === 500 ||
      response.status === 502 ||
      response.status === 504
    ) {
      throw new ModelUnavailableError(
        `${this.name} service or model unavailable (${response.status}) during ${action}: ${errorText}`,
        response.status
      );
    }

    throw new ProviderError(
      `${this.name} request failed with status ${response.status} during ${action}: ${errorText}`,
      'ERR_HTTP_ERROR',
      response.status
    );
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}
