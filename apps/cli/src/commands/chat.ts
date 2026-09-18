import path from 'node:path';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, canonicalizeRoot } from '@moderado/tools';
import { ApprovalDecision, ApprovalRequest, ChatMessage, IApprovalHandler } from '@moderado/contracts';
import { CliParsedArgs } from '../args.js';
import { getActiveConnection, loadConfig, ProviderConnection, resolveApiKey, saveConnection } from '../config.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { TerminalRenderer } from '../ui/renderer.js';
import { selectCompatibleModelOverlay, selectModelOverlay, showModelConnectionRequired } from '../ui/model_selector.js';
import { connectProviderInteractive } from '../ui/provider_connect.js';
import { promptInteractiveTurn, terminalCleanExitDone } from '../ui/welcome.js';

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
  let sessionTokens = 0;
  let isFirst = true;
  const tools = createDefaultToolRegistry();
  const terminalApproval = new TerminalApprovalHandler();
  const approvalHandler: IApprovalHandler = { requestApproval: async (req: ApprovalRequest, sig?: AbortSignal): Promise<ApprovalDecision> =>
    activeAutoApprove ? { requestId: req.requestId, status: 'approved' } : terminalApproval.requestApproval(req, sig) };
  const renderer = new TerminalRenderer({ verbose: args.verbose, isChatMode: true });
  const router = new Router();
  const loop = new AgentLoop();
  let conversationHistory: ChatMessage[] = [];
  let lastQuestion = '';
  let lastAnswer = '';

  while (!signal?.aborted) {
    const turn = await promptInteractiveTurn({
      model: currentModel ?? 'No model connected — use /connect', tokens: Math.round(sessionTokens), cost: '$0.00', workspace: canonicalWorkspace, version,
      initialMode: activeMode, initialAutoApprove: activeAutoApprove, isFirstTurn: isFirst, signal, chatQuestion: lastQuestion || undefined, chatAnswer: lastAnswer || undefined,
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
      onClear: () => { conversationHistory = []; lastQuestion = ''; lastAnswer = ''; },
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

    process.stdout.write('\n');
    const policy = new PolicyManager({ maxSteps: args.maxSteps, readOnly: activeMode === 'Plan' || args.readOnly, nonInteractive: args.nonInteractive, timeoutSeconds: args.timeout });
    try {
      const result = await loop.run(trimmed, {
        workspaceRoot: canonicalWorkspace, provider: provider!, tools, approvalHandler, router, policy,
        routeOptions: { pinnedModelId: currentModel === 'auto' ? undefined : currentModel, allowPaid: config.allowPaid ?? args.allowPaid, allowUnknown: config.allowUnknown ?? args.allowUnknown, isLocalProfile: args.profile.includes('local') },
        eventListener: (event) => renderer.handleEvent(event), signal, conversationHistory,
      });
      conversationHistory = result.messages;
      lastAnswer = [...result.messages].reverse().find((message) => message.role === 'assistant' && message.content?.trim())?.content ?? '';
      lastQuestion = trimmed;
      sessionTokens += Math.round(result.messages.reduce((sum, message) => sum + (message.content?.length ?? 0), 0) / 4);
      process.stdout.write('\n');
    } catch (err: any) { process.stderr.write(`\n\x1b[1;31mError:\x1b[0m ${err.message}\n\n`); }
  }
  return 0;
}
