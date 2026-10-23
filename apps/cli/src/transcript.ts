/**
 * Session transcript export.
 *
 * The chat window shows one turn at a time, so earlier turns scroll out of
 * existence. `/transcript` writes the whole conversation — every question, every
 * answer, every turn summary — to a markdown file under `~/.moderado/transcripts`
 * and hands it to the pager, which is where long-form reading belongs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TranscriptMessage {
  role: string;
  /** Assistant turns that only call tools carry no text. */
  content: string | null;
}

export interface TranscriptOptions {
  messages: readonly TranscriptMessage[];
  workspace: string;
  model: string;
  sessionId?: string;
  /** Home directory override (tests). */
  home?: string;
  /** Clock override (tests). */
  now?: Date;
}

const SUMMARY_OPEN = '```summary';

/**
 * Turn the summary fence into a real heading.
 *
 * Inside the CLI the fence marks the tinted panel; in a markdown file it would
 * render as a code block, which is the wrong voice for a report.
 */
function unFenceSummary(text: string): string {
  const out: string[] = [];
  let inSummary = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!inSummary && trimmed === SUMMARY_OPEN) { inSummary = true; out.push('### Turn summary'); continue; }
    if (inSummary && trimmed === '```') { inSummary = false; continue; }
    out.push(line);
  }
  return out.join('\n');
}

export function buildTranscriptMarkdown(options: TranscriptOptions): string {
  const now = options.now ?? new Date();
  const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
  const lines: string[] = [
    '# Moderado transcript',
    '',
    `- **Workspace**: \`${options.workspace}\``,
    `- **Model**: \`${options.model}\``,
  ];
  if (options.sessionId) lines.push(`- **Session**: \`${options.sessionId}\``);
  lines.push(`- **Exported**: ${stamp}`, '', '---', '');

  let turn = 0;
  for (const message of options.messages) {
    const body = (message.content ?? '').trim();
    if (body.length === 0) continue;
    if (message.role === 'user') turn += 1;
    const who = message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Moderado' : message.role;
    lines.push(`## ${turn || 1} · ${who}`, '', unFenceSummary(body), '');
  }
  if (turn === 0) lines.push('_This session has no completed turns yet._', '');
  return lines.join('\n');
}

/** Write the transcript and return its absolute path. */
export function writeTranscript(options: TranscriptOptions): string {
  const home = options.home ?? os.homedir();
  const directory = path.join(home, '.moderado', 'transcripts');
  fs.mkdirSync(directory, { recursive: true });
  const now = options.now ?? new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = path.basename(options.workspace) || 'session';
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
  const file = path.join(directory, `${safe}-${stamp}.md`);
  fs.writeFileSync(file, buildTranscriptMarkdown(options), 'utf8');
  return file;
}
