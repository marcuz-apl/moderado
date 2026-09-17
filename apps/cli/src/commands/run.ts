import path from 'node:path';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, canonicalizeRoot } from '@moderado/tools';
import { CliParsedArgs } from '../args.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { TerminalRenderer } from '../ui/renderer.js';
import { resolveApiKey, saveConfig } from '../config.js';
import { askQuestion, askSecret, askSelect, SelectOption } from '../ui/prompt.js';

export async function handleRunCommand(
  args: CliParsedArgs,
  signal?: AbortSignal
): Promise<number> {
  if (!args.task) {
    process.stderr.write('\x1b[1;31mError:\x1b[0m Missing task prompt. Usage: moderado run "<task>"\n');
    return 1;
  }

  let canonicalWorkspace: string;
  try {
    canonicalWorkspace = canonicalizeRoot(path.resolve(process.cwd(), args.workspace));
  } catch (err: any) {
    process.stderr.write(`\x1b[1;31mWorkspace Error:\x1b[0m ${err.message}\n`);
    return 1;
  }

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

    // Interactive onboarding prompt
    process.stdout.write('\n\x1b[1;36m[Moderado Setup]\x1b[0m NVIDIA NIM API Key not detected.\n');
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
      process.stdout.write('\x1b[32m✔ API key saved to ~/.moderado/config.json\x1b[0m\n\n');
    }
  }

  let selectedModel = args.model;
  let allowPaid = args.allowPaid;
  let allowUnknown = args.allowUnknown;

  if (!selectedModel && !args.nonInteractive) {
    const choices: SelectOption[] = [
      {
        label: 'Auto (Recommended Free-First)',
        value: 'auto',
        tag: 'Free Trial',
        description: 'Automatically routes to free-trial models with tool support (default: meta/llama-3.2-11b-vision-instruct)',
      },
      {
        label: 'meta/llama-3.2-11b-vision-instruct',
        value: 'meta/llama-3.2-11b-vision-instruct',
        tag: 'Free Trial',
        description: 'Fast multimodal instruction model with verified tool calling support',
      },
      {
        label: 'meta/llama-3.2-90b-vision-instruct',
        value: 'meta/llama-3.2-90b-vision-instruct',
        tag: 'Free Trial',
        description: 'High-capacity reasoning model with tool support',
      },
      {
        label: 'Allow Paid / All Models',
        value: 'all_paid',
        tag: 'Paid + Free',
        description: 'Enables access to paid models and unclassified catalog items',
      },
      {
        label: 'Custom Model ID',
        value: 'custom',
        tag: 'Custom',
        description: 'Specify any custom NVIDIA NIM model identifier manually',
      },
    ];

    const pick = await askSelect('Select Model Routing Strategy:', choices, 0, { signal });
    if (pick.value === 'auto') {
      selectedModel = undefined;
    } else if (pick.value === 'all_paid') {
      selectedModel = undefined;
      allowPaid = true;
      allowUnknown = true;
    } else if (pick.value === 'custom') {
      const customId = await askQuestion('Enter Model ID (e.g. meta/llama-3.2-11b-vision-instruct): ', { signal });
      if (customId) {
        selectedModel = customId;
      }
    } else {
      selectedModel = pick.value;
    }
  }

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

  process.stdout.write(`\x1b[1mModerado v0.1.0\x1b[0m | Workspace: \x1b[36m${canonicalWorkspace}\x1b[0m\n`);
  process.stdout.write(`Task: "\x1b[1m${args.task}\x1b[0m"\n\n`);

  try {
    const result = await loop.run(args.task, {
      workspaceRoot: canonicalWorkspace,
      provider,
      tools,
      approvalHandler,
      router,
      policy,
      routeOptions: {
        pinnedModelId: selectedModel,
        allowPaid,
        allowUnknown,
        isLocalProfile: args.profile.includes('local'),
      },
      eventListener: (event) => renderer.handleEvent(event),
      signal,
    });

    if (result.status === 'completed') {
      return 0;
    } else if (result.status === 'cancelled') {
      return 130;
    } else {
      return 1;
    }
  } catch (err: any) {
    process.stderr.write(`\n\x1b[1;31mExecution Fatal Error:\x1b[0m ${err.message}\n`);
    return 1;
  }
}
