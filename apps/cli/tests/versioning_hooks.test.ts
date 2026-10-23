import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeNextVersion } from '../../../scripts/bump_version.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const hook = (name: string): string => fs.readFileSync(path.join(repoRoot, '.githooks', name), 'utf8');

describe('Alfazen version hooks', () => {
  it('computes explicit patch and minor bumps from a connected identifier', () => {
    expect(computeNextVersion('v0.4.33+2610214', 'patch', '261021')).toEqual({
      version: 'v0.4.34+2610214',
      packageVersion: '0.4.34',
    });
    expect(computeNextVersion('v0.4.33+2610214', 'minor', '261021')).toEqual({
      version: 'v0.5.0+2610214',
      packageVersion: '0.5.0',
    });
    expect(computeNextVersion('v0.4.45+261023l', 'patch', '261023')).toEqual({
      version: 'v0.4.46+261023l',
      packageVersion: '0.4.46',
    });
  });

  it('rejects malformed identifiers and unknown levels', () => {
    expect(() => computeNextVersion('0.4.33', 'patch', '261021')).toThrow(/connected identifier/);
    expect(() => computeNextVersion('v0.4.33+2610214', 'major', '261021')).toThrow(/Unsupported bump level/);
    expect(() => computeNextVersion('v0.4.33+2610214', 'patch', '2026-10-21')).toThrow(/Invalid UTC build date/);
  });

  // Regression guard for the defect where pre-commit classified the *previous*
  // commit's message: Git creates the message file only after pre-commit runs.
  it('never classifies the commit message in pre-commit', () => {
    const source = hook('pre-commit');
    expect(source).not.toContain('msgfile');
    expect(source).not.toContain('detect_bump_type');
    expect(source).toContain('"$(utc_yymmdd)" build');
  });

  it('enforces the release rule in commit-msg', () => {
    const source = hook('commit-msg');
    expect(source).toContain('release\\(minor\\):*|release\\(patch\\):*');
    expect(source).toContain('npm run version:patch');
    expect(source).toContain('git describe --tags');
  });

  it('keeps prepare-commit-msg inert so VERSION cannot be staged too late', () => {
    const source = hook('prepare-commit-msg');
    expect(source).toContain('exit 0');
    expect(source).not.toContain('git add');
  });
});
