import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectGitWorkspace } from '../src/git_workspace.js';

describe('inspectGitWorkspace', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

  it('reports branch and changed workspace-relative files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-git-'));
    dirs.push(root);
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Moderado Test'], { cwd: root });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'one\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: root });
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'two\n');
    fs.writeFileSync(path.join(root, 'new.txt'), 'new\n');

    const summary = await inspectGitWorkspace(root);
    expect(summary.isRepository).toBe(true);
    expect(summary.branch).toBeTruthy();
    expect(summary.files.map((file) => file.path)).toEqual(expect.arrayContaining(['tracked.txt', 'new.txt']));
  });

  it('returns an empty non-repository summary', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-no-git-'));
    dirs.push(root);
    await expect(inspectGitWorkspace(root)).resolves.toEqual({ isRepository: false, files: [] });
  });
});
