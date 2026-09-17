import path from 'node:path';
import { AgentLoop, PolicyManager, Router } from '@moderado/core';
import { NvidiaAdapter } from '@moderado/providers';
import { createDefaultToolRegistry, canonicalizeRoot } from '@moderado/tools';
import { CliParsedArgs } from '../args.js';
import { TerminalApprovalHandler } from '../ui/terminal_approval.js';
import { TerminalRenderer } from '../ui/renderer.js';

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
  if (!isLocal && !process.env.NVIDIA_API_KEY) {
    process.stderr.write(
      '\x1b[1;31mAuthentication Error:\x1b[0m NVIDIA_API_KEY environment variable is not set.\n\n' +
      'Please set your API key to run tasks against NVIDIA NIM:\n' +
      '  PowerShell: $env:NVIDIA_API_KEY = "nvapi-..."\n' +
      '  POSIX:      export NVIDIA_API_KEY="nvapi-..."\n\n' +
      'Get a free API trial key at: https://build.nvidia.com\n'
    );
    return 1;
  }

  const provider = new NvidiaAdapter();
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
        pinnedModelId: args.model,
        allowPaid: args.allowPaid,
        allowUnknown: args.allowUnknown,
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
