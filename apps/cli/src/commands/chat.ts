import path from 'node:path';
import fs from 'node:fs';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, canonicalizeRoot } from '@moderado/tools';
import { ApprovalDecision, ApprovalRequest, ChatMessage, IApprovalHandler } from '@moderado/contracts';
import { CliParsedArgs } from '../args.js';
import { getActiveConnection, loadConfig, ProviderConnection, resolveApiKey, saveConnection } from '../config.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { selectCompatibleModelOverlay, selectModelOverlay, showModelConnectionRequired } from '../ui/model_selector.js';
import { connectProviderInteractive } from '../ui/provider_connect.js';
import { promptInteractiveTurn, renderFullWelcomeScreen, terminalCleanExitDone } from '../ui/welcome.js';
import { calculateOutputTokenRate, calculateSessionCost, compactSessionMessages, createSession, exportSessionMarkdown, formatSessionCost, SessionStore, StoredSession } from '../sessions.js';
import { renderBoxLines, selectListPopup } from '../ui/popup.js';
import { findModelPricing } from '../model_pricing.js';

export async function handleChatSession(args: CliParsedArgs, version: string, signal?: AbortSignal): Promise<number> {
  let canonicalWorkspace: string;
  try { canonicalWorkspace = canonicalizeRoot(path.resolve(process.cwd(), args.workspace)); }
  catch (err: any) { process.stderr.write(`\x1b[1;31mWorkspace Error:\x1b[0m ${err.message}\n`); return 1; }

  let config = loadConfig();
  let activeConnection = getActiveConnection(config);
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
  const tools = createDefaultToolRegistry();
  const terminalApproval = new TerminalApprovalHandler();
  const approvalHandler: IApprovalHandler = { requestApproval: async (req: ApprovalRequest, sig?: AbortSignal): Promise<ApprovalDecision> =>
    activeAutoApprove ? { requestId: req.requestId, status: 'approved' } : terminalApproval.requestApproval(req, sig) };
  const router = new Router();
  const loop = new AgentLoop();
  let conversationHistory: ChatMessage[] = [...activeSession.messages];
  let lastQuestion = '';
  let lastAnswer = '';
  let lastThoughtTime = 0;
  let lastOutputTokenRate: number | undefined;
  const costLabel = (): string => formatSessionCost(activeSession.usage);

  while (!signal?.aborted) {
    const turn = await promptInteractiveTurn({
      model: currentModel ?? 'No model connected — use /connect', tokens: Math.round(sessionTokens), cost: costLabel(), workspace: canonicalWorkspace, version,
      usageAvailable: activeSession.usage.available, initialMode: activeMode, initialAutoApprove: activeAutoApprove, isFirstTurn: isFirst, signal, chatQuestion: lastQuestion || undefined, chatAnswer: lastAnswer || undefined, chatThoughtTime: lastThoughtTime, outputTokenRate: lastOutputTokenRate,
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
        if (selection.modelId) currentModel = selection.modelId;
        return selection.modelId;
      },
      onConnect: async (drawFrame) => {
        const connection = await connectProviderInteractive({ signal, drawFrame });
        if (!connection) return currentModel;
        saveConnection(connection); config = loadConfig(); activateConnection(connection);
        return currentModel ?? 'No model connected — use /connect';
      },
      onClear: () => {
        conversationHistory = []; lastQuestion = ''; lastAnswer = ''; lastThoughtTime = 0; lastOutputTokenRate = undefined;
        activeSession.messages = [];
        sessionStore.save(activeSession);
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
    const trimmed = turn.text.trim(); isFirst = false;
    if (!trimmed) continue;

    if (!provider) {
      process.stdout.write('\nNo provider is connected. Let\'s connect one before sending this task.\n');
      const connection = await connectProviderInteractive({ signal });
      if (!connection) { process.stdout.write('No provider connected. Use /connect whenever you are ready.\n\n'); continue; }
      saveConnection(connection); config = loadConfig(); activateConnection(connection);
    }

    const policy = new PolicyManager({ maxSteps: args.maxSteps, readOnly: activeMode === 'Plan' || args.readOnly, nonInteractive: args.nonInteractive, timeoutSeconds: args.timeout });
    try {
      const startedAt = Date.now();
      let streamedAnswer = '';
      let firstAssistantDeltaAt: number | undefined;
      let outputTokenRate: number | undefined;
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
      };

      // Move to the chat layout before the provider can emit its first event.
      redrawChatFrame();
      const result = await loop.run(trimmed, {
        workspaceRoot: canonicalWorkspace, provider: provider!, tools, approvalHandler, router, policy,
        routeOptions: { pinnedModelId: currentModel === 'auto' ? undefined : currentModel, allowPaid: config.allowPaid ?? args.allowPaid, allowUnknown: config.allowUnknown ?? args.allowUnknown, isLocalProfile: args.profile.includes('local') },
        eventListener: (event) => {
          if (event.type === 'assistant_delta') {
            firstAssistantDeltaAt ??= Date.now();
            streamedAnswer += event.delta;
          }
          if (event.type === 'assistant_delta' || event.type === 'progress' || event.type === 'reasoning_delta') redrawChatFrame();
        }, signal, conversationHistory,
      });
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
      lastQuestion = trimmed;
      lastThoughtTime = Math.max(0.001, (Date.now() - startedAt) / 1000);
      lastOutputTokenRate = outputTokenRate;
      redrawChatFrame();
    } catch (err: any) { process.stderr.write(`\n\x1b[1;31mError:\x1b[0m ${err.message}\n\n`); }
  }
  return 0;
}
