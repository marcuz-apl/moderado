import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceCheckpointStore } from '../src/checkpoints.js';
describe('WorkspaceCheckpointStore', () => { const dirs: string[]=[]; afterEach(()=>dirs.splice(0).forEach(d=>fs.rmSync(d,{recursive:true,force:true})));
  it('restores only when files retain the recorded post-write digest', () => { const root=fs.mkdtempSync(path.join(os.tmpdir(),'moderado-cp-')); const home=fs.mkdtempSync(path.join(os.tmpdir(),'moderado-cp-home-')); dirs.push(root,home); const file=path.join(root,'a.txt'); fs.writeFileSync(file,'old'); const store=new WorkspaceCheckpointStore(home); store.capture(root,['a.txt']); fs.writeFileSync(file,'new'); store.recordPostWrite(root,['a.txt']); expect(store.restoreLatest(root)).toEqual({restored:['a.txt'],conflicts:[]}); expect(fs.readFileSync(file,'utf8')).toBe('old'); });
});
