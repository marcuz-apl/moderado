/**
 * Local meta queries: questions about the session itself (model, provider,
 * identity, tokens, version, workspace) answered from CLI state without a model
 * round trip, plus the network-command predicate the approval policy needs.
 *
 * Split out of `chat.ts`, which had grown to carry command routing, turn
 * execution, usage accounting and rendering at once.
 */
import type { ApprovalRequest } from '@moderado/contracts';

export function isNetworkCommand(request: Pick<ApprovalRequest, 'toolName' | 'exactPayload'>): boolean {
  const command = (request.exactPayload as { command?: unknown }).command;
  const text = Array.isArray(command) ? command.join(' ').toLowerCase() : '';
  return request.toolName === 'run_command' && /\b(curl|wget|invoke-webrequest|iwr|irm)\b|https?:\/\//.test(text);
}

export function isLocalModelQuery(input: string): boolean {
  const text = input.trim().toLowerCase().replace(/[?!.]+$/, '').trim();
  if (!text) return false;
  if (/^(what|which)\s+(model|llm)(\s+(is\s+(this|active|running|currently\s+active|currently\s+running)|are\s+you\s+(running|using|on)(\s+against)?))?$/.test(text)) {
    return true;
  }
  if (/^(what|which)\s+is\s+(the\s+)?(current|active)\s+(model|llm)$/.test(text)) {
    return true;
  }
  if (/^(current|active)\s+(model|llm)$/.test(text)) {
    return true;
  }
  return false;
}

export function isLocalProviderQuery(input: string): boolean {
  const text = input.trim().toLowerCase().replace(/[?!.]+$/, '').trim();
  if (!text) return false;
  if (/^(what|which)\s+(provider|service)(\s+(is\s+(this|active|running|currently\s+active|currently\s+running)|are\s+you\s+(connected\s+to|using|on)))?$/.test(text)) {
    return true;
  }
  if (/^(what|which)\s+is\s+(the\s+)?(current|active)\s+(provider|service)$/.test(text)) {
    return true;
  }
  if (/^(current|active)\s+(provider|service)$/.test(text)) {
    return true;
  }
  return false;
}

export function isLocalIdentityQuery(input: string): boolean {
  const text = input.trim().toLowerCase().replace(/[?!.]+$/, '').trim();
  if (!text) return false;
  return /^(who|what)\s+are\s+you$/i.test(text) ||
    /^(tell\s+me\s+about\s+yourself|introduce\s+yourself)$/i.test(text) ||
    /^(who\s+made\s+you|who\s+built\s+you)$/i.test(text);
}

export function isLocalTokenQuery(input: string): boolean {
  const text = input.trim().toLowerCase().replace(/[?!.]+$/, '').trim();
  if (!text) return false;
  return /^(how\s+many\s+tokens|token\s+count|tokens\s+used|session\s+tokens|what\s+is\s+(the\s+)?(token\s+count|cost|session\s+cost)|how\s+much\s+did\s+this\s+cost|how\s+much\s+cost|cost|session\s+cost|usage)$/i.test(text);
}

export function isLocalVersionQuery(input: string): boolean {
  const text = input.trim().toLowerCase().replace(/[?!.]+$/, '').trim();
  if (!text) return false;
  return /^(what|which)\s+version(\s+is\s+this)?$/i.test(text) ||
    /^(version|moderado\s+version)$/i.test(text);
}

export function isLocalWorkspaceQuery(input: string): boolean {
  const text = input.trim().toLowerCase().replace(/[?!.]+$/, '').trim();
  if (!text) return false;
  return /^(where\s+are\s+we|what\s+workspace|what\s+is\s+the\s+workspace|current\s+workspace|working\s+directory|current\s+directory|pwd)$/i.test(text);
}

export interface LocalMetaQueryContext {
  currentModel?: string;
  providerName?: string;
  activeMode: 'Plan' | 'Execute';
  workspace: string;
  version?: string;
  sessionTokens?: number;
  sessionCost?: string;
}

export function resolveLocalMetaQuery(input: string, context: LocalMetaQueryContext): string | undefined {
  if (isLocalIdentityQuery(input)) {
    const model = context.currentModel ?? 'no model';
    const provider = context.providerName ?? 'unconnected';
    return `**Moderado** — minimalist, bloat-free AI coding agent (${model} via ${provider}).`;
  }
  if (isLocalModelQuery(input)) {
    const model = context.currentModel ?? 'none';
    const provider = context.providerName ?? 'unconnected';
    return `**Model:** \`${model}\` (${provider}, [${context.activeMode}]).`;
  }
  if (isLocalProviderQuery(input)) {
    const provider = context.providerName ?? 'none';
    const model = context.currentModel ?? 'none';
    return `**Provider:** ${provider} (model: \`${model}\`).`;
  }
  if (isLocalTokenQuery(input)) {
    const tokens = context.sessionTokens ?? 0;
    const cost = context.sessionCost ?? '$0.00';
    return `**Session:** ${tokens.toLocaleString()} tokens (${cost})`;
  }
  if (isLocalVersionQuery(input)) {
    const ver = context.version ?? 'unknown';
    return `\`${ver}\``;
  }
  if (isLocalWorkspaceQuery(input)) {
    return `\`${context.workspace}\``;
  }
  return undefined;
}
