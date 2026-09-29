export function parseBudgetCommand(input: string, currentLimit?: number): { limit?: number; message: string } {
  const value = input.slice('/budget'.length).trim();
  if (!value) return { limit: currentLimit, message: currentLimit
    ? `Token budget: ${currentLimit.toLocaleString()} per task (best-effort stop).`
    : 'Token budget is off. Use /budget <tokens> to set a per-task limit.' };
  if (value === 'off') return { limit: undefined, message: 'Token budget disabled.' };
  const amount = value.replace(/^tokens\s+/, '');
  const limit = /^\d+$/.test(amount) ? Number(amount) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    return { limit: currentLimit, message: 'Usage: /budget <tokens> | /budget off. Cost limits require reliable provider pricing and are not available.' };
  }
  return { limit, message: `Token budget: ${limit.toLocaleString()} per task (best-effort stop).` };
}

export function evaluateTokenBudget(totalTokens: number, limit?: number): 'ok' | 'warning' | 'stop' {
  if (!limit) return 'ok';
  if (totalTokens >= limit) return 'stop';
  if (totalTokens >= limit * 0.8) return 'warning';
  return 'ok';
}
