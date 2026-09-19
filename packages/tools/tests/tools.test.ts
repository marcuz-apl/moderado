import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  ListFilesTool,
  SearchFilesTool,
  RunCommandTool,
  GitDiffTool,
  createDefaultToolRegistry,
} from '../src/index.js';

describe('Workspace Tools Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-tools-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('read_file', () => {
    it('reads and line-numbers file content', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'line one\nline two\nline three');

      const result = await ReadFileTool.execute(
        { path: 'test.txt', offset: 1, limit: 500 },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('success');
      expect(result.output).toContain('1: line one');
      expect(result.output).toContain('2: line two');
      expect(result.output).toContain('3: line three');
    });

    it('paginates lines using offset and limit', async () => {
      const filePath = path.join(tempDir, 'many.txt');
      fs.writeFileSync(filePath, 'a\nb\nc\nd\ne\nf');

      const result = await ReadFileTool.execute(
        { path: 'many.txt', offset: 3, limit: 2 },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('success');
      expect(result.output).toContain('3: c');
      expect(result.output).toContain('4: d');
      expect(result.output).not.toContain('2: b');
      expect(result.truncated).toBe(true);
    });

    it('rejects reading binary files', async () => {
      const binPath = path.join(tempDir, 'binary.dat');
      const buf = Buffer.from([0x68, 0x65, 0x00, 0x6c]);
      fs.writeFileSync(binPath, buf);

      const result = await ReadFileTool.execute(
        { path: 'binary.dat', offset: 1, limit: 100 },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('error');
      expect(result.output).toContain('binary file detected');
    });

    it('returns error for missing file', async () => {
      const result = await ReadFileTool.execute(
        { path: 'nonexistent.txt', offset: 1, limit: 100 },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('error');
      expect(result.output).toContain('does not exist');
    });
  });

  describe('write_file', () => {
    it('creates a new file atomically and creates parent directories', async () => {
      const result = await WriteFileTool.execute(
        { path: 'nested/deep/file.txt', content: 'hello world' },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('success');
      const createdFile = path.join(tempDir, 'nested/deep/file.txt');
      expect(fs.existsSync(createdFile)).toBe(true);
      expect(fs.readFileSync(createdFile, 'utf8')).toBe('hello world');
    });

    it('overwrites an existing file atomically', async () => {
      const filePath = path.join(tempDir, 'overwrite.txt');
      fs.writeFileSync(filePath, 'original content');

      const result = await WriteFileTool.execute(
        { path: 'overwrite.txt', content: 'new content' },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('success');
      expect(fs.readFileSync(filePath, 'utf8')).toBe('new content');
    });
  });

  describe('edit_file', () => {
    it('edits unique target snippet and reports diff preview', async () => {
      const filePath = path.join(tempDir, 'edit.txt');
      fs.writeFileSync(filePath, 'export const port = 3000;\nexport const host = "localhost";');

      const result = await EditFileTool.execute(
        {
          path: 'edit.txt',
          targetContent: 'export const port = 3000;',
          replacementContent: 'export const port = 8080;',
        },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('success');
      expect(result.output).toContain('-export const port = 3000;');
      expect(result.output).toContain('+export const port = 8080;');
      expect(fs.readFileSync(filePath, 'utf8')).toContain('export const port = 8080;');
    });

    it('fails when targetContent is not found', async () => {
      const filePath = path.join(tempDir, 'edit.txt');
      fs.writeFileSync(filePath, 'hello');

      const result = await EditFileTool.execute(
        {
          path: 'edit.txt',
          targetContent: 'missing code',
          replacementContent: 'replacement',
        },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('error');
      expect(result.output).toContain('Could not locate targetContent');
    });
  });

  describe('list_files', () => {
    it('lists files and ignores node_modules and .git', async () => {
      fs.writeFileSync(path.join(tempDir, 'app.ts'), 'console.log()');
      fs.mkdirSync(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'node_modules', 'pkg', 'index.js'), '');

      const result = await ListFilesTool.execute(
        { subpath: '.', recursive: true, maxDepth: 3, limit: 100 },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('success');
      expect(result.output).toContain('app.ts');
      expect(result.output).not.toContain('node_modules');
    });
  });

  describe('search_files', () => {
    it('searches for text patterns across workspace files', async () => {
      fs.writeFileSync(path.join(tempDir, 'a.ts'), 'function authenticate() { return true; }');
      fs.writeFileSync(path.join(tempDir, 'b.ts'), 'const port = 8080;');

      const result = await SearchFilesTool.execute(
        { query: 'authenticate', isRegex: false, caseSensitive: true, maxResults: 10 },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('success');
      expect(result.output).toContain('a.ts:1: function authenticate()');
      expect(result.output).not.toContain('b.ts');
    });
  });

  describe('run_command', () => {
    it('executes external commands with arguments array and shell: false', async () => {
      const result = await RunCommandTool.execute(
        { command: process.execPath, args: ['-e', 'console.log("hello from child")'], timeoutSeconds: 5 },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('success');
      expect(result.output).toBe('hello from child');
    });

    it('purges sensitive provider credentials from child process environment', async () => {
      process.env.NVIDIA_API_KEY = 'super-secret-key-123';

      const result = await RunCommandTool.execute(
        {
          command: process.execPath,
          args: ['-e', 'console.log(process.env.NVIDIA_API_KEY || "CLEARED")'],
          timeoutSeconds: 5,
        },
        { workspaceRoot: tempDir }
      );

      delete process.env.NVIDIA_API_KEY;

      expect(result.status).toBe('success');
      expect(result.output).toBe('CLEARED');
    });

    it('enforces execution timeout', async () => {
      const result = await RunCommandTool.execute(
        {
          command: process.execPath,
          args: ['-e', 'setTimeout(() => {}, 10000)'],
          timeoutSeconds: 1,
        },
        { workspaceRoot: tempDir }
      );

      expect(result.status).toBe('error');
      expect(result.output).toContain('Command timed out after 1 seconds');
    });
  });

  describe('git_diff', () => {
    it('executes git diff safely', async () => {
      const result = await GitDiffTool.execute(
        { staged: false },
        { workspaceRoot: tempDir }
      );
      expect(result.toolName).toBe('git_diff');
      expect(result.output).toBeDefined();
    });
  });

  describe('ToolRegistry', () => {
    it('registers all 9 tools and exports JSON schema declarations', () => {
      const registry = createDefaultToolRegistry();
      const tools = registry.list();
      expect(tools.length).toBe(9);

      expect(registry.get('read_file')).toBeDefined();
      expect(registry.get('write_file')).toBeDefined();
      expect(registry.get('edit_file')).toBeDefined();
      expect(registry.get('list_files')).toBeDefined();
      expect(registry.get('search_files')).toBeDefined();
      expect(registry.get('run_command')).toBeDefined();
      expect(registry.get('apply_patch')).toBeDefined();
      expect(registry.get('git_diff')).toBeDefined();
      expect(registry.get('run_diagnostics')).toBeDefined();

      const declarations = registry.getDeclarations();
      expect(declarations.length).toBe(9);
      const readDecl = declarations.find((d) => d.name === 'read_file');
      expect(readDecl?.parameters).toBeDefined();
      expect((readDecl?.parameters as any).type).toBe('object');
      expect((readDecl?.parameters as any).properties.path).toBeDefined();
    });
  });
});
