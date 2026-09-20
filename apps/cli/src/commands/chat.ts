import path from 'node:path';
import fs from 'node:fs';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, canonicalizeRoot, createMcpTools, discoverMcpServers, WorkspaceCheckpointStore } from '@moderado/tools';
import { ApprovalDecision, ApprovalRequest, ChatMessage, IApprovalHandler, IToolRegistry, McpServerConfig, McpServerConfigSchema } from '@moderado/contracts';
import { CliParsedArgs } from '../args.js';
import { getActiveConnection, loadConfig, ProviderConnection, removeMcpServer, resolveApiKey, resolveConnectionCredential, saveConnection, saveMcpServer, setMcpServerEnabled, storeConnectionCredential } from '../config.js';
import { CredentialStore, MemoryCredentialStore } from '../credentials.js';
import { WindowsCredentialStore } from '../windows_credentials.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { selectCompatibleModelOverlay, selectModelOverlay, showModelConnectionRequired } from '../ui/model_selector.js';
import { connectProviderInteractive, isAuthenticationFailure, replaceProviderKeyInteractive } from '../ui/provider_connect.js';
import { promptInteractiveTurn, renderChatAnswerDelta, renderChatComposerCursor, renderChatThoughtTimeUpdate, renderFullWelcomeScreen, terminalCleanExitDone } from '../ui/welcome.js';
import { calculateOutputTokenRate, calculateSessionCost, compactSessionMessages, createSession, exportSessionMarkdown, formatSessionCost, SessionStore, StoredSession } from '../sessions.js';
import { layerPromptBox, renderBoxLines, selectConfirmPopup, selectListPopup } from '../ui/popup.js';
import { askModalChoice } from '../ui/prompt.js';
import { findModelPricing } from '../model_pricing.js';
import { inspectGitWorkspace, readGitDiff } from '@moderado/tools';

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

export function isBareExitCommand(input: string): boolean {
  return input.trim().toLowerCase() === 'exit';
}

export function isGenerationCancelKey(key: { name?: string } | undefined): boolean {
  return key?.name === 'escape';
}

export function isNetworkCommand(request: Pick<ApprovalRequest, 'toolName' | 'exactPayload'>): boolean {
  const command = (request.exactPayload as { command?: unknown }).command;
  const text = Array.isArray(command) ? command.join(' ').toLowerCase() : '';
  return request.toolName === 'run_command' && /\b(curl|wget|invoke-webrequest|iwr|irm)\b|https?:\/\//.test(text);
}

export function isNetworkConsentReply(input: string, previousAnswer: string): boolean {
  return /^(y|yes)$/i.test(input.trim()) && /\b(weather|internet|online|look up|web|curl)\b/i.test(previousAnswer);
}

export async function createMcpToolRegistry(servers: Record<string, McpServerConfig> | undefined): Promise<IToolRegistry> {
  return createDefaultToolRegistry(await createMcpTools(servers));
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
      show(title, ['No matching local MCP servers are configured.']);
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

export async function handleChatSession(args: CliParsedArgs, version: string, signal?: AbortSignal): Promise<number> {
  let canonicalWorkspace: string;
  try { canonicalWorkspace = canonicalizeRoot(path.resolve(process.cwd(), args.workspace)); }
  catch (err: any) { process.stderr.write(`\x1b[1;31mWorkspace Error:\x1b[0m ${err.message}\n`); return 1; }

  const credentialStore: CredentialStore = process.platform === 'win32' ? new WindowsCredentialStore() : new MemoryCredentialStore();
  let config = loadConfig();
  let activeConnection = getActiveConnection(config);
  if (activeConnection) activeConnection = await resolveConnectionCredential(activeConnection, credentialStore);
  if (!activeConnection && resolveApiKey()) {
    activeConnection = { id: 'nvidia-nim', displayName: 'NVIDIA NIM', kind: 'nvidia-nim',
      baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: resolveApiKey(), defaultModel: config.defaultModel };
  }
  let currentModel = args.model ?? activeConnection?.defaultModel ?? (activeConnection?.kind === 'nvidia-nim' ? 'auto' : undefined);

  process.stdout.write('\x1b]0;Moderado\x07');
  const restoreTerminal = (): void => {
    if (terminalCleanExitDone) return;
    try { process.stdout.write('\x1b[?25h\x1b[?1049l\x1b[0 q\x1b[0m'); if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* ignore */ }
  };
  process.on('exit', restoreTerminal);

  let provider: NvidiaAdapter | undefined;
  const activateConnection = (connection: ProviderConnection): void => {
    activeConnection = connection;
    currentModel = args.model ?? connection.defaultModel ?? (connection.kind === 'nvidia-nim' ? 'auto' : undefined);
    provider = new NvidiaAdapter({ apiKey: connection.apiKey, baseUrl: connection.baseUrl, providerId: connection.id, providerName: connection.displayName });
  };
  if (activeConnection) activateConnection(activeConnection);

  let activeMode: 'Plan' | 'Execute' = args.readOnly ? 'Plan' : 'Execute';
  let activeAutoApprove = false;
  const sessionStore = new SessionStore();
  let activeSession: StoredSession = sessionStore.loadLatestSession(canonicalWorkspace) ??
    createSession(canonicalWorkspace, {
      providerId: activeConnection?.id,
      providerName: activeConnection?.displayName,
      modelId: currentModel,
      mode: activeMode,
    });
  let sessionTokens = activeSession.usage.totalTokens;
  let isFirst = true;
  if (config.typescriptLanguageServer) process.env.MODERADO_TYPESCRIPT_LANGUAGE_SERVER = config.typescriptLanguageServer;
  let tools = createDefaultToolRegistry();
  const reloadMcpTools = async (): Promise<void> => {
    config = loadConfig();
    tools = await createMcpToolRegistry(config.mcpServers);
  };
  await reloadMcpTools();
  const terminalApproval = new TerminalApprovalHandler();
  const checkpoints = new WorkspaceCheckpointStore();
  let networkAccessApproved = false;
  let suspendGenerationInput: (() => (() => void) | undefined) | undefined;
  const approvalHandler: IApprovalHandler = { requestApproval: async (req: ApprovalRequest, sig?: AbortSignal): Promise<ApprovalDecision> => {
    if (isNetworkCommand(req) && !networkAccessApproved) {
      return { requestId: req.requestId, status: 'denied', reason: 'Network access requires an explicit Yes reply to the model first.' };
    }
    if (activeAutoApprove) return { requestId: req.requestId, status: 'approved' };
    const resumeGenerationInput = suspendGenerationInput?.();
    try { return await terminalApproval.requestApproval(req, sig); }
    finally { resumeGenerationInput?.(); }
  } };
  const router = new Router();
  const loop = new AgentLoop();
  let conversationHistory: ChatMessage[] = [...activeSession.messages];
  let lastQuestion = '';
  let lastAnswer = '';
  let lastThoughtTime = 0;
  let lastOutputTokenRate: number | undefined;
  let activePlan: string | undefined;
  const costLabel = (): string => formatSessionCost(activeSession.usage);

  while (!signal?.aborted) {
    const turn = await promptInteractiveTurn({
      model: currentModel ?? 'No model connected — use /connect', tokens: Math.round(sessionTokens), cost: costLabel(), workspace: canonicalWorkspace, version,
      usageAvailable: activeSession.usage.available, initialMode: activeMode, initialAutoApprove: activeAutoApprove, isFirstTurn: isFirst, signal, chatQuestion: lastQuestion || undefined, chatAnswer: lastAnswer || undefined, chatThoughtTime: lastThoughtTime, outputTokenRate: lastOutputTokenRate,
      questionHistory: conversationHistory.flatMap((message) => message.role === 'user' && message.content?.trim() ? [message.content] : []),
      onModelSelect: async (drawFrame) => {
        if (!activeConnection) {
          await showModelConnectionRequired(drawFrame, signal);
          return undefined;
        }
        if (activeConnection.kind === 'openai-compatible') {
          const modelId = await selectCompatibleModelOverlay({
            apiKey: activeConnection.apiKey,
            baseUrl: activeConnection.baseUrl,
            providerId: activeConnection.id,
            providerName: activeConnection.displayName,
            currentModel,
            allModelsFree: activeConnection.id === 'agnes-ai',
            signal,
            drawFrame,
          });
          if (modelId && modelId !== currentModel) {
            currentModel = modelId;
            activeConnection = { ...activeConnection, defaultModel: modelId };
            saveConnection(activeConnection);
            config = loadConfig();
          }
          return modelId;
        }
        const selection = await selectModelOverlay({ apiKey: activeConnection.apiKey, currentModel, signal, saveSelectionByDefault: true, drawFrame });
        if (selection.modelId) {
          currentModel = selection.modelId;
          activeConnection = { ...activeConnection, defaultModel: selection.modelId };
          saveConnection(activeConnection);
          config = loadConfig();
        }
        return selection.modelId;
      },
      onConnect: async (drawFrame) => {
        const connection = await connectProviderInteractive({ signal, drawFrame, savedConnections: config.connections, resolveSavedConnection: (saved) => resolveConnectionCredential(saved, credentialStore) });
        if (!connection) return currentModel;
        const runtimeConnection = process.platform === 'win32' ? await storeConnectionCredential(connection, credentialStore) : connection;
        saveConnection(runtimeConnection); config = loadConfig(); activateConnection(runtimeConnection);
        return currentModel ?? 'No model connected — use /connect';
      },
      onClear: () => {
        conversationHistory = []; lastQuestion = ''; lastAnswer = ''; lastThoughtTime = 0; lastOutputTokenRate = undefined;
        activeSession.messages = [];
        sessionStore.save(activeSession);
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
      onSession: async (command, drawFrame) => {
        let action = command.slice('/session'.length).trim();
        if (!action) {
          action = (await selectListPopup('Session', [
            { label: 'New session', value: 'new', description: 'Start with an empty conversation.' },
            { label: 'List or resume', value: 'resume', description: 'Load a saved session for this workspace.' },
            { label: 'Export transcript', value: 'export', description: 'Write a redacted Markdown transcript in this workspace.' },
            { label: 'Compact history', value: 'compact', description: 'Reduce older messages without calling a model.' },
          ], { drawFrame, signal })) ?? '';
        }
        if (action === 'new') {
          activeSession = createSession(canonicalWorkspace, { providerId: activeConnection?.id, providerName: activeConnection?.displayName, modelId: currentModel, mode: activeMode });
          conversationHistory = []; sessionTokens = 0; lastQuestion = ''; lastAnswer = ''; lastThoughtTime = 0; lastOutputTokenRate = undefined;
          sessionStore.save(activeSession);
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
            currentModel = loaded.modelId ?? currentModel; activeMode = loaded.mode;
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
        }
      },
    });
    activeMode = turn.mode; activeAutoApprove = turn.autoApprove;
    const trimmed = turn.workflowAction === 'build' && activePlan ? `Implement this approved plan:\n${activePlan}` : turn.text.trim(); isFirst = false;
    if (!trimmed) continue;
    if (isBareExitCommand(trimmed)) {
      lastQuestion = trimmed;
      lastAnswer = 'To leave Moderado, type /exit.';
      lastThoughtTime = 0;
      lastOutputTokenRate = undefined;
      continue;
    }
    networkAccessApproved = isNetworkConsentReply(trimmed, lastAnswer);

    if (!provider) {
      process.stdout.write('\nNo provider is connected. Let\'s connect one before sending this task.\n');
      const connection = await connectProviderInteractive({ signal, savedConnections: config.connections, resolveSavedConnection: (saved) => resolveConnectionCredential(saved, credentialStore) });
      if (!connection) { process.stdout.write('No provider connected. Use /connect whenever you are ready.\n\n'); continue; }
      const runtimeConnection = process.platform === 'win32' ? await storeConnectionCredential(connection, credentialStore) : connection;
      saveConnection(runtimeConnection); config = loadConfig(); activateConnection(runtimeConnection);
    }

    const policy = new PolicyManager({ maxSteps: args.maxSteps, readOnly: activeMode === 'Plan' || args.readOnly, nonInteractive: args.nonInteractive, timeoutSeconds: args.timeout });
    let thinkingTimer: ReturnType<typeof setInterval> | undefined;
    let removeGenerationListener: (() => void) | undefined;
    try {
      const requestAbort = new AbortController();
      const requestSignal = signal ? AbortSignal.any([signal, requestAbort.signal]) : requestAbort.signal;
      const onGenerationKeypress = (_text: string, key: { name?: string } | undefined): void => {
        if (isGenerationCancelKey(key)) requestAbort.abort();
      };
      if (process.stdin.isTTY) {
        const readlineModule = await import('node:readline');
        const attachGenerationListener = (): void => {
          readlineModule.emitKeypressEvents(process.stdin);
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
          suspendGenerationInput = undefined;
        };
      }
      const startedAt = Date.now();
      let streamedAnswer = '';
      let firstAssistantDeltaAt: number | undefined;
      let outputTokenRate: number | undefined;
      let answerPosition = { row: 15, column: 1 };
      const redrawChatFrame = (): void => {
        const thoughtTime = Math.max(0.001, (Date.now() - startedAt) / 1000);
        process.stdout.write('\x1b[H\x1b[J');
        process.stdout.write(renderFullWelcomeScreen({
          model: currentModel ?? 'No model connected — use /connect',
          tokens: Math.round(sessionTokens),
          cost: costLabel(),
          usageAvailable: activeSession.usage.available,
          workspace: canonicalWorkspace,
          mode: activeMode,
          autoApprove: activeAutoApprove,
          chatQuestion: trimmed,
          chatAnswer: streamedAnswer,
          chatThoughtTime: thoughtTime,
          outputTokenRate,
        }, process.stdout.rows));
        process.stdout.write(renderChatComposerCursor({ width: process.stdout.columns }, 0));
      };

      // Move to the chat layout before the provider can emit its first event.
      redrawChatFrame();
      thinkingTimer = setInterval(() => {
        if (!firstAssistantDeltaAt) {
          process.stdout.write(renderChatThoughtTimeUpdate((Date.now() - startedAt) / 1000));
        }
      }, 400);
      const runAgent = () => loop.run(createAgentTask(trimmed, activeMode), {
        workspaceRoot: canonicalWorkspace, provider: provider!, tools, approvalHandler, router, policy,
        routeOptions: { pinnedModelId: currentModel === 'auto' ? undefined : currentModel, allowPaid: config.allowPaid ?? args.allowPaid, allowUnknown: config.allowUnknown ?? args.allowUnknown, isLocalProfile: args.profile.includes('local') },
        eventListener: (event) => {
          if (event.type === 'assistant_delta') {
            firstAssistantDeltaAt ??= Date.now();
            if (thinkingTimer) clearInterval(thinkingTimer);
            streamedAnswer += event.delta;
            const renderedDelta = renderChatAnswerDelta(event.delta, answerPosition, process.stdout.columns || 80);
            answerPosition = renderedDelta;
            process.stdout.write(renderedDelta.sequence);
            process.stdout.write(renderChatComposerCursor({ width: process.stdout.columns }, 0));
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
      let result;
      try {
        result = await runAgent();
      } catch (error) {
        if (!activeConnection || !isAuthenticationFailure(error)) throw error;
        if (thinkingTimer) clearInterval(thinkingTimer);
        process.stdout.write(`\nThe saved ${activeConnection.displayName} API key was rejected. Enter a replacement key to retry once.\n`);
        const replacement = await replaceProviderKeyInteractive(activeConnection, { signal });
        if (!replacement) throw error;
        const secured = process.platform === 'win32' ? await storeConnectionCredential(replacement, credentialStore) : replacement;
        saveConnection(secured); config = loadConfig(); activateConnection(secured);
        result = await runAgent();
      }
      conversationHistory = result.messages;
      if (result.usage) {
        let pricing: Record<string, string> | undefined;
        try {
          pricing = findModelPricing(await provider!.discoverModels(signal), result.selectedModel.id);
        } catch {
          // A valid answer remains usable when the provider catalog is unavailable.
        }
        activeSession.usage = { ...result.usage, ...calculateSessionCost(result.usage, pricing), available: true };
        sessionTokens = result.usage.totalTokens;
        if (firstAssistantDeltaAt) outputTokenRate = calculateOutputTokenRate(result.usage.completionTokens, Date.now() - firstAssistantDeltaAt);
      }
      activeSession.messages = conversationHistory;
      activeSession.providerId = activeConnection?.id;
      activeSession.providerName = activeConnection?.displayName;
      activeSession.modelId = result.selectedModel.id;
      activeSession.mode = activeMode;
      sessionStore.save(activeSession);
      lastAnswer = [...result.messages].reverse().find((message) => message.role === 'assistant' && message.content?.trim())?.content ?? '';
      if (activeMode === 'Plan') activePlan = lastAnswer;
      lastQuestion = trimmed;
      lastThoughtTime = Math.max(0.001, (Date.now() - startedAt) / 1000);
      lastOutputTokenRate = outputTokenRate;
      if (thinkingTimer) clearInterval(thinkingTimer);
      removeGenerationListener?.();
      redrawChatFrame();
    } catch (err: any) { if (thinkingTimer) clearInterval(thinkingTimer); removeGenerationListener?.(); process.stderr.write(`\n\x1b[1;31mError:\x1b[0m ${err.message}\n\n`); }
  }
  return 0;
}
