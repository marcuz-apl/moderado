import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as chatCommands from '../src/commands/chat.js';
import { createAgentTask, createMcpToolRegistry, decideApproval, handleChatSession, isBareExitCommand, isGenerationCancelKey, isNetworkCommand, isNetworkConsentReply } from '../src/commands/chat.js';
import { CliParsedArgs } from '../src/args.js';
import { loadConfig, saveConfig, saveMcpServer } from '../src/config.js';
import { ApprovalRequest } from '@moderado/contracts';

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

  it('probes an added MCP server before saving it and reloading the registry', async () => {
    const prompts = ['docs', process.execPath, 'server.mjs --stdio'];
    const discovered: unknown[] = [];
    let reloads = 0;
    const handleMcpCommand = (chatCommands as unknown as { handleMcpCommand?: Function }).handleMcpCommand;

    await handleMcpCommand?.('/mcp add', () => {}, {
      configHome: tempDir,
      reloadMcpTools: async () => { reloads++; },
      promptText: async () => prompts.shift(),
      discoverMcpServers: async (servers: unknown) => {
        discovered.push(servers);
        return [{ name: 'docs', enabled: true, tools: [{ name: 'search' }] }];
      },
    });

    expect(discovered).toEqual([{ docs: { executable: process.execPath, args: ['server.mjs', '--stdio'], enabled: true } }]);
    expect(loadConfig(tempDir).mcpServers?.docs).toEqual({ executable: process.execPath, args: ['server.mjs', '--stdio'], enabled: true });
    expect(reloads).toBe(1);
  });

  it('leaves persisted MCP configuration unchanged when an add probe fails', async () => {
    saveMcpServer('existing', { executable: 'node', args: ['existing.mjs'], enabled: true }, tempDir);
    const prompts = ['broken', 'missing-server', ''];
    let reloads = 0;
    const handleMcpCommand = (chatCommands as unknown as { handleMcpCommand?: Function }).handleMcpCommand;

    await handleMcpCommand?.('/mcp add', () => {}, {
      configHome: tempDir,
      reloadMcpTools: async () => { reloads++; },
      promptText: async () => prompts.shift(),
      discoverMcpServers: async () => [{ name: 'broken', enabled: true, tools: [], error: 'spawn failed' }],
    });

    expect(loadConfig(tempDir).mcpServers).toEqual({ existing: { executable: 'node', args: ['existing.mjs'], enabled: true } });
    expect(reloads).toBe(0);
  });

  it('persists enable and disable changes and reloads the MCP registry', async () => {
    saveMcpServer('docs', { executable: 'node', args: ['server.mjs'], enabled: true }, tempDir);
    let reloads = 0;
    const handleMcpCommand = (chatCommands as unknown as { handleMcpCommand?: Function }).handleMcpCommand;
    const options = { configHome: tempDir, reloadMcpTools: async () => { reloads++; } };

    await handleMcpCommand?.('/mcp disable docs', () => {}, options);
    expect(loadConfig(tempDir).mcpServers?.docs.enabled).toBe(false);
    await handleMcpCommand?.('/mcp enable docs', () => {}, options);
    expect(loadConfig(tempDir).mcpServers?.docs.enabled).toBe(true);
    await handleMcpCommand?.('/mcp reload', () => {}, options);
    expect(reloads).toBe(3);
  });

  it('requires confirmation before removing an MCP server and reloads after deletion', async () => {
    saveMcpServer('docs', { executable: 'node', args: ['server.mjs'], enabled: true }, tempDir);
    let reloads = 0;
    const handleMcpCommand = (chatCommands as unknown as { handleMcpCommand?: Function }).handleMcpCommand;

    await handleMcpCommand?.('/mcp remove docs', () => {}, {
      configHome: tempDir,
      reloadMcpTools: async () => { reloads++; },
      selectConfirmPopup: async () => true,
    });

    expect(loadConfig(tempDir).mcpServers?.docs).toBeUndefined();
    expect(reloads).toBe(1);
  });

  it('preserves an MCP server and skips reload when removal is cancelled', async () => {
    saveMcpServer('docs', { executable: 'node', args: ['server.mjs'], enabled: true }, tempDir);
    let reloads = 0;
    const handleMcpCommand = (chatCommands as unknown as { handleMcpCommand?: Function }).handleMcpCommand;

    await handleMcpCommand?.('/mcp remove docs', () => {}, {
      configHome: tempDir,
      reloadMcpTools: async () => { reloads++; },
      selectConfirmPopup: async () => false,
    });

    expect(loadConfig(tempDir).mcpServers?.docs).toBeDefined();
    expect(reloads).toBe(0);
  });

  it('shows MCP status with enabled state, executable, tool count, and errors', async () => {
    saveMcpServer('docs', { executable: 'node', args: ['docs.mjs'], enabled: true }, tempDir);
    saveMcpServer('broken', { executable: 'missing', args: [], enabled: true }, tempDir);
    saveMcpServer('offline', { executable: 'offline', args: [], enabled: false }, tempDir);
    let items: Array<{ label: string; tag?: string; description?: string }> = [];
    const handleMcpCommand = (chatCommands as unknown as { handleMcpCommand?: Function }).handleMcpCommand;

    await handleMcpCommand?.('/mcp status', () => {}, {
      configHome: tempDir,
      reloadMcpTools: async () => {},
      discoverMcpServers: async () => [
        { name: 'docs', enabled: true, tools: [{ name: 'search' }, { name: 'open' }] },
        { name: 'broken', enabled: true, tools: [], error: 'spawn failed' },
        { name: 'offline', enabled: false, tools: [] },
      ],
      selectListPopup: async (_title: string, statusItems: typeof items) => { items = statusItems; return null; },
    });

    expect(items).toEqual([
      { label: 'docs', value: 'docs', tag: 'Enabled', description: 'node · 2 tools' },
      { label: 'broken', value: 'broken', tag: 'Enabled', description: 'missing · Error: spawn failed' },
      { label: 'offline', value: 'offline', tag: 'Disabled', description: 'offline · 0 tools' },
    ]);
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

  it('does not auto-approve an MCP tool when general auto-approve is enabled', async () => {
    const decision = await decideApproval(
      { requestId: 'mcp-approval', toolName: 'mcp.docs.search', exactPayload: { query: 'safe' } } as ApprovalRequest,
      {
        autoApprove: true,
        networkAccessApproved: false,
        requestInteractiveApproval: async () => ({ requestId: 'mcp-approval', status: 'denied' }),
      }
    );

    expect(decision).toEqual({ requestId: 'mcp-approval', status: 'denied' });
  });

  it('denies unconsented network commands before considering auto-approval', async () => {
    const decision = await decideApproval(
      { requestId: 'network-approval', toolName: 'run_command', exactPayload: { command: ['curl', 'https://example.com'] } } as ApprovalRequest,
      {
        autoApprove: true,
        networkAccessApproved: false,
        requestInteractiveApproval: async () => ({ requestId: 'network-approval', status: 'approved' }),
      }
    );

    expect(decision).toEqual({
      requestId: 'network-approval',
      status: 'denied',
      reason: 'Network access requires an explicit Yes reply to the model first.',
    });
  });
});
