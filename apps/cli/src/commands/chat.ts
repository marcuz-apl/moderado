import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { AgentLoop, PolicyManager, Router, cleanConversationalFiller, DEFAULT_MAX_OUTPUT_TOKENS } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, ToolRegistry, canonicalizeRoot, createMcpTools, createWebSearchTool, discoverMcpServers, WorkspaceCheckpointStore, WriteFileTool } from '@moderado/tools';
import type { WebSearchToolOptions } from '@moderado/tools';
import { ApprovalDecision, ApprovalRequest, ChatMessage, IApprovalHandler, IToolRegistry, McpServerConfig, McpServerConfigSchema, ToolResult, type UsageEvent } from '@moderado/contracts';
import { CliParsedArgs } from '../args.js';
import { freeModelPolicyFor, getActiveConnection, loadConfig, ProviderConnection, removeMcpServer, requiresCredentialReference, resolveApiKey, resolveConnectionCredential, resolveModeradoSessionConnection, saveConnection, saveMcpServer, setMcpServerEnabled, storeConnectionCredential } from '../config.js';
import { CredentialStore, MemoryCredentialStore } from '../credentials.js';
import { WindowsCredentialStore } from '../windows_credentials.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { selectCompatibleModelOverlay, selectModelOverlay, showModelConnectionRequired } from '../ui/model_selector.js';
import { connectProviderInteractive, isAuthenticationFailure, isModeradoOAuthConnection, loginModeradoInteractive, replaceProviderKeyInteractive, resolveAutoModeradoConnection } from '../ui/provider_connect.js';
import { initWorkspace } from './init.js';
import { expandMentions, createWorkspaceFileSource } from '../ui/file_mentions.js';
import { listFiles } from '@moderado/tools';
import { exitCleanly, renderChatTranscriptWindow, renderChatTranscriptHeader, renderChatComposerCursor, renderChatThoughtTimeUpdate, renderChatUsageUpdate, renderGatewayFallbackUpdate, renderFullWelcomeScreen, renderWelcomePopupLayer, terminalCleanExitDone, wrapText, getChatLayout, getChatComposerRows, describeActivity, describeToolActivity, describeWait } from '../ui/welcome.js';
import type { ActivityEntry, ChatActivityBlock, ChatHistoryTurn } from '../ui/welcome.js';
import type { WelcomeLayoutOptions } from '../ui/welcome.js';
import { promptInteractiveTurn } from '../ui/composer.js';
import { TurnRecorder, formatTurnSummary } from '../turn_summary.js';
import { writeDiagnosticLog } from '../diagnostic_log.js';
import { writeTranscript } from '../transcript.js';
import { accumulateSessionUsage, compactSessionMessages, createSession, exportSessionMarkdown, formatSessionCost, SessionStore, StoredSession } from '../sessions.js';
import { layerPromptBox, renderBoxLines, selectConfirmPopup, selectListPopup } from '../ui/popup.js';
import { askModalChoice } from '../ui/prompt.js';
import { findModelPricing, isFreeModelOption } from '../model_pricing.js';
import { inspectGitWorkspace, readGitDiff } from '@moderado/tools';
import { buildWorkspaceMap } from '../repo_map.js';
import { evaluateTokenBudget, parseBudgetCommand } from '../budget.js';
import { discoverSkills, formatSkillContext, formatSkillsList, getEnabledSkillNames, selectEnabledSkills, setSkillEnabled, UserSkill } from '../skills.js';
import { getHelpCommandLines } from '../ui/help_content.js';
import { forceExit } from '../http_shutdown.js';

// Command routing, local meta queries, web-search routing and turn outcomes
// live in their own modules. Re-exported so `commands/chat.js` stays the one
// import surface for callers and tests.
import { findSlashCommandAdvice } from './chat_slash.js';
import { resolveLocalMetaQuery } from './chat_meta.js';
import { buildSearchAnswerTask, formatDirectWebSearchAnswer, replaceEvidenceTurn, resolveWebSearchOptions, shouldFastRouteWebSearch } from './chat_search.js';
import { isBareExitCommand, isGenerationCancelKey, resolveSessionSharePath, resolveTurnAssistantAnswer, saveFailedTurnPrompt, turnFailedAuthentication } from './chat_outcome.js';

export * from './chat_slash.js';
export * from './chat_meta.js';
export * from './chat_search.js';
export * from './chat_outcome.js';

export function createConnectionProvider(connection: ProviderConnection): NvidiaAdapter {
  return new NvidiaAdapter({ apiKey: connection.apiKey, baseUrl: connection.baseUrl, providerId: connection.id, providerName: connection.displayName });
}

export function getProviderStatusName(connection?: Pick<ProviderConnection, 'id' | 'displayName'>): string | undefined {
  return connection?.id === 'moderado' || connection?.id === 'moderado-cloud'
    ? 'Moderado'
    : connection?.displayName;
}

/**
 * A keyless Moderado session reaches the Gateway's pinned defaults and paid
 * routes without an account, so every model it selects costs the user nothing.
 */
export function isKeylessGatewaySession(connection: ProviderConnection | undefined): boolean {
  return Boolean(connection
    && (connection.id === 'moderado' || connection.id === 'moderado-cloud')
    && !connection.apiKey?.trim());
}

export function formatSessionExitSummary(session: StoredSession, modelId?: string): string {
  const usage = session.usage;
  const tokens = usage.available
    ? `Input ${usage.promptTokens.toLocaleString('en-US')} | Output ${usage.completionTokens.toLocaleString('en-US')} | Total ${usage.totalTokens.toLocaleString('en-US')}${usage.estimated ? ' (estimated)' : ''}`
    : 'Usage unavailable';
  return [
    '\x1b[1;38;5;25mSession Summary\x1b[0m',
    `ID: ${session.id}`,
    `Model: ${modelId ?? session.modelId ?? 'No model selected'}`,
    `Tokens: ${tokens}`,
    `Cost: ${formatSessionCost(usage)}`,
    'Resume: /session resume',
  ].join('\n');
}

function mutationPaths(toolName: string, parameters: unknown): string[] {
  const value = parameters as { path?: unknown; edits?: { path?: unknown }[] };
  if (toolName === 'apply_patch' && Array.isArray(value.edits)) {
    return value.edits.map((edit) => typeof edit.path === 'string' ? edit.path : '').filter(Boolean);
  }
  return typeof value.path === 'string' ? [value.path] : [];
}
export function createAgentTask(request: string, mode: 'Plan' | 'Execute'): string {
  if (mode === 'Execute') return request;
  return `Create a concise implementation checklist for this request. Inspect files as needed, but do not modify files or run commands.\n\nUser request:\n${request}`;
}

export function createReviewTask(changedFiles: string[]): string {
  return `Review the current workspace changes. Inspect staged and unstaged Git diffs with git_diff, then inspect relevant surrounding code. Also review untracked files listed below with read_file. Do not modify files or run commands. Report only actionable bugs or security issues, ordered by severity, with file paths and line numbers. If none are found, say "No findings". Keep the report concise.\n\nChanged files:\n${changedFiles.join('\n') || '(none)'}`;
}

export function createReviewToolRegistry(): IToolRegistry {
  const source = createDefaultToolRegistry();
  const registry = new ToolRegistry();
  for (const name of ['git_diff', 'read_file', 'list_files', 'search_files', 'get_definition', 'find_references']) {
    const tool = source.get(name);
    if (tool) registry.register(tool);
  }
  return registry;
}

const CONTINUE_INTERRUPTED_TASK_PROMPT = 'Continue the interrupted task from the saved conversation. Start from the unfinished work and avoid repeating completed steps.';

/** Braille spinner frames for the live "still running" status row. */
const ACTIVITY_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function hasInterruptedTurn(messages: ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || !message.content?.trim()) continue;
    return message.content.includes('[This response was interrupted before completion.')
      || message.content.includes('[This task was interrupted before a response was produced.');
  }
  return false;
}

function restoreLastSessionTurn(messages: ChatMessage[]): { question: string; answer: string } {
  let assistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant' && messages[index].content?.trim()) {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) {
    const question = [...messages].reverse().find((message) => message.role === 'user' && message.content?.trim())?.content ?? '';
    return { question, answer: question ? 'This task was interrupted. Type “continue” to resume with the current model.' : '' };
  }
  let question = '';
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && messages[index].content?.trim()) {
      question = messages[index].content ?? '';
      break;
    }
  }
  return { question, answer: messages[assistantIndex].content ?? '' };
}

export function getPriorChatTurns(messages: readonly ChatMessage[], currentQuestion: string, currentAnswer: string): ChatHistoryTurn[] {
  const turns: ChatHistoryTurn[] = [];
  let question = '';
  for (const message of messages) {
    if (message.role === 'user') question = message.content;
    else if (message.role === 'assistant' && question && message.content?.trim()) {
      turns.push({ question, answer: message.content });
      question = '';
    }
  }
  const latest = turns.at(-1);
  if (latest && currentAnswer && latest.question === currentQuestion) turns.pop();
  return turns;
}

export class TurnCommandQueue {
  private queue: string[] = [];
  private draft = '';

  get items(): readonly string[] {
    return this.queue;
  }

  get currentDraft(): string {
    return this.draft;
  }

  get length(): number {
    return this.queue.length;
  }

  push(command: string): void {
    const trimmed = command.trim();
    if (trimmed) {
      this.queue.push(trimmed);
    }
  }

  shift(): string | undefined {
    return this.queue.shift();
  }

  clear(): void {
    this.queue = [];
    this.draft = '';
  }

  setDraft(text: string): void {
    this.draft = text;
  }

  appendDraft(text: string): void {
    this.draft += text;
  }

  backspaceDraft(): void {
    if (this.draft.length > 0) {
      this.draft = this.draft.slice(0, -1);
    }
  }

  commitDraft(): string | undefined {
    const trimmed = this.draft.trim();
    this.draft = '';
    if (trimmed) {
      this.queue.push(trimmed);
      return trimmed;
    }
    return undefined;
  }
}

export function handleGenerationKeypress(
  str: string,
  key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean } | undefined,
  queue: TurnCommandQueue,
  actions: {
    abort: () => void;
    onDraftChange: () => void;
    onQueueAdd: (item: string) => void;
    onBtw?: (command: string) => void;
  }
): void {
  // 1. Ctrl+C: abort generation and clear queue
  if ((key?.ctrl && key.name === 'c') || str === '\x03') {
    actions.abort();
    return;
  }

  // 2. Escape always stops the active task; the caller clears queued input.
  if (isGenerationCancelKey(key, str)) {
    actions.abort();
    return;
  }

  // 3. Return / Enter: commit draft or execute /btw immediately
  if (key?.name === 'return' || key?.name === 'enter' || str === '\r' || str === '\n') {
    const trimmed = queue.currentDraft.trim();
    if (trimmed.startsWith('/btw')) {
      queue.setDraft('');
      actions.onDraftChange();
      if (actions.onBtw) {
        actions.onBtw(trimmed);
      }
      return;
    }

    const added = queue.commitDraft();
    if (added) {
      actions.onQueueAdd(added);
    }
    return;
  }

  // 4. Backspace: delete character from draft (support Windows BS \x08 / DEL \x7f)
  if (key?.name === 'backspace' || str === '\x08' || str === '\x7f') {
    if (queue.currentDraft.length > 0) {
      queue.backspaceDraft();
      actions.onDraftChange();
    }
    return;
  }

  // 5. Printable characters / pasted text
  if (!key?.ctrl && !key?.meta && str) {
    const printable = str.replace(/[\x00-\x1f\x7f]/g, '');
    if (printable.length > 0) {
      queue.appendDraft(printable);
      actions.onDraftChange();
    }
  }
}

export interface ApprovalPolicyOptions {
  autoApprove: boolean;
  requestInteractiveApproval: (request: ApprovalRequest, signal?: AbortSignal) => Promise<ApprovalDecision>;
}

export async function decideApproval(
  request: ApprovalRequest,
  options: ApprovalPolicyOptions,
  signal?: AbortSignal
): Promise<ApprovalDecision> {
  // Auto-approve is an explicit, session-wide opt-in and it covers every local
  // tool — `run_command` included. It used to exempt commands that reach the
  // network, which is why `npx …` and `curl …` still raised a prompt while the
  // status bar said "Auto-approve enabled". MCP tools stay gated: they are
  // third-party code the user never reviewed.
  if (options.autoApprove && !request.toolName.startsWith('mcp.')) {
    return { requestId: request.requestId, status: 'approved' };
  }
  return options.requestInteractiveApproval(request, signal);
}

export async function createMcpToolRegistry(servers: Record<string, McpServerConfig> | undefined, webSearch: WebSearchToolOptions = {}): Promise<IToolRegistry> {
  return createDefaultToolRegistry([createWebSearchTool(webSearch), ...(await createMcpTools(servers))]);
}

export interface McpCommandOptions {
  reloadMcpTools: () => Promise<void>;
  signal?: AbortSignal;
  configHome?: string;
  promptText?: (label: string) => Promise<string | undefined>;
  discoverMcpServers?: typeof discoverMcpServers;
  selectListPopup?: typeof selectListPopup;
  selectConfirmPopup?: typeof selectConfirmPopup;
}

export async function handleMcpCommand(
  command: string,
  drawFrame: (popupLines: string[]) => void,
  options: McpCommandOptions
): Promise<void> {
  const choose = options.selectListPopup ?? selectListPopup;
  const confirm = options.selectConfirmPopup ?? selectConfirmPopup;
  const discover = options.discoverMcpServers ?? discoverMcpServers;
  const promptText = options.promptText ?? (async (label: string): Promise<string | undefined> => {
    layerPromptBox(drawFrame, label);
    const answer = await askModalChoice('\n> ', { signal: options.signal });
    return answer === 'q' ? undefined : answer.trim();
  });
  const show = async (title: string, lines: string[]): Promise<void> => {
    const popupLines = [...lines, '', 'Press Esc or Enter to return.'];
    if (!process.stdin.isTTY) {
      drawFrame(renderBoxLines(title, popupLines, 72));
      return;
    }
    await choose(title, [{
      label: 'Close',
      value: 'close',
      description: lines.join('\n'),
    }], {
      drawFrame,
      signal: options.signal,
      hint: 'Enter close · Esc cancel',
    });
  };
  const currentServers = (): Record<string, McpServerConfig> => loadConfig(options.configHome).mcpServers ?? {};
  const pickServer = async (title: string, predicate: (server: McpServerConfig) => boolean = () => true): Promise<string | undefined> => {
    const entries = Object.entries(currentServers()).filter(([, server]) => predicate(server));
    if (!entries.length) {
      await show(title, ['No matching local MCP servers are configured.']);
      return undefined;
    }
    return (await choose(title, entries.map(([name, server]) => ({
      label: name,
      value: name,
      tag: server.enabled === false ? 'Disabled' : 'Enabled',
      description: server.executable,
    })), { drawFrame, signal: options.signal, filterable: true })) ?? undefined;
  };

  let actionText = command.slice('/mcp'.length).trim();
  if (!actionText) {
    actionText = (await choose('Local MCP servers', [
      { label: 'List/status', value: 'status', description: 'Probe configured servers and show their current tools.' },
      { label: 'Add', value: 'add', description: 'Probe and save a trusted local stdio server.' },
      { label: 'Enable/disable', value: 'toggle', description: 'Change whether a configured server contributes tools.' },
      { label: 'Remove', value: 'remove', description: 'Delete a server after confirmation.' },
      { label: 'Reload', value: 'reload', description: 'Rebuild MCP tools for this chat session.' },
    ], { drawFrame, signal: options.signal })) ?? '';
  }
  if (!actionText) return;

  const [requestedAction, requestedName] = actionText.split(/\s+/, 2);
  let action = requestedAction.toLowerCase();
  let name: string | undefined = requestedName;

  try {
    if (action === 'status' || action === 'list') {
      const servers = currentServers();
      if (!Object.keys(servers).length) {
        await show('Local MCP servers', ['No local MCP servers are configured.']);
        return;
      }
      const statuses = await discover(servers);
      await choose('Local MCP servers', statuses.map((status) => ({
        label: status.name,
        value: status.name,
        tag: status.enabled ? 'Enabled' : 'Disabled',
        description: `${servers[status.name]?.executable ?? 'Unknown executable'} · ${status.error ? `Error: ${status.error}` : `${status.tools.length} ${status.tools.length === 1 ? 'tool' : 'tools'}`}`,
      })), { drawFrame, signal: options.signal, filterable: true, hint: '↑↓ inspect · Esc close' });
      return;
    }

    if (action === 'add') {
      name = await promptText('MCP server name (letters, numbers, dash, underscore)');
      if (!name) return;
      if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Invalid MCP server name '${name}'.`);
      const executable = await promptText('Local executable');
      if (!executable) return;
      const argsText = await promptText('Fixed arguments (space-delimited, optional)');
      if (argsText === undefined) return;
      const server = McpServerConfigSchema.parse({ executable: executable.trim(), args: argsText.trim() ? argsText.trim().split(/\s+/) : [], enabled: true });
      const [status] = await discover({ [name]: server });
      if (!status || status.error) {
        await show('MCP add failed', [status?.error ?? 'The server did not return a valid tools/list response.', 'Configuration was not changed.']);
        return;
      }
      saveMcpServer(name, server, options.configHome);
      await options.reloadMcpTools();
      await show('MCP server added', [`${name} · ${status.tools.length} ${status.tools.length === 1 ? 'tool' : 'tools'}`]);
      return;
    }

    if (action === 'toggle') {
      name = await pickServer('Enable or disable MCP server');
      if (!name) return;
      action = currentServers()[name]?.enabled === false ? 'enable' : 'disable';
    }
    if (action === 'enable' || action === 'disable') {
      name ??= await pickServer(`${action === 'enable' ? 'Enable' : 'Disable'} MCP server`, (server) => (server.enabled !== false) !== (action === 'enable'));
      if (!name) return;
      setMcpServerEnabled(name, action === 'enable', options.configHome);
      await options.reloadMcpTools();
      await show('MCP server updated', [`${name} is now ${action === 'enable' ? 'enabled' : 'disabled'}.`]);
      return;
    }

    if (action === 'remove') {
      name ??= await pickServer('Remove MCP server');
      if (!name) return;
      if (!(await confirm('Remove MCP server', [`Remove '${name}' from local configuration?`], { drawFrame, signal: options.signal }))) return;
      removeMcpServer(name, options.configHome);
      await options.reloadMcpTools();
      await show('MCP server removed', [`Removed ${name}.`]);
      return;
    }

    if (action === 'reload') {
      await options.reloadMcpTools();
      await show('MCP tools reloaded', ['Configured local MCP tools were rebuilt for this chat session.']);
      return;
    }

    await show('Local MCP servers', ['Use status, add, enable NAME, disable NAME, remove NAME, or reload.']);
  } catch (error) {
    await show('MCP management error', [error instanceof Error ? error.message : 'MCP management failed.']);
  }
}

export async function executeBtwQuery(
  command: string,
  drawFrame: (popupLines: string[], options?: { waitDismiss?: boolean }) => void | Promise<void>,
  provider: NvidiaAdapter | undefined,
  currentModel: string | undefined,
  btwHistory: Array<{ question: string; answer: string; timestamp: number }>,
  signal?: AbortSignal,
  btwSignal?: AbortSignal
): Promise<void> {
  const question = command.replace(/^\/btw\s*/i, '').trim();
  if (!question) {
    if (btwHistory.length === 0) {
      await drawFrame(renderBoxLines('By The Way (/btw)', [
        'Ask quick ephemeral side questions without polluting the session context.',
        '',
        'Usage:',
        '  /btw <question>        Ask a side question in an ephemeral popup',
        '  /btw                   Review recent side questions from this session',
        '',
        'Examples:',
        '  /btw how do I format a date in JS?',
        '  /btw what does git switch -c do?',
        '',
        'Press Esc or Enter to return.',
      ], 76));
    } else {
      const lines: string[] = [];
      for (let i = btwHistory.length - 1; i >= Math.max(0, btwHistory.length - 5); i--) {
        const item = btwHistory[i];
        lines.push(`\x1b[1;38;5;221mQ:\x1b[0m ${item.question}`);
        lines.push(`\x1b[38;5;253mA:\x1b[0m ${item.answer}`);
        if (i > Math.max(0, btwHistory.length - 5)) lines.push('---');
      }
      lines.push('');
      lines.push('Press Esc or Enter to return.');
      await drawFrame(renderBoxLines('By The Way (/btw) — Recent Side Questions', lines, 76));
    }
    return;
  }

  if (!provider || !currentModel) {
    await drawFrame(renderBoxLines('By The Way (/btw)', [
      'No model or provider connected.',
      'Use /connect to choose a provider and model.',
      '',
      'Press Esc or Enter to return.',
    ], 72));
    return;
  }

  await drawFrame(renderBoxLines('By The Way (/btw)', [
    `Q: ${question}`,
    '',
    '\x1b[38;5;221mThinking (/btw)... (Press Esc to cancel)\x1b[0m',
  ], 76), { waitDismiss: false });

  if (btwSignal?.aborted || signal?.aborted) return;

  try {
    const btwMessages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are Moderado answering a quick side question (by-the-way). Extreme brevity is mandatory. Answer in 1 to 3 short sentences or under 35 words. No conversational filler, pleasantries, or preambles. Output only the direct answer or code.',
      },
      {
        role: 'user',
        content: question,
      },
    ];

    let answer = '';
    const activeSignal = btwSignal || signal;
    const stream = provider.streamChat({
      modelId: currentModel,
      messages: btwMessages,
      maxTokens: 2048,
      signal: activeSignal,
    });

    for await (const chunk of stream) {
      if (chunk.contentDelta) {
        answer += chunk.contentDelta;
      }
    }

    if (activeSignal?.aborted) return;

    const cleanedAnswer = cleanConversationalFiller(answer) || 'No response generated.';
    btwHistory.push({ question, answer: cleanedAnswer, timestamp: Date.now() });

    const wrappedAnswer = wrapText(cleanedAnswer, 70);
    await drawFrame(renderBoxLines('By The Way (/btw)', [
      `\x1b[1;38;5;221mQ:\x1b[0m ${question}`,
      '---',
      ...wrappedAnswer.map((l) => `\x1b[38;5;253m${l}\x1b[0m`),
      '',
      '\x1b[38;5;244m(Not saved to session history • Esc or Enter to close)\x1b[0m',
    ], 76));
  } catch (err: any) {
    if (btwSignal?.aborted || signal?.aborted) {
      return;
    }
    await drawFrame(renderBoxLines('By The Way (/btw) — Error', [
      `Failed to answer side question: ${err?.message || String(err)}`,
      '',
      'Press Esc or Enter to return.',
    ], 76));
  }
}

export async function handleChatSession(args: CliParsedArgs, version: string, signal?: AbortSignal): Promise<number> {
  let canonicalWorkspace: string;
  try { canonicalWorkspace = canonicalizeRoot(path.resolve(process.cwd(), args.workspace)); }
  catch (err: any) { process.stderr.write(`\x1b[1;31mWorkspace Error:\x1b[0m ${err.message}\n`); return 1; }

  const credentialStore: CredentialStore = process.platform === 'win32' ? new WindowsCredentialStore() : new MemoryCredentialStore();
  let config = loadConfig();
  let activeConnection = getActiveConnection(config);
  if (activeConnection) activeConnection = await resolveConnectionCredential(activeConnection, credentialStore);
  // A keyless Gateway profile saved whichever URL the last probe picked. Probe
  // again so /model reaches a running development Gateway instead of a stale
  // production URL, while an explicit custom URL still wins.
  activeConnection = await resolveModeradoSessionConnection(activeConnection, config, { signal });
  if (!activeConnection && resolveApiKey()) {
    activeConnection = { id: 'nvidia-nim', displayName: 'NVIDIA NIM', kind: 'nvidia-nim',
      baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: resolveApiKey(), defaultModel: config.defaultModel };
  }
  // A fresh install starts on the Gateway's account-free defaults so it can talk
  // to a model without a key. Saved profiles that are merely not selected stay
  // untouched; this connection is session-scoped, so the next start probes again.
  if (!activeConnection && Object.keys(config.connections ?? {}).length === 0) {
    activeConnection = await resolveAutoModeradoConnection(config, { signal });
  }
  let currentModel = args.model ?? activeConnection?.defaultModel ?? (activeConnection?.kind === 'nvidia-nim' ? 'auto' : undefined);

  process.stdout.write('\x1b]0;Moderado\x07');
  const restoreTerminal = (): void => {
    if (terminalCleanExitDone) return;
    try { process.stdout.write('\x1b[?25h\x1b[?1049l\x1b[0 q\x1b[0m'); if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* ignore */ }
  };
  process.on('exit', restoreTerminal);

  let provider: NvidiaAdapter | undefined;
  const activateConnection = (connection: ProviderConnection, explicitModel?: string): void => {
    activeConnection = connection;
    currentModel = explicitModel ?? connection.defaultModel ?? (connection.kind === 'nvidia-nim' ? 'auto' : undefined);
    provider = createConnectionProvider(connection);
  };
  if (activeConnection) activateConnection(activeConnection, args.model);

  let activeMode: 'Plan' | 'Execute' = args.readOnly ? 'Plan' : 'Execute';
  let activeAutoApprove = !args.nonInteractive;
  let tokenBudget: number | undefined;
  const sessionStore = new SessionStore();
  let activeSession: StoredSession = sessionStore.loadLatestSession(canonicalWorkspace) ??
    createSession(canonicalWorkspace, {
      providerId: activeConnection?.id,
      providerName: activeConnection?.displayName,
      modelId: currentModel,
      mode: activeMode,
    });
  currentModel = args.model ?? (activeSession.providerId === activeConnection?.id ? activeSession.modelId : undefined) ?? currentModel;
  if (
    activeSession.usage.available &&
    !activeSession.usage.costKnown &&
    activeSession.providerId === activeConnection?.id &&
    (freeModelPolicyFor(activeConnection?.id)?.freeCatalog || isKeylessGatewaySession(activeConnection))
  ) {
    activeSession.usage.costKnown = true;
    activeSession.usage.costUsd = 0;
    sessionStore.save(activeSession);
  }
  let sessionTokens = activeSession.usage.totalTokens;
  let isFirst = true;
  if (config.typescriptLanguageServer) process.env.MODERADO_TYPESCRIPT_LANGUAGE_SERVER = config.typescriptLanguageServer;
  let tools: IToolRegistry = createDefaultToolRegistry();
  let discoveredSkills: UserSkill[] = discoverSkills();
  let enabledSkillNames = getEnabledSkillNames();
  let skills: UserSkill[] = selectEnabledSkills(discoveredSkills, enabledSkillNames);
  const skillContext = (task: string): string => `${formatSkillContext(skills, task)}

CLI CHART OUTPUT:
When the user explicitly asks for a bar or line graph, output it as a fenced chart block, not an ASCII-art chart or a code sample. Start the block with \`\`\`chart, put JSON on the next line, and close it with \`\`\`; use {"type":"bar"|"line","title":"optional title","data":[{"label":"category","value":number}]}. Use "bar" for category comparisons and "line" for ordered values. Include at most 24 finite numeric values. For other requests, use a chart only when it clearly helps.`;
  const reloadMcpTools = async (): Promise<void> => {
    config = loadConfig();
    tools = await createMcpToolRegistry(config.mcpServers, resolveWebSearchOptions(config));
  };
  await reloadMcpTools();
  const terminalApproval = new TerminalApprovalHandler();
  const checkpoints = new WorkspaceCheckpointStore();
  let suspendGenerationInput: (() => (() => void) | undefined) | undefined;
  const approvalHandler: IApprovalHandler = { requestApproval: async (req: ApprovalRequest, sig?: AbortSignal): Promise<ApprovalDecision> => decideApproval(req, {
    autoApprove: activeAutoApprove,
    requestInteractiveApproval: async (request, approvalSignal) => {
      const resumeGenerationInput = suspendGenerationInput?.();
      try { return await terminalApproval.requestApproval(request, approvalSignal); }
      finally { resumeGenerationInput?.(); }
    },
  }, sig) };
  const router = new Router();
  const loop = new AgentLoop();
  /**
   * Rows the transcript is scrolled up from its tail, mirrored from the
   * composer. The turn loop paints the transcript on every streamed delta, so
   * it has to paint at the reader's position — repainting at offset 0 would
   * drag someone who scrolled up back to the bottom mid-sentence.
   */
  let answerOffset = 0;
  /**
   * Live activity for the turn that is running, or undefined between turns.
   * Hoisted out of the turn closure so the composer can read it while it owns
   * the scroll position.
   */
  let currentActivity: ChatActivityBlock | undefined;
  let conversationHistory: ChatMessage[] = [...activeSession.messages];
  const restoredTurn = restoreLastSessionTurn(conversationHistory);
  let lastQuestion = restoredTurn.question;
  let lastAnswer = restoredTurn.answer;
  let lastTurnDone = conversationHistory.length > 0 && !hasInterruptedTurn(conversationHistory);
  /**
   * Whether `lastAnswer` is a real answer that may be replayed when the same
   * question is asked twice. A cancelled, failed, or interrupted turn leaves a
   * status note in `lastAnswer` rather than an answer; replaying that would
   * claim the model answered a question it never answered, so those turns leave
   * this false and the question reaches the model again.
   */
  let lastAnswerReplayable = lastTurnDone;
  let lastThoughtTime = 0;
  let lastOutputTokenRate: number | undefined;
  let lastTokenUsage: UsageEvent | undefined;
  let activePlan: string | undefined;
  const costLabel = (): string => formatSessionCost(activeSession.usage);
  const exitMessage = (): string => `\x1b[32mGoodbye! Stay Tuned with Moderado!\x1b[0m\n\n${formatSessionExitSummary(activeSession, currentModel)}`;
  const commandQueue = new TurnCommandQueue();
  const btwHistory: Array<{ question: string; answer: string; timestamp: number }> = [];

  /**
   * One source of truth for the frame: the answer window, the caret row, and
   * the composer card are all measured from these options, so a queued-commands
   * box (or a mention box) that makes the card taller is accounted for
   * everywhere instead of only where the card is painted.
   */
  const chatFrameOptions = (overrides: Partial<WelcomeLayoutOptions> = {}): WelcomeLayoutOptions => ({
    provider: getProviderStatusName(activeConnection),
    model: currentModel ?? 'No model connected — use /connect',
    tokens: Math.round(sessionTokens),
    cost: costLabel(),
    usageAvailable: activeSession.usage.available,
    usageEstimated: activeSession.usage.estimated,
    workspace: canonicalWorkspace,
    mode: activeMode,
    autoApprove: activeAutoApprove,
    chatQuestion: lastQuestion,
    chatAnswer: lastAnswer,
    chatHistory: getPriorChatTurns(conversationHistory, lastQuestion, lastAnswer),
    isTurnSettled: true,
    // Scroll position mirrored from the composer, so a full frame repaint lands
    // on the same rows the reader is looking at.
    chatAnswerOffset: answerOffset,
    chatThoughtTime: lastThoughtTime,
    input: commandQueue.currentDraft,
    queuedCommands: commandQueue.items,
    ...overrides,
  });

  /** Row geometry for a frame, with the real composer height (queued box included). */
  const layoutFor = (options: WelcomeLayoutOptions) =>
    getChatLayout(process.stdout.columns, process.stdout.rows, options.chatQuestion ?? '', getChatComposerRows(options));

  /** Repaint a settled frame and park the caret on the composer's input row. */
  const paintStaticChatFrame = (overrides: Partial<WelcomeLayoutOptions> = {}): void => {
    const options = chatFrameOptions(overrides);
    const layout = layoutFor(options);
    process.stdout.write('\x1b[?2026h');
    process.stdout.write('\x1b[H\x1b[J');
    process.stdout.write(renderFullWelcomeScreen(options, process.stdout.rows));
    process.stdout.write(renderChatComposerCursor({ width: process.stdout.columns }, options.input ?? '', layout.composerTop));
    process.stdout.write('\x1b[?2026l');
  };

  while (!signal?.aborted) {
    let trimmed = '';

    if (commandQueue.length > 0) {
      trimmed = commandQueue.shift()!;
      isFirst = false;
    } else {
      let autoContinueRequested = false;
      const turn = await promptInteractiveTurn({
        getProviderName: () => getProviderStatusName(activeConnection),
        model: currentModel ?? 'No model connected — use /connect', tokens: Math.round(sessionTokens), cost: costLabel(), workspace: canonicalWorkspace, version,
        usageAvailable: activeSession.usage.available, usageEstimated: activeSession.usage.estimated, initialMode: activeMode, initialAutoApprove: activeAutoApprove, isFirstTurn: isFirst, signal, chatQuestion: lastQuestion || undefined, chatAnswer: lastAnswer || undefined, chatHistory: getPriorChatTurns(conversationHistory, lastQuestion, lastAnswer), chatThoughtTime: lastThoughtTime, chatTaskDone: lastTurnDone, outputTokenRate: lastOutputTokenRate, tokenUsage: lastTokenUsage,
        queuedCommands: commandQueue.items,
        takeAutoContinuePrompt: () => {
          if (!autoContinueRequested) return undefined;
          autoContinueRequested = false;
          return CONTINUE_INTERRUPTED_TASK_PROMPT;
        },
        onExit: exitMessage,
        onTranscript: async () => (conversationHistory.length === 0 ? undefined : writeTranscript({
          messages: conversationHistory,
          workspace: canonicalWorkspace,
          model: currentModel ?? 'unknown',
          sessionId: activeSession.id,
        })),
        questionHistory: conversationHistory.flatMap((message) => message.role === 'user' && message.content?.trim() ? [message.content] : []),
        // The composer owns the scroll position; the turn loop needs to know
        // when it moves so its incremental paints follow the reader.
        onTranscriptScroll: (offset) => { answerOffset = offset; },
        getChatActivity: () => currentActivity,
      onModelSelect: async (drawFrame) => {
        if (!activeConnection) {
          await showModelConnectionRequired(drawFrame, signal);
          return undefined;
        }
        if (activeConnection.kind === 'openai-compatible') {
          const modelId = await selectCompatibleModelOverlay({
            apiKey: activeConnection.id === 'moderado' ? undefined : activeConnection.apiKey,
            baseUrl: activeConnection.baseUrl,
            providerId: activeConnection.id,
            providerName: activeConnection.displayName,
            currentModel,
            gatewayFreeOnly: activeConnection.id === 'moderado' && !activeConnection.apiKey,
            signal,
            drawFrame,
          });
          if (modelId && modelId !== currentModel) {
            currentModel = modelId;
            activeConnection = { ...activeConnection, defaultModel: modelId };
            saveConnection(activeConnection);
            config = loadConfig();
            activeSession.providerId = activeConnection.id;
            activeSession.providerName = activeConnection.displayName;
            activeSession.modelId = modelId;
            sessionStore.save(activeSession);
            autoContinueRequested = hasInterruptedTurn(activeSession.messages);
          }
          return modelId;
        }
        const selection = await selectModelOverlay({ apiKey: activeConnection.id === 'moderado' ? undefined : activeConnection.apiKey, currentModel, signal, saveSelectionByDefault: true, drawFrame });
        if (selection.modelId && selection.modelId !== currentModel) {
          currentModel = selection.modelId;
          activeConnection = { ...activeConnection, defaultModel: selection.modelId };
          saveConnection(activeConnection);
          config = loadConfig();
          activeSession.providerId = activeConnection.id;
          activeSession.providerName = activeConnection.displayName;
          activeSession.modelId = selection.modelId;
          sessionStore.save(activeSession);
          autoContinueRequested = hasInterruptedTurn(activeSession.messages);
        }
        return selection.modelId;
      },
      onConnect: async (drawFrame) => {
        const connection = await connectProviderInteractive({
          signal,
          drawFrame,
          gatewayUrl: config.connections?.moderado?.baseUrl,
          activeConnection,
          savedConnections: config.connections,
          connectProviders: config.connectProviders,
          resolveSavedConnection: (saved) => resolveConnectionCredential(saved, credentialStore),
        });
        if (!connection) return currentModel;
        const runtimeConnection = requiresCredentialReference(connection) ? await storeConnectionCredential(connection, credentialStore) : connection;
        saveConnection(runtimeConnection); config = loadConfig(); activateConnection(runtimeConnection);
        return currentModel ?? 'No model connected — use /connect';
      },
      onClear: () => {
        commandQueue.clear();
        conversationHistory = []; lastQuestion = ''; lastAnswer = ''; lastThoughtTime = 0; lastOutputTokenRate = undefined; lastTokenUsage = undefined;
        activeSession.messages = [];
        sessionStore.save(activeSession);
      },
      onQueue: async (command, drawFrame) => {
        const rawArgs = command.slice('/queue'.length).trim();
        if (!rawArgs || rawArgs === 'list' || rawArgs === 'status') {
          if (commandQueue.length === 0) {
            await drawFrame(renderBoxLines('Command Queue', [
              'The command queue is currently empty.',
              '',
              'To queue follow-up commands, use:',
              '  /queue <command>       Queue a command from the prompt',
              '  (or type during active generation and press Enter)',
              '',
              'Press Esc or Enter to return.',
            ], 72));
          } else {
            const items = commandQueue.items.map((item, idx) => `${idx + 1}. ${item}`);
            await drawFrame(renderBoxLines('Queued Commands', [
              ...items,
              '',
              'Commands will execute automatically in sequence.',
              'Use /queue clear to empty the queue.',
              '',
              'Press Esc or Enter to return.',
            ], 72));
          }
          return;
        }
        if (rawArgs === 'clear') {
          commandQueue.clear();
          return;
        }
        const task = rawArgs.startsWith('add ') ? rawArgs.slice(4).trim() : rawArgs;
        if (task) {
          commandQueue.push(task);
        }
      },
      onBtw: async (command, drawFrame, btwSignal) => {
        await executeBtwQuery(command, drawFrame, provider, currentModel, btwHistory, signal, btwSignal);
      },
      onMcp: async (command, drawFrame) => {
        await handleMcpCommand(command, drawFrame, { reloadMcpTools, signal });
      },
      onWorkflow: async (command, drawFrame) => {
        const action = command.slice('/workflow'.length).trim();
        if (!action) {
          const selected = await selectListPopup('Coding Workflow', [
            { label: 'Git status', value: 'git', description: 'Inspect the current branch and changed files.' },
            { label: 'Review diff', value: 'diff', description: 'Inspect uncommitted changes safely.' },
            { label: 'Build plan', value: 'build', description: 'Confirm and execute the active plan.' },
            { label: 'Undo latest agent change', value: 'undo', description: 'Restore the latest checkpoint when safe.' },
          ], { drawFrame, signal });
          command = `/workflow ${selected ?? ''}`;
        }
        if (command === '/workflow git') {
          const summary = await inspectGitWorkspace(canonicalWorkspace);
          drawFrame(renderBoxLines('Git workspace', summary.isRepository ? [
            `Branch: ${summary.branch ?? 'detached'}`,
            ...summary.files.map((file) => `${file.status}  ${file.path}`),
            '', 'Press Esc or Enter to return.',
          ] : ['This workspace is not a Git repository.', '', 'Press Esc or Enter to return.'], 72));
          return undefined;
        }
        if (command === '/workflow diff') {
          drawFrame(renderBoxLines('Git diff', (await readGitDiff(canonicalWorkspace)).split('\n').slice(0, 24), 76));
          return undefined;
        }
        if (command === '/workflow build') {
          if (!activePlan) {
            drawFrame(renderBoxLines('Build plan', ['Create a plan first in Plan mode.', '', 'Press Esc or Enter to return.'], 72));
            return undefined;
          }
          const confirmed = await selectConfirmPopup('Build plan', ['Send the active plan to the agent in Build mode?', '', 'The agent will still ask approval before each mutation.'], { drawFrame, signal });
          return confirmed ? 'build' : undefined;
        }
        if (command === '/workflow undo') {
          const request: ApprovalRequest = { requestId: `workflow_undo_${Date.now()}`, toolName: 'undo latest agent change', actionSummary: 'Restore the latest completed agent checkpoint.', exactPayload: { cwd: canonicalWorkspace }, timestamp: Date.now() };
          const decision = await terminalApproval.requestApproval(request, signal);
          if (decision.status !== 'approved') {
            drawFrame(renderBoxLines('Undo latest change', ['Undo was not approved.', '', 'Press Esc or Enter to return.'], 72));
            return undefined;
          }
          const restored = checkpoints.restoreLatest(canonicalWorkspace);
          drawFrame(renderBoxLines('Undo latest change', restored.conflicts.length ? ['No files changed because the workspace changed since the checkpoint:', ...restored.conflicts] : restored.restored.length ? ['Restored:', ...restored.restored] : ['No completed agent checkpoint is available.'], 72));
          return undefined;
        }
        drawFrame(renderBoxLines('Coding Workflow', ['Choose Git status, Review diff, Build plan, or Undo latest agent change.', '', 'Press Esc or Enter to return.'], 72));
        return undefined;
      },
      onInit: async (drawFrame) => {
        await initWorkspace(canonicalWorkspace, drawFrame, { approval: terminalApproval, signal });
      },
      onMentionComplete: async (token: string) => {
        return listFiles(canonicalWorkspace, token, { recursive: true, maxDepth: 4, limit: 50 });
      },
      onSession: async (command, drawFrame) => {
        let action = command.slice('/session'.length).trim();
        if (!action) {
          const sessionActions = [
            { label: 'New session', value: 'new', description: 'Start with an empty conversation.' },
            { label: 'List or resume', value: 'resume', description: 'Load a saved session for this workspace.' },
            ...(hasInterruptedTurn(activeSession.messages) ? [{ label: 'Continue interrupted task', value: 'continue', description: 'Continue the last stopped task with the current model.' }] : []),
            { label: 'Export transcript', value: 'export', description: 'Write a redacted Markdown transcript in this workspace.' },
            { label: 'Undo latest agent change', value: 'undo', description: 'Restore the last checkpoint when safe.' },
            { label: 'Redo latest agent change', value: 'redo', description: 'Reapply the last safely undone checkpoint.' },
            { label: 'Share transcript', value: 'share', description: 'Choose an explicit workspace output path.' },
            { label: 'Compact history', value: 'compact', description: 'Reduce older messages without calling a model.' },
          ];
          action = (await selectListPopup('Session', sessionActions, { drawFrame, signal })) ?? '';
        }
        if (action === 'new') {
          activeSession = createSession(canonicalWorkspace, { providerId: activeConnection?.id, providerName: activeConnection?.displayName, modelId: currentModel, mode: activeMode });
          conversationHistory = []; sessionTokens = 0; lastQuestion = ''; lastAnswer = ''; lastThoughtTime = 0; lastOutputTokenRate = undefined; lastTokenUsage = undefined;
          sessionStore.save(activeSession);
          return;
        }
        if (action === 'continue') {
          if (!hasInterruptedTurn(activeSession.messages)) {
            drawFrame(renderBoxLines('Continue task', ['There is no interrupted task in this session.', '', 'Press Esc or Enter to return.'], 64));
            return;
          }
          autoContinueRequested = true;
          return;
        }
        if (action === 'list' || action === 'resume') {
          const sessions = sessionStore.listSessions(canonicalWorkspace);
          const id = await selectListPopup('Saved sessions', sessions.map((entry) => ({
            label: entry.updatedAt.slice(0, 16).replace('T', ' ') + '  ' + (entry.modelId ?? 'No model'),
            value: entry.id,
            description: entry.messages.find((message) => message.role === 'user')?.content?.slice(0, 100) ?? 'Empty session',
          })), { drawFrame, signal, filterable: true });
          const loaded = sessions.find((entry) => entry.id === id);
          if (loaded) {
            activeSession = loaded; conversationHistory = [...loaded.messages]; sessionTokens = loaded.usage.totalTokens;
            currentModel = loaded.providerId === activeConnection?.id ? loaded.modelId ?? currentModel : currentModel;
            activeMode = loaded.mode;
            const restored = restoreLastSessionTurn(conversationHistory);
            lastQuestion = restored.question;
            lastAnswer = restored.answer;
            lastTurnDone = conversationHistory.length > 0 && !hasInterruptedTurn(conversationHistory);
            lastAnswerReplayable = lastTurnDone;
          }
          return;
        }
        if (action === 'compact') {
          const compacted = compactSessionMessages(conversationHistory);
          activeSession.messages = compacted; conversationHistory = compacted; sessionStore.save(activeSession);
          drawFrame(renderBoxLines('Session compacted', ['Older conversation history was reduced.', '', 'Press Esc or Enter to return.'], 64));
          return;
        }
        if (action === 'export') {
          const output = path.join(canonicalWorkspace, 'moderado-session.md');
          fs.writeFileSync(output, exportSessionMarkdown(activeSession), 'utf8');
          drawFrame(renderBoxLines('Session exported', ['Saved redacted transcript:', output, '', 'Press Esc or Enter to return.'], 70));
          return;
        }
        if (action === 'undo' || action === 'redo') {
          const request: ApprovalRequest = {
            requestId: `session_${action}_${Date.now()}`,
            toolName: `${action} latest agent change`,
            actionSummary: action === 'undo' ? 'Restore the latest completed agent checkpoint.' : 'Reapply the latest safely undone agent checkpoint.',
            exactPayload: { cwd: canonicalWorkspace },
            timestamp: Date.now(),
          };
          const decision = await terminalApproval.requestApproval(request, signal);
          if (decision.status !== 'approved') {
            drawFrame(renderBoxLines(`${action === 'undo' ? 'Undo' : 'Redo'} latest change`, [`${action === 'undo' ? 'Undo' : 'Redo'} was not approved.`, '', 'Press Esc or Enter to return.'], 72));
            return;
          }
          const restored = action === 'undo' ? checkpoints.undoLatest(canonicalWorkspace) : checkpoints.redoLatest(canonicalWorkspace);
          const title = `${action === 'undo' ? 'Undo' : 'Redo'} latest change`;
          const none = action === 'undo' ? 'No completed agent checkpoint is available.' : 'No safely undone agent checkpoint is available.';
          drawFrame(renderBoxLines(title, restored.conflicts.length ? ['No files changed because the workspace changed since the checkpoint:', ...restored.conflicts] : restored.restored.length ? ['Restored:', ...restored.restored] : [none], 72));
          return;
        }
        if (action === 'share' || action.startsWith('share ')) {
          const sharePath = action === 'share' ? await askModalChoice('Session share destination: ', { signal }) : action.slice('share'.length).trim();
          if (!sharePath || sharePath === 'q') return;
          let output: string;
          try {
            output = resolveSessionSharePath(canonicalWorkspace, sharePath);
          } catch (error) {
            drawFrame(renderBoxLines('Share session', [error instanceof Error ? error.message : 'Invalid output path.', '', 'Press Esc or Enter to return.'], 72));
            return;
          }
          const request: ApprovalRequest = {
            requestId: `session_share_${Date.now()}`,
            toolName: 'share session transcript',
            actionSummary: `Write the redacted session transcript to ${output}.`,
            exactPayload: { targetFile: output },
            timestamp: Date.now(),
          };
          const decision = await terminalApproval.requestApproval(request, signal);
          if (decision.status !== 'approved') {
            drawFrame(renderBoxLines('Share session', ['Share was not approved.', '', 'Press Esc or Enter to return.'], 72));
            return;
          }
          const relativePath = path.relative(canonicalWorkspace, output);
          const write = await WriteFileTool.execute({ path: relativePath, content: exportSessionMarkdown(activeSession) }, { workspaceRoot: canonicalWorkspace });
          if (write.status !== 'success') {
            drawFrame(renderBoxLines('Share session', [write.output, '', 'Press Esc or Enter to return.'], 72));
            return;
          }
          drawFrame(renderBoxLines('Session shared', ['Saved redacted transcript:', output, '', 'Press Esc or Enter to return.'], 72));
        }
      },
    });
      activeMode = turn.mode; activeAutoApprove = turn.autoApprove;
      trimmed = turn.workflowAction === 'build' && activePlan ? `Implement this approved plan:\n${activePlan}` : turn.text.trim();
      isFirst = false;
    }
    if (!trimmed) {
      if (commandQueue.length > 0) {
        trimmed = commandQueue.shift()!;
      } else {
        continue;
      }
    }
    if (trimmed === '/budget' || trimmed.startsWith('/budget ')) {
      const budget = parseBudgetCommand(trimmed, tokenBudget);
      tokenBudget = budget.limit;
      lastQuestion = trimmed;
      lastAnswer = budget.message;
      lastThoughtTime = 0.001;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      paintStaticChatFrame();
      continue;
    }
    if (trimmed === '/map') {
      lastQuestion = trimmed;
      lastAnswer = await buildWorkspaceMap(canonicalWorkspace);
      lastThoughtTime = 0.001;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      paintStaticChatFrame();
      continue;
    }
    if (trimmed.startsWith('/queue')) {
      const args = trimmed.slice('/queue'.length).trim();
      lastQuestion = trimmed;
      lastThoughtTime = 0.001;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      if (!args || args === 'list') {
        lastAnswer = commandQueue.length === 0
          ? 'Command queue is empty. Use `/queue <command>` to add commands.'
          : `Queued commands (${commandQueue.length}):\n` + commandQueue.items.map((it, i) => `${i + 1}. ${it}`).join('\n');
      } else if (args === 'clear') {
        commandQueue.clear();
        lastAnswer = 'Command queue cleared.';
      } else {
        const task = args.startsWith('add ') ? args.slice(4).trim() : args;
        if (task) {
          commandQueue.push(task);
          lastAnswer = `Added to queue (${commandQueue.length}): "${task}". Commands execute sequentially.`;
        } else {
          lastAnswer = 'Usage: `/queue <command>` or `/queue list` or `/queue clear`.';
        }
      }
      paintStaticChatFrame();
      continue;
    }
    if (trimmed === '/clear') {
      commandQueue.clear();
      conversationHistory = []; lastQuestion = ''; lastAnswer = ''; lastThoughtTime = 0; lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      activeSession.messages = [];
      sessionStore.save(activeSession);
      continue;
    }
    if (isBareExitCommand(trimmed)) {
      lastQuestion = trimmed;
      lastAnswer = 'To leave Moderado, type /exit.';
      lastThoughtTime = 0;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      continue;
    }

    // Non-standard or misspelled slash command rejection with advice
    const slashAdvice = findSlashCommandAdvice(trimmed);
    if (slashAdvice.isSlashCommand && !slashAdvice.isValid) {
      lastQuestion = trimmed;
      lastAnswer = slashAdvice.advice!;
      lastThoughtTime = 0.001;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      paintStaticChatFrame();
      continue;
    }

    if (trimmed === '/skills' || trimmed.startsWith('/skills ')) {
      const parts = trimmed.split(/\s+/);
      discoveredSkills = discoverSkills();
      enabledSkillNames = getEnabledSkillNames();
      if ((parts[1] === 'on' || parts[1] === 'off') && parts[2]) {
        try {
          enabledSkillNames = setSkillEnabled(parts[2], parts[1] === 'on');
          lastAnswer = `User skill${parts[2].includes('*') ? 's matching' : ''} ${parts[2]} ${parts[1] === 'on' ? 'enabled' : 'disabled'}.\n\n${formatSkillsList(discoveredSkills, true, undefined, enabledSkillNames)}`;
        } catch (error) { lastAnswer = error instanceof Error ? error.message : String(error); }
      } else if (parts[1] === 'on' || parts[1] === 'off') {
        lastAnswer = `Usage: /skills ${parts[1]} NAME|PATTERN (* matches all user skills)`;
      } else if (parts[1]) {
        const skill = discoveredSkills.find((item) => item.name === parts[1]);
        lastAnswer = skill
          ? `**${skill.name}**\n${skill.description}\nSource: ${skill.path}\nStatus: ${skill.path.startsWith('builtin:') || enabledSkillNames.includes(skill.name) ? 'on' : 'off'}${skill.path.startsWith('builtin:') ? '' : `\n\nUse /skills on ${skill.name} to enable this user skill.`}`
          : `Unknown skill: ${parts[1]}. Use /skills to list installed skills.`;
      } else lastAnswer = formatSkillsList(discoveredSkills, true, undefined, enabledSkillNames);
      skills = selectEnabledSkills(discoveredSkills, enabledSkillNames);
      lastQuestion = trimmed;
      lastThoughtTime = 0.001;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      paintStaticChatFrame();
      continue;
    }

    if (trimmed === '/exit' || trimmed === '/quit') {
      return await exitCleanly(exitMessage());
    }

    if (trimmed === '/help') {
      lastQuestion = trimmed;
      lastAnswer = 'Available slash commands:\n' + getHelpCommandLines().map((line) => line.includes(' - ') ? line : `\n${line}`).join('\n');
      lastThoughtTime = 0.001;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      paintStaticChatFrame();
      continue;
    }
    const expandedTurn = await expandMentions(trimmed, createWorkspaceFileSource(canonicalWorkspace));
    const effectivePrompt = expandedTurn.text;

    // 1. Instant local meta queries (model/provider status)
    const localMetaAnswer = resolveLocalMetaQuery(trimmed, {
      currentModel,
      providerName: activeConnection?.displayName,
      activeMode,
      workspace: canonicalWorkspace,
      version,
      sessionTokens: Math.round(sessionTokens),
      sessionCost: costLabel(),
    });
    if (localMetaAnswer) {
      lastQuestion = trimmed;
      lastAnswer = localMetaAnswer;
      lastThoughtTime = 0.001;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      conversationHistory = [...conversationHistory, { role: 'user', content: trimmed }, { role: 'assistant', content: localMetaAnswer }];
      activeSession.messages = conversationHistory;
      sessionStore.save(activeSession);
      paintStaticChatFrame();
      continue;
    }

    // 2. Consecutive repeated question cache: instant replay without redundant network round-trip.
    // Only a genuine answer may be replayed — see `lastAnswerReplayable`.
    if (lastAnswerReplayable && lastQuestion && trimmed.toLowerCase() === lastQuestion.toLowerCase() && lastAnswer && lastAnswer.trim().length > 0) {
      lastQuestion = trimmed;
      lastThoughtTime = 0.001;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      conversationHistory = [...conversationHistory, { role: 'user', content: trimmed }, { role: 'assistant', content: lastAnswer }];
      activeSession.messages = conversationHistory;
      sessionStore.save(activeSession);
      paintStaticChatFrame();
      continue;
    }

    // Current-information lane: gather live evidence before inference so the model answers in one turn.
    let liveSearch: ToolResult | undefined;
    const liveSearchTool = tools.get('web_search');
    if (shouldFastRouteWebSearch(trimmed) && liveSearchTool) {
      const searchStartedAt = Date.now();
      if (!provider && activeSession.usage.totalTokens === 0) {
        activeSession.usage.costKnown = true;
        activeSession.usage.costUsd = 0;
      }
      lastQuestion = trimmed;
      lastAnswer = 'Searching the web...';
      lastThoughtTime = 0;
      lastOutputTokenRate = undefined; lastTokenUsage = undefined;
      paintStaticChatFrame({ model: currentModel ?? 'Web search' });

      const searchResult = await liveSearchTool.execute(
        { query: trimmed, maxResults: 5 },
        { workspaceRoot: canonicalWorkspace, abortSignal: signal },
      );

      if (provider) {
        liveSearch = searchResult;
      } else {
        lastAnswer = formatDirectWebSearchAnswer(searchResult);
        lastThoughtTime = Math.max(0.001, (Date.now() - searchStartedAt) / 1000);
        conversationHistory = [...conversationHistory, { role: 'user', content: effectivePrompt }, { role: 'assistant', content: lastAnswer }];
        activeSession.messages = conversationHistory;
        activeSession.providerId = activeConnection?.id;
        activeSession.providerName = activeConnection?.displayName;
        activeSession.modelId = currentModel;
        activeSession.mode = activeMode;
        sessionStore.save(activeSession);
        paintStaticChatFrame({ model: currentModel ?? 'Web search' });
        continue;
      }
    }

    if (!provider) {
      process.stdout.write('\nNo model is connected. Use /connect to choose a provider.\n');
      const connection = await connectProviderInteractive({
        signal,
        drawFrame: (popupLines) => {
          process.stdout.write('\x1b[H\x1b[J');
          process.stdout.write(renderWelcomePopupLayer({
            provider: getProviderStatusName(activeConnection), model: currentModel ?? 'No model connected — use /connect',
            tokens: Math.round(sessionTokens), cost: costLabel(), workspace: canonicalWorkspace,
            mode: activeMode, autoApprove: activeAutoApprove,
            chatQuestion: lastQuestion, chatAnswer: lastAnswer,
          }, popupLines, process.stdout.columns, process.stdout.rows));
        },
        gatewayUrl: config.connections?.moderado?.baseUrl,
        activeConnection,
        savedConnections: config.connections,
        connectProviders: config.connectProviders,
        resolveSavedConnection: (saved) => resolveConnectionCredential(saved, credentialStore),
      });
      if (!connection) { process.stdout.write('No provider connected. Use /connect whenever you are ready.\n\n'); continue; }
      const runtimeConnection = requiresCredentialReference(connection) ? await storeConnectionCredential(connection, credentialStore) : connection;
      saveConnection(runtimeConnection); config = loadConfig(); activateConnection(runtimeConnection);
    }

    const isReview = trimmed === '/review';
    const reviewFiles = isReview ? (await inspectGitWorkspace(canonicalWorkspace)).files.map(file => `${file.status} ${file.path}`) : [];
    const policy = new PolicyManager({ maxSteps: args.maxSteps, readOnly: isReview || activeMode === 'Plan' || args.readOnly, nonInteractive: args.nonInteractive, timeoutSeconds: args.timeout });
    const startedAt = Date.now();
    let thinkingTimer: ReturnType<typeof setInterval> | undefined;
    let removeGenerationListener: (() => void) | undefined;
    let turnUsage: UsageEvent | undefined;
    let usageRecorded = false;
    lastTokenUsage = undefined;
    const recordTurnUsage = (pricing?: Record<string, string>): void => {
      if (!turnUsage || usageRecorded) return;
      activeSession.usage = accumulateSessionUsage(activeSession.usage, turnUsage.usage, turnUsage.estimated, pricing);
      sessionTokens = activeSession.usage.totalTokens;
      usageRecorded = true;
    };
    let streamedAnswer = '';
    const recorder = new TurnRecorder(canonicalWorkspace);
    try {
      const requestAbort = new AbortController();
      const requestSignal = signal ? AbortSignal.any([signal, requestAbort.signal]) : requestAbort.signal;
      let lastSessionCheckpointAt = 0;
      const checkpointInterruptedTurn = (): void => {
        activeSession.messages = saveFailedTurnPrompt(conversationHistory, effectivePrompt, streamedAnswer);
        activeSession.providerId = activeConnection?.id;
        activeSession.providerName = activeConnection?.displayName;
        activeSession.modelId = currentModel;
        activeSession.mode = activeMode;
        sessionStore.save(activeSession);
        lastSessionCheckpointAt = Date.now();
      };
      lastAnswer = '';
      lastAnswerReplayable = false;
      lastTurnDone = false;
      // A new turn starts at the tail: the reader asked a question, so the
      // newest rows are what they want, wherever they left the last one.
      answerOffset = 0;
      let activityLabel: string | undefined;
      let activityFrame = 0;
      /** Last event of any kind, so the row can admit a long silent wait. */
      let lastEventAt = Date.now();
      let turnActive = true;
      let outputTokenRate: number | undefined;
      let budgetWarningIssued = false;
      let budgetStopped = false;
      let lastUsagePaint = 0;
      const usedModels = new Set<string>();
      // Row geometry for this turn: fixed between the status row and the
      // composer, so streamed output is windowed instead of overwriting the
      // input card and its mode/workspace rows. The composer height is measured
      // from the live card, so a queued-commands box cannot hide the tail of the
      // answer or push the frame past the bottom of the viewport.
      const turnLayout = () => layoutFor(chatFrameOptions({ chatQuestion: trimmed }));
      let layout = turnLayout();
      let lastAnswerPaint = 0;
      const paintAnswer = (force = false): void => {
        const now = Date.now();
        if (!force && now - lastAnswerPaint < 40) return;
        lastAnswerPaint = now;
        if (!streamedAnswer) return;
        process.stdout.write(renderChatTranscriptWindow(currentActivity, streamedAnswer, layout, answerOffset, getPriorChatTurns(conversationHistory, trimmed, ''), trimmed));
      };
      let lastErrorEvent: { code?: string; message: string } | undefined;
      /** Tail of the model's reasoning, shown as one dim line while it thinks. */
      let reasoningTail = '';
      let lastReasoningPaint = 0;
      /** Silence clock shown while the model has produced nothing. */
      let waitElapsedLabel: string | undefined;
      /** Tool log for the live activity log: oldest first, bounded. */
      const activityHistory: ActivityEntry[] = [];
      // Keep a live spinner on the status row for the whole turn: streaming
      // text and silent tool execution both leave the screen looking settled.
      const stopActivity = (): void => {
        if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = undefined; }
      };
      /**
       * Paint the pinned phase header and the transcript under it.
       *
       * The header is one row; everything below it is the activity log followed
       * by the answer, in one scrollable window. The block used to be a separate
       * *six-row* region that handed its rows back the moment text streamed, so a
       * long answer left a single clipped status row on screen. Merging the two
       * is what keeps the log readable for the whole turn.
       */
      const paintActivity = (glyph: string, label: string): void => {
        // The reasoning tail belongs to the thinking phases, including the long
        // wait that follows them — that is when it is most useful.
        const thinking = label === 'Thinking' || label === 'Waiting on the model';
        const elapsedLabel = label === 'Waiting on the model' ? waitElapsedLabel : undefined;
        const thoughtTime = (Date.now() - startedAt) / 1000;
        currentActivity = {
          glyph,
          label,
          reasoning: thinking ? reasoningTail : undefined,
          elapsedLabel,
          history: activityHistory,
        };
        process.stdout.write(renderChatTranscriptHeader(currentActivity, layout, thoughtTime));
        process.stdout.write(renderChatTranscriptWindow(currentActivity, streamedAnswer, layout, answerOffset, getPriorChatTurns(conversationHistory, trimmed, ''), trimmed));
      };
      const startActivity = (): void => {
        stopActivity();
        if (!turnActive) return;
        activityLabel = undefined;
        thinkingTimer = setInterval(() => {
          // A single inference can run for minutes with no event of any kind.
          // After ten silent seconds the row says it is waiting, and refreshes
          // every twenty seconds so the wait never looks like a hang.
          if (activityLabel === 'Thinking' || activityLabel === 'Waiting on the model') {
            const notice = describeWait(Date.now() - lastEventAt);
            if (notice) {
              activityLabel = notice.label;
              waitElapsedLabel = notice.elapsedLabel;
            }
          }
          paintActivity(ACTIVITY_SPINNER_FRAMES[activityFrame++ % ACTIVITY_SPINNER_FRAMES.length], activityLabel ?? 'Working');
        }, 200);
      };
      /** The frame as it is painted right now — also the approval backdrop. */
      const currentFrameOptions = () => chatFrameOptions({
        tokens: Math.round(sessionTokens + (usageRecorded ? 0 : turnUsage?.usage.totalTokens ?? 0)),
        chatQuestion: trimmed,
        chatAnswer: streamedAnswer || lastAnswer,
        chatHistory: getPriorChatTurns(conversationHistory, trimmed, turnActive ? '' : lastAnswer),
        isTurnSettled: !turnActive,
        // The live activity rides along with the frame, so a full repaint (a
        // resize, a keystroke in the composer) shows the same transcript the
        // incremental paints do instead of an empty answer area.
        chatActivity: turnActive ? currentActivity : undefined,
        chatThoughtTime: Math.max(0.001, (Date.now() - startedAt) / 1000),
        chatTaskDone: lastTurnDone,
        outputTokenRate,
        tokenUsage: turnUsage,
        budgetStatus: budgetStopped ? 'Budget reached' : budgetWarningIssued ? 'Budget ≥80%' : undefined,
      });
      const redrawChatFrame = (): void => {
        const options = currentFrameOptions();
        layout = layoutFor(options);
        process.stdout.write('\x1b[H\x1b[J');
        process.stdout.write(renderFullWelcomeScreen(options, process.stdout.rows));
        process.stdout.write(renderChatComposerCursor({ width: process.stdout.columns }, commandQueue.currentDraft, layout.composerTop));
        // The frame paints a static status; keep the live row authoritative while the turn runs.
        if (thinkingTimer) paintActivity(ACTIVITY_SPINNER_FRAMES[activityFrame++ % ACTIVITY_SPINNER_FRAMES.length], activityLabel ?? 'Working');
      };

      let generationEscapes = 0;
      const onGenerationKeypress = (str: string, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean } | undefined): void => {
        // Raw mode turns Ctrl+C into a keypress, not SIGINT, so the session-level
        // handler never sees it. The first press aborts the turn; a second press
        // means the abort did not take (a stalled stream or a hung tool), so
        // leave instead of freezing with no way out.
        const isCtrlC = (key?.ctrl && key.name === 'c') || str === '\x03';
        if (isCtrlC) {
          generationEscapes += 1;
          if (generationEscapes > 1) {
            void forceExit(130);
            return;
          }
        }
        handleGenerationKeypress(str, key, commandQueue, {
          abort: () => {
            commandQueue.clear();
            requestAbort.abort();
          },
          onDraftChange: () => {
            redrawChatFrame();
          },
          onQueueAdd: () => {
            redrawChatFrame();
          },
          onBtw: async (command) => {
            const resume = suspendGenerationInput?.();
            stopActivity();
            const ac = new AbortController();
            let btwEscapes = 0;
            const onBtwKey = (s: string, k: any) => {
              const isCtrlC = (k && k.ctrl && k.name === 'c') || s === '\x03';
              if ((k && k.name === 'escape') || s === '\x1b' || isCtrlC) {
                // Escape/Ctrl+C stops the /btw query; a second Ctrl+C means the
                // query ignores the abort, so leave instead of freezing.
                if (isCtrlC && ++btwEscapes > 1) {
                  void forceExit(130);
                  return;
                }
                ac.abort();
              }
            };
            process.stdin.on('keypress', onBtwKey);

            try {
              await executeBtwQuery(
                command,
                async (popupLines, frameOpts) => {
                  process.stdout.write('\x1b[H\x1b[J');
                  process.stdout.write(renderWelcomePopupLayer({
                    provider: getProviderStatusName(activeConnection), model: currentModel ?? 'No model connected',
                    tokens: Math.round(sessionTokens),
                    cost: costLabel(),
                    usageAvailable: activeSession.usage.available, usageEstimated: activeSession.usage.estimated,
                    workspace: canonicalWorkspace,
                    mode: activeMode,
                    autoApprove: activeAutoApprove,
                    chatQuestion: trimmed,
                    chatAnswer: streamedAnswer || lastAnswer,
                    chatThoughtTime: Math.max(0.001, (Date.now() - startedAt) / 1000),
                    isTurnSettled: false,
                    queuedCommands: commandQueue.items,
                  }, popupLines, process.stdout.columns, process.stdout.rows));

                  if (frameOpts?.waitDismiss !== false && !ac.signal.aborted) {
                    await new Promise<void>((dismissResolve) => {
                      const onDismiss = (s: string, k: any) => {
                        if (
                          (k && (k.name === 'escape' || k.name === 'return' || k.name === 'enter')) ||
                          s === 'q' || s === 'Q' || s === '\x1b' ||
                          (k && k.ctrl && k.name === 'c')
                        ) {
                          process.stdin.removeListener('keypress', onDismiss);
                          dismissResolve();
                        }
                      };
                      process.stdin.on('keypress', onDismiss);
                    });
                  }
                },
                provider,
                currentModel,
                btwHistory,
                signal,
                ac.signal
              );
            } finally {
              process.stdin.removeListener('keypress', onBtwKey);
              startActivity();
              redrawChatFrame();
              resume?.();
            }
          },
        });
      };
      if (process.stdin.isTTY) {
        const onGenerationResize = (): void => redrawChatFrame();
        process.stdout.on('resize', onGenerationResize);
        const attachGenerationListener = (): void => {
          readline.emitKeypressEvents(process.stdin);
          process.stdin.resume();
          process.stdin.setRawMode(true);
          process.stdin.on('keypress', onGenerationKeypress);
        };
        attachGenerationListener();
        suspendGenerationInput = () => {
          process.stdin.removeListener('keypress', onGenerationKeypress);
          try { process.stdin.setRawMode(false); process.stdin.pause(); } catch { /* ignore */ }
          return () => { if (!requestSignal.aborted) attachGenerationListener(); };
        };
        removeGenerationListener = () => {
          process.stdin.removeListener('keypress', onGenerationKeypress);
          process.stdout.removeListener('resize', onGenerationResize);
          suspendGenerationInput = undefined;
        };
      }

      // Move to the chat layout before the provider can emit its first event.
      redrawChatFrame();
      startActivity();
      const evidenceTask = liveSearch ? buildSearchAnswerTask(effectivePrompt, liveSearch) : undefined;
      const runAgent = () => loop.run(isReview ? createReviewTask(reviewFiles) : evidenceTask ?? createAgentTask(effectivePrompt, activeMode), {
        workspaceRoot: canonicalWorkspace, provider: provider!, tools: isReview ? createReviewToolRegistry() : tools, approvalHandler, router, policy,
        maxOutputTokens: args.maxTokens ?? config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        skillContext: skillContext(effectivePrompt), skills,
        routeOptions: { pinnedModelId: currentModel === 'auto' ? undefined : currentModel, allowPaid: config.allowPaid ?? args.allowPaid, allowUnknown: config.allowUnknown ?? args.allowUnknown, isLocalProfile: args.profile.includes('local') },
        eventListener: (event) => {
          recorder.record(event);
          lastEventAt = Date.now();
          // A real event ends the silent wait, so its clock goes away.
          waitElapsedLabel = undefined;
          if (event.type === 'model_change') usedModels.add(event.newModelId);
          if (event.type === 'progress') {
            activityLabel = describeActivity(event.status);
            paintActivity(ACTIVITY_SPINNER_FRAMES[activityFrame++ % ACTIVITY_SPINNER_FRAMES.length], activityLabel);
          }
          if (event.type === 'tool_call_initiated') {
            // Name the target, not the tool: `Reading src/ui/welcome.ts` tells the
            // person what is happening, `Running read_file` does not.
            activityLabel = describeToolActivity(event.toolName, event.parameters);
            activityHistory.push({ glyph: '⠼', label: activityLabel, tone: 'active' });
            // Bounded: a long turn can call dozens of tools, and only the tail is
            // ever on screen.
            if (activityHistory.length > 20) activityHistory.splice(0, activityHistory.length - 20);
            paintActivity(ACTIVITY_SPINNER_FRAMES[activityFrame++ % ACTIVITY_SPINNER_FRAMES.length], activityLabel);
          }
          if (event.type === 'tool_result') {
            // Settle the entry that is still running, so the log reads as a
            // record of what happened rather than a list of intentions.
            const settled = [...activityHistory].reverse().find((entry) => entry.tone === 'active');
            if (settled) {
              const status = event.result.status;
              settled.tone = status === 'success' ? 'done' : 'failed';
              settled.glyph = status === 'success' ? '✔' : status === 'denied' ? '⊘' : '✖';
            }
            if (!thinkingTimer) startActivity();
            // `startActivity` clears the label; a result means the agent is about
            // to read it and decide the next move.
            activityLabel = 'Reviewing';
          }
          // The approval prompt owns the screen until the tool result arrives.
          if (event.type === 'approval_request') stopActivity();
          // The prompt is written straight to stdout, so without a repaint it
          // stays on top of the chat frame — which is what made a large diff look
          // like content spilling out of the workspace.
          if (event.type === 'approval_resolved') redrawChatFrame();
          if (event.type === 'gateway_status') process.stdout.write(renderGatewayFallbackUpdate(event, process.stdout.columns || 80));
          if (event.type === 'usage') {
            turnUsage = event;
            lastTokenUsage = event;
            outputTokenRate = event.generationMs > 0 ? event.outputTokensPerSecond : undefined;
            const budgetState = evaluateTokenBudget(event.usage.totalTokens, tokenBudget);
            const firstBudgetWarning = budgetState === 'warning' && !budgetWarningIssued;
            if (budgetState === 'warning') budgetWarningIssued = true;
            if (budgetState === 'stop' && !budgetStopped) {
              budgetStopped = true;
              requestAbort.abort();
            }
            if (budgetStopped || firstBudgetWarning || event.final || event.timestamp - lastUsagePaint >= 400) {
              process.stdout.write(renderChatUsageUpdate(event, process.stdout.columns || 80, budgetStopped ? 'Budget reached' : budgetWarningIssued ? 'Budget ≥80%' : undefined, `${Math.round(sessionTokens + event.usage.totalTokens)} tokens / ${costLabel()}`, process.stdout.rows || 24, activeMode));
              lastUsagePaint = event.timestamp;
            }
          }
          if (event.type === 'reasoning_delta') {
            // Keep a bounded tail: enough to show what the model is working
            // through, without turning the status row into a transcript.
            reasoningTail = (reasoningTail + event.delta).slice(-240);
            activityLabel = 'Thinking';
            const now = Date.now();
            if (now - lastReasoningPaint >= 100) {
              lastReasoningPaint = now;
              paintActivity(ACTIVITY_SPINNER_FRAMES[activityFrame++ % ACTIVITY_SPINNER_FRAMES.length], 'Thinking');
            }
          }
          if (event.type === 'assistant_delta') {
            streamedAnswer += event.delta;
            reasoningTail = '';
            if (activityLabel !== 'Writing') {
              activityLabel = 'Writing';
              paintActivity(ACTIVITY_SPINNER_FRAMES[activityFrame++ % ACTIVITY_SPINNER_FRAMES.length], activityLabel);
            }
            if (Date.now() - lastSessionCheckpointAt >= 1_000) checkpointInterruptedTurn();
            paintAnswer();
          }
          if (event.type === 'error') {
            lastErrorEvent = { code: event.code, message: event.message };
          }
        }, signal: requestSignal, conversationHistory,
        onMutationApproved: (toolName, parameters) => {
          const paths = mutationPaths(toolName, parameters);
          if (paths.length) checkpoints.capture(canonicalWorkspace, paths);
        },
        onMutationCompleted: (toolName, parameters) => {
          const paths = mutationPaths(toolName, parameters);
          if (paths.length) checkpoints.recordPostWrite(canonicalWorkspace, paths);
        },
      });
      /** Prompt for a replacement credential once, persist it, and activate it. Falsy when the user cancels. */
      const recoverAuthenticationFailure = async (): Promise<ProviderConnection | undefined> => {
        if (!activeConnection) return undefined;
        stopActivity();
        const connection = activeConnection;
        const moderadoOAuth = isModeradoOAuthConnection(connection);
        const moderadoWithoutKey = connection.id === 'moderado' && !connection.apiKey;
        process.stdout.write(moderadoWithoutKey
          ? '\nThe Gateway rejected the keyless free defaults. Sign in or enter a Moderado key to retry once.\n'
          : moderadoOAuth
          ? '\nModerado rejected this browser login. Sign in again to retry once.\n'
          : `\nThe saved ${connection.displayName} API key was rejected. Enter a replacement key to retry once.\n`);
        const replacement = moderadoOAuth || moderadoWithoutKey
          ? await loginModeradoInteractive({ signal, gatewayUrl: connection.baseUrl, forceReauthenticate: true })
          : await replaceProviderKeyInteractive(connection, { signal });
        if (!replacement) return undefined;
        recordTurnUsage();
        turnUsage = undefined;
        usageRecorded = false;
        const secured = requiresCredentialReference(replacement) ? await storeConnectionCredential(replacement, credentialStore) : replacement;
        saveConnection(secured); config = loadConfig(); activateConnection(secured);
        startActivity();
        return secured;
      };
      let result;
      // While the turn runs, an approval dialog is composited over the chat
      // frame instead of being appended below it: appending pushed the composer
      // off screen and made the dialog look like it had overflowed the
      // workspace. Outside a turn the handler keeps its inline behaviour.
      terminalApproval.renderLayer = (popupLines) => renderWelcomePopupLayer(
        currentFrameOptions(),
        popupLines,
        process.stdout.columns,
        process.stdout.rows,
      );
      try {
        checkpointInterruptedTurn();
        result = await runAgent();
        // The agent loop reports provider failures as error events and resolves
        // with a failed result instead of throwing, so key re-entry must be
        // offered here too. Retry once; a second failure falls through to the
        // formatted error answer.
        if (turnFailedAuthentication(result.status, lastErrorEvent) && activeConnection && await recoverAuthenticationFailure()) {
          lastErrorEvent = undefined;
          result = await runAgent();
        }
      } catch (error) {
        if (!activeConnection || !isAuthenticationFailure(error)) throw error;
        if (!(await recoverAuthenticationFailure())) throw error;
        result = await runAgent();
      } finally {
        terminalApproval.renderLayer = undefined;
      }
      // The turn is over: replace the spinner with the settled state while
      // usage accounting and catalog refresh finish.
      turnActive = false;
      // Drop the live activity from the frame so the settled "✔ Done" row and
      // the finished transcript are what a repaint shows from here on.
      currentActivity = undefined;
      stopActivity();
      process.stdout.write(renderChatThoughtTimeUpdate(
        (Date.now() - startedAt) / 1000,
        process.stdout.columns,
        {
          glyph: result.status === 'completed' ? '✔' : '✖',
          label: result.status === 'completed' ? 'Done' : result.status === 'cancelled' ? 'Stopped' : 'Failed',
        },
        // Same row the live status used: the settled state replaces it in place
        // instead of landing on row 13 when a wrapped question pushed it down.
        layout.statusRow,
      ));
      if (turnUsage) {
        let pricing: Record<string, string> | undefined;
        const modelIds = new Set([...usedModels, result.selectedModel.id]);
        const freePolicy = freeModelPolicyFor(activeConnection?.id);
        let inventory: Awaited<ReturnType<NvidiaAdapter['discoverModels']>> = [];
        try {
          inventory = await provider!.discoverModels(signal);
        } catch {
          // A valid answer remains usable when the provider catalog is unavailable.
        }
        const allModelsAreFree = [...modelIds].every((modelId) => isFreeModelOption(
          inventory.find((entry) => entry.id === modelId) ?? { id: modelId },
          modelId === result.selectedModel.id
            ? result.selectedModel.classification
            : router.classifyModel(modelId, args.profile.includes('local')),
          freePolicy,
        ));
        if (allModelsAreFree || isKeylessGatewaySession(activeConnection)) pricing = { prompt: '0', completion: '0' };
        else if (!turnUsage.estimated && modelIds.size === 1) pricing = findModelPricing(inventory, result.selectedModel.id);
        recordTurnUsage(pricing);
      }
      recordTurnUsage();
      // Failed/cancelled tasks can still consume tokens, even without a saved answer.
      if (turnUsage) sessionStore.save(activeSession);
      const otherConnections = Object.keys(config.connections ?? {}).filter((id) => id !== activeConnection?.id);
      const resolution = resolveTurnAssistantAnswer(
        result,
        conversationHistory.length,
        lastErrorEvent,
        streamedAnswer,
        currentModel,
        otherConnections
      );
      const searchFallback = result.status === 'failed' && liveSearch?.status === 'success'
        ? formatDirectWebSearchAnswer(liveSearch, true)
        : undefined;
      const hasSearchFallback = searchFallback !== undefined && searchFallback !== 'Web search returned no readable content.';
      // A turn can fail without throwing: the loop reports a status plus an error
      // event, the session stays alive, and nothing reached the diagnostic log —
      // so a provider or Gateway failure left no evidence to report. A cancelled
      // turn is user intent, not a failure, and stays out of the log.
      if (result.status === 'failed' && !hasSearchFallback) {
        writeDiagnosticLog(
          'chat.turn',
          `${lastErrorEvent?.code ? `${lastErrorEvent.code}: ` : ''}${lastErrorEvent?.message ?? 'turn failed without an error event'}`,
        );
      }
      lastAnswer = hasSearchFallback ? searchFallback : resolution.answer;
      // A cancelled, failed, or budget-stopped turn leaves a status note here.
      // Only a completed turn — or a failed one that still produced usable search
      // evidence — may be replayed for a repeated question.
      lastAnswerReplayable = hasSearchFallback || (!resolution.isError && !budgetStopped);
      if (budgetStopped) {
        const note = `Token budget reached (${tokenBudget?.toLocaleString()} per task). Task stopped; usage may exceed the limit because providers report in chunks.`;
        lastAnswer = [lastAnswer, note].filter(Boolean).join('\n\n');
        streamedAnswer = lastAnswer;
      }
      if (resolution.isError && hasSearchFallback) {
        conversationHistory = [...conversationHistory, { role: 'user', content: trimmed }, { role: 'assistant', content: lastAnswer }];
        activeSession.messages = conversationHistory;
        activeSession.providerId = activeConnection?.id;
        activeSession.providerName = activeConnection?.displayName;
        activeSession.modelId = currentModel;
        activeSession.mode = activeMode;
        sessionStore.save(activeSession);
        streamedAnswer = lastAnswer;
      } else if (resolution.isError) {
        conversationHistory = saveFailedTurnPrompt(conversationHistory, effectivePrompt, streamedAnswer);
        activeSession.messages = conversationHistory;
        activeSession.providerId = activeConnection?.id;
        activeSession.providerName = activeConnection?.displayName;
        activeSession.modelId = result.selectedModel.id;
        activeSession.mode = activeMode;
        sessionStore.save(activeSession);
        streamedAnswer = lastAnswer;
      } else {
        conversationHistory = evidenceTask ? replaceEvidenceTurn(result.messages, evidenceTask, trimmed) : result.messages;
        activeSession.messages = conversationHistory;
        activeSession.providerId = activeConnection?.id;
        activeSession.providerName = activeConnection?.displayName;
        activeSession.modelId = result.selectedModel.id;
        activeSession.mode = activeMode;
        sessionStore.save(activeSession);
      }
      if (activeMode === 'Plan') activePlan = lastAnswer;
      // Coding turns end with a deterministic report (what changed, what was
      // verified, what is outstanding, how to run the app) built from the
      // event stream rather than from model prose. It is appended after the
      // plan is captured so a plan never contains its own summary.
      if (recorder.hasWork()) {
        lastAnswer = [lastAnswer, formatTurnSummary(recorder.build(result.status, result.totalSteps), 'chat')]
          .filter((part) => part && part.trim().length > 0)
          .join('\n\n');
      }
      lastTurnDone = result.status === 'completed' && !budgetStopped && !resolution.isError;
      lastQuestion = trimmed;
      lastThoughtTime = Math.max(0.001, (Date.now() - startedAt) / 1000);
      lastOutputTokenRate = outputTokenRate;
      turnActive = false;
      stopActivity();
      removeGenerationListener?.();
      redrawChatFrame();
    } catch (err: any) {
      writeDiagnosticLog('chat.turn', err);
      if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = undefined; }
      removeGenerationListener?.();
      recordTurnUsage();
      if (turnUsage) sessionStore.save(activeSession);
      const otherConnections = Object.keys(config.connections ?? {}).filter((id) => id !== activeConnection?.id);
      const altSuggestion = otherConnections.length > 0
        ? ` (other configured providers: ${otherConnections.join(', ')})`
        : '';
      lastQuestion = trimmed;
      conversationHistory = saveFailedTurnPrompt(conversationHistory, effectivePrompt, streamedAnswer);
      activeSession.messages = conversationHistory;
      activeSession.providerId = activeConnection?.id;
      activeSession.providerName = activeConnection?.displayName;
      activeSession.modelId = currentModel;
      activeSession.mode = activeMode;
      sessionStore.save(activeSession);
      const rawErr = err?.message || 'Inference error';
      const cleanErr = rawErr
        .replace(/^(?:NVIDIA NIM|OpenAI|OpenRouter|[a-zA-Z0-9_-]+)\s*(?:request failed|rate limit exceeded|service or model unavailable)?\s*(?:\([^)]*\))?\s*(?:during\s*streamChat)?:\s*/i, '')
        .trim();
      lastAnswer = `⚠️ **Error:** ${cleanErr || rawErr}\n\n👉 **Suggestion:** Switch models with \`/model\` or choose a provider with \`/connect\`${altSuggestion}.`;
      if (recorder.hasWork()) {
        lastAnswer = `${lastAnswer}\n\n${formatTurnSummary(recorder.build('failed', 0), 'chat')}`;
      }
      lastThoughtTime = Math.max(0.001, (Date.now() - startedAt) / 1000);
      lastOutputTokenRate = undefined;
      paintStaticChatFrame({ tokenUsage: turnUsage });
    }
  }
  return 0;
}
