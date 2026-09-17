import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleChatSession } from '../src/commands/chat.js';
import { CliParsedArgs } from '../src/args.js';
import { saveConfig } from '../src/config.js';

describe('Chat Terminal REPL Session (OpenCode / Cline Experience)', () => {
  let tempDir: string;
  let origKey: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-chat-test-'));
    origKey = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'nvapi-test-dummy';
  });

  afterEach(() => {
    if (origKey !== undefined) {
      process.env.NVIDIA_API_KEY = origKey;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('handleChatSession is exported and handles pre-aborted signal gracefully', async () => {
    const controller = new AbortController();
    controller.abort();

    const args: CliParsedArgs = {
      command: undefined,
      workspace: tempDir,
      profile: 'hosted-nvidia',
      maxSteps: 5,
      timeout: 30,
      readOnly: false,
      nonInteractive: false,
      verbose: false,
      help: false,
      version: false,
      refresh: false,
      json: false,
    };

    saveConfig({ apiKey: 'nvapi-test', defaultModel: 'meta/llama-3.3-70b-instruct' }, tempDir);

    const exitCode = await handleChatSession(args, 'v0.1.2', controller.signal);
    expect(exitCode).toBe(0);
  });
});
