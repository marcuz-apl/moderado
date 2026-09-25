import fs from 'node:fs';
import path from 'node:path';
import { listFiles, resolveInJail } from '@moderado/tools';

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

const MENTION_PATTERN = /@([\w./\\-]+)/g;

export const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

export function isImagePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext in IMAGE_EXTENSIONS;
}

export function getImageMimeType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS[ext];
}

/** Parse the `@`-token that ends at the caret, for autocomplete filtering. */
export function activeMentionToken(input: string, caret: number): { token: string; start: number } | undefined {
  const before = input.slice(0, caret);
  const match = /@([\w./\\-]*)$/.exec(before);
  if (!match) return undefined;
  return { token: match[1].replace(/\\/g, '/'), start: caret - match[0].length };
}

export interface WorkspaceFileSource {
  listFiles(relativePath: string): Promise<string[]>;
  readFile(relativePath: string): Promise<string>;
  readImage?(relativePath: string): Promise<Buffer>;
}

export function createWorkspaceFileSource(workspaceRoot: string): WorkspaceFileSource {
  return {
    async listFiles(relativePath: string) {
      return listFiles(workspaceRoot, relativePath, { recursive: true, maxDepth: 5, limit: 50 });
    },
    async readFile(relativePath: string) {
      const canonical = resolveInJail(workspaceRoot, relativePath);
      return fs.readFileSync(canonical, 'utf8');
    },
    async readImage(relativePath: string) {
      const canonical = resolveInJail(workspaceRoot, relativePath);
      return fs.readFileSync(canonical);
    },
  };
}

export function filterMentionCandidates(candidates: string[], token: string, limit = 8): string[] {
  const q = token.toLowerCase().trim();
  if (!q) return candidates.slice(0, limit);
  const exactStart: string[] = [];
  const substring: string[] = [];
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    const base = path.basename(candidate).toLowerCase();
    if (base.startsWith(q) || normalized.startsWith(q)) {
      exactStart.push(candidate);
    } else if (normalized.includes(q)) {
      substring.push(candidate);
    }
  }
  return [...exactStart, ...substring].slice(0, limit);
}

/**
 * Render one resolved workspace file as the fenced mention block used in
 * prompts. Shared by the TUI composer (`expandMentions`) and the host runtime
 * (`chat.send` context files) so both embed identical content. Throws when the
 * file cannot be read; callers decide how to report the failure.
 */
export async function renderFileContent(
  target: string,
  workspace: WorkspaceFileSource,
  options: { maxExcerptLines?: number } = {}
): Promise<string> {
  const maxLines = options.maxExcerptLines ?? 200;

  if (isImagePath(target)) {
    const mime = getImageMimeType(target) ?? 'application/octet-stream';
    if (workspace.readImage) {
      const buffer = await workspace.readImage(target);
      if (buffer.byteLength > 1024 * 1024) {
        return `\n--- @${target} (image) ---\n[Attached image: ${target} (${mime}, ${buffer.byteLength} bytes - exceeded 1MB inline limit)]\n--- end @${target} ---`;
      }
      const base64 = buffer.toString('base64');
      return `\n--- @${target} (image) ---\n[Attached image: ${target} (${mime}, ${buffer.byteLength} bytes)]\ndata:${mime};base64,${base64}\n--- end @${target} ---`;
    }
    try {
      const content = await workspace.readFile(target);
      return `\n--- @${target} ---\n${content}\n--- end @${target} ---`;
    } catch {
      return `\n--- @${target} (image) ---\n[Attached image: ${target} (${mime})]\n--- end @${target} ---`;
    }
  }

  const content = await workspace.readFile(target);
  const lines = content.split(/\r?\n/).slice(0, maxLines);
  return `\n--- @${target} ---\n${lines.join('\n')}\n--- end @${target} ---`;
}

/**
 * Expand every `@token` mention into a fenced block with the file path and a
 * capped excerpt (first 200 lines) or attached image payload. Unresolvable
 * tokens are left verbatim and reported, so nothing silently disappears from
 * the user's prompt.
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
    const rawToken = match[1];
    const token = rawToken.replace(/\\/g, '/');
    const full = `@${rawToken}`;
    try {
      const files = await workspace.listFiles(token);
      const target = files.length === 1 ? files[0] : files[0] ?? token;
      const block = await renderFileContent(target, workspace, { maxExcerptLines: maxLines });
      text = text.replace(full, block);
    } catch {
      unresolved.push(full);
    }
  }

  for (const missing of unresolved) {
    text = text.replace(missing, `${missing} (file not found)`);
  }
  return { text: text.trim(), unresolved };
}
