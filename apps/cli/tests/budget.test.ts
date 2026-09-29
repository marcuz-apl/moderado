import { expect, it } from 'vitest';
import { evaluateTokenBudget, parseBudgetCommand } from '../src/budget.js';
import { AgentLoop } from '@moderado/core';
import { FakeProviderAdapter } from '@moderado/providers';
import { createDefaultToolRegistry } from '@moderado/tools';

it('sets, shows, and disables a per-task token budget', () => {
  expect(parseBudgetCommand('/budget 5000', undefined)).toEqual({ limit: 5000, message: 'Token budget: 5,000 per task (best-effort stop).' });
  expect(parseBudgetCommand('/budget tokens 1200', undefined).limit).toBe(1200);
  expect(parseBudgetCommand('/budget', 5000).message).toContain('5,000');
  expect(parseBudgetCommand('/budget off', 5000)).toEqual({ limit: undefined, message: 'Token budget disabled.' });
});

it('rejects invalid limits and unsupported cost budgets', () => {
  for (const input of ['/budget 0', '/budget -1', '/budget 1.5', '/budget nope', '/budget $0.10']) {
    expect(parseBudgetCommand(input, 5000).limit).toBe(5000);
    expect(parseBudgetCommand(input, 5000).message).toContain('Usage:');
  }
});

it('warns at 80 percent and stops at the token limit', () => {
  expect(evaluateTokenBudget(799, 1000)).toBe('ok');
  expect(evaluateTokenBudget(800, 1000)).toBe('warning');
  expect(evaluateTokenBudget(1000, 1000)).toBe('stop');
  expect(evaluateTokenBudget(1200, undefined)).toBe('ok');
});

it('can abort a streaming task when cumulative usage reaches its limit', async () => {
  const provider = new FakeProviderAdapter();
  provider.queueResponse([{ contentDelta: 'First chunk' }, { contentDelta: 'Second chunk' }]);
  const controller = new AbortController();
  const result = await new AgentLoop().run('Answer', {
    workspaceRoot: process.cwd(), provider, tools: createDefaultToolRegistry(),
    approvalHandler: { async requestApproval(request) { return { requestId: request.requestId, status: 'denied' }; } },
    routeOptions: { pinnedModelId: 'mock/free-tool-model' }, signal: controller.signal,
    eventListener: event => {
      if (event.type === 'usage' && evaluateTokenBudget(event.usage.totalTokens, 1) === 'stop') controller.abort();
    },
  });
  expect(result.status).toBe('cancelled');
  expect(provider.recordedCalls).toHaveLength(1);
});
