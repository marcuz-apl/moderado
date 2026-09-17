import fs from 'node:fs';
import path from 'node:path';
import {
  IToolDefinition,
  ListFilesParams,
  ListFilesParamsSchema,
  ToolExecutionContext,
  ToolResult,
} from '@moderado/contracts';
import { isProtectedPath, resolveInJail } from '../jail.js';

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.turbo',
  '.next',
  '.nuxt',
  'coverage',
]);

export const ListFilesTool: IToolDefinition<ListFilesParams> = {
  name: 'list_files',
  description: 'List files and directories in the workspace with recursive options.',
  requiresApproval: false,
  parametersSchema: ListFilesParamsSchema,

  async execute(params: ListFilesParams, context: ToolExecutionContext): Promise<ToolResult> {
    const canonicalDir = resolveInJail(context.workspaceRoot, params.subpath);

    if (!fs.existsSync(canonicalDir)) {
      return {
        toolName: 'list_files',
        status: 'error',
        output: `Error: Directory '${params.subpath}' does not exist.`,
      };
    }

    const stat = fs.statSync(canonicalDir);
    if (!stat.isDirectory()) {
      return {
        toolName: 'list_files',
        status: 'error',
        output: `Error: '${params.subpath}' is a file, not a directory.`,
      };
    }

    const results: string[] = [];
    let hitLimit = false;

    function walk(currentDir: string, currentDepth: number) {
      if (hitLimit || currentDepth > params.maxDepth) {
        return;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (err: any) {
        results.push(`[Permission denied: ${path.relative(context.workspaceRoot, currentDir)}]`);
        return;
      }

      for (const entry of entries) {
        if (results.length >= params.limit) {
          hitLimit = true;
          return;
        }

        const fullPath = path.join(currentDir, entry.name);
        const relFromRoot = path.relative(context.workspaceRoot, fullPath);

        if (isProtectedPath(relFromRoot)) {
          continue;
        }

        if (entry.isDirectory()) {
          if (DEFAULT_IGNORED_DIRS.has(entry.name)) {
            continue;
          }
          results.push(`${relFromRoot}/`);
          if (params.recursive) {
            walk(fullPath, currentDepth + 1);
          }
        } else {
          results.push(relFromRoot);
        }
      }
    }

    walk(canonicalDir, 1);

    let output = results.join('\n');
    if (hitLimit) {
      output += `\n... [Limit of ${params.limit} files reached]`;
    } else if (results.length === 0) {
      output = '(Empty directory)';
    }

    return {
      toolName: 'list_files',
      status: 'success',
      output,
      truncated: hitLimit,
      metadata: {
        totalCount: results.length,
      },
    };
  },
};
