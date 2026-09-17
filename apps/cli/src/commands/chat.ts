import path from 'node:path';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, canonicalizeRoot } from '@moderado/tools';
import { ChatMessage } from '@moderado/contracts';
import { CliParsedArgs } from '../args.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { TerminalRenderer } from '../ui/renderer.js';
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
    if (args.nonInteractive) {
      process.stderr.write(
        '\x1b[1;31mAuthentication Error:\x1b[0m NVIDIA_API_KEY environment variable is not set.\n\n' +
        'Please set your API key to run tasks against NVIDIA NIM:\n' +
        '  PowerShell: $env:NVIDIA_API_KEY = "nvapi-..."\n' +
        '  POSIX:      export NVIDIA_API_KEY="nvapi-..."\n\n' +
        'Get a free API trial key at: https://build.nvidia.com\n'
      );
      return 1;
    }

    process.stdout.write('\n\x1b[1;36m[Moderado Setup]\x1b[0m Step 1/2: NVIDIA NIM API Key not detected.\n');
    process.stdout.write('Get a free trial key with 1,000 credits at: \x1b[4mhttps://build.nvidia.com\x1b[0m\n\n');

    const entered = await askSecret('Enter NVIDIA API Key (nvapi-...): ', { signal });
    if (!entered) {
      process.stderr.write('\x1b[1;31mError:\x1b[0m No API key entered. Aborting session.\n');
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
  const shortWs = canonicalWorkspace.length > 40
    ? '...' + canonicalWorkspace.slice(-37)
    : canonicalWorkspace;

  process.stdout.write(
    `\n\x1b[1;36m╭─────────────────────────────────────────────────────────────╮\x1b[0m\n` +
    `\x1b[1;36m│\x1b[0m  \x1b[1;37m◆ MODERADO CLI\x1b[0m                                    \x1b[90m${version.padEnd(8)}\x1b[0m \x1b[1;36m│\x1b[0m\n` +
    `\x1b[1;36m│\x1b[0m  \x1b[90mWorkspace:\x1b[0m \x1b[36m${shortWs.padEnd(46)}\x1b[0m \x1b[1;36m│\x1b[0m\n` +
    `\x1b[1;36m│\x1b[0m  \x1b[90mModel:    \x1b[0m \x1b[35m${displayModel.slice(0, 36).padEnd(36)}\x1b[0m \x1b[32m● Active\x1b[0m   \x1b[1;36m│\x1b[0m\n` +
    `\x1b[1;36m│\x1b[0m                                                             \x1b[1;36m│\x1b[0m\n` +
    `\x1b[1;36m│\x1b[0m  \x1b[90mShortcuts:\x1b[0m \x1b[1;33m/exit\x1b[0m · \x1b[1;33m/model\x1b[0m · \x1b[1;33m/clear\x1b[0m · \x1b[1;33m/help\x1b[0m                  \x1b[1;36m│\x1b[0m\n` +
    `\x1b[1;36m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n\n`
  );

  const provider = new NvidiaAdapter({ apiKey });
  const tools = createDefaultToolRegistry();
  const approvalHandler = new TerminalApprovalHandler();
  const renderer = new TerminalRenderer({ verbose: args.verbose });
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
    const modelBadge = currentModel ? currentModel.split('/').pop() : 'auto';
    process.stdout.write(`\x1b[90m╭─ (\x1b[35m${modelBadge}\x1b[90m) \x1b[36m${path.basename(canonicalWorkspace)}\x1b[0m\n`);
    const promptLine = await askQuestion('\x1b[90m╰─\x1b[1;36m❯\x1b[0m ', { signal });
    const trimmed = promptLine.trim();

    if (!trimmed) {
      continue;
    }

    // Handle slash commands
    if (trimmed === '/exit' || trimmed === '/quit' || trimmed.toLowerCase() === 'exit') {
      process.stdout.write('\n\x1b[32m✔ Session terminated. Goodbye!\x1b[0m\n\n');
      return 0;
    }

    if (trimmed === '/help') {
      process.stdout.write(
        `\n\x1b[1;36m╭── ⌨ Moderado Command Palette ───────────────────────────────╮\x1b[0m\n` +
        `\x1b[1;36m│\x1b[0m  \x1b[1;33m/exit\x1b[0m, \x1b[1;33m/quit\x1b[0m    Terminate the session and return to shell  \x1b[1;36m│\x1b[0m\n` +
        `\x1b[1;36m│\x1b[0m  \x1b[1;33m/model\x1b[0m          Switch AI model (Free Trial or Paid NIM)   \x1b[1;36m│\x1b[0m\n` +
        `\x1b[1;36m│\x1b[0m  \x1b[1;33m/clear\x1b[0m          Clear conversation memory & start fresh    \x1b[1;36m│\x1b[0m\n` +
        `\x1b[1;36m│\x1b[0m  \x1b[1;33m/help\x1b[0m           Display this command reference             \x1b[1;36m│\x1b[0m\n` +
        `\x1b[1;36m╰─────────────────────────────────────────────────────────────╯\x1b[0m\n\n`
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
