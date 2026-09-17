import { ChatCompletionChunk, ToolCallChunk } from '@moderado/contracts';

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

        try {
          const parsed = JSON.parse(dataStr);
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
          if (delta?.content) {
            completionChunk.contentDelta = delta.content;
          }
          const reasoning = delta?.reasoning_content ?? delta?.thought;
          if (reasoning) {
            completionChunk.reasoningDelta = reasoning;
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
        } catch {
          // Ignore non-JSON data lines
        }
      }
    }
  }
}
