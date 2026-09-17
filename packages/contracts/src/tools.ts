import { z } from 'zod';
import type { ProviderToolDeclaration } from './provider.js';

export const ToolExecutionStatusSchema = z.enum(['success', 'error', 'denied']);
export type ToolExecutionStatus = z.infer<typeof ToolExecutionStatusSchema>;

export const ToolResultSchema = z.object({
  toolName: z.string().min(1),
  status: ToolExecutionStatusSchema,
  output: z.string(),
  truncated: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export interface ToolExecutionContext {
  workspaceRoot: string;
  abortSignal?: AbortSignal;
}

export interface IToolDefinition<TParams = unknown> {
  readonly name: string;
  readonly description: string;
  readonly requiresApproval: boolean;
  readonly parametersSchema: z.ZodType<TParams>;
  execute(params: TParams, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface IToolRegistry {
  register(tool: IToolDefinition<any>): void;
  get(name: string): IToolDefinition<any> | undefined;
  list(): IToolDefinition<any>[];
  getDeclarations(): ProviderToolDeclaration[];
}

// --- Specific Parameter Schemas for the 7 Workspace Tools ---

export const ReadFileParamsSchema = z.object({
  path: z.string().min(1, 'File path cannot be empty'),
  offset: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(2000).default(500),
});
export type ReadFileParams = z.infer<typeof ReadFileParamsSchema>;

export const WriteFileParamsSchema = z.object({
  path: z.string().min(1, 'File path cannot be empty'),
  content: z.string(),
});
export type WriteFileParams = z.infer<typeof WriteFileParamsSchema>;

export const EditFileParamsSchema = z.object({
  path: z.string().min(1, 'File path cannot be empty'),
  targetContent: z.string().min(1, 'Target content must not be empty'),
  replacementContent: z.string(),
});
export type EditFileParams = z.infer<typeof EditFileParamsSchema>;

export const ListFilesParamsSchema = z.object({
  subpath: z.string().default('.'),
  recursive: z.boolean().default(false),
  maxDepth: z.number().int().min(1).max(10).default(3),
  limit: z.number().int().min(1).max(500).default(200),
});
export type ListFilesParams = z.infer<typeof ListFilesParamsSchema>;

export const SearchFilesParamsSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  isRegex: z.boolean().default(false),
  caseSensitive: z.boolean().default(true),
  includes: z.array(z.string()).optional(),
  maxResults: z.number().int().min(1).max(100).default(50),
});
export type SearchFilesParams = z.infer<typeof SearchFilesParamsSchema>;

export const RunCommandParamsSchema = z.object({
  command: z.string().min(1, 'Command cannot be empty'),
  args: z.array(z.string()).default([]),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
});
export type RunCommandParams = z.infer<typeof RunCommandParamsSchema>;

export const GitDiffParamsSchema = z.object({
  staged: z.boolean().default(false),
  targetRef: z.string().regex(/^[a-zA-Z0-9_\-\.\/]+$/).optional(),
  filePaths: z.array(z.string()).optional(),
});
export type GitDiffParams = z.infer<typeof GitDiffParamsSchema>;
