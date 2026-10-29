import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeRoot, resolveInJailFromRoot } from '@moderado/tools';
import type { AgentEvent, ChatMessage } from '@moderado/contracts';

export type TurnStatus = 'completed' | 'step_limit_reached' | 'cancelled' | 'failed';

/**
 * Fence that marks the turn summary inside a chat answer.
 *
 * The renderer paints everything between these markers as a tinted panel, so
 * the report reads as an afterword rather than more prose. `ui/welcome.ts`
 * imports this constant rather than repeating the literal.
 */
export const SUMMARY_FENCE = '```summary';

export interface TurnCommandRecord {
  command: string;
  ok: boolean;
  exitCode?: number;
  /** The tool backgrounded a dev server after it reported readiness. */
  serverUrl?: string;
}

export interface WebAppHint {
  /** Workspace-relative directory, `.` for the workspace root. */
  directory: string;
  command: string;
  url?: string;
  /** True when the agent already started this server during the turn. */
  live: boolean;
}

export interface TurnSummary {
  status: TurnStatus;
  steps: number;
  created: string[];
  modified: string[];
  /** Deliverables written outside the workspace, by `save_to_documents`. */
  saved: string[];
  commands: TurnCommandRecord[];
  checks: { name: string; ok: boolean }[];
  leftover: string[];
  webApp?: WebAppHint;
}

interface PendingCall {
  toolName: string;
  parameters: Record<string, unknown>;
  existed: boolean;
}

/** Commands that verify work rather than change it. */
const VERIFICATION_COMMAND = /\b(test|vitest|jest|pytest|tsc|typecheck|type-check|lint|eslint|biome|build)\b/i;
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|php|cs|cpp|cc|c|h|vue|svelte|astro)$/i;
const MAX_LISTED = 5;

/**
 * Records one agent turn from the structured event stream so the CLI can
 * report what actually happened without asking the model to summarise itself
 * (a model summary is unbounded prose and can claim work it never did).
 */
export class TurnRecorder {
  private readonly pending = new Map<string, PendingCall>();
  private readonly created = new Set<string>();
  private readonly modified = new Set<string>();
  private readonly saved = new Set<string>();
  private readonly commands: TurnCommandRecord[] = [];
  private readonly checks: { name: string; ok: boolean }[] = [];
  private readonly failures: string[] = [];
  private denied = 0;
  /** Jail root, resolved on first use: one recorder serves one workspace for one turn. */
  private canonicalRootCache?: string;

  constructor(private readonly workspaceRoot: string) {}

  private get canonicalRoot(): string {
    // `resolveInJail` would stat + realpath the root on every tool call; the root
    // cannot change under a single turn, so resolve it once.
    if (!this.canonicalRootCache) this.canonicalRootCache = canonicalizeRoot(this.workspaceRoot);
    return this.canonicalRootCache;
  }

  record(event: AgentEvent): void {
    if (event.type === 'tool_call_initiated') {
      const parameters = event.parameters as Record<string, unknown>;
      this.pending.set(event.toolCallId, {
        toolName: event.toolName,
        parameters,
        existed: this.fileExists(parameters.path),
      });
      return;
    }
    if (event.type === 'tool_result') {
      this.recordResult(event.toolCallId, event.result);
      return;
    }
    if (event.type === 'error') {
      this.failures.push(`Provider error: ${event.message}`);
    }
  }

  /** True when the turn changed files or ran commands, so a summary is worth showing. */
  hasWork(): boolean {
    return this.created.size + this.modified.size + this.saved.size + this.commands.length > 0;
  }

  build(status: TurnStatus, steps: number): TurnSummary {
    // Workspace changes only: a deliverable in Documents is neither code the
    // project owns nor a reason to offer to run the app.
    const changed = [...this.created, ...this.modified];
    const leftover = [...this.failures];
    if (this.denied > 0) leftover.push(`${this.denied} action${this.denied === 1 ? ' was' : 's were'} denied; those changes were not applied.`);
    if (status === 'step_limit_reached') leftover.push('The step limit ended the task before it finished; run the task again to continue.');
    if (status === 'cancelled') leftover.push('The task was stopped before it finished.');
    if (status === 'failed') leftover.push('The task failed before finishing.');
    if (changed.some((file) => CODE_FILE.test(file)) && this.checks.length === 0) {
      leftover.push('No test, typecheck, or build command ran after these edits.');
    }
    return {
      status,
      steps,
      created: [...this.created],
      modified: [...this.modified],
      saved: [...this.saved],
      commands: [...this.commands],
      checks: [...this.checks],
      leftover,
      webApp: this.webAppHint(changed),
    };
  }

  private recordResult(toolCallId: string, result: { status: string; output: string; metadata?: Record<string, unknown> }): void {
    const call = this.pending.get(toolCallId);
    this.pending.delete(toolCallId);
    if (result.status === 'denied') {
      this.denied += 1;
      return;
    }
    if (!call) return;

    if (call.toolName === 'run_command') {
      const command = formatCommand(call.parameters);
      const serverUrl = typeof result.metadata?.serverUrl === 'string' ? result.metadata.serverUrl : undefined;
      const exitCode = typeof result.metadata?.exitCode === 'number' ? result.metadata.exitCode : undefined;
      this.commands.push({ command, ok: result.status === 'success', exitCode, serverUrl });
      if (result.status !== 'success') {
        this.failures.push(`\`${command}\` failed: ${firstLine(result.output)}`);
      } else if (VERIFICATION_COMMAND.test(command)) {
        this.checks.push({ name: command, ok: true });
      }
      return;
    }

    if (call.toolName === 'run_diagnostics') {
      const script = typeof call.parameters.script === 'string' ? call.parameters.script : 'diagnostics';
      this.checks.push({ name: script, ok: result.status === 'success' });
      if (result.status !== 'success') this.failures.push(`${script} reported problems.`);
      return;
    }

    if (result.status !== 'success') {
      this.failures.push(`${call.toolName} failed: ${firstLine(result.output)}`);
      return;
    }

    if (call.toolName === 'save_to_documents') {
      // The deliverable lives outside the jail, so its absolute path comes from
      // the tool's metadata rather than a workspace-relative parameter.
      const saved = typeof result.metadata?.path === 'string' ? result.metadata.path : undefined;
      const target = saved ?? (typeof call.parameters.name === 'string' ? call.parameters.name : undefined);
      if (target) this.saved.add(target);
      return;
    }

    if (call.toolName === 'write_file' && typeof call.parameters.path === 'string') {
      (call.existed ? this.modified : this.created).add(call.parameters.path);
    } else if (call.toolName === 'edit_file' && typeof call.parameters.path === 'string') {
      this.modified.add(call.parameters.path);
    } else if (call.toolName === 'apply_patch' && Array.isArray(call.parameters.edits)) {
      for (const edit of call.parameters.edits) {
        const target = (edit as { path?: unknown })?.path;
        if (typeof target === 'string') this.modified.add(target);
      }
    }
  }

  private fileExists(relative: unknown): boolean {
    if (typeof relative !== 'string' || !relative) return false;
    try {
      return fs.existsSync(resolveInJailFromRoot(this.canonicalRoot, relative));
    } catch {
      return false;
    }
  }

  private webAppHint(changed: readonly string[]): WebAppHint | undefined {
    const started = this.commands.find((command) => command.serverUrl);
    // Nothing in the app changed and no server was started: the report has no
    // running advice to give, and `detectWebApp` would still find the root app.
    if (changed.length === 0 && !started) return undefined;
    const hint = detectWebApp(this.workspaceRoot, changed);
    if (!hint) return undefined;
    if (!started?.serverUrl) return hint;
    return { ...hint, url: started.serverUrl, live: true };
  }
}

/**
 * Add the report to the exchange that was just saved.
 *
 * The panel is painted under the answer, so a transcript export or a resumed
 * session used to stop where the prose ended and never carried the report.
 */
export function appendSummaryToHistory(messages: ChatMessage[], answer: string, summary: string): ChatMessage[] {
  let index = -1;
  for (let position = messages.length - 1; position >= 0; position -= 1) {
    if (messages[position].role === 'assistant' && messages[position].content === answer) {
      index = position;
      break;
    }
  }
  if (index === -1) return messages;
  return messages.map((message, position) =>
    position === index ? { ...message, content: `${message.content}\n\n${summary}` } : message,
  );
}

function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim().length > 0)?.trim() ?? '';
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function formatCommand(parameters: Record<string, unknown>): string {
  const command = typeof parameters.command === 'string' ? parameters.command : '';
  const args = Array.isArray(parameters.args) ? parameters.args.filter((arg): arg is string => typeof arg === 'string') : [];
  return [command, ...args].join(' ').trim();
}

const WEB_FRAMEWORKS: { dependency: RegExp; port: number }[] = [
  { dependency: /^next$/, port: 3000 },
  { dependency: /^nuxt$/, port: 3000 },
  { dependency: /^@remix-run\/dev$/, port: 3000 },
  { dependency: /^astro$/, port: 4321 },
  { dependency: /^vite$/, port: 5173 },
  { dependency: /^@sveltejs\/kit$/, port: 5173 },
  { dependency: /^react-scripts$/, port: 3000 },
  { dependency: /^parcel$/, port: 1234 },
  { dependency: /^@angular\/core$/, port: 4200 },
  { dependency: /^webpack-dev-server$/, port: 8080 },
];

const START_SCRIPTS = ['dev', 'start', 'serve', 'preview'] as const;

/**
 * Find the web app a change belongs to: the nearest ancestor directory that
 * declares a start script and a web framework (or ships an `index.html`).
 * A build-only library therefore never claims to be runnable.
 */
export function detectWebApp(workspaceRoot: string, changedPaths: readonly string[]): WebAppHint | undefined {
  // Every candidate directory resolves `package.json` and `index.html`; canonicalize
  // the root once for the whole scan rather than once per file.
  let canonicalRoot: string;
  try {
    canonicalRoot = canonicalizeRoot(workspaceRoot);
  } catch {
    return undefined;
  }
  const directories: string[] = [];
  const seen = new Set<string>();
  const add = (directory: string): void => {
    if (!directory || seen.has(directory)) return;
    seen.add(directory);
    directories.push(directory);
  };
  for (const changed of changedPaths) {
    let directory = path.posix.dirname(changed.replace(/\\/g, '/'));
    while (directory && directory !== '.' && directory !== '/' && directory !== '..') {
      add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  add('.');
  for (const directory of directories) {
    const hint = readWebAppHint(canonicalRoot, directory);
    if (hint) return hint;
  }
  return undefined;
}

function readWebAppHint(canonicalRoot: string, directory: string): WebAppHint | undefined {
  const relative = (file: string): string => (directory === '.' ? file : `${directory}/${file}`);
  const absolute = (file: string): string | undefined => {
    try {
      return resolveInJailFromRoot(canonicalRoot, relative(file));
    } catch {
      return undefined;
    }
  };
  const hasIndex = (() => {
    const target = absolute('index.html');
    return target !== undefined && fs.existsSync(target);
  })();

  const packagePath = absolute('package.json');
  if (packagePath && fs.existsSync(packagePath)) {
    let manifest: { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    try {
      if (fs.statSync(packagePath).size > 512 * 1024) return undefined;
      manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    } catch {
      return undefined;
    }
    const scripts = manifest.scripts ?? {};
    const script = START_SCRIPTS.find((name) => typeof scripts[name] === 'string');
    const dependencies = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
    const framework = WEB_FRAMEWORKS.find((candidate) => Object.keys(dependencies).some((name) => candidate.dependency.test(name)));
    if (!script || (!framework && !hasIndex)) return undefined;
    return {
      directory,
      command: `cd ${directory} && ${script === 'start' ? 'npm start' : `npm run ${script}`}`,
      url: framework ? `http://localhost:${framework.port}` : undefined,
      live: false,
    };
  }

  if (!hasIndex) return undefined;
  return {
    directory,
    command: `npx --yes serve ${directory === '.' ? '.' : directory}`,
    url: 'http://localhost:3000',
    live: false,
  };
}

/** How the report opens, in the turn's own words. */
const STATUS_TITLE: Record<TurnStatus, string> = {
  completed: 'COMPLETED!',
  step_limit_reached: 'NOT FINISHED',
  cancelled: 'STOPPED',
  failed: 'FAILED',
};

/**
 * Render the end-of-turn report: what changed, what was verified, what is
 * outstanding, and how to run the app when the turn produced one.
 */
export function formatTurnSummary(summary: TurnSummary, style: 'chat' | 'terminal' = 'chat'): string {
  const chat = style === 'chat';
  // Chat renders the report as a fenced block so the CLI can paint it as a
  // tinted panel: the summary is the answer's afterword, and it has to read as
  // a different thing from the prose above it. `#`/`##`/`-` keep it valid
  // markdown outside the CLI, where the fence degrades to a code block.
  const heading = (title: string, level: 1 | 2 = 2): string =>
    chat ? `${'#'.repeat(level)} ${title}` : `\x1b[1;38;5;75m${title}\x1b[0m`;
  const quote = (value: string): string => (chat ? `\`${value}\`` : value);
  const bullet = (text: string): string => (chat ? `- ${text}` : `  \x1b[38;5;253m•\x1b[0m ${text}`);
  const section = (title: string, items: string[]): string => [heading(title), ...items.map(bullet)].join('\n');

  const changed = [
    ...summary.created.map((file) => `Added ${quote(file)}`),
    ...summary.modified.map((file) => `Updated ${quote(file)}`),
    ...summary.saved.map((file) => `Saved ${quote(file)} to Documents`),
    ...summary.commands.map((command) => `Ran ${quote(command.command)}${command.ok ? '' : ' (failed)'}`),
  ];
  const listed = changed.slice(0, MAX_LISTED * 2);
  if (changed.length > listed.length) listed.push(`… +${changed.length - listed.length} more actions`);

  const sections = [
    heading(STATUS_TITLE[summary.status], 1),
    section('Done', listed.length > 0 ? listed : ['No workspace changes were needed.']),
  ];

  if (summary.checks.length > 0) {
    sections.push(section('Checked', summary.checks.map((check) => `${quote(check.name)} ${check.ok ? 'passed' : 'reported problems'}`)));
  }

  sections.push(section('Left over', summary.leftover.length > 0 ? summary.leftover : ['Nothing outstanding.']));

  if (summary.webApp) {
    const { command, url, live, directory } = summary.webApp;
    const where = directory === '.' ? 'workspace root' : quote(directory);
    sections.push(section('Run it', [
      live && url ? `Already running at ${quote(url)}` : `${quote(command)}${url ? ` → ${quote(url)}` : ''}`,
      `Web app in ${where}; Moderado does not keep a server in the foreground.`,
    ]));
  }

  // One blank line between sections keeps the tinted band readable; the fence
  // markers are the contract with `wrapAnswerLines` in `ui/welcome.ts`.
  return chat ? [SUMMARY_FENCE, sections.join('\n'), '```'].join('\n') : sections.join('\n\n');
}
