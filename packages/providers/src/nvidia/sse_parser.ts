import { ChatCompletionChunk, ProviderError, RateLimitError, ToolCallChunk } from '@moderado/contracts';

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
          // Ignore non-JSON data lines
          continue;
        }

        if (parsed && typeof parsed === 'object' && parsed.error) {
          const err = parsed.error;
          const errCode = err.code ?? err.status;
          const errMsg = err.message || (typeof err === 'string' ? err : JSON.stringify(err));
          if (errCode === 429 || /rate\s*limit/i.test(errMsg)) {
            throw new RateLimitError(`Provider rate limit exceeded: ${errMsg}`);
          }
          throw new ProviderError(
            `Provider stream error (${errCode ?? 'unknown'}): ${errMsg}`,
            'ERR_STREAM_ERROR',
            typeof errCode === 'number' ? errCode : undefined
          );
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
