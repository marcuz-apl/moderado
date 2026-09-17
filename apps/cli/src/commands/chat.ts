import path from 'node:path';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, canonicalizeRoot } from '@moderado/tools';
import { ChatMessage } from '@moderado/contracts';
import { CliParsedArgs } from '../args.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { TerminalRenderer } from '../ui/renderer.js';
import { renderBox } from '../ui/box.js';
import { resolveApiKey, saveConfig, loadConfig } from '../config.js';
import { askQuestion, askSecret } from '../ui/prompt.js';
import { selectModelInteractive } from '../ui/model_selector.js';

export async function handleChatSession(
  args: CliParsedArgs,
  version: string,
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

  // 3. Enter Chat Terminal (REPL like OpenCode / Cline)
  const displayModel = currentModel ?? 'Auto (Free-First)';
  const shortWs = canonicalWorkspace.length > 45
    ? '...' + canonicalWorkspace.slice(-42)
    : canonicalWorkspace;

  process.stdout.write(
    '\n' +
      renderBox(
        [
          `\x1b[1;38;5;255mModerado\x1b[0m \x1b[38;5;242m${version}\x1b[0m`,
          `\x1b[38;5;242m${shortWs}\x1b[0m`,
          `\x1b[38;5;245mModel:\x1b[0m \x1b[38;5;75m${displayModel}\x1b[0m`,
        ],
        {
          minWidth: 46,
          borderColor: '\x1b[38;5;238m',
        }
      ) +
      '\x1b[38;5;242mType /help for commands, /exit to quit.\x1b[0m\n\n'
  );

  const provider = new NvidiaAdapter({ apiKey });
  const tools = createDefaultToolRegistry();
  const approvalHandler = new TerminalApprovalHandler();
  const renderer = new TerminalRenderer({ verbose: args.verbose, isChatMode: true });
  const policy = new PolicyManager({
    maxSteps: args.maxSteps,
    readOnly: args.readOnly,
    nonInteractive: args.nonInteractive,
    timeoutSeconds: args.timeout,
  });
  const router = new Router();
  const loop = new AgentLoop();

  let conversationHistory: ChatMessage[] = [];

  // 4. Continuous interactive loop - stay until /exit
  while (!signal?.aborted) {
    const promptLine = await askQuestion('\x1b[1;38;5;75m❯\x1b[0m ', { signal });
    const trimmed = promptLine.trim();

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
      if (selection.modelId !== undefined) {
        currentModel = selection.modelId;
      }
      config = loadConfig();
      process.stdout.write(`Active model updated: \x1b[35m${currentModel ?? 'Auto (Free-First)'}\x1b[0m\n\n`);
      continue;
    }

    // Execute user coding task / question
    process.stdout.write('\n');
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
      process.stdout.write('\n');
    } catch (err: any) {
      process.stderr.write(`\n\x1b[1;31mError:\x1b[0m ${err.message}\n\n`);
    }

    // Once the question gets answered, DON'T exit! Stay here for next input.
  }

  return 0;
}
