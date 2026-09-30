#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliArgs, getHelpText } from './args.js';
import { handleModelsCommand } from './commands/models.js';
import { handleRunCommand } from './commands/run.js';
import { handleChatSession } from './commands/chat.js';
import { handleDoctorCommand } from './commands/doctor.js';
import { writeDiagnosticLog } from './diagnostic_log.js';
import { handleSkillsCommand } from './commands/skills.js';
import { INJECTED_VERSION } from './injected_version.js';

/**
 * Injected at build time by `scripts/binaries.mjs` via `pkg --define`. `pkg`
 * snapshots the filesystem, so the root VERSION file and package.json are absent
 * inside a standalone binary; without this the CLI reported a stale v0.1.0.
 */
declare const __MODERADO_VERSION__: string | undefined;

function getVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // Check root VERSION (3 levels up from apps/cli/dist)
    const rootVersion = path.resolve(__dirname, '../../../VERSION');
    if (fs.existsSync(rootVersion)) {
      return fs.readFileSync(rootVersion, 'utf8').trim();
    }
    // Check package.json
    const pkgJson = path.resolve(__dirname, '../package.json');
    if (fs.existsSync(pkgJson)) {
      const parsed = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      return `v${parsed.version}`;
    }
  } catch {
    // ignore
  }
  // pkg snapshots the filesystem, so neither path above exists inside a standalone
  // binary. scripts/binaries.mjs writes this module before packaging; without it
  // the CLI reported a stale hardcoded version.
  return INJECTED_VERSION;
}

/** Exported so the `run` banner cannot drift from `--version`. */
export function resolveVersion(): string {
  return getVersion();
}

async function main(): Promise<void> {
  const args = parseCliArgs();

  if (args.help) {
    process.stdout.write(getHelpText());
    process.exitCode = 0;
    return;
  }

  if (args.version) {
    process.stdout.write(`${getVersion()}\n`);
    process.exitCode = 0;
    return;
  }

  const abortController = new AbortController();
  const handleSigint = () => {
    process.stdout.write('\n\x1b[33mReceived SIGINT, aborting session gracefully...\x1b[0m\n');
    abortController.abort();
  };

  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigint);

  let exitCode = 0;
  try {
    if (args.command === 'doctor') { exitCode = await handleDoctorCommand(args); } else if (args.command === 'skills') {
      exitCode = handleSkillsCommand(args.skillAction, args.skillName);
    } else if (args.command === 'models') {
      exitCode = await handleModelsCommand(args);
    } else if (args.command === 'run') {
      exitCode = await handleRunCommand(args, abortController.signal);
    } else {
      if (args.nonInteractive) {
        process.stdout.write(getHelpText());
        exitCode = 0;
      } else {
        exitCode = await handleChatSession(args, getVersion(), abortController.signal);
      }
    }
  } finally {
    process.off('SIGINT', handleSigint);
    process.off('SIGTERM', handleSigint);
  }

  process.exitCode = exitCode;
  process.exit(exitCode);
}

main().catch((err) => {
  writeDiagnosticLog(process.argv[2] ?? 'interactive', err);
  process.stderr.write(`\x1b[1;31mFatal error:\x1b[0m ${err.message}\n`);
  process.exitCode = 1;
});
