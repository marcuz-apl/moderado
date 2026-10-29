import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {
  IToolDefinition,
  ToolExecutionContext,
  ToolResult,
  SaveDocumentParams,
  SaveDocumentParamsSchema,
} from '@moderado/contracts';
import { canonicalizeRoot, resolveInJailFromRoot } from '../jail.js';

/** The user's Documents folder; deliverables belong here, not in the workspace. */
export function documentsDirectory(): string {
  return path.join(os.homedir(), 'Documents');
}

/**
 * Save a user-facing deliverable into Documents.
 *
 * The workspace jail still owns every repository path; this is a single,
 * explicit destination outside it, reachable only through this tool. It reuses
 * the jail's canonicalization, so `..`, absolute paths, and symlinked folders
 * that point elsewhere are rejected exactly as they are inside a workspace.
 */
export function createSaveToDocumentsTool(documentsRoot: string = documentsDirectory()): IToolDefinition<SaveDocumentParams> {
  return {
    name: 'save_to_documents',
    description:
      "Save a file into the user's Documents folder. Use this whenever the user asks for a file to keep, open, download, or share (notes, reports, exports); the absolute path is returned so you can tell the user where it is.",
    requiresApproval: true,
    parametersSchema: SaveDocumentParamsSchema,

    async execute(params: SaveDocumentParams, _context: ToolExecutionContext): Promise<ToolResult> {
      let targetPath: string;
      try {
        if (!fs.existsSync(documentsRoot)) fs.mkdirSync(documentsRoot, { recursive: true });
        targetPath = resolveInJailFromRoot(canonicalizeRoot(documentsRoot), params.name);
      } catch (err: any) {
        return {
          toolName: 'save_to_documents',
          status: 'error',
          output: `Cannot save '${params.name}' to Documents: ${err.message}`,
        };
      }

      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

      const tmpPath = path.join(parentDir, `.tmp.moderado.${crypto.randomUUID()}`);
      try {
        fs.writeFileSync(tmpPath, params.content, 'utf8');
        fs.renameSync(tmpPath, targetPath);
      } catch (err: any) {
        if (fs.existsSync(tmpPath)) {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // ignore cleanup failure
          }
        }
        return {
          toolName: 'save_to_documents',
          status: 'error',
          output: `Failed to save '${params.name}' to Documents: ${err.message}`,
        };
      }

      const lineCount = params.content.split(/\r?\n/).length;
      const byteLength = Buffer.byteLength(params.content, 'utf8');
      return {
        toolName: 'save_to_documents',
        status: 'success',
        output: `Saved ${lineCount} lines (${byteLength} bytes) to '${targetPath}'.`,
        metadata: { path: targetPath, byteLength, lineCount },
      };
    },
  };
}
