import path from 'node:path';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, canonicalizeRoot } from '@moderado/tools';
import { ChatMessage, ApprovalDecision, ApprovalRequest, IApprovalHandler } from '@moderado/contracts';
import { CliParsedArgs } from '../args.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { TerminalRenderer } from '../ui/renderer.js';
import { resolveApiKey, saveConfig, loadConfig } from '../config.js';
import { askQuestion, askSecret } from '../ui/prompt.js';
import { selectModelInteractive } from '../ui/model_selector.js';
import { promptInteractiveTurn } from '../ui/welcome.js';

export async function handleChatSession(
  args: CliParsedArgs,
  _version: string,
  signal?: AbortSignal
): Promise<number> {
  let canonicalWorkspace: string;
  try {
    canonicalWorkspace = canonicalizeRoot(path.resolve(process.cwd(), args.workspace));
  } catch (err: any) {
    process.stderr.write(`\x1b[1;31mWorkspace Error:\x1b[0m ${err.message}\n`);
    return 1;
  }

  // 1. Configure API Key (skip if already valid)
  const isLocal = args.profile.includes('local');
  let apiKey = resolveApiKey();

  if (!isLocal && !apiKey) {
    process.stdout.write('\n\x1b[1;36m[Moderado Setup]\x1b[0m Step 1/2: Configure your NVIDIA NIM API Key.\n');
    process.stdout.write('Get a free API key with 1,000 free inference credits at https://build.nvidia.com\n\n');
    const entered = await askSecret('Enter NVIDIA_API_KEY: ', { signal });
    if (!entered.trim()) {
      process.stderr.write('\x1b[1;31mError: API key cannot be empty.\x1b[0m\n');
      return 1;
    }
    apiKey = entered;
    process.env.NVIDIA_API_KEY = apiKey;

    const shouldSave = await askQuestion('Save API key persistently to ~/.moderado/config.json? [Y/n]: ', { signal });
    if (shouldSave.toLowerCase() !== 'n' && shouldSave.toLowerCase() !== 'no') {
      saveConfig({ apiKey });
      process.stdout.write('\x1b[32m✔ API key saved to ~/.moderado/config.json\x1b[0m\n');
    }
  }

  // 2. Select default free model (skip if already selected)
  let config = loadConfig();
  let currentModel = args.model ?? config.defaultModel;

  if (!currentModel && !args.nonInteractive) {
    process.stdout.write('\n\x1b[1;36m[Moderado Setup]\x1b[0m Step 2/2: Select a default free model.\n');
    const selection = await selectModelInteractive({
      apiKey,
      signal,
      saveSelectionByDefault: true,
    });
    currentModel = selection.modelId;
    config = loadConfig();
  }

  // 3. Enter Chat Terminal (Welcome TUI with OpenCode-style layout)
  process.stdout.write('\x1b]0;Moderado\x07');
  let activeMode: 'Plan' | 'Execute' = args.readOnly ? 'Plan' : 'Execute';
  let activeAutoApprove = false;
  let sessionTokens = 0;
  let isFirst = true;

  const provider = new NvidiaAdapter({ apiKey });
  const tools = createDefaultToolRegistry();
  const terminalApproval = new TerminalApprovalHandler();
  const approvalHandler: IApprovalHandler = {
    requestApproval: async (req: ApprovalRequest, sig?: AbortSignal): Promise<ApprovalDecision> => {
      if (activeAutoApprove) {
        return { requestId: req.requestId, status: 'approved' as const };
      }
      return terminalApproval.requestApproval(req, sig);
    },
  };
  const renderer = new TerminalRenderer({ verbose: args.verbose, isChatMode: true });
  const router = new Router();
  const loop = new AgentLoop();

  let conversationHistory: ChatMessage[] = [];

  // 4. Continuous interactive loop - stay until /exit
  while (!signal?.aborted) {
      const displayModel = currentModel ?? 'Auto (Free-First)';
      const costDisplay = '$0.00';

      const turn = await promptInteractiveTurn({
        model: displayModel,
        tokens: Math.round(sessionTokens),
        cost: costDisplay,
        workspace: canonicalWorkspace,
        initialMode: activeMode,
        initialAutoApprove: activeAutoApprove,
        isFirstTurn: isFirst,
        signal,
      });

      isFirst = false;
      activeMode = turn.mode;
      activeAutoApprove = turn.autoApprove;
      const trimmed = turn.text.trim();

      if (!trimmed) {
        continue;
      }

      // Handle slash commands
      if (trimmed === '/exit' || trimmed === '/quit' || trimmed.toLowerCase() === 'exit') {
        process.stdout.write('\x1b[32mGoodbye!\x1b[0m\n\n');
        return 0;
      }

    if (trimmed === '/help') {
      process.stdout.write(
        '\n\x1b[1mCommands:\x1b[0m\n' +
        '  \x1b[38;5;75m/model\x1b[0m    Switch AI model\n' +
        '  \x1b[38;5;75m/clear\x1b[0m    Reset conversation memory\n' +
        '  \x1b[38;5;75m/help\x1b[0m     Display command reference\n' +
        '  \x1b[38;5;75m/exit\x1b[0m     Exit Moderado\n\n'
      );
      continue;
    }

    if (trimmed === '/clear') {
      conversationHistory = [];
      process.stdout.write('\n\x1b[32m✔ Conversation history cleared.\x1b[0m\n\n');
      continue;
    }

    if (trimmed === '/model') {
      const selection = await selectModelInteractive({
        apiKey,
        currentModel,
        signal,
        saveSelectionByDefault: true,
      });
      if (selection.modelId && selection.modelId !== currentModel) {
        currentModel = selection.modelId;
        config = loadConfig();
        process.stdout.write(`\x1b[32m✔ Active model updated:\x1b[0m \x1b[1;38;5;75m${currentModel}\x1b[0m\n\n`);
      } else {
        process.stdout.write(`\x1b[38;5;244mActive model unchanged:\x1b[0m \x1b[1;38;5;180m${currentModel ?? 'Auto (Free-First)'}\x1b[0m\n\n`);
      }
      continue;
    }

    // Execute user coding task / question
    process.stdout.write('\n');
    const policy = new PolicyManager({
      maxSteps: args.maxSteps,
      readOnly: activeMode === 'Plan' || args.readOnly,
      nonInteractive: args.nonInteractive,
      timeoutSeconds: args.timeout,
    });

    try {
      const result = await loop.run(trimmed, {
        workspaceRoot: canonicalWorkspace,
        provider,
        tools,
        approvalHandler,
        router,
        policy,
        routeOptions: {
          pinnedModelId: currentModel === 'auto' ? undefined : currentModel,
          allowPaid: config.allowPaid ?? args.allowPaid,
          allowUnknown: config.allowUnknown ?? args.allowUnknown,
          isLocalProfile: args.profile.includes('local'),
        },
        eventListener: (event) => renderer.handleEvent(event),
        signal,
        conversationHistory,
      });

      conversationHistory = result.messages;
      const turnChars = result.messages.reduce(
        (sum, m) => sum + (m.content ? m.content.length : 0),
        0
      );
      sessionTokens += Math.round(turnChars / 4);
      process.stdout.write('\n');
    } catch (err: any) {
      process.stderr.write(`\n\x1b[1;31mError:\x1b[0m ${err.message}\n\n`);
    }

    // Once the question gets answered, DON'T exit! Stay here for next input.
  }

  return 0;
}
