import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GetDefinitionTool } from '../src/tools/language_intelligence.js';

describe('language intelligence tools', () => {
  const roots: string[]=[];
  afterEach(()=>{ delete process.env.MODERADO_TYPESCRIPT_LANGUAGE_SERVER; roots.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true})); });
  it('reports a clear error when the configured server cannot start', async () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'moderado-lsp-')); roots.push(root);
    fs.writeFileSync(path.join(root,'a.ts'),'const value = 1;');
    process.env.MODERADO_TYPESCRIPT_LANGUAGE_SERVER='moderado-missing-language-server';
    const result=await GetDefinitionTool.execute({path:'a.ts',line:1,column:7},{workspaceRoot:root});
    expect(result.status).toBe('error');
    expect(result.output).toContain('Unable to start TypeScript language server');
  });
});