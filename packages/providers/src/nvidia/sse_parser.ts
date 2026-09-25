import { ChatCompletionChunk, AuthenticationError, MalformedResponseError, ModelUnavailableError, ProviderError, RateLimitError, ToolCallChunk } from '@moderado/contracts';

const AUTH_PATTERN = /api[\s_-]?key|unauthor|forbidden|authentication|permission/i;
const CAPACITY_PATTERN = /overload|capacity|server[\s_-]?error|unavailable|busy|try again|temporar/i;

/**
 * Providers inject a JSON error object into an otherwise healthy SSE stream. Classify it into the
 * shared taxonomy so the agent loop can tell a recoverable hiccup from a terminal fault and decide
 * whether to retry, fail over, or stop.
 */
export function classifyInjectedStreamError(raw: unknown): ProviderError {
  const err = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const code = err.code ?? err.status ?? err.type;
  const message =
    typeof err.message === 'string' && err.message
      ? err.message
      : typeof raw === 'string'
        ? raw
        : JSON.stringify(raw);
  const status = typeof code === 'number' ? code : undefined;

  if (code === 429 || /rate\s*limit|too many requests/i.test(message)) {
    return new RateLimitError(`Provider rate limit exceeded: ${message}`, undefined, status);
  }
  if (status === 401 || status === 403 || AUTH_PATTERN.test(message)) {
    return new AuthenticationError(`Provider authentication failed: ${message}`, status ?? 401);
  }
  if ((status !== undefined && status >= 500) || CAPACITY_PATTERN.test(message)) {
    return new ModelUnavailableError(
      `Provider service or model unavailable (${code ?? 'unknown'}): ${message}`,
      status ?? 503
    );
  }
  return new ProviderError(
    `Provider stream error (${code ?? 'unknown'}): ${message}`,
    'ERR_STREAM_ERROR',
    status
  );
}

export async function* parseSseStream(
  byteStream: AsyncIterable<Uint8Array>
): AsyncIterable<ChatCompletionChunk> {
  const decoder = new TextDecoder('utf8');
  let buffer = '';

  for await (const chunk of byteStream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    // Keep incomplete last line in buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) {
        // Empty line or SSE comment (heartbeat)
        continue;
      }

      if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') {
          return;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          // A truncated or proxied payload is a real fault, not a heartbeat: fail loudly
          // so the agent can retry instead of silently yielding an empty response.
          throw new MalformedResponseError(
            `Provider sent an unparseable SSE data line: ${dataStr.slice(0, 200)}`
          );
        }

        if (parsed && typeof parsed === 'object' && parsed.error) {
          throw classifyInjectedStreamError(parsed.error);
        }

        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        const finishReason = choice?.finish_reason ?? null;

          const toolCallChunks: ToolCallChunk[] = [];
          if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              toolCallChunks.push({
                index: tc.index ?? 0,
                id: tc.id,
                name: tc.function?.name,
                argumentsDelta: tc.function?.arguments,
              });
            }
          }

          const completionChunk: ChatCompletionChunk = {};
          const reasoning = delta?.reasoning_content ?? delta?.thought;
          if (reasoning) {
            completionChunk.reasoningDelta = reasoning;
          }
          if (delta?.content && !reasoning) {
            completionChunk.contentDelta = delta.content;
          }
          if (toolCallChunks.length > 0) {
            completionChunk.toolCallChunks = toolCallChunks;
          }
          if (finishReason !== undefined) {
            completionChunk.finishReason = finishReason;
          }
          if (parsed.usage) {
            completionChunk.usage = {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens ?? 0,
            };
          }

          if (
            completionChunk.contentDelta !== undefined ||
            completionChunk.reasoningDelta !== undefined ||
            completionChunk.toolCallChunks !== undefined ||
            completionChunk.finishReason !== undefined ||
            completionChunk.usage !== undefined
          ) {
            yield completionChunk;
          }
      }
    }
  }
}
