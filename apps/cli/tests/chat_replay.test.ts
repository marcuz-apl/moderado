import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NvidiaAdapter } from '@moderado/providers';
import { parseCliArgs } from '../src/args.js';
import { handleChatSession, saveFailedTurnPrompt } from '../src/commands/chat.js';
import * as config from '../src/config.js';
import * as composer from '../src/ui/composer.js';
import { createSession, SessionStore } from '../src/sessions.js';
import { stripAnsi } from '../src/ui/welcome.js';

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

/** Wire a session against a fake provider and capture everything written to the terminal. */
function runSession(home: string, question: string | string[], turns: number): { output: () => string; rawOutput: () => string; controller: AbortController } {
  originalExitListeners = process.listeners('exit');
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.spyOn(config, 'loadConfig').mockReturnValue({});
  vi.spyOn(config, 'resolveApiKey').mockReturnValue('test-key');
  vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
    { id: 'z-ai/glm-5', object: 'model', owned_by: 'z-ai' },
  ]);
  const controller = new AbortController();
  let promptCount = 0;
  vi.spyOn(composer, 'promptInteractiveTurn').mockImplementation(async () => {
    promptCount++;
    // Ask the same question `turns` times, then stop the session.
    if (promptCount > turns) controller.abort();
    return { text: promptCount <= turns ? (Array.isArray(question) ? question[promptCount - 1] : question) : '', mode: 'Execute', autoApprove: false };
  });
  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  return { output: () => stripAnsi(output), rawOutput: () => output, controller };
}

it('shows the next question above its answer and separates completed exchanges', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-turn-boundary-'));
  homes.push(home);
  const { rawOutput, controller } = runSession(home, ['First question', 'Second question'], 2);
  let calls = 0;
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* () {
    yield { contentDelta: ++calls === 1 ? 'First answer' : 'Second answer' };
  });

  await handleChatSession(parseCliArgs(['--workspace', home, '--model', 'z-ai/glm-5']), '0.4.51', controller.signal);

  const finalFrame = stripAnsi(rawOutput().split('\x1b[H\x1b[J').at(-1) ?? '');
  const firstAnswer = finalFrame.indexOf('First answer');
  const currentQuestion = finalFrame.lastIndexOf('Second question');
  const currentAnswer = finalFrame.indexOf('Second answer');
  expect(firstAnswer).toBeGreaterThan(0);
  expect(currentQuestion).toBeGreaterThan(firstAnswer);
  expect(currentAnswer).toBeGreaterThan(currentQuestion);
});

it('re-asks the model after a failed turn instead of replaying the error', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-replay-failed-'));
  homes.push(home);
  const { output, controller } = runSession(home, 'Explain the token budget.', 2);
  let calls = 0;
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* () {
    calls++;
    if (calls === 1) throw new Error('provider exploded');
    yield { contentDelta: 'A real answer from the model.' };
  });

  await handleChatSession(parseCliArgs(['--workspace', home, '--model', 'z-ai/glm-5']), '0.3.4', controller.signal);

  // The decisive assertion: the second identical question reached the provider.
  expect(calls).toBe(2);
  expect(output()).toContain('A real answer from the model.');
});

it('re-asks the model after resuming an interrupted session instead of replaying the notice', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-replay-resume-'));
  homes.push(home);
  const workspace = fs.realpathSync(home);
  const sessionStore = new SessionStore(home);
  const interrupted = createSession(workspace, { modelId: 'z-ai/glm-5' });
  // Exactly what the CLI persists when a turn is stopped mid-flight.
  interrupted.messages = saveFailedTurnPrompt([], 'Explain the token budget.', '');
  sessionStore.save(interrupted);

  const { output, controller } = runSession(home, 'Explain the token budget.', 1);
  let calls = 0;
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* () {
    calls++;
    yield { contentDelta: 'Recovered answer from the model.' };
  });

  await handleChatSession(parseCliArgs(['--workspace', home, '--model', 'z-ai/glm-5']), '0.3.4', controller.signal);

  // The restored "answer" is the interruption notice, so it must not be replayed.
  expect(calls).toBe(1);
  expect(output()).toContain('Recovered answer from the model.');
});

it('still replays a genuine answer when the same question is repeated', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-replay-cached-'));
  homes.push(home);
  const { output, controller } = runSession(home, 'Explain the token budget.', 2);
  let calls = 0;
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* () {
    calls++;
    yield { contentDelta: 'The one genuine answer.' };
  });

  await handleChatSession(parseCliArgs(['--workspace', home, '--model', 'z-ai/glm-5']), '0.3.4', controller.signal);

  // The cache still exists: a successful turn is replayed, not re-requested.
  expect(calls).toBe(1);
  expect(output()).toContain('The one genuine answer.');
});
