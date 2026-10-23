import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeDiagnosticLog } from '../src/diagnostic_log.js';

describe('diagnostic logs', () => {
  const homes: string[] = [];
  afterEach(() => homes.splice(0).forEach((home) => fs.rmSync(home, { recursive: true, force: true })));

  it('writes a local redacted failure record', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-log-'));
    homes.push(home);

    writeDiagnosticLog('run', new Error('Provider rejected nvapi-abcdef and sk-secret-value'), home);

    const log = fs.readFileSync(path.join(home, '.moderado', 'logs', 'moderado.jsonl'), 'utf8');
    expect(log).toContain('"command":"run"');
    expect(log).not.toContain('nvapi-abcdef');
    expect(log).not.toContain('sk-secret-value');
  });

  it('records a failed turn reported as a plain message', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-log-'));
    homes.push(home);

    // The agent loop reports a failure as a status plus an error event, so the
    // caller logs a message rather than an Error instance.
    writeDiagnosticLog('chat.turn', 'rate_limited: Gateway rejected mrd_abcdef for Bearer abc.def', home);

    const log = fs.readFileSync(path.join(home, '.moderado', 'logs', 'moderado.jsonl'), 'utf8');
    expect(log).toContain('"command":"chat.turn"');
    expect(log).toContain('rate_limited');
    expect(log).toContain('[redacted Moderado key]');
    expect(log).not.toContain('mrd_abcdef');
    expect(log).not.toContain('Bearer abc.def');
  });
});
