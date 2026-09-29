import { expect, it } from 'vitest';
import { AuthenticationError, ModelUnavailableError, type AgentEvent } from '@moderado/contracts';
import { FakeProviderAdapter } from '@moderado/providers';
import { createDefaultToolRegistry } from '@moderado/tools';
import { AgentLoop, type AgentRunOptions } from '../src/agent.js';

function options(provider: FakeProviderAdapter, events: AgentEvent[], extra: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return { workspaceRoot: process.cwd(), provider, tools: createDefaultToolRegistry(),
    approvalHandler: { async requestApproval(request) { return { requestId: request.requestId, status: 'denied' }; } },
    routeOptions: { pinnedModelId: 'mock/free-tool-model' }, eventListener: event => events.push(event),
    retryDelaysMs: [0, 0], ...extra };
}

it('retries a transient failure on a pinned model before giving up', async () => {
  const provider = new FakeProviderAdapter();
  provider.queueError(new ModelUnavailableError());
  provider.queueTextResponse('Recovered.');
  const events: AgentEvent[] = [];
  const result = await new AgentLoop().run('Answer', options(provider, events));
  expect(result.status).toBe('completed');
  expect(provider.recordedCalls).toHaveLength(2);
  expect(events.filter(event => event.type === 'usage' && event.final)).toHaveLength(2);
});

it('bounds retries and does not retry authentication failures', async () => {
  const provider = new FakeProviderAdapter();
  for (let i = 0; i < 4; i++) provider.queueError(new ModelUnavailableError());
  const result = await new AgentLoop().run('Answer', options(provider, []));
  expect(result.status).toBe('failed');
  expect(provider.recordedCalls).toHaveLength(3);
  const auth = new FakeProviderAdapter();
  auth.queueError(new AuthenticationError());
  await new AgentLoop().run('Answer', options(auth, []));
  expect(auth.recordedCalls).toHaveLength(1);
});

it('does not restart a streamed answer after visible partial output', async () => {
  const provider = new FakeProviderAdapter();
  let requests = 0;
  provider.streamChat = async function* () {
    requests++;
    yield { contentDelta: 'Partial answer.' };
    throw new ModelUnavailableError();
  };
  const events: AgentEvent[] = [];
  const result = await new AgentLoop().run('Answer', options(provider, events));
  expect(requests).toBe(1);
  expect(result.finalMessage).toBe('Partial answer.');
  expect(events.filter(event => event.type === 'assistant_delta')).toHaveLength(1);
});

it('returns cancelled when an aborted stream throws', async () => {
  const provider = new FakeProviderAdapter();
  const controller = new AbortController();
  provider.streamChat = async function* () { controller.abort(); throw new Error('fetch aborted'); };
  const events: AgentEvent[] = [];
  const result = await new AgentLoop().run('Answer', options(provider, events, { signal: controller.signal }));
  expect(result.status).toBe('cancelled');
  expect(events.filter(event => event.type === 'error')).toHaveLength(0);
});

it('returns cancelled when Escape aborts model discovery', async () => {
  const provider = new FakeProviderAdapter();
  const controller = new AbortController();
  provider.discoverModels = async () => { controller.abort(); throw new Error('discovery aborted'); };
  const events: AgentEvent[] = [];
  const result = await new AgentLoop().run('Answer', options(provider, events, {
    signal: controller.signal, routeOptions: {},
  }));
  expect(result.status).toBe('cancelled');
  expect(events.some(event => event.type === 'cancellation')).toBe(true);
  expect(provider.recordedCalls).toHaveLength(0);
});

it('aborts a long retry backoff promptly without sending a second request', async () => {
  const provider = new FakeProviderAdapter();
  provider.queueError(new ModelUnavailableError());
  const controller = new AbortController();
  const events: AgentEvent[] = [];
  const opts = options(provider, events, { signal: controller.signal, retryDelaysMs: [10000] });
  opts.eventListener = event => {
    events.push(event);
    if (event.type === 'progress' && event.status.includes('Retrying')) queueMicrotask(() => controller.abort());
  };
  const result = await new AgentLoop().run('Answer', opts);
  expect(result.status).toBe('cancelled');
  expect(provider.recordedCalls).toHaveLength(1);
});
