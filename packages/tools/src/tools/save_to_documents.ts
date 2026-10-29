import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  IToolDefinition,
  ToolExecutionContext,
  ToolResult,
  SaveDocumentParams,
  SaveDocumentParamsSchema,
} from '@moderado/contracts';
import { canonicalizeRoot, resolveInJailFromRoot } from '../jail.js';
import { SecurityViolationError } from '../errors.js';

/**
 * Names Windows reserves for devices. They are valid bytes on POSIX, but a
 * deliverable named `CON.txt` cannot be opened or deleted there, and the user
 * shares deliverables.
 */
const WINDOWS_RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function isReservedWindowsFileName(name: string): boolean {
  return name
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => WINDOWS_RESERVED_SEGMENT.test(segment.replace(/[. ]+$/, '').split('.')[0] ?? ''));
}

/**
 * The tools whose write leaves the workspace jail. The approval gate keys on
 * this, so an auto-approve session still asks before a file lands outside it.
 */
export const OUT_OF_WORKSPACE_TOOLS: ReadonlySet<string> = new Set(['save_to_documents']);

export interface DocumentsDirectoryOptions {
  platform?: NodeJS.Platform;
  homedir?: () => string;
  env?: NodeJS.ProcessEnv;
  readPersonalFolder?: () => string | undefined;
}

const USER_SHELL_FOLDERS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';

/** Explorer and Office show this folder, so it is the one the user actually looks in. */
function readWindowsPersonalFolder(): string | undefined {
  try {
    const raw = execFileSync('reg', ['query', USER_SHELL_FOLDERS_KEY, '/v', 'Personal'], {
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
    const value = text.match(/Personal\s+REG_\w+_SZ\s+(.+)/)?.[1]?.trim();
    return value && !value.includes('\uFFFD') ? value : undefined;
  } catch {
    return undefined;
  }
}

function expandEnvironmentVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([A-Za-z0-9_]+)%/g, (token, name: string) => env[name] ?? token);
}

let cachedDocumentsRoot: string | undefined;

/**
 * The user's Documents folder; deliverables belong here, not in the workspace.
 *
 * On Windows the shell knows where the folder really is, because OneDrive
 * redirection moves it off the profile while `os.homedir()` stays put.
 */
export function documentsDirectory(options: DocumentsDirectoryOptions = {}): string {
  const cachedOnly = Object.keys(options).length === 0;
  if (cachedOnly && cachedDocumentsRoot) return cachedDocumentsRoot;

  const platform = options.platform ?? process.platform;
  const fallback = path.join((options.homedir ?? os.homedir)(), 'Documents');
  let root = fallback;

  if (platform === 'win32') {
    const personal = (options.readPersonalFolder ?? readWindowsPersonalFolder)();
    if (personal) {
      const expanded = expandEnvironmentVars(personal, options.env ?? process.env);
      // A redirected folder is the destination even before it exists locally:
      // Explorer shows it, and the save creates it on the way through.
      if (path.isAbsolute(expanded) && !expanded.includes('%')) root = expanded;
    }
  }

  if (cachedOnly) cachedDocumentsRoot = root;
  return root;
}

/** The home directory is not the model's business; Documents is enough. */
function describeDocumentsPath(targetPath: string, documentsRoot: string): string {
  const relative = path.relative(documentsRoot, targetPath);
  return relative && !relative.startsWith('..') ? path.join('Documents', relative) : 'Documents';
}

/**
 * Save a user-facing deliverable into Documents.
 *
 * The workspace jail still owns every repository path; this is a single,
 * explicit destination outside it, reachable only through this tool. It reuses
 * the jail's canonicalization, so `..`, absolute paths, and symlinked folders
 * that point elsewhere are rejected exactly as they are inside a workspace.
 */
export function createSaveToDocumentsTool(documentsRoot?: string): IToolDefinition<SaveDocumentParams> {
  const rootOf = (): string => documentsRoot ?? documentsDirectory();
  return {
    name: 'save_to_documents',
    description:
      "Save a file into the user's Documents folder. Use this whenever the user asks for a file to keep, open, download, or share (notes, reports, exports); the absolute path is returned so you can tell the user where it is.",
    requiresApproval: true,
    parametersSchema: SaveDocumentParamsSchema,

    /**
     * Name the destination and show what goes into it.
     *
     * This is the only write that leaves the workspace, so approving it blind is
     * not approving: the person needs the folder, whether the file is already
     * there, and the bytes about to land.
     */
    async preview(params: SaveDocumentParams): Promise<string> {
      let canonicalRoot = rootOf();
      try {
        canonicalRoot = canonicalizeRoot(canonicalRoot);
      } catch {
        // Report the folder the user would be asked about, not a stack trace.
      }
      const header = [`Documents folder    ${canonicalRoot}`];
      if (process.platform === 'win32' && isReservedWindowsFileName(params.name)) {
        return `${header.join('\n')}\n'${params.name}' cannot go there: it is a reserved name on Windows.`;
      }

      let targetPath: string;
      try {
        targetPath = resolveInJailFromRoot(canonicalRoot, params.name);
      } catch {
        return `${header.join('\n')}\n'${params.name}' cannot go there: the file name must stay inside your Documents folder.`;
      }

      header.push(`File              ${targetPath}${fs.existsSync(targetPath) ? '  (already exists — it will be replaced)' : ''}`);
      const body = params.content.split(/\r?\n/).map((line) => `+${line}`);
      return `${header.join('\n')}\n\n${body.join('\n')}`;
    },

    async execute(params: SaveDocumentParams, _context: ToolExecutionContext): Promise<ToolResult> {
      const root = rootOf();
      let canonicalRoot = root;
      // Only this tool writes outside the workspace, so its own failures must
      // not publish the user's home directory into provider context.
      const hideRoot = (message: string): string => [root, canonicalRoot]
        .reduce((text, value) => text.split(value).join('Documents'), message);
      const failed = (reason: string): ToolResult => ({
        toolName: 'save_to_documents',
        status: 'error',
        output: `Cannot save '${params.name}' to Documents: ${reason}`,
      });

      if (process.platform === 'win32' && isReservedWindowsFileName(params.name)) {
        return failed(`'${params.name}' is a reserved name on Windows. Choose another file name.`);
      }

      try {
        if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
        canonicalRoot = canonicalizeRoot(root);
      } catch (err) {
        return failed(hideRoot(describeReason(err)));
      }

      let targetPath: string;
      try {
        targetPath = resolveInJailFromRoot(canonicalRoot, params.name);
      } catch (err) {
        // The jail quotes the resolved absolute path, which is inside home.
        return failed(err instanceof SecurityViolationError
          ? 'the file name must stay inside your Documents folder'
          : hideRoot(describeReason(err)));
      }

      const parentDir = path.dirname(targetPath);
      try {
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

        const tmpPath = path.join(parentDir, `.tmp.moderado.${crypto.randomUUID()}`);
        try {
          fs.writeFileSync(tmpPath, params.content, 'utf8');
          fs.renameSync(tmpPath, targetPath);
        } catch (err) {
          if (fs.existsSync(tmpPath)) {
            try {
              fs.unlinkSync(tmpPath);
            } catch {
              // ignore cleanup failure
            }
          }
          throw err;
        }
      } catch (err) {
        return failed(hideRoot(describeReason(err)));
      }

      const lineCount = params.content.split(/\r?\n/).length;
      const byteLength = Buffer.byteLength(params.content, 'utf8');
      return {
        toolName: 'save_to_documents',
        status: 'success',
        output: `Saved ${lineCount} lines (${byteLength} bytes) to '${targetPath}'.`,
        metadata: { path: targetPath, displayPath: describeDocumentsPath(targetPath, canonicalRoot), byteLength, lineCount },
      };
    },
  };
}

function describeReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
