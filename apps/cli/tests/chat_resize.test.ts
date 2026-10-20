import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NvidiaAdapter } from '@moderado/providers';
import { parseCliArgs } from '../src/args.js';
import { handleChatSession } from '../src/commands/chat.js';
import * as config from '../src/config.js';
import * as welcome from '../src/ui/welcome.js';

const homes: string[] = [];
let originalExitListeners: Function[] = [];
let originalColumns: PropertyDescriptor | undefined;
let originalIsTTY: PropertyDescriptor | undefined;
let originalSetRawMode: (() => unknown) | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const listener of process.listeners('exit')) {
    if (!originalExitListeners.includes(listener)) process.removeListener('exit', listener);
  }
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
  if (originalColumns) Object.defineProperty(process.stdout, 'columns', originalColumns);
  else delete (process.stdout as { columns?: number }).columns;
  if (originalIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  (process.stdin as { setRawMode?: unknown }).setRawMode = originalSetRawMode;
});

it('repaints the chat frame centered after the terminal is maximized mid-answer', async () => {
  originalExitListeners = process.listeners('exit');
  originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  originalSetRawMode = (process.stdin as { setRawMode?: () => unknown }).setRawMode;

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-chat-resize-'));
  homes.push(home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.spyOn(config, 'loadConfig').mockReturnValue({});
  vi.spyOn(config, 'resolveApiKey').mockReturnValue('test-key');
  vi.spyOn(NvidiaAdapter.prototype, 'discoverModels').mockResolvedValue([
    { id: 'z-ai/glm-5', object: 'model', owned_by: 'z-ai' },
  ]);

  // Simulate a TTY so the generation listeners (keypress + resize) attach.
  Object.defineProperty(process.stdout, 'columns', { configurable: true, writable: true, value: 80 });
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  const stdin = process.stdin as typeof process.stdin & { setRawMode?: (mode: boolean) => unknown };
  vi.spyOn(stdin, 'resume').mockImplementation(() => stdin);
  vi.spyOn(stdin, 'pause').mockImplementation(() => stdin);
  stdin.setRawMode = () => stdin;

  const controller = new AbortController();
  let promptCount = 0;
  vi.spyOn(welcome, 'promptInteractiveTurn').mockImplementation(async () => {
    promptCount++;
    if (promptCount === 2) controller.abort();
    return { text: promptCount === 1 ? 'Explain the module' : '', mode: 'Execute', autoApprove: false };
  });

  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output += String(chunk); return true; });

  let resizeRepaint = '';
  vi.spyOn(NvidiaAdapter.prototype, 'streamChat').mockImplementation(async function* () {
    yield { contentDelta: 'The module ' };
    // Simulate the user maximizing the terminal while the answer is streaming.
    const resizedAt = output.length;
    process.stdout.columns = 200;
    process.stdout.emit('resize');
    resizeRepaint = output.slice(resizedAt);
    yield { contentDelta: 'exports its API.' };
    yield { usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
  });

  await handleChatSession(parseCliArgs(['--workspace', home, '--model', 'z-ai/glm-5']), '0.4.31', controller.signal);

  // The resize event itself must repaint; a final turn repaint is too late.
  expect(resizeRepaint).toContain('\x1b[H\x1b[J');
  const lines = welcome.stripAnsi(resizeRepaint).split('\n');
  expect(lines.some((line) => line.startsWith(' '.repeat(40) + '❯ Explain the module'))).toBe(true);
});
