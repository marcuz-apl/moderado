import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ApplyPatchParams, ApplyPatchParamsSchema, IToolDefinition, ToolExecutionContext, ToolResult } from '@moderado/contracts';
import { generateDiffPreview } from '../diff.js';
import { resolveInJail } from '../jail.js';

export const ApplyPatchTool: IToolDefinition<ApplyPatchParams> = {
  name: 'apply_patch', description: 'Apply validated exact edits to multiple workspace files.', requiresApproval: true, parametersSchema: ApplyPatchParamsSchema,
  async preview(params, context) {
    return params.edits.map((edit) => {
      const original = fs.readFileSync(resolveInJail(context.workspaceRoot, edit.path), 'utf8');
      return generateDiffPreview(edit.path, original, edit.targetContent, edit.replacementContent).diffPreview;
    }).join('\n');
  },
  async execute(params: ApplyPatchParams, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const prepared = params.edits.map((edit) => {
        const absolute = resolveInJail(context.workspaceRoot, edit.path);
        const original = fs.readFileSync(absolute, 'utf8');
        return { absolute, edit, result: generateDiffPreview(edit.path, original, edit.targetContent, edit.replacementContent) };
      });
      for (const item of prepared) {
        const temp = path.join(path.dirname(item.absolute), `.tmp.moderado.${crypto.randomUUID()}`);
        fs.writeFileSync(temp, item.result.newContent, 'utf8'); fs.renameSync(temp, item.absolute);
      }
      const preview = prepared.map((item) => item.result.diffPreview).join('\n');
      return { toolName: 'apply_patch', status: 'success', output: preview, metadata: { diffPreview: preview } };
    } catch (err: any) { return { toolName: 'apply_patch', status: 'error', output: err.message }; }
  },
};
