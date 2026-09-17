import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveInJail, isProtectedPath, canonicalizeRoot } from '../src/jail.js';
import { SecurityViolationError } from '../src/errors.js';

describe('Workspace Security Jail', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-jail-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('canonicalizes existing directory root', () => {
    const canonical = canonicalizeRoot(tempDir);
    expect(canonical).toBeDefined();
    expect(fs.existsSync(canonical)).toBe(true);
  });

  it('resolves valid internal files within the jail', () => {
    const filePath = path.join(tempDir, 'sub', 'file.txt');
    fs.mkdirSync(path.join(tempDir, 'sub'), { recursive: true });
    fs.writeFileSync(filePath, 'hello');

    const resolved = resolveInJail(tempDir, 'sub/file.txt');
    expect(resolved).toBe(fs.realpathSync(filePath));
  });

  it('rejects path traversal escaping workspace', () => {
    expect(() => resolveInJail(tempDir, '../outside.txt')).toThrow(SecurityViolationError);
    expect(() => resolveInJail(tempDir, '../../../../etc/passwd')).toThrow(SecurityViolationError);
  });

  it('rejects empty paths', () => {
    expect(() => resolveInJail(tempDir, '')).toThrow(SecurityViolationError);
    expect(() => resolveInJail(tempDir, '   ')).toThrow(SecurityViolationError);
  });

  it('identifies protected file patterns', () => {
    expect(isProtectedPath('.git')).toBe(true);
    expect(isProtectedPath('.git/config')).toBe(true);
    expect(isProtectedPath('sub/.git/HEAD')).toBe(true);
    expect(isProtectedPath('.env')).toBe(true);
    expect(isProtectedPath('.env.production')).toBe(true);
    expect(isProtectedPath('server.key')).toBe(true);
    expect(isProtectedPath('cert.pem')).toBe(true);
    expect(isProtectedPath('id_rsa')).toBe(true);

    expect(isProtectedPath('src/index.ts')).toBe(false);
    expect(isProtectedPath('package.json')).toBe(false);
  });

  it('rejects attempts to access protected files via resolveInJail', () => {
    expect(() => resolveInJail(tempDir, '.env')).toThrow(SecurityViolationError);
    expect(() => resolveInJail(tempDir, '.git/config')).toThrow(SecurityViolationError);
    expect(() => resolveInJail(tempDir, 'secrets.key')).toThrow(SecurityViolationError);
  });
});
