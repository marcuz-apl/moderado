import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceCheckpointStore } from '../src/checkpoints.js';
describe('WorkspaceCheckpointStore', () => { const dirs: string[]=[]; afterEach(()=>dirs.splice(0).forEach(d=>fs.rmSync(d,{recursive:true,force:true})));
  it('restores only when files retain the recorded post-write digest', () => { const root=fs.mkdtempSync(path.join(os.tmpdir(),'moderado-cp-')); const home=fs.mkdtempSync(path.join(os.tmpdir(),'moderado-cp-home-')); dirs.push(root,home); const file=path.join(root,'a.txt'); fs.writeFileSync(file,'old'); const store=new WorkspaceCheckpointStore(home); store.capture(root,['a.txt']); fs.writeFileSync(file,'new'); store.recordPostWrite(root,['a.txt']); expect(store.restoreLatest(root)).toEqual({restored:['a.txt'],conflicts:[]}); expect(fs.readFileSync(file,'utf8')).toBe('old'); });

  it('reports conflicts without restoring any file after an external change', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-cp-conflict-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-cp-home-'));
    dirs.push(root, home);
    fs.writeFileSync(path.join(root, 'a.txt'), 'before a');
    fs.writeFileSync(path.join(root, 'b.txt'), 'before b');
    const store = new WorkspaceCheckpointStore(home);
    store.capture(root, ['a.txt', 'b.txt']);
    fs.writeFileSync(path.join(root, 'a.txt'), 'after a');
    fs.writeFileSync(path.join(root, 'b.txt'), 'after b');
    store.recordPostWrite(root, ['a.txt', 'b.txt']);
    fs.writeFileSync(path.join(root, 'b.txt'), 'external b');

    expect(store.restoreLatest(root)).toEqual({ restored: [], conflicts: ['b.txt'] });
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('after a');
    expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe('external b');
  });


  it('preserves binary bytes and rejects outside-workspace checkpoint paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-cp-binary-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-cp-home-'));
    dirs.push(root, home);
    const file = path.join(root, 'binary.dat');
    const before = Buffer.from([0, 255, 128, 10]);
    fs.writeFileSync(file, before);
    const store = new WorkspaceCheckpointStore(home);
    store.capture(root, ['binary.dat']);
    fs.writeFileSync(file, Buffer.from([1, 2]));
    store.recordPostWrite(root, ['binary.dat']);
    expect(store.restoreLatest(root)).toEqual({ restored: ['binary.dat'], conflicts: [] });
    expect(fs.readFileSync(file)).toEqual(before);
    expect(() => store.capture(root, ['../outside.txt'])).toThrow(/escapes workspace jail/);
  });
});
