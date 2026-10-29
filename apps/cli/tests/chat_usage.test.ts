import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NvidiaAdapter } from '@moderado/providers';
import { parseCliArgs } from '../src/args.js';
import { handleChatSession } from '../src/commands/chat.js';
import * as config from '../src/config.js';
import * as welcome from '../src/ui/welcome.js';
import * as composer from '../src/ui/composer.js';
import { createSession, SessionStore } from '../src/sessions.js';

const homes: string[] = [];
let originalExitListeners: Function[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const listener of process.listeners('exit')) {
    if (!originalExitListeners.includes(listener)) process.removeListener('exit', listener);
  }
  // A refused cleanup must not fail assertions that already passed: some
  // sandboxes block deletes under the temp directory.
  for (const home of homes.splice(0)) {
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

it('shows zero cost for a search-assisted turn on keyless Gateway defaults', async () => {
  originalExitListeners = process.listeners('exit');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-chat-search-'));
  homes.push(home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.spyOn(config, 'loadConfig').mockReturnValue({ webSearchEndpoint: 'http://127.0.0.1/search', webSearchProvider: 'custom' });
  vi.spyOn(config, 'resolveApiKey').mockReturnValue(undefined);
  vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
    { id: 'vendor/free-default', object: 'model', owned_by: 'moderado', access: 'free' },
  ]);
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* () {
    yield { contentDelta: 'Sunny in Calgary.' };
    yield { usage: { promptTokens: 100, completionTokens: 12, totalTokens: 112 } };
  });
  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output += String(chunk); return true; });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    return new Response(JSON.stringify({
      results: [{ title: 'Weather', url: 'https://example.test/weather', snippet: 'Sunny.' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  const controller = new AbortController();
  let promptCount = 0;
  vi.spyOn(composer, 'promptInteractiveTurn').mockImplementation(async () => {
    promptCount++;
    if (promptCount === 2) controller.abort();
    return { text: promptCount === 1 ? 'What is the weather today?' : '', mode: 'Execute', autoApprove: false };
  });
  await handleChatSession(parseCliArgs(['--workspace', home]), '0.3.4', controller.signal);

  const stored = new SessionStore(home).loadLatestSession(fs.realpathSync(home));
  expect(stored?.usage).toMatchObject({ available: true, costKnown: true, costUsd: 0 });
  expect(welcome.stripAnsi(output)).toContain('$0.00');
});

it('shows zero cost for estimated Moderado usage across a generically paid model', async () => {
  originalExitListeners = process.listeners('exit');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-chat-cloud-free-'));
  homes.push(home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.spyOn(config, 'loadConfig').mockReturnValue({
    activeConnectionId: 'moderado',
    connections: {
      moderado: {
        id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
        baseUrl: 'https://modr.alfazen.org/v1', apiKey: 'test-key',
      },
    },
  });
  vi.spyOn(config, 'resolveApiKey').mockReturnValue(undefined);
  vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
    { id: 'openai/gpt-oss-20b', object: 'model', owned_by: 'openai', access: 'free' },
  ]);
  const sessionStore = new SessionStore(home);
  const previousSession = createSession(fs.realpathSync(home), {
    providerId: 'moderado', providerName: 'Moderado', modelId: 'openai/gpt-oss-20b',
  });
  previousSession.usage = {
    promptTokens: 40, completionTokens: 10, totalTokens: 50,
    estimated: true, available: true, costKnown: true, costUsd: 0,
  };
  sessionStore.save(previousSession);
  const controller = new AbortController();
  let promptCount = 0;
  vi.spyOn(composer, 'promptInteractiveTurn').mockImplementation(async () => {
    promptCount++;
    if (promptCount === 2) controller.abort();
    return { text: promptCount === 1 ? 'Explain a simple example.' : '', mode: 'Execute', autoApprove: false };
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* () {
    yield { contentDelta: 'Here is an example.' };
  });

  await handleChatSession(parseCliArgs(['--workspace', home, '--model', 'openai/gpt-oss-20b']), '0.3.4', controller.signal);

  const stored = sessionStore.loadLatestSession(fs.realpathSync(home));
  expect(stored?.usage).toMatchObject({ estimated: true, available: true, costKnown: true, costUsd: 0 });
  expect(stored?.usage.promptTokens).toBeGreaterThan(40);
});

it('prices an explicitly selected keyless Gateway default at zero', async () => {
  originalExitListeners = process.listeners('exit');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-chat-stealth-'));
  homes.push(home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline test')));
  vi.spyOn(config, 'loadConfig').mockReturnValue({
    activeConnectionId: 'moderado',
    connections: {
      moderado: {
        id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
        baseUrl: 'https://modr.alfazen.org/v1',
      },
    },
  });
  vi.spyOn(config, 'resolveApiKey').mockReturnValue(undefined);
  vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
    { id: 'stealth one', name: 'Stealth One', object: 'model', owned_by: 'moderado', access: 'paid', section: 'default' },
  ]);
  const controller = new AbortController();
  let promptCount = 0;
  vi.spyOn(composer, 'promptInteractiveTurn').mockImplementation(async () => {
    promptCount++;
    if (promptCount === 2) controller.abort();
    return { text: promptCount === 1 ? 'Hello there.' : '', mode: 'Execute', autoApprove: false };
  });
  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output += String(chunk); return true; });
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* () {
    yield { contentDelta: 'Hi.' };
    yield { usage: { promptTokens: 30, completionTokens: 5, totalTokens: 35 } };
  });

  await handleChatSession(parseCliArgs(['--workspace', home, '--model', 'stealth one']), '0.3.4', controller.signal);

  const stored = new SessionStore(home).loadLatestSession(fs.realpathSync(home));
  expect(stored?.modelId).toBe('stealth one');
  expect(stored?.usage).toMatchObject({ available: true, costKnown: true, costUsd: 0, totalTokens: 35 });
  expect(welcome.stripAnsi(output)).toContain('$0.00');
});

it('re-points a saved keyless production profile at the running development Gateway', async () => {
  originalExitListeners = process.listeners('exit');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-chat-reprobe-'));
  homes.push(home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  vi.spyOn(config, 'loadConfig').mockReturnValue({
    activeConnectionId: 'moderado',
    connections: {
      moderado: {
        id: 'moderado', displayName: 'Moderado', kind: 'openai-compatible',
        baseUrl: 'https://modr.alfazen.org/v1', defaultModel: 'stealth one',
      },
    },
  });
  vi.spyOn(config, 'resolveApiKey').mockReturnValue(undefined);
  vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
    { id: 'stealth one', object: 'model', owned_by: 'moderado', access: 'paid', section: 'default' },
  ]);
  let usedBaseUrl: string | undefined;
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* (this: NvidiaAdapter) {
    usedBaseUrl = (this as unknown as { baseUrl: string }).baseUrl;
    yield { contentDelta: 'Hi.' };
  });
  const controller = new AbortController();
  let promptCount = 0;
  vi.spyOn(composer, 'promptInteractiveTurn').mockImplementation(async () => {
    promptCount++;
    if (promptCount === 2) controller.abort();
    return { text: promptCount === 1 ? 'Hello there.' : '', mode: 'Execute', autoApprove: false };
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  await handleChatSession(parseCliArgs(['--workspace', home]), '0.4.51', controller.signal);

  expect(usedBaseUrl).toBe(config.MODERADO_DEVELOPMENT_BASE_URL);
});

it('updates usage while the provider is streaming and adds reported counts across chat turns', async () => {
  originalExitListeners = process.listeners('exit');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-chat-usage-'));
  homes.push(home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline test')));
  vi.spyOn(config, 'loadConfig').mockReturnValue({});
  vi.spyOn(config, 'resolveApiKey').mockReturnValue('test-key');
  vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
    { id: 'z-ai/glm-5', object: 'model', owned_by: 'z-ai' },
  ]);
  const controller = new AbortController();
  let promptCount = 0;
  const prompts: welcome.PromptInteractiveTurnOptions[] = [];
  vi.spyOn(composer, 'promptInteractiveTurn').mockImplementation(async (options) => {
    prompts.push(options);
    promptCount++;
    if (promptCount === 3) controller.abort();
    return { text: promptCount < 3 ? `Explain function ${promptCount}` : '', mode: 'Execute', autoApprove: false };
  });
  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  let request = 0;
  let duringStream = '';
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* () {
    request++;
    yield { contentDelta: 'The function ' };
    duringStream = welcome.stripAnsi(output);
    yield { contentDelta: 'returns a value.' };
    yield { usage: { promptTokens: request * 100, completionTokens: request * 10, totalTokens: request * 110 } };
  });
  await handleChatSession(parseCliArgs(['--workspace', home, '--model', 'z-ai/glm-5']), '0.3.4', controller.signal);
  expect(duringStream).toMatch(/Output ~?\d+/);
  expect(prompts[1]?.tokens).toBe(110);
  expect(prompts[2]?.tokens).toBe(330);
  expect(prompts[2]?.tokenUsage).toMatchObject({ usage: { totalTokens: 220 }, estimated: false });
  const stored = new SessionStore(home).loadLatestSession(fs.realpathSync(home));
  expect(stored?.usage).toMatchObject({ promptTokens: 300, completionTokens: 30, totalTokens: 330, available: true, costKnown: true, costUsd: 0 });
  expect(welcome.stripAnsi(output)).toContain('Total 220');
});
