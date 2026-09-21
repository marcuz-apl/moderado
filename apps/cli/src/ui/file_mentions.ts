import { listFiles } from '@moderado/tools';

/**
 * Parse `@`-mention tokens out of composer text and expand them to absolute
 * workspace paths. Only the token directly at the caret is auto-completed;
 * submission expands every token to a path + excerpt block appended to the
 * prompt, keeping the model context explicit and approval-free (reads are
 * auto-approved by the jail).
 */
export interface MentionExpansion {
  /** Prompt sent to the model, with each `@token` replaced by path + excerpt. */
  text: string;
  /** Mention tokens that could not be resolved (reported back to the user). */
  unresolved: string[];
}

const MENTION_PATTERN = /@([\w./-]+)/g;

/** Parse the `@`-token that ends at the caret, for autocomplete filtering. */
export function activeMentionToken(input: string, caret: number): { token: string; start: number } | undefined {
  const before = input.slice(0, caret);
  const match = /@([\w./-]*)$/.exec(before);
  if (!match) return undefined;
  return { token: match[1], start: caret - match[0].length };
}

export interface WorkspaceFileSource {
  listFiles(relativePath: string): Promise<string[]>;
  readFile(relativePath: string): Promise<string>;
}

/**
 * Expand every `@token` mention into a fenced block with the file path and a
 * capped excerpt (first 200 lines). Unresolvable tokens are left verbatim and
 * reported, so nothing silently disappears from the user's prompt.
 */
export async function expandMentions(
  input: string,
  workspace: WorkspaceFileSource,
  options: { maxExcerptLines?: number } = {}
): Promise<MentionExpansion> {
  const maxLines = options.maxExcerptLines ?? 200;
  const unresolved: string[] = [];
  let text = input;

  const matches = [...input.matchAll(MENTION_PATTERN)];
  for (const match of matches.reverse()) {
    const token = match[1];
    const full = `@${token}`;
    try {
      const files = await workspace.listFiles(token);
      const target = files.length === 1 ? files[0] : files[0] ?? token;
      const content = await workspace.readFile(target);
      const lines = content.split('\n').slice(0, maxLines);
      text = text.replace(full, `\n--- @${target} ---\n${lines.join('\n')}\n--- end @${target} ---`);
    } catch {
      unresolved.push(full);
    }
  }

  for (const missing of unresolved) {
    text = text.replace(missing, `${missing} (file not found)`);
  }
  return { text: text.trim(), unresolved };
}
