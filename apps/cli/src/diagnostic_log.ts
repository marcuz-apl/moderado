import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function redact(value: string): string {
  return value
    .replace(/\bnvapi-[A-Za-z0-9_-]+/g, '[redacted NVIDIA key]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted API key]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}

export function writeDiagnosticLog(command: string, error: unknown, customHome?: string): void {
  try {
    const message = redact(error instanceof Error ? error.message : String(error));
    const directory = path.join(customHome ?? os.homedir(), '.moderado', 'logs');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(directory, 'moderado.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), command, category: 'operational_failure', message })}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Logging must never obscure the command failure.
  }
}
