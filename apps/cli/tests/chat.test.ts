import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as chatCommands from '../src/commands/chat.js';
import {
  buildSearchAnswerTask,
  createAgentTask,
  createMcpToolRegistry,
  decideApproval,
  formatDirectWebSearchAnswer,
  handleChatSession,
  handleGenerationKeypress,
  isBareExitCommand,
  isGenerationCancelKey,
  isLocalIdentityQuery,
  isLocalModelQuery,
  isLocalProviderQuery,
  isNetworkCommand,
  isNetworkConsentReply,
  replaceEvidenceTurn,
  resolveLocalMetaQuery,
  resolveSessionSharePath,
  resolveWebSearchEndpoint,
  resolveWebSearchProvider,
  shouldFastRouteWebSearch,
  TurnCommandQueue,
  findSlashCommandAdvice,
  formatTurnFailureAnswer,
  levenshteinDistance,
  resolveTurnAssistantAnswer,
} from '../src/commands/chat.js';
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
    expect(shouldFastRouteWebSearch('What is the temperature in Berlin right now?')).toBe(true);
    expect(shouldFastRouteWebSearch('Any news about the release?')).toBe(true);
    expect(shouldFastRouteWebSearch('Explain how this function works.')).toBe(false);
    expect(shouldFastRouteWebSearch('Where can I find the docs?')).toBe(false);
    expect(shouldFastRouteWebSearch('Refactor the current router.')).toBe(false);
    // Coding requests should NEVER be routed to live web search, even if they mention weather or news
    expect(shouldFastRouteWebSearch('please write a weather webapp using React.JS and Tailwind CSS')).toBe(false);
    expect(shouldFastRouteWebSearch('create a weather widget component in react')).toBe(false);
    expect(shouldFastRouteWebSearch('build a stock portfolio tracker app')).toBe(false);
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
    expect(evidence).toContain('Currently in [Location] ([Date]):');
    expect(evidence).not.toContain('Calgary');
    expect(evidence).toContain('Never print URLs');
    expect(evidence).toContain('3 to 6 short bullets');
    expect(evidence).toContain('Answer only the question below');

    const failed = buildSearchAnswerTask('What is the weather today?', { toolName: 'web_search', status: 'error', output: 'Web search failed (exa: timed out after 20000ms).' });
    expect(failed).toContain('Call the web_search tool once');
    expect(failed).toContain('timed out after 20000ms');
  });

  it('keeps the asked question in the transcript instead of the injected search evidence', () => {
    const evidence = buildSearchAnswerTask('What is the weather in Tokyo today?', { toolName: 'web_search', status: 'success', output: 'Overcast, 7C.' });
    const produced: ChatMessage[] = [
      { role: 'user', content: evidence },
      { role: 'assistant', content: 'Currently in Tokyo: 7C.' },
    ];
    expect(replaceEvidenceTurn(produced, evidence, 'What is the weather in Tokyo today?')).toEqual([
      { role: 'user', content: 'What is the weather in Tokyo today?' },
      { role: 'assistant', content: 'Currently in Tokyo: 7C.' },
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

  it('detects model and provider status questions for instant local resolution', () => {
    expect(isLocalModelQuery('which model are you running against?')).toBe(true);
    expect(isLocalModelQuery('what model are you running against?')).toBe(true);
    expect(isLocalModelQuery('which model are you running?')).toBe(true);
    expect(isLocalModelQuery('what model are you using?')).toBe(true);
    expect(isLocalModelQuery('what model is this?')).toBe(true);
    expect(isLocalModelQuery('which model is active?')).toBe(true);
    expect(isLocalModelQuery('what is the current model?')).toBe(true);
    expect(isLocalModelQuery('current model')).toBe(true);
    expect(isLocalModelQuery('which model?')).toBe(true);
    expect(isLocalModelQuery('write a test for user model')).toBe(false);

    expect(isLocalProviderQuery('what provider are you using?')).toBe(true);
    expect(isLocalProviderQuery('which provider are you connected to?')).toBe(true);
    expect(isLocalProviderQuery('current provider')).toBe(true);
    expect(isLocalProviderQuery('provider service test')).toBe(false);
  });

  it('resolves model status instantly without external network calls', () => {
    const answer = resolveLocalMetaQuery('which model are you running against?', {
      currentModel: 'nvidia/nemotron-3-ultra-550b-a55b',
      providerName: 'NVIDIA NIM',
      activeMode: 'Execute',
      workspace: '/test/workspace',
    });

    expect(answer).toBeDefined();
    expect(answer).toContain('nvidia/nemotron-3-ultra-550b-a55b');
    expect(answer).toContain('NVIDIA NIM');
    expect(answer).toContain('/test/workspace');
    expect(answer).toContain('/model');
  });

  it('detects and resolves identity questions ("who are you?") instantly without external network calls', () => {
    expect(isLocalIdentityQuery('who are you?')).toBe(true);
    expect(isLocalIdentityQuery('who are you')).toBe(true);
    expect(isLocalIdentityQuery('what are you?')).toBe(true);
    expect(isLocalIdentityQuery('introduce yourself')).toBe(true);
    expect(isLocalIdentityQuery('tell me about yourself')).toBe(true);
    expect(isLocalIdentityQuery('who made you')).toBe(true);
    expect(isLocalIdentityQuery('who wrote this file')).toBe(false);

    const answer = resolveLocalMetaQuery('who are you?', {
      currentModel: 'agnes-3.0-flash',
      providerName: 'agnes',
      activeMode: 'Execute',
      workspace: '/test/workspace',
    });

    expect(answer).toBeDefined();
    expect(answer).toContain('Moderado');
    expect(answer).toContain('Ponytail Decision Ladder');
    expect(answer).toContain('agnes-3.0-flash');
    expect(answer).toContain('agnes');
    expect(answer).toContain('/test/workspace');
    expect(answer).toContain('/model');
    expect(answer).toContain('/connect');
  });

  it('TurnCommandQueue manages FIFO commands and editing draft', () => {
    const queue = new TurnCommandQueue();
    expect(queue.length).toBe(0);
    expect(queue.currentDraft).toBe('');

    queue.appendDraft('run test');
    expect(queue.currentDraft).toBe('run test');

    queue.backspaceDraft();
    expect(queue.currentDraft).toBe('run tes');

    queue.appendDraft('t');
    const committed = queue.commitDraft();
    expect(committed).toBe('run test');
    expect(queue.length).toBe(1);
    expect(queue.items).toEqual(['run test']);
    expect(queue.currentDraft).toBe('');

    queue.push('git diff');
    queue.push('commit changes');
    expect(queue.length).toBe(3);
    expect(queue.items).toEqual(['run test', 'git diff', 'commit changes']);

    expect(queue.shift()).toBe('run test');
    expect(queue.shift()).toBe('git diff');
    expect(queue.length).toBe(1);

    queue.clear();
    expect(queue.length).toBe(0);
    expect(queue.items).toEqual([]);
    expect(queue.currentDraft).toBe('');
  });

  it('handleGenerationKeypress handles typing, queueing, and cancel keys during active mission', () => {
    const queue = new TurnCommandQueue();
    let aborted = false;
    let draftChanges = 0;
    const queuedItems: string[] = [];

    const actions = {
      abort: () => { aborted = true; },
      onDraftChange: () => { draftChanges++; },
      onQueueAdd: (item: string) => { queuedItems.push(item); },
    };

    // 1. Typing printable characters updates draft
    handleGenerationKeypress('a', undefined, queue, actions);
    handleGenerationKeypress('l', undefined, queue, actions);
    handleGenerationKeypress('s', undefined, queue, actions);
    handleGenerationKeypress('o', undefined, queue, actions);
    expect(queue.currentDraft).toBe('also');
    expect(draftChanges).toBe(4);

    // 2. Backspace deletes character
    handleGenerationKeypress('', { name: 'backspace' }, queue, actions);
    expect(queue.currentDraft).toBe('als');
    expect(draftChanges).toBe(5);

    // 3. Escape with non-empty draft clears draft without aborting
    handleGenerationKeypress('', { name: 'escape' }, queue, actions);
    expect(queue.currentDraft).toBe('');
    expect(aborted).toBe(false);

    // 4. Escape with empty draft aborts generation
    handleGenerationKeypress('', { name: 'escape' }, queue, actions);
    expect(aborted).toBe(true);

    // 5. Enter commits draft to queue
    queue.setDraft('check edge cases');
    handleGenerationKeypress('', { name: 'return' }, queue, actions);
    expect(queue.currentDraft).toBe('');
    expect(queue.length).toBe(1);
    expect(queue.items).toEqual(['check edge cases']);
    expect(queuedItems).toEqual(['check edge cases']);

    // 6. Enter second command in succession
    queue.setDraft('run build');
    handleGenerationKeypress('', { name: 'enter' }, queue, actions);
    expect(queue.length).toBe(2);
    expect(queue.items).toEqual(['check edge cases', 'run build']);
    expect(queuedItems).toEqual(['check edge cases', 'run build']);

    // 7. Ctrl+C aborts
    aborted = false;
    handleGenerationKeypress('', { name: 'c', ctrl: true }, queue, actions);
    expect(aborted).toBe(true);
  });

  it('levenshteinDistance calculates edit distance between strings', () => {
    expect(levenshteinDistance('exit', 'exit')).toBe(0);
    expect(levenshteinDistance('exit', 'eixt')).toBe(2);
    expect(levenshteinDistance('model', 'modle')).toBe(2);
    expect(levenshteinDistance('clear', 'cler')).toBe(1);
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('findSlashCommandAdvice validates standard slash commands and rejects non-standard ones with advice', () => {
    // 1. Valid standard commands
    expect(findSlashCommandAdvice('/exit')).toEqual({ isSlashCommand: true, isValid: true });
    expect(findSlashCommandAdvice('/model')).toEqual({ isSlashCommand: true, isValid: true });
    expect(findSlashCommandAdvice('/connect')).toEqual({ isSlashCommand: true, isValid: true });
    expect(findSlashCommandAdvice('/clear')).toEqual({ isSlashCommand: true, isValid: true });
    expect(findSlashCommandAdvice('/session list')).toEqual({ isSlashCommand: true, isValid: true });
    expect(findSlashCommandAdvice('/workflow git')).toEqual({ isSlashCommand: true, isValid: true });

    // 2. Non-slash normal user messages
    expect(findSlashCommandAdvice('write a function in python')).toEqual({ isSlashCommand: false, isValid: false });
    expect(findSlashCommandAdvice('exit')).toEqual({ isSlashCommand: false, isValid: false });

    // 3. User example: /EXIT (case variation)
    const exitCase = findSlashCommandAdvice('/EXIT');
    expect(exitCase.isSlashCommand).toBe(true);
    expect(exitCase.isValid).toBe(false);
    expect(exitCase.suggestion).toBe('/exit');
    expect(exitCase.advice).toContain('Unknown command "/EXIT"');
    expect(exitCase.advice).toContain('Did you mean "/exit"?');
    expect(exitCase.advice).toContain('Commands are lowercase');

    // 4. User example: /eixt (typo)
    const exitTypo = findSlashCommandAdvice('/eixt');
    expect(exitTypo.isSlashCommand).toBe(true);
    expect(exitTypo.isValid).toBe(false);
    expect(exitTypo.suggestion).toBe('/exit');
    expect(exitTypo.advice).toContain('Unknown command "/eixt"');
    expect(exitTypo.advice).toContain('Did you mean "/exit"?');

    // 5. Common typos for other commands
    const modelTypo = findSlashCommandAdvice('/mdoel');
    expect(modelTypo.isValid).toBe(false);
    expect(modelTypo.suggestion).toBe('/model');
    expect(modelTypo.advice).toContain('Did you mean "/model"?');

    const clearTypo = findSlashCommandAdvice('/cler');
    expect(clearTypo.isValid).toBe(false);
    expect(clearTypo.suggestion).toBe('/clear');
    expect(clearTypo.advice).toContain('Did you mean "/clear"?');

    const helpShorthand = findSlashCommandAdvice('/?');
    expect(helpShorthand.isValid).toBe(false);
    expect(helpShorthand.suggestion).toBe('/help');
    expect(helpShorthand.advice).toContain('Did you mean "/help"?');

    // 6. Unknown slash command with no close match
    const unknown = findSlashCommandAdvice('/foobar');
    expect(unknown.isSlashCommand).toBe(true);
    expect(unknown.isValid).toBe(false);
    expect(unknown.suggestion).toBeUndefined();
    expect(unknown.advice).toBe('Unknown command "/foobar". Type /help to see available commands.');
  });

  it('formats turn failure answer with model and suggestion without leaking internals', () => {
    const errorText = formatTurnFailureAnswer(
      'failed',
      { code: 'ERR_RATE_LIMIT', message: 'NVIDIA NIM rate limit exceeded (429) during streamChat: Rate limit reached' },
      'meta/llama-3.3-70b-instruct',
      ['openrouter', 'agnes-ai']
    );

    expect(errorText).toContain('⚠️ **Model Error (ERR_RATE_LIMIT):**');
    expect(errorText).toContain('Rate limit reached');
    expect(errorText).toContain('meta/llama-3.3-70b-instruct');
    expect(errorText).toContain('other configured providers: openrouter, agnes-ai');
  });

  it('resolves current turn assistant answer without leaking earlier turn answers on failure', () => {
    // Simulate Turn 1: user asked "Who are you?", assistant answered "I am Moderado."
    const turn1History: ChatMessage[] = [
      { role: 'user', content: 'Who are you?' },
      { role: 'assistant', content: 'I am Moderado, your minimal autonomous coding agent.' },
    ];

    // Simulate Turn 2: user asks a new question, but provider fails with rate limit
    // result.messages contains the conversation history plus the new prompt
    const turn2Result = {
      status: 'failed',
      messages: [
        ...turn1History,
        { role: 'user', content: 'What is the weather today?' } as ChatMessage,
      ],
      selectedModel: { id: 'openrouter/auto' },
    };

    const resolution = resolveTurnAssistantAnswer(
      turn2Result,
      turn1History.length,
      { code: 'ERR_RATE_LIMIT', message: 'Rate limit exceeded on provider' },
      '',
      'openrouter/auto',
      ['nvidia-nim']
    );

    expect(resolution.isError).toBe(true);
    // Crucially: MUST NOT leak Turn 1's assistant message ("I am Moderado") into Turn 2's answer!
    expect(resolution.answer).not.toContain('I am Moderado');
    expect(resolution.answer).toContain('⚠️ **Model Error (ERR_RATE_LIMIT):**');
    expect(resolution.answer).toContain('Rate limit exceeded on provider');
    expect(resolution.answer).toContain('openrouter/auto');
  });

  it('resolves current turn assistant answer on success without leaking earlier turn answers', () => {
    const turn1History: ChatMessage[] = [
      { role: 'user', content: 'Who are you?' },
      { role: 'assistant', content: 'I am Moderado.' },
    ];

    const turn2Result = {
      status: 'completed',
      messages: [
        ...turn1History,
        { role: 'user', content: 'What is 2+2?' } as ChatMessage,
        { role: 'assistant', content: '4' } as ChatMessage,
      ],
      selectedModel: { id: 'meta/llama-3.3-70b-instruct' },
    };

    const resolution = resolveTurnAssistantAnswer(
      turn2Result,
      turn1History.length,
      undefined,
      '',
      'meta/llama-3.3-70b-instruct'
    );

    expect(resolution.isError).toBe(false);
    expect(resolution.answer).toBe('4');
  });

  it('recognizes /queue as a valid standard slash command', () => {
    expect(findSlashCommandAdvice('/queue')).toEqual({ isSlashCommand: true, isValid: true });
    expect(findSlashCommandAdvice('/queue list')).toEqual({ isSlashCommand: true, isValid: true });
    expect(findSlashCommandAdvice('/queue add do something')).toEqual({ isSlashCommand: true, isValid: true });
  });

  it('handleGenerationKeypress handles raw control bytes including Windows CR, BS, DEL, and ESC', () => {
    const queue = new TurnCommandQueue();
    let draftChanges = 0;
    const queuedItems: string[] = [];
    let aborted = false;

    const actions = {
      abort: () => { aborted = true; },
      onDraftChange: () => { draftChanges++; },
      onQueueAdd: (item: string) => { queuedItems.push(item); },
    };

    // Type text
    handleGenerationKeypress('t', undefined, queue, actions);
    handleGenerationKeypress('e', undefined, queue, actions);
    handleGenerationKeypress('s', undefined, queue, actions);
    handleGenerationKeypress('t', undefined, queue, actions);
    expect(queue.currentDraft).toBe('test');

    // Backspace via \x08 or \x7f
    handleGenerationKeypress('\x08', undefined, queue, actions);
    expect(queue.currentDraft).toBe('tes');

    // Enter via raw CR '\r'
    handleGenerationKeypress('\r', undefined, queue, actions);
    expect(queue.currentDraft).toBe('');
    expect(queue.length).toBe(1);
    expect(queuedItems).toEqual(['tes']);

    // Escape via raw ESC '\x1b'
    queue.setDraft('discard me');
    handleGenerationKeypress('\x1b', undefined, queue, actions);
    expect(queue.currentDraft).toBe('');
    expect(aborted).toBe(false);
  });
});