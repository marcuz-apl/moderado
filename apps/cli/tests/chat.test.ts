import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAgentTask, createMcpToolRegistry, handleChatSession, isBareExitCommand, isGenerationCancelKey, isNetworkCommand, isNetworkConsentReply } from '../src/commands/chat.js';
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


  it('creates a read-only checklist instruction in Plan mode', () => {
    expect(createAgentTask('Add a command', 'Plan')).toContain('do not modify files or run commands');
    expect(createAgentTask('Add a command', 'Execute')).toBe('Add a command');
  });

  it('rebuilds the registry with built-in tools when no MCP server is enabled', async () => {
    const registry = await createMcpToolRegistry({
      disabled: { executable: 'unused-disabled-server', args: [], enabled: false },
    });

    expect(registry.get('read_file')).toBeDefined();
    expect(registry.get('mcp.disabled.search')).toBeUndefined();
  });

  it('recognizes only a bare exit input for an exit reminder', () => {
    expect(isBareExitCommand('exit')).toBe(true);
    expect(isBareExitCommand(' EXIT ')).toBe(true);
    expect(isBareExitCommand('/exit')).toBe(false);
    expect(isBareExitCommand('How do I exit?')).toBe(false);
  });

  it('recognizes Escape as a request-only generation interrupt', () => {
    expect(isGenerationCancelKey({ name: 'escape' })).toBe(true);
    expect(isGenerationCancelKey({ name: 'c', ctrl: true })).toBe(false);
    expect(isGenerationCancelKey({ name: 'return' })).toBe(false);
  });

  it('requires an explicit reply to the model before enabling network commands', () => {
    expect(isNetworkCommand({ toolName: 'run_command', exactPayload: { command: ['curl', 'https://example.com'] } } as any)).toBe(true);
    expect(isNetworkCommand({ toolName: 'run_command', exactPayload: { command: ['git', 'status'] } } as any)).toBe(false);
    expect(isNetworkConsentReply('yes', 'Would you like me to look up the weather online?')).toBe(true);
    expect(isNetworkConsentReply('yes', 'Here is your answer.')).toBe(false);
  });
});
