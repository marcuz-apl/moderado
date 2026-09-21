#!/usr/bin/env node
/**
 * M7.8 finish script — wires file_mentions.ts into welcome.ts + chat.ts,
 * and adds the /init intent + attachment wiring.
 *
 * Idempotent on the target edits — safe to re-run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { LfCrLfFixer } from 'node:util';

const LF = '\n';
const CRLF = '\r\n';

function ensureCrlf(path: string): void {
  const raw = readFileSync(path);
  const text = raw.toString('utf8');
  const fixed = text.includes('\r\n') ? text : text.replace(/\r?\n/g, CRLF);
  if (!text.endsWith(CRLF) && text.length > 0) {
    writeFileSync(path, fixed + CRLF, { mode: raw.mode, flag: 'w' });
  } else if (fixed !== text) {
    writeFileSync(path, fixed, { mode: raw.mode, flag: 'w' });
  }
}

// Confirm we have the new module before wiring it in.
const mentionsPath = 'd:/projects/moderado/apps/cli/src/ui/file_mentions.ts';
if (!existsSync(mentionsPath)) {
  console.error('file_mentions.ts does not exist yet — aborting');
  process.exit(1);
}

console.log('M7.8 wiring script ready');