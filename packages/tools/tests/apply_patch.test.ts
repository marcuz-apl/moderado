import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplyPatchTool } from '../src/tools/apply_patch.js';

describe('ApplyPatchTool', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
  it('validates every edit before writing any file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-patch-')); dirs.push(root);
    fs.writeFileSync(path.join(root, 'a.txt'), 'one'); fs.writeFileSync(path.join(root, 'b.txt'), 'two');
    const result = await ApplyPatchTool.execute({ edits: [
      { path: 'a.txt', targetContent: 'one', replacementContent: 'ONE' },
      { path: 'b.txt', targetContent: 'missing', replacementContent: 'TWO' },
    ] }, { workspaceRoot: root });
    expect(result.status).toBe('error');
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('one');
  });
});
