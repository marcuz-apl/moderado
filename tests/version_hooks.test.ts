import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';

const hookSource = path.resolve(import.meta.dirname, '../.githooks');
const repos: string[] = [];
const git = (repo: string, ...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const version = (repo: string) => readFileSync(path.join(repo, 'VERSION'), 'utf8').trim();
const committedVersion = (repo: string) => git(repo, 'show', 'HEAD:VERSION');
const subject = (repo: string) => git(repo, 'log', '-1', '--format=%s');

function createRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'moderado-hooks-'));
  repos.push(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'Hook Test');
  git(repo, 'config', 'user.email', 'hook@example.test');
  git(repo, 'config', 'core.autocrlf', 'false');
  const today = new Date().toISOString().slice(2, 10).replaceAll('-', '');
  writeFileSync(path.join(repo, 'VERSION'), `v0.3.4+${today}1\n`);
  writeFileSync(path.join(repo, 'notes.txt'), 'baseline\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'baseline');
  cpSync(hookSource, path.join(repo, '.githooks'), { recursive: true });
  git(repo, 'config', 'core.hooksPath', '.githooks');
  return repo;
}

function commit(repo: string, message: string, content: string): void {
  writeFileSync(path.join(repo, 'notes.txt'), `${content}\n`);
  git(repo, 'add', 'notes.txt');
  git(repo, 'commit', '-qm', message);
}

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

it('uses each pending subject for feature, docs, and explicit minor commits', () => {
  const repo = createRepo();
  commit(repo, 'feat(test): first feature', 'feature');
  expect(version(repo).split('+')[0]).toBe('v0.3.5');
  expect(subject(repo).split(' ')[0]).toBe(version(repo));
  expect(committedVersion(repo)).toBe(version(repo));

  const featureVersion = version(repo);
  commit(repo, 'docs: update notes', 'docs');
  expect(version(repo).split('+')[0]).toBe('v0.3.5');
  expect(version(repo)).not.toBe(featureVersion);
  expect(subject(repo).split(' ')[0]).toBe(version(repo));
  expect(committedVersion(repo)).toBe(version(repo));

  const docsVersion = version(repo);
  commit(repo, 'fix: correct notes', 'fix');
  expect(version(repo).split('+')[0]).toBe('v0.3.5');
  expect(version(repo)).not.toBe(docsVersion);
  expect(subject(repo).split(' ')[0]).toBe(version(repo));
  expect(committedVersion(repo)).toBe(version(repo));

  commit(repo, 'release(minor): publish milestone', 'release');
  expect(version(repo).split('+')[0]).toBe('v0.4.0');
  expect(subject(repo).split(' ')[0]).toBe(version(repo));
  expect(committedVersion(repo)).toBe(version(repo));
}, 15_000);

it('rejects a breaking commit without major approval', () => {
  const repo = createRepo();
  writeFileSync(path.join(repo, 'notes.txt'), 'breaking\n');
  git(repo, 'add', 'notes.txt');
  const result = spawnSync('git', ['commit', '-m', 'feat!: breaking API'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ALFAZEN_MAJOR_APPROVED: '' },
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Major version');
  expect(version(repo).split('+')[0]).toBe('v0.3.4');
});

it('keeps unrelated staged files out of a partial commit', () => {
  const repo = createRepo();
  writeFileSync(path.join(repo, 'pending.txt'), 'keep staged\n');
  git(repo, 'add', 'pending.txt');
  writeFileSync(path.join(repo, 'notes.txt'), 'selected\n');
  git(repo, 'commit', '-qm', 'docs: selected notes', '--only', 'notes.txt');
  expect(subject(repo).split(' ')[0]).toBe(committedVersion(repo));
  expect(git(repo, 'ls-tree', '--name-only', 'HEAD', 'pending.txt')).toBe('');
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('pending.txt');
});

it('updates VERSION when a user amends a commit', () => {
  const repo = createRepo();
  writeFileSync(path.join(repo, 'notes.txt'), 'amended\n');
  git(repo, 'add', 'notes.txt');
  git(repo, 'commit', '--amend', '-qm', 'docs: amend baseline');
  expect(subject(repo).split(' ')[0]).toBe(committedVersion(repo));
  expect(version(repo)).toBe(committedVersion(repo));
  expect(git(repo, 'show', 'HEAD:notes.txt')).toBe('amended');
});

it('does not stage a version bump when commit-msg rejects the commit', () => {
  const repo = createRepo();
  writeFileSync(path.join(repo, '.githooks', 'commit-msg'), '#!/bin/sh\nexit 1\n');
  writeFileSync(path.join(repo, 'notes.txt'), 'rejected\n');
  git(repo, 'add', 'notes.txt');
  const before = version(repo);
  const result = spawnSync('git', ['commit', '-m', 'docs: rejected'], { cwd: repo, encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(version(repo)).toBe(before);
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('notes.txt');
});

it('rolls back the original commit if the VERSION amend fails', () => {
  const repo = createRepo();
  const hookPath = path.join(repo, '.githooks', 'post-commit');
  const hook = readFileSync(hookPath, 'utf8');
  writeFileSync(hookPath, `${hook.slice(0, hook.indexOf('\n') + 1)}git() { case " $* " in *" --amend "*) return 1;; *) command git "$@";; esac; }\n${hook.slice(hook.indexOf('\n') + 1)}`);
  const before = version(repo);
  writeFileSync(path.join(repo, 'notes.txt'), 'needs recovery\n');
  git(repo, 'add', 'notes.txt');
  const result = spawnSync('git', ['commit', '-m', 'docs: update notes'], { cwd: repo, encoding: 'utf8' });
  expect(result.stderr).toContain('rolling back the commit');
  expect(subject(repo)).toBe('baseline');
  expect(version(repo)).toBe(before);
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('notes.txt');
});

it('preserves the previous tip when an amended commit cannot add VERSION', () => {
  const repo = createRepo();
  const hookPath = path.join(repo, '.githooks', 'post-commit');
  const hook = readFileSync(hookPath, 'utf8');
  writeFileSync(hookPath, `${hook.slice(0, hook.indexOf('\n') + 1)}git() { case " $* " in *" --only VERSION "*) return 1;; *) command git "$@";; esac; }\n${hook.slice(hook.indexOf('\n') + 1)}`);
  const previousHead = git(repo, 'rev-parse', 'HEAD');
  const before = version(repo);
  writeFileSync(path.join(repo, 'notes.txt'), 'amended\n');
  git(repo, 'add', 'notes.txt');
  const result = spawnSync('git', ['commit', '--amend', '-m', 'docs: amend baseline'], { cwd: repo, encoding: 'utf8' });
  expect(result.stderr).toContain('rolling back the commit');
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(previousHead);
  expect(version(repo)).toBe(before);
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('notes.txt');
});

it('does not change VERSION when signing fails after commit-msg', () => {
  const repo = createRepo();
  const before = version(repo);
  const previousHead = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(path.join(repo, 'notes.txt'), 'unsigned\n');
  git(repo, 'add', 'notes.txt');
  const result = spawnSync('git', ['-c', 'commit.gpgsign=true', '-c', 'gpg.program=missing-gpg-program', 'commit', '-m', 'docs: signed notes'], { cwd: repo, encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(previousHead);
  expect(version(repo)).toBe(before);
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('notes.txt');
  git(repo, 'commit', '-qm', 'docs: retry unsigned');
  expect(subject(repo).split(' ')[0]).toBe(committedVersion(repo));
  expect(existsSync(path.resolve(repo, git(repo, 'rev-parse', '--git-path', 'ALFAZEN_PENDING')))).toBe(false);
});
