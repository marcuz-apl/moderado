/**
 * Explicit SemVer bump for Alfazen versioning.
 *
 * Used for explicit patch/minor releases. Feature commits bump the patch
 * automatically in post-commit, which amends the same commit with the bump.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IDENTIFIER = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\+(\d{6})([0-9a-zA-Z])$/;

/** Pure helper so the arithmetic is testable without touching the repository. */
export function computeNextVersion(current, level, today) {
  const match = IDENTIFIER.exec(current);
  if (!match) throw new Error(`VERSION is not a connected identifier: ${current}`);
  if (level !== 'patch' && level !== 'minor') throw new Error(`Unsupported bump level: ${level}`);
  if (!/^\d{6}$/.test(today)) throw new Error(`Invalid UTC build date: ${today}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const [nextMajor, nextMinor, nextPatch] = level === 'minor'
    ? [major, minor + 1, 0]
    : [major, minor, patch + 1];
  const semver = `${nextMajor}.${nextMinor}.${nextPatch}`;
  // Keep today's counter as the pre-commit baseline so the hook advances it
  // once, instead of resetting the daily sequence during a SemVer bump.
  const buildCounter = match[4] === today ? match[5] : '1';
  return { version: `v${semver}+${today}${buildCounter}`, packageVersion: semver };
}

function utcBuildDate() {
  return new Date().toISOString().slice(2, 10).replace(/-/g, '');
}

function updateJsonVersion(file, version) {
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  const target = file.endsWith('package-lock.json') ? parsed.packages?.['apps/cli'] : parsed;
  if (!target) throw new Error(`No version target in ${file}`);
  target.version = version;
  const trailing = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(file, JSON.stringify(parsed, null, 2) + trailing);
}

function main() {
  const level = process.argv[2];
  if (level !== 'patch' && level !== 'minor') {
    console.error('Usage: npm run version:patch | npm run version:minor');
    return 2;
  }
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const versionFile = join(root, 'VERSION');
  const current = readFileSync(versionFile, 'utf8').trim();
  let next;
  try {
    next = computeNextVersion(current, level, utcBuildDate());
  } catch (error) {
    console.error(`version: ${error.message}`);
    return 1;
  }
  writeFileSync(versionFile, `${next.version}\n`);
  updateJsonVersion(join(root, 'apps/cli/package.json'), next.packageVersion);
  updateJsonVersion(join(root, 'package-lock.json'), next.packageVersion);
  execFileSync('git', ['add', '--', 'VERSION', 'apps/cli/package.json', 'package-lock.json'], { cwd: root, stdio: 'inherit' });
  console.log(`${current} -> ${next.version} (package ${next.packageVersion}), staged for the release commit.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
