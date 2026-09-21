import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as chatCommands from '../src/commands/chat.js';
import { buildSearchAnswerTask, createAgentTask, createMcpToolRegistry, decideApproval, formatDirectWebSearchAnswer, handleChatSession, isBareExitCommand, isGenerationCancelKey, isNetworkCommand, isNetworkConsentReply, replaceEvidenceTurn, resolveSessionSharePath, resolveWebSearchEndpoint, resolveWebSearchProvider, shouldFastRouteWebSearch } from '../src/commands/chat.js';
import { CliParsedArgs } from '../src/args.js';
import { loadConfig, saveConfig, saveMcpServer } from '../src/config.js';
import { ApprovalRequest, ChatMessage } from '@moderado/contracts';

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

  it('requires a workspace-contained output path for session sharing', () => {
    expect(resolveSessionSharePath(tempDir, 'exports/session.md')).toBe(path.join(tempDir, 'exports', 'session.md'));
    expect(() => resolveSessionSharePath(tempDir, '')).toThrow('requires an output path');
    expect(() => resolveSessionSharePath(tempDir, '../session.md')).toThrow(/escapes workspace jail/);
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

  it('fast-routes current-information questions but leaves ordinary questions to the model', () => {
    expect(shouldFastRouteWebSearch("What's the weather today?")).toBe(true);
    expect(shouldFastRouteWebSearch('What is the temperature in Berlin right now?')).toBe(true); expect(shouldFastRouteWebSearch('Any news about the release?')).toBe(true);
    expect(shouldFastRouteWebSearch('Explain how this function works.')).toBe(false); expect(shouldFastRouteWebSearch('Where can I find the docs?')).toBe(false); expect(shouldFastRouteWebSearch('Refactor the current router.')).toBe(false);
  });

  it('prefers an explicit web-search endpoint environment setting', () => {
    const original = process.env.MODERADO_WEB_SEARCH_ENDPOINT;
    process.env.MODERADO_WEB_SEARCH_ENDPOINT = 'https://environment.example.test/search';
    expect(resolveWebSearchEndpoint({ webSearchEndpoint: 'https://config.example.test/search' })).toBe('https://environment.example.test/search');
    if (original === undefined) delete process.env.MODERADO_WEB_SEARCH_ENDPOINT;
    else process.env.MODERADO_WEB_SEARCH_ENDPOINT = original;
  });

  it('formats raw provider results into a readable fallback without block metadata', () => {
    const digest = formatDirectWebSearchAnswer({ toolName: 'web_search', status: 'success', output: 'Title: Weather\nURL: https://example.test/weather\nPublished: N/A\nHighlights:\n# Weather for Calgary\nClear sky. High 24.3°C (76°F).\n---\nhttps://example.test/other' });
    expect(digest).toContain('Clear sky. High 24.3°C (76°F).');
    expect(digest).not.toContain('https://example.test/weather');
    expect(digest).not.toContain('Title:');
    expect(digest).not.toContain('#');
    expect(digest).toContain('raw search excerpt');
    expect(formatDirectWebSearchAnswer({ toolName: 'web_search', status: 'success', output: 'URL: https://example.test/only' })).toBe('Web search returned no readable content.');
    expect(formatDirectWebSearchAnswer({ toolName: 'web_search', status: 'error', output: 'Search endpoint returned HTTP 500.' })).toContain('Web search failed');
  });
  it('prefers the configured search provider and ignores unknown values', () => {
    const original = process.env.MODERADO_WEB_SEARCH_PROVIDER;
    process.env.MODERADO_WEB_SEARCH_PROVIDER = 'parallel';
    expect(resolveWebSearchProvider({ webSearchProvider: 'exa' })).toBe('parallel');
    delete process.env.MODERADO_WEB_SEARCH_PROVIDER;
    expect(resolveWebSearchProvider({ webSearchProvider: 'exa' })).toBe('exa');
    expect(resolveWebSearchProvider({ webSearchProvider: 'nope' as never })).toBeUndefined();
    if (original !== undefined) process.env.MODERADO_WEB_SEARCH_PROVIDER = original;
  });

  it('turns live search evidence into a single answering turn', () => {
    const evidence = buildSearchAnswerTask('What is the weather today?', { toolName: 'web_search', status: 'success', output: 'Overcast, 57F.', metadata: { provider: 'exa', sources: [{ title: 'Weather', url: 'https://example.test/weather' }] } });
    expect(evidence).toContain('exa');
    expect(evidence).toContain('Overcast, 57F.');
    expect(evidence).toContain('untrusted reference data');
    expect(evidence).toContain('Answer with the facts only');
    expect(evidence).toContain('Never print URLs');
    expect(evidence).toContain('3 to 6 short bullets');
    expect(evidence).toContain('Answer only the question below');

    const failed = buildSearchAnswerTask('What is the weather today?', { toolName: 'web_search', status: 'error', output: 'Web search failed (exa: timed out after 20000ms).' });
    expect(failed).toContain('Call the web_search tool once');
    expect(failed).toContain('timed out after 20000ms');
  });



  it('keeps the asked question in the transcript instead of the injected search evidence', () => {
    const evidence = buildSearchAnswerTask('What is the weather in Calgary today?', { toolName: 'web_search', status: 'success', output: 'Overcast, 7C.' });
    const produced: ChatMessage[] = [
      { role: 'user', content: evidence },
      { role: 'assistant', content: 'Currently in Calgary: 7C.' },
    ];
    expect(replaceEvidenceTurn(produced, evidence, 'What is the weather in Calgary today?')).toEqual([
      { role: 'user', content: 'What is the weather in Calgary today?' },
      { role: 'assistant', content: 'Currently in Calgary: 7C.' },
    ]);
    expect(replaceEvidenceTurn([{ role: 'assistant', content: 'hello' }], evidence, 'who are you?')).toEqual([{ role: 'assistant', content: 'hello' }]);
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
  it('automatically approves workspace file writes and terminal commands without prompting', async () => {
    const tools = ['write_file', 'edit_file', 'apply_patch', 'run_command', 'run_diagnostics'];
    for (const toolName of tools) {
      let prompted = false;
      const decision = await decideApproval(
        { requestId: 'req-' + toolName, toolName, exactPayload: { command: ['npm', 'test'] } } as ApprovalRequest,
        {
          autoApprove: false,
          networkAccessApproved: false,
          requestInteractiveApproval: async () => { prompted = true; return { requestId: 'req-' + toolName, status: 'denied' }; },
        }
      );
      expect(decision.status).toBe('approved');
      expect(prompted).toBe(false);
    }
  });

  it('prompts interactive approval for external MCP tools when auto-approve is disabled', async () => {
    let prompted = false;
    const decision = await decideApproval(
      { requestId: 'mcp-req', toolName: 'mcp.database.query', exactPayload: {} } as ApprovalRequest,
      {
        autoApprove: false,
        networkAccessApproved: false,
        requestInteractiveApproval: async () => { prompted = true; return { requestId: 'mcp-req', status: 'denied' }; },
      }
    );
    expect(prompted).toBe(true);
    expect(decision.status).toBe('denied');
  });
});