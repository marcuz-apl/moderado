/**
 * Turn outcomes: how a finished, failed, or cancelled turn becomes the text the
 * user reads, plus the small input predicates the composer relies on.
 *
 * Split out of `chat.ts`, which had grown to carry command routing, turn
 * execution, usage accounting and rendering at once.
 */
import { cleanConversationalFiller } from '@moderado/core';
import { resolveInJail } from '@moderado/tools';
import type { ChatMessage } from '@moderado/contracts';
import { isAuthenticationFailure } from '../ui/provider_connect.js';

export function formatTurnFailureAnswer(
  status: string,
  errorEvent: { code?: string; message: string } | undefined,
  modelId: string,
  otherConnections: string[] = []
): string {
  const altSuggestion = otherConnections.length > 0
    ? ` (other configured providers: ${otherConnections.join(', ')})`
    : '';
  const rawDetail = errorEvent?.message || (status === 'failed' ? 'Inference request failed without response.' : '');
  const cleanDetail = rawDetail
    .replace(/^(?:NVIDIA NIM|OpenAI|OpenRouter|[a-zA-Z0-9_-]+)\s*(?:request failed|rate limit exceeded|service or model unavailable)?\s*(?:\([^)]*\))?\s*(?:during\s*streamChat)?:\s*/i, '')
    .trim();
  if (errorEvent?.code === 'ERR_GATEWAY_UNAUTHORIZED') {
    return `⚠️ **Gateway Authorization (${errorEvent.code}):**\n${cleanDetail}`;
  }
  if (errorEvent?.code?.toUpperCase().includes('RATE_LIMIT')) {
    return `⚠️ **Model Error (${errorEvent.code}):**\n${cleanDetail || 'Provider rate limit reached.'}\n\n👉 **Suggestion:** The provider temporarily limited requests for \`${modelId}\`. Please retry shortly or choose another model with \`/model\`.`;
  }
  return `⚠️ **Model Error (${errorEvent?.code || 'ERR_INFERENCE_FAILED'}):**\n${cleanDetail || 'Model returned no response.'}\n\n👉 **Suggestion:** The model \`${modelId}\` encountered an error. Switch models with \`/model\` or choose a provider with \`/connect\`${altSuggestion}.`;
}

/** A turn whose provider rejected its credential may recover by re-entering a key once. */
export function turnFailedAuthentication(
  status: string,
  errorEvent: { code?: string; message: string } | undefined,
): boolean {
  return status === 'failed' && isAuthenticationFailure(errorEvent);
}

export function resolveTurnAssistantAnswer(
  result: { status: string; messages: ChatMessage[]; selectedModel?: { id: string } },
  previousHistoryLength: number,
  lastErrorEvent?: { code?: string; message: string },
  streamedAnswer = '',
  currentModel = 'unknown',
  otherConnections: string[] = []
): { answer: string; isError: boolean } {
  if (result.status === 'cancelled') {
    const partial = cleanConversationalFiller(streamedAnswer);
    return { answer: [partial, 'Task stopped.'].filter(Boolean).join('\n\n'), isError: true };
  }
  if (result.status === 'failed' || lastErrorEvent) {
    return {
      answer: formatTurnFailureAnswer(result.status, lastErrorEvent, result.selectedModel?.id || currentModel, otherConnections),
      isError: true,
    };
  }
  const turnMessages = result.messages.slice(previousHistoryLength);
  const turnAssistant = [...turnMessages].reverse().find((m) => m.role === 'assistant' && m.content?.trim())?.content;
  return {
    answer: cleanConversationalFiller(turnAssistant || streamedAnswer),
    isError: false,
  };
}

export function saveFailedTurnPrompt(
  history: ChatMessage[],
  prompt: string,
  partialResponse = '',
): ChatMessage[] {
  if (!prompt.trim()) return history;
  const interruptionNote = '[This response was interrupted before completion. Continue the task if asked.]';
  const interruptedResponse = partialResponse.trim()
    ? `${partialResponse.trim()}\n\n${interruptionNote}`
    : '[This task was interrupted before a response was produced. Continue the task if asked.]';
  return [...history, { role: 'user', content: prompt }, { role: 'assistant', content: interruptedResponse }];
}

export function isBareExitCommand(input: string): boolean {
  return input.trim().toLowerCase() === 'exit';
}

/** Resolve the required, explicit local destination for `/session share`. */
export function resolveSessionSharePath(workspaceRoot: string, outputPath: string): string {
  if (!outputPath.trim()) throw new Error('/session share requires an output path within the workspace.');
  return resolveInJail(workspaceRoot, outputPath.trim());
}

export function isGenerationCancelKey(key: { name?: string } | undefined, str?: string): boolean {
  return key?.name === 'escape' || str === '\x1b';
}
