import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ChatMessageSchema, type ChatMessage, type ChatUsage } from '@moderado/contracts';

const UsageSchema = z.object({ promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(), costUsd: z.number().nonnegative().optional(), costKnown: z.boolean(), available: z.boolean().default(false) });
export const StoredSessionSchema = z.object({ schemaVersion: z.literal(1), id: z.string().uuid(), workspaceRoot: z.string().min(1), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), providerId: z.string().optional(), providerName: z.string().optional(), modelId: z.string().optional(), mode: z.enum(['Plan', 'Execute']), messages: z.array(ChatMessageSchema), usage: UsageSchema });
export type StoredSession = z.infer<typeof StoredSessionSchema>;

export function createSession(workspaceRoot: string, details: Partial<Pick<StoredSession, 'providerId' | 'providerName' | 'modelId' | 'mode'>> = {}): StoredSession {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: crypto.randomUUID(), workspaceRoot, createdAt: now, updatedAt: now, providerId: details.providerId, providerName: details.providerName, modelId: details.modelId, mode: details.mode ?? 'Execute', messages: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costKnown: false, available: false } };
}

export class SessionStore {
  constructor(private readonly home = os.homedir()) {}
  getDirectory(workspaceRoot: string): string { return path.join(this.home, '.moderado', 'sessions', crypto.createHash('sha256').update(workspaceRoot).digest('hex')); }
  getSessionPath(session: StoredSession): string { return path.join(this.getDirectory(session.workspaceRoot), session.id + '.json'); }
  save(session: StoredSession): void {
    const checked = StoredSessionSchema.parse({ ...session, updatedAt: new Date().toISOString() });
    const dir = this.getDirectory(checked.workspaceRoot);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = this.getSessionPath(checked);
    const temp = target + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(checked, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, target);
  }
  listSessions(workspaceRoot: string): StoredSession[] {
    const dir = this.getDirectory(workspaceRoot);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((entry) => entry.endsWith('.json')).flatMap((entry) => {
      try { return [StoredSessionSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')))]; } catch { return []; }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  loadLatestSession(workspaceRoot: string): StoredSession | undefined { return this.listSessions(workspaceRoot)[0]; }
}

export function calculateSessionCost(usage: ChatUsage | undefined, pricing?: Record<string, string>): { costKnown: boolean; costUsd?: number } {
  const prompt = Number(pricing?.prompt); const completion = Number(pricing?.completion);
  if (!usage || !Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return { costKnown: false };
  return { costKnown: true, costUsd: usage.promptTokens * prompt + usage.completionTokens * completion };
}

/** Output speed uses only generated tokens, never prompt/context processing time. */
export function calculateOutputTokenRate(completionTokens: number, streamDurationMs: number): number | undefined {
  if (!Number.isFinite(completionTokens) || completionTokens <= 0 || !Number.isFinite(streamDurationMs) || streamDurationMs <= 0) return undefined;
  return completionTokens / (streamDurationMs / 1_000);
}

export function formatSessionCost(usage: StoredSession['usage']): string {
  if (!usage.available || !usage.costKnown || usage.costUsd === undefined) return 'Cost unknown';
  if (usage.costUsd === 0) return '$0.00';
  return `$${usage.costUsd < 0.01 ? usage.costUsd.toFixed(6) : usage.costUsd.toFixed(4)}`;
}
function redact(text: string): string { return text.replace(/(?:nvapi-|sk-)[A-Za-z0-9_-]+/g, '[redacted]'); }
export function exportSessionMarkdown(session: StoredSession): string {
  const lines = ['# Moderado session', '', 'Updated: ' + session.updatedAt, ''];
  for (const message of session.messages) { if (message.role !== 'tool') lines.push('## ' + message.role, '', redact(message.content ?? ''), ''); }
  return lines.join('\n');
}
export function compactSessionMessages(messages: ChatMessage[]): ChatMessage[] {
  const conversational = messages.filter((message) => message.role === 'user' || message.role === 'assistant');
  if (conversational.length <= 4) return [...messages];
  const removed = conversational.slice(0, -4); const kept = conversational.slice(-4);
  const summary = removed.map((message) => message.role + ': ' + redact((message.content ?? '').slice(0, 240))).join('\n');
  return [{ role: 'system', content: 'Compacted ' + removed.length + ' earlier messages:\n' + summary }, ...kept];
}
