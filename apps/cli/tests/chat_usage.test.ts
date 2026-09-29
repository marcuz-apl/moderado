import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NvidiaAdapter } from '@moderado/providers';
import { parseCliArgs } from '../src/args.js';
import { handleChatSession } from '../src/commands/chat.js';
import * as config from '../src/config.js';
import * as welcome from '../src/ui/welcome.js';
import { SessionStore } from '../src/sessions.js';

const homes: string[] = [];
let originalExitListeners: Function[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const listener of process.listeners('exit')) {
    if (!originalExitListeners.includes(listener)) process.removeListener('exit', listener);
  }
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

it('updates usage while the provider is streaming and adds reported counts across chat turns', async () => {
  originalExitListeners = process.listeners('exit');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-chat-usage-'));
  homes.push(home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.spyOn(config, 'loadConfig').mockReturnValue({});
  vi.spyOn(config, 'resolveApiKey').mockReturnValue('test-key');
  vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
    { id: 'z-ai/glm-5', object: 'model', owned_by: 'z-ai', pricing: { prompt: '0', completion: '0' } },
  ]);
  const controller = new AbortController();
  let promptCount = 0;
  const prompts: welcome.PromptInteractiveTurnOptions[] = [];
  vi.spyOn(welcome, 'promptInteractiveTurn').mockImplementation(async (options) => {
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
  expect(stored?.usage).toMatchObject({ promptTokens: 300, completionTokens: 30, totalTokens: 330, available: true });
  expect(welcome.stripAnsi(output)).toContain('Total 220');
});
