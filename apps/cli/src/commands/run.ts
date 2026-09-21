import path from 'node:path';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, canonicalizeRoot } from '@moderado/tools';
import { CliParsedArgs } from '../args.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { TerminalRenderer } from '../ui/renderer.js';
import { getActiveConnection, resolveApiKey, resolveConnectionCredential, saveConfig, loadConfig, saveConnection, storeConnectionCredential } from '../config.js';
import { WindowsCredentialStore } from '../windows_credentials.js';
import { askQuestion, askSecret } from '../ui/prompt.js';
import { selectModelInteractive } from '../ui/model_selector.js';

export async function handleRunCommand(
  args: CliParsedArgs,
  signal?: AbortSignal
): Promise<number> {
  if (!args.task) {
    if (!args.nonInteractive) {
      args.task = await askQuestion('Enter task prompt: ', { signal });
    }
    if (!args.task) {
      process.stderr.write('\x1b[1;31mError:\x1b[0m Missing task prompt. Usage: moderado run "<task>"\n');
      return 1;
    }
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
  if (!apiKey && process.platform === 'win32') {
    const connection = getActiveConnection(loadConfig());
    if (connection) apiKey = (await resolveConnectionCredential(connection, new WindowsCredentialStore())).apiKey;
  }

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
      if (process.platform === 'win32') { const connection = await storeConnectionCredential({ id: 'nvidia-nim', displayName: 'NVIDIA NIM', kind: 'nvidia-nim', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey }, new WindowsCredentialStore()); saveConnection(connection); process.stdout.write('API key saved in Windows Credential Manager.\\n'); } else { saveConfig({ apiKey }); process.stdout.write('Set NVIDIA_API_KEY to persist this key on your platform.\\n'); }
    }
  }

  const config = loadConfig();
  let selectedModel = args.model ?? config.defaultModel;
  let allowPaid = args.allowPaid ?? config.allowPaid;
  let allowUnknown = args.allowUnknown ?? config.allowUnknown;

  if (!args.model && !args.nonInteractive) {
    const selection = await selectModelInteractive({
      apiKey,
      currentModel: selectedModel,
      signal,
      saveSelectionByDefault: true,
    });
    selectedModel = selection.modelId;
    if (selection.allowPaid) allowPaid = true;
    if (selection.allowUnknown) allowUnknown = true;
  }

  const provider = new NvidiaAdapter({ apiKey });
  const tools = createDefaultToolRegistry();
  const terminalApproval = new TerminalApprovalHandler();
  const approvalHandler = {
    requestApproval: async (req: any, sig?: AbortSignal) => {
      if (args.autoApprove || ['write_file', 'edit_file', 'apply_patch'].includes(req.toolName)) {
        return { requestId: req.requestId, status: 'approved' as const };
      }
      return terminalApproval.requestApproval(req, sig);
    },
  };
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
