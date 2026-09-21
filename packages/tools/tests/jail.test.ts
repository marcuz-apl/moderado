import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveInJail,
  isProtectedPath,
  canonicalizeRoot,
  normalizeCrossPlatformPath,
} from '../src/jail.js';
import { SecurityViolationError } from '../src/errors.js';

describe('Workspace Security Jail', () => {
  let tempDir: string;
  let outsideDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-jail-test-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-outside-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Core Jail Containment', () => {
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

    it('resolves non-existent target files inside valid parent directories', () => {
      fs.mkdirSync(path.join(tempDir, 'newdir'), { recursive: true });
      const resolved = resolveInJail(tempDir, 'newdir/newfile.txt');
      const expected = path.join(canonicalizeRoot(tempDir), 'newdir', 'newfile.txt');
      expect(resolved.toLowerCase()).toBe(expected.toLowerCase());
    });

    it('rejects path traversal escaping workspace', () => {
      expect(() => resolveInJail(tempDir, '../outside.txt')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '../../../../etc/passwd')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, 'sub/../../outside.txt')).toThrow(SecurityViolationError);
    });

    it('rejects empty and whitespace paths', () => {
      expect(() => resolveInJail(tempDir, '')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '   ')).toThrow(SecurityViolationError);
      expect(() => canonicalizeRoot('')).toThrow(SecurityViolationError);
      expect(() => canonicalizeRoot('   ')).toThrow(SecurityViolationError);
    });

    it('rejects non-existent or non-directory roots', () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');
      expect(() => canonicalizeRoot(nonExistent)).toThrow(SecurityViolationError);

      const filePath = path.join(tempDir, 'a-file.txt');
      fs.writeFileSync(filePath, 'contents');
      expect(() => canonicalizeRoot(filePath)).toThrow(SecurityViolationError);
    });
  });

  describe('Cross-Platform Path Normalization (Windows / WSL / UNC)', () => {
    it('normalizes WSL /mnt/<drive>/ paths to Windows drive paths', () => {
      const norm = normalizeCrossPlatformPath('/mnt/c/Users/developer/repo/src/index.ts', 'C:\\repo');
      expect(norm).toBe('C:\\Users\\developer\\repo\\src\\index.ts');

      const normD = normalizeCrossPlatformPath('/mnt/d/projects/moderado', 'D:\\projects');
      expect(normD).toBe('D:\\projects\\moderado');
    });

    it('normalizes \\\\wsl$\\<distro>\\mnt\\<drive> UNC paths to Windows drive paths', () => {
      const unc = '\\\\wsl$\\Ubuntu\\mnt\\c\\Users\\developer\\repo\\src\\index.ts';
      const norm = normalizeCrossPlatformPath(unc, 'C:\\Users\\developer\\repo');
      expect(norm).toBe('C:\\Users\\developer\\repo\\src\\index.ts');
    });

    it('normalizes \\\\wsl.localhost\\<distro>\\mnt\\<drive> UNC paths to Windows drive paths', () => {
      const unc = '\\\\wsl.localhost\\Ubuntu\\mnt\\d\\projects\\moderado\\package.json';
      const norm = normalizeCrossPlatformPath(unc, 'D:\\projects\\moderado');
      expect(norm).toBe('D:\\projects\\moderado\\package.json');
    });

    it('normalizes forward-slash WSL UNC paths', () => {
      const unc1 = '//wsl$/Ubuntu/mnt/c/projects/file.txt';
      expect(normalizeCrossPlatformPath(unc1, 'C:\\projects')).toBe('C:\\projects\\file.txt');

      const unc2 = '//wsl.localhost/Ubuntu/mnt/c/projects/file.txt';
      expect(normalizeCrossPlatformPath(unc2, 'C:\\projects')).toBe('C:\\projects\\file.txt');
    });

    it('strips Windows extended-length prefixes (\\\\?\\)', () => {
      expect(normalizeCrossPlatformPath('\\\\?\\C:\\projects\\file.txt')).toBe('C:\\projects\\file.txt');
      expect(normalizeCrossPlatformPath('//?/C:/projects/file.txt')).toBe('C:\\projects\\file.txt');
      expect(normalizeCrossPlatformPath('\\\\?\\UNC\\server\\share\\file.txt')).toBe('\\\\server\\share\\file.txt');
    });

    it('normalizes Windows drive paths to /mnt/<drive>/ when reference root is POSIX/WSL', () => {
      const winPath = 'C:\\projects\\repo\\src\\index.ts';
      const posixRoot = '/mnt/c/projects/repo';
      expect(normalizeCrossPlatformPath(winPath, posixRoot)).toBe('/mnt/c/projects/repo/src/index.ts');
    });

    it('maps Linux paths when reference root is a WSL UNC root', () => {
      const wslRoot = '\\\\wsl$\\Ubuntu\\home\\alice\\project';
      const linuxPath = '/home/alice/project/src/index.ts';
      expect(normalizeCrossPlatformPath(linuxPath, wslRoot)).toBe('\\\\wsl$\\Ubuntu\\home\\alice\\project\\src\\index.ts');
    });

    it('preserves relative paths without alteration', () => {
      expect(normalizeCrossPlatformPath('src/index.ts', 'C:\\repo')).toBe('src/index.ts');
      expect(normalizeCrossPlatformPath('package.json')).toBe('package.json');
    });
  });

  describe('Jail Resolution Across Path Notations', () => {
    it('canonicalizes workspace root passed as /mnt/<drive>/... or WSL UNC form', () => {
      const canonical = canonicalizeRoot(tempDir);
      if (/^[a-zA-Z]:/.test(canonical)) {
        const drive = canonical[0].toLowerCase();
        const rest = canonical.slice(2).replace(/\\/g, '/');

        // Test /mnt/<drive>/... root
        const wslMntRoot = `/mnt/${drive}${rest}`;
        expect(canonicalizeRoot(wslMntRoot)).toBe(canonical);

        // Test \\wsl$\Ubuntu\mnt\<drive>\... root
        const wslUncRoot = `\\\\wsl$\\Ubuntu\\mnt\\${drive}${rest.replace(/\//g, '\\')}`;
        expect(canonicalizeRoot(wslUncRoot)).toBe(canonical);

        // Test \\wsl.localhost\Ubuntu\mnt\<drive>\... root
        const wslLocalhostRoot = `\\\\wsl.localhost\\Ubuntu\\mnt\\${drive}${rest.replace(/\//g, '\\')}`;
        expect(canonicalizeRoot(wslLocalhostRoot)).toBe(canonical);
      }
    });

    it('resolves file targets supplied in /mnt/<drive>/... notation', () => {
      const canonical = canonicalizeRoot(tempDir);
      const filePath = path.join(tempDir, 'nested', 'target.txt');
      fs.mkdirSync(path.join(tempDir, 'nested'), { recursive: true });
      fs.writeFileSync(filePath, 'sample');

      if (/^[a-zA-Z]:/.test(canonical)) {
        const drive = canonical[0].toLowerCase();
        const rest = canonical.slice(2).replace(/\\/g, '/');
        const mntPath = `/mnt/${drive}${rest}/nested/target.txt`;

        const resolved = resolveInJail(tempDir, mntPath);
        expect(resolved).toBe(fs.realpathSync(filePath));
      }
    });

    it('resolves file targets supplied in \\\\wsl$\\ and \\\\wsl.localhost\\ notation', () => {
      const canonical = canonicalizeRoot(tempDir);
      const filePath = path.join(tempDir, 'nested', 'target.txt');
      fs.mkdirSync(path.join(tempDir, 'nested'), { recursive: true });
      fs.writeFileSync(filePath, 'sample');

      if (/^[a-zA-Z]:/.test(canonical)) {
        const drive = canonical[0].toLowerCase();
        const rest = canonical.slice(2).replace(/\\/g, '/');

        const wslUnc = `\\\\wsl$\\Ubuntu\\mnt\\${drive}${rest.replace(/\//g, '\\')}\\nested\\target.txt`;
        expect(resolveInJail(tempDir, wslUnc)).toBe(fs.realpathSync(filePath));

        const wslLocalhost = `\\\\wsl.localhost\\Ubuntu\\mnt\\${drive}${rest.replace(/\//g, '\\')}\\nested\\target.txt`;
        expect(resolveInJail(tempDir, wslLocalhost)).toBe(fs.realpathSync(filePath));

        const wslForward = `//wsl$/Ubuntu/mnt/${drive}${rest}/nested/target.txt`;
        expect(resolveInJail(tempDir, wslForward)).toBe(fs.realpathSync(filePath));
      }
    });

    it('resolves target with differing drive-letter case on Windows', () => {
      const canonical = canonicalizeRoot(tempDir);
      const filePath = path.join(tempDir, 'casing.txt');
      fs.writeFileSync(filePath, 'content');

      if (/^[a-zA-Z]:/.test(canonical)) {
        const upperDrivePath = canonical[0].toUpperCase() + ':' + filePath.slice(2);
        const lowerDrivePath = canonical[0].toLowerCase() + ':' + filePath.slice(2);

        expect(resolveInJail(tempDir, upperDrivePath)).toBe(fs.realpathSync(filePath));
        expect(resolveInJail(tempDir, lowerDrivePath)).toBe(fs.realpathSync(filePath));
      }
    });

    it('rejects cross-drive path targets', () => {
      const canonical = canonicalizeRoot(tempDir);
      if (/^[a-zA-Z]:/.test(canonical)) {
        const currentDrive = canonical[0].toUpperCase();
        const otherDrive = currentDrive === 'C' ? 'D' : 'C';

        const crossDrivePath = `${otherDrive}:\\some\\other\\folder\\file.txt`;
        expect(() => resolveInJail(tempDir, crossDrivePath)).toThrow(SecurityViolationError);

        const crossDriveMnt = `/mnt/${otherDrive.toLowerCase()}/some/other/folder/file.txt`;
        expect(() => resolveInJail(tempDir, crossDriveMnt)).toThrow(SecurityViolationError);
      }
    });

    it('rejects UNC network paths attempting to escape workspace', () => {
      expect(() => resolveInJail(tempDir, '\\\\malicious-server\\share\\payload.txt')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '//malicious-server/share/payload.txt')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '\\\\wsl$\\Ubuntu\\etc\\shadow')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '\\\\wsl.localhost\\Ubuntu\\root\\secret.key')).toThrow(SecurityViolationError);
    });
  });

  describe('Symlink and Junction Escape Defense', () => {
    it('detects directory junctions/symlinks escaping the workspace boundary', () => {
      const outsideTarget = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(outsideTarget, 'outside secret');

      const junctionDir = path.join(tempDir, 'outside_link');
      try {
        if (process.platform === 'win32') {
          fs.symlinkSync(outsideDir, junctionDir, 'junction');
        } else {
          fs.symlinkSync(outsideDir, junctionDir, 'dir');
        }

        expect(() => resolveInJail(tempDir, 'outside_link/secret.txt')).toThrow(SecurityViolationError);
      } catch (err: any) {
        if (err?.code === 'EPERM') {
          // Symlink creation unprivileged in environment; junction handled
          return;
        }
        throw err;
      }
    });

    it('allows valid internal directory junctions/symlinks within the jail', () => {
      const subDir = path.join(tempDir, 'real_sub');
      fs.mkdirSync(subDir, { recursive: true });
      const targetFile = path.join(subDir, 'inner.txt');
      fs.writeFileSync(targetFile, 'inner content');

      const internalLink = path.join(tempDir, 'link_sub');
      try {
        if (process.platform === 'win32') {
          fs.symlinkSync(subDir, internalLink, 'junction');
        } else {
          fs.symlinkSync(subDir, internalLink, 'dir');
        }

        const resolved = resolveInJail(tempDir, 'link_sub/inner.txt');
        expect(resolved).toBe(fs.realpathSync(targetFile));
      } catch (err: any) {
        if (err?.code === 'EPERM') return;
        throw err;
      }
    });
  });

  describe('Hardened .git, .env, and Sensitive Metadata Denial', () => {
    it('blocks .git in root and subdirectories with mixed case', () => {
      expect(isProtectedPath('.git')).toBe(true);
      expect(isProtectedPath('.GIT')).toBe(true);
      expect(isProtectedPath('.Git')).toBe(true);
      expect(isProtectedPath('.git/config')).toBe(true);
      expect(isProtectedPath('.GIT\\config')).toBe(true);
      expect(isProtectedPath('sub/.git/HEAD')).toBe(true);
      expect(isProtectedPath('sub/.GIT/HEAD')).toBe(true);
      expect(isProtectedPath('deep/nested/.Git/index')).toBe(true);
    });

    it('blocks .env files in root and subdirectories with case insensitivity', () => {
      expect(isProtectedPath('.env')).toBe(true);
      expect(isProtectedPath('.ENV')).toBe(true);
      expect(isProtectedPath('.env.local')).toBe(true);
      expect(isProtectedPath('.ENV.LOCAL')).toBe(true);
      expect(isProtectedPath('.env.production')).toBe(true);
      expect(isProtectedPath('.env.test')).toBe(true);
      expect(isProtectedPath('.env.staging_1')).toBe(true);
      expect(isProtectedPath('sub/.env')).toBe(true);
      expect(isProtectedPath('sub/.env.local')).toBe(true);
      expect(isProtectedPath('api/.ENV.PRODUCTION')).toBe(true);
    });

    it('blocks Windows Alternate Data Streams (ADS) attempting bypass', () => {
      expect(isProtectedPath('.env::$DATA')).toBe(true);
      expect(isProtectedPath('.env.local::$DATA')).toBe(true);
      expect(isProtectedPath('sub/.env::$DATA')).toBe(true);
      expect(isProtectedPath('.git::$INDEX_ALLOCATION')).toBe(true);
    });

    it('blocks sensitive keys, certs, and credentials', () => {
      expect(isProtectedPath('server.key')).toBe(true);
      expect(isProtectedPath('sub/server.key')).toBe(true);
      expect(isProtectedPath('cert.pem')).toBe(true);
      expect(isProtectedPath('sub/cert.pem')).toBe(true);
      expect(isProtectedPath('id_rsa')).toBe(true);
      expect(isProtectedPath('id_rsa.pub')).toBe(true);
      expect(isProtectedPath('id_ed25519')).toBe(true);
      expect(isProtectedPath('credentials.json')).toBe(true);
      expect(isProtectedPath('config/credentials.json')).toBe(true);
    });

    it('allows legitimate non-sensitive files', () => {
      expect(isProtectedPath('src/index.ts')).toBe(false);
      expect(isProtectedPath('package.json')).toBe(false);
      expect(isProtectedPath('git.txt')).toBe(false);
      expect(isProtectedPath('src/git_workspace.ts')).toBe(false);
      expect(isProtectedPath('.gitignore')).toBe(false);
      expect(isProtectedPath('.gitattributes')).toBe(false);
      expect(isProtectedPath('.github/workflows/ci.yml')).toBe(false);
      expect(isProtectedPath('src/environment.ts')).toBe(false);
      expect(isProtectedPath('dotenv.config.js')).toBe(false);
      expect(isProtectedPath('my-credentials.json.ts')).toBe(false);
    });

    it('rejects attempts to access sensitive files through resolveInJail', () => {
      expect(() => resolveInJail(tempDir, '.env')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '.ENV')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '.env.local')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '.env::$DATA')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '.git/config')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, '.GIT\\HEAD')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, 'sub/.git/config')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, 'sub/.GIT/HEAD')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, 'sub/secrets.key')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, 'sub/id_ed25519')).toThrow(SecurityViolationError);
      expect(() => resolveInJail(tempDir, 'credentials.json')).toThrow(SecurityViolationError);
    });
  });
});
