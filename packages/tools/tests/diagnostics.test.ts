import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverDiagnosticScripts, parseTypeScriptDiagnostics } from '../src/diagnostics.js';

describe('diagnostics', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
  it('discovers only approved package scripts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-diagnostics-')); dirs.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', test: 'vitest', prepare: 'node setup' } }));
    expect(discoverDiagnosticScripts(root)).toEqual(['typecheck', 'test']);
  });
  it('parses TypeScript locations from both common formats', () => {
    const records = parseTypeScriptDiagnostics('src/a.ts(4,2): error TS2322: Type mismatch\nsrc/b.ts:8:3 - warning TS6133: unused');
    expect(records).toEqual([expect.objectContaining({ file: 'src/a.ts', line: 4, column: 2, code: 'TS2322', severity: 'error' }), expect.objectContaining({ file: 'src/b.ts', line: 8, column: 3, severity: 'warning' })]);
  });
});