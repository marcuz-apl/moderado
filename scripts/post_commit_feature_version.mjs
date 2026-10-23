import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IDENTIFIER = /^(v\d+\.\d+\.\d+)\+(\d{6}[0-9a-zA-Z])$/;
const STAMP = /^v\d+\.\d+\.\d+\+\d{6}[0-9a-zA-Z] /;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function packageVersion(document, lockfile) {
  const target = lockfile ? document.packages?.['apps/cli'] : document;
  if (!target) throw new Error('package-lock.json has no apps/cli entry');
  return target;
}

function main() {
  if (process.env.ALFAZEN_POST_COMMIT_AMEND === '1') return;

  const subject = git('log', '-1', '--format=%s').trim();
  const plainSubject = subject.replace(STAMP, '');
  if (!/^feat(?:\([^\r\n)]*\))?:\s/.test(plainSubject)) return;

  const headVersion = git('show', 'HEAD:VERSION').trim();
  const parentVersion = git('show', 'HEAD^:VERSION').trim();
  const headMatch = IDENTIFIER.exec(headVersion);
  const parentMatch = IDENTIFIER.exec(parentVersion);
  if (!headMatch || !parentMatch) throw new Error('Malformed VERSION in feature commit or its parent');
  if (headMatch[1] !== parentMatch[1]) return; // Already bumped (for example, an explicit release bump).

  const semverMatch = /^v(\d+)\.(\d+)\.(\d+)$/.exec(headMatch[1]);
  if (!semverMatch) throw new Error(`Malformed SemVer in VERSION: ${headVersion}`);
  const nextSemver = `v${semverMatch[1]}.${semverMatch[2]}.${Number(semverMatch[3]) + 1}`;
  const nextVersion = `${nextSemver}+${headMatch[2]}`;
  const app = JSON.parse(git('show', 'HEAD:apps/cli/package.json'));
  app.version = nextSemver.slice(1);
  const lock = JSON.parse(git('show', 'HEAD:package-lock.json'));
  packageVersion(lock, true).version = nextSemver.slice(1);

  writeFileSync('VERSION', `${nextVersion}\n`);
  writeFileSync('apps/cli/package.json', `${JSON.stringify(app, null, 2)}\n`);
  writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);

  const message = git('log', '-1', '--format=%B').replace(STAMP, `${nextVersion} `);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'moderado-feature-version-'));
  const messageFile = path.join(tempDir, 'message.txt');
  writeFileSync(messageFile, message);
  try {
    execFileSync('git', ['add', '--', 'VERSION', 'apps/cli/package.json', 'package-lock.json'], { stdio: 'inherit' });
    execFileSync('git', ['commit', '--amend', '--no-verify', '--file', messageFile], {
      stdio: 'inherit',
      env: { ...process.env, ALFAZEN_POST_COMMIT_AMEND: '1' },
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`alfazen-versioning: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
