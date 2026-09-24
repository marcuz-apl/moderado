import { parseArgs } from 'node:util';

export interface CliParsedArgs {
  command?: 'models' | 'run' | 'doctor' | 'skills';
  task?: string;
  workspace: string;
  model?: string;
  provider?: string;
  profile: string;
  maxSteps: number;
  timeout: number;
  readOnly: boolean;
  autoApprove: boolean;
  nonInteractive: boolean;
  allowPaid: boolean;
  allowUnknown: boolean;
  verbose: boolean;
  json: boolean;
  refresh: boolean;
  connectivity: boolean;
  migrateCredentials: boolean;
  maxTokens?: number;
  help: boolean;
  version: boolean;
}

export function parseCliArgs(args: string[] = process.argv.slice(2)): CliParsedArgs {
  const optionsConfig = {
    workspace: { type: 'string' as const, short: 'w', default: '.' },
    model: { type: 'string' as const, short: 'm' },
    provider: { type: 'string' as const },
    profile: { type: 'string' as const, short: 'p', default: 'hosted-nvidia' },
    'max-steps': { type: 'string' as const, default: '25' },
    'max-tokens': { type: 'string' as const },
    timeout: { type: 'string' as const, default: '600' },
    'read-only': { type: 'boolean' as const, default: false },
    'auto-approve': { type: 'boolean' as const, short: 'y', default: false },
    'non-interactive': { type: 'boolean' as const, default: false },
    'allow-paid': { type: 'boolean' as const, default: false },
    'allow-unknown': { type: 'boolean' as const, default: false },
    verbose: { type: 'boolean' as const, default: false },
    json: { type: 'boolean' as const, default: false },
    refresh: { type: 'boolean' as const, default: false },
    connectivity: { type: 'boolean' as const, default: false },
    'migrate-credentials': { type: 'boolean' as const, default: false },
    help: { type: 'boolean' as const, short: 'h', default: false },
    version: { type: 'boolean' as const, short: 'v', default: false },
  };

  const parsed = parseArgs({
    args,
    options: optionsConfig,
    allowPositionals: true,
  });

  const positionals = parsed.positionals;
  let command: 'models' | 'run' | 'doctor' | 'skills' | undefined;
  let task: string | undefined;

  if (positionals.length > 0) {
    const first = positionals[0].toLowerCase();
    if (first === 'doctor') { command = 'doctor'; } else if (first === 'skill' || first === 'skills') { command = 'skills'; } else if (first === 'models') {
      command = 'models';
    } else if (first === 'run') {
      command = 'run';
      task = positionals.slice(1).join(' ');
    } else {
      // If first positional is not a command, treat as task for implicit 'run'
      command = 'run';
      task = positionals.join(' ');
    }
  }

  const maxSteps = parseInt(parsed.values['max-steps'] as string, 10);
  const maxTokens = parsed.values['max-tokens'] ? parseInt(parsed.values['max-tokens'] as string, 10) : undefined;
  const timeout = parseInt(parsed.values.timeout as string, 10);

  return {
    command,
    task: task?.trim() || undefined,
    workspace: parsed.values.workspace as string,
    model: parsed.values.model as string | undefined,
    provider: parsed.values.provider as string | undefined,
    profile: parsed.values.profile as string,
    maxSteps: isNaN(maxSteps) ? 25 : maxSteps,
    maxTokens: maxTokens && !isNaN(maxTokens) ? maxTokens : undefined,
    timeout: isNaN(timeout) ? 600 : timeout,
    readOnly: Boolean(parsed.values['read-only']),
    autoApprove: Boolean(parsed.values['auto-approve']),
    nonInteractive: Boolean(parsed.values['non-interactive']),
    allowPaid: Boolean(parsed.values['allow-paid']),
    allowUnknown: Boolean(parsed.values['allow-unknown']),
    verbose: Boolean(parsed.values.verbose),
    json: Boolean(parsed.values.json),
    refresh: Boolean(parsed.values.refresh),
    connectivity: Boolean(parsed.values.connectivity),
    migrateCredentials: Boolean(parsed.values['migrate-credentials']),
    help: Boolean(parsed.values.help),
    version: Boolean(parsed.values.version),
  };
}

export function getHelpText(): string {
  return `Moderado - Lightweight CLI coding agent with NVIDIA NIM discovery and free-first routing.

USAGE:
  moderado models [options]
  moderado run "<task>" [options]
  moderado "<task>" [options]

COMMANDS:
  models                 Discover live models, capability & access tiers
  run "<task>"           Execute a bounded coding task in the workspace\n  skills                 List installed user skills
  doctor                 Check local Moderado setup

OPTIONS:
  -w, --workspace <path> Target workspace directory (default: current directory)
  -m, --model <id>       Pin a specific model (disables AUTO fallback)
  -p, --profile <name>   Target configured profile (default: hosted-nvidia)
  --max-steps <int>      Upper bound on tool interaction cycles (default: 25)
  --max-tokens <int>     Hard limit on generated output tokens per response (default: 1024)
  --timeout <seconds>    Global session execution timeout (default: 600s)
  --read-only            Enforce read-only mode (blocks writes & commands)
  -y, --auto-approve     Automatically approve all tool operations
  --non-interactive      Fail closed on operations requiring approval
  --allow-paid           Permit paid models during AUTO routing
  --allow-unknown        Permit unverified/unknown access models in AUTO
  --verbose              Display raw tool inputs and event logs
  --json                 Output results in structured JSON (models command)
  --migrate-credentials  Move legacy Windows config keys into Credential Manager
  -h, --help             Show this help screen
  -v, --version          Show version identifier
`;
}
