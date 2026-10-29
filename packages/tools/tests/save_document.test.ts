import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createSaveToDocumentsTool,
  createDefaultToolRegistry,
  documentsDirectory,
  isReservedWindowsFileName,
} from '../src/index.js';

describe('save_to_documents', () => {
  let documents: string;

  beforeEach(() => {
    documents = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-documents-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(documents, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('writes a deliverable into the Documents folder and reports its absolute path', async () => {
    const tool = createSaveToDocumentsTool(documents);
    const result = await tool.execute(
      { name: 'llm-models-notes.md', content: '# Notes\nSelected models.' },
      { workspaceRoot: process.cwd() },
    );

    expect(tool.requiresApproval).toBe(true);
    expect(result.status).toBe('success');
    const saved = path.join(documents, 'llm-models-notes.md');
    expect(fs.readFileSync(saved, 'utf8')).toBe('# Notes\nSelected models.');
    expect(result.output).toContain(saved);
  });

  it('creates subfolders inside Documents', async () => {
    const result = await createSaveToDocumentsTool(documents).execute(
      { name: 'moderado/reports/notes.md', content: 'nested' },
      { workspaceRoot: process.cwd() },
    );

    expect(result.status).toBe('success');
    expect(fs.readFileSync(path.join(documents, 'moderado', 'reports', 'notes.md'), 'utf8')).toBe('nested');
  });

  it('rejects a name that escapes the Documents folder', async () => {
    const result = await createSaveToDocumentsTool(documents).execute(
      { name: '../escaped.md', content: 'x' },
      { workspaceRoot: process.cwd() },
    );

    expect(result.status).toBe('error');
    expect(result.output).toContain('escaped.md');
    expect(fs.existsSync(path.join(path.dirname(documents), 'escaped.md'))).toBe(false);
  });

  it('rejects an absolute path outside the Documents folder', async () => {
    const outside = path.join(os.tmpdir(), 'moderado-absolute-escape.md');
    const result = await createSaveToDocumentsTool(documents).execute(
      { name: outside, content: 'x' },
      { workspaceRoot: process.cwd() },
    );

    expect(result.status).toBe('error');
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('is registered in the default tool registry', () => {
    expect(createDefaultToolRegistry().get('save_to_documents')).toBeDefined();
  });

  it('previews the destination, the overwrite risk, and the content', async () => {
    fs.writeFileSync(path.join(documents, 'llm-models-notes.md'), 'the old draft');
    const tool = createSaveToDocumentsTool(documents);

    const preview = await tool.preview?.(
      { name: 'llm-models-notes.md', content: '# Notes\nSelected models.' },
      { workspaceRoot: process.cwd() },
    );

    // This is the only write that leaves the workspace, so the prompt has to
    // name where the file goes and what it replaces.
    expect(preview).toContain(fs.realpathSync(documents));
    expect(preview).toContain('already exists');
    expect(preview).toContain('+# Notes');
    expect(preview).not.toContain('the old draft');
  });

  it('previews a new file without claiming an overwrite', async () => {
    const preview = await createSaveToDocumentsTool(documents).preview?.(
      { name: 'fresh.md', content: 'hello' },
      { workspaceRoot: process.cwd() },
    );

    expect(preview).toContain('fresh.md');
    expect(preview).not.toContain('already exists');
  });

  it('previews a rejected name instead of an empty prompt', async () => {
    const preview = await createSaveToDocumentsTool(documents).preview?.(
      { name: '../escape.md', content: 'hello' },
      { workspaceRoot: process.cwd() },
    );

    expect(preview).toContain('cannot go there');
  });

  it('rejects a Windows device name instead of saving an unopenable file', async () => {
    const previousPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      for (const name of ['CON.txt', 'nul', 'aux.txt', 'COM1.log', 'moderado/LPT9/note.md']) {
        const result = await createSaveToDocumentsTool(documents).execute(
          { name, content: 'x' },
          { workspaceRoot: process.cwd() },
        );
        expect(result.status).toBe('error');
        expect(result.output).toContain('reserved name');
      }
      expect(fs.readdirSync(documents)).toEqual([]);
    } finally {
      Object.defineProperty(process, 'platform', { value: previousPlatform });
    }
  });

  it('explains a name collision instead of throwing', async () => {
    fs.writeFileSync(path.join(documents, 'notes.txt'), 'taken');

    const result = await createSaveToDocumentsTool(documents).execute(
      { name: 'notes.txt/inner.md', content: 'x' },
      { workspaceRoot: process.cwd() },
    );

    // The folder that would hold the file is a file, so Documents cannot be
    // prepared at all. That has to reach the model as a tool error; thrown, it
    // is only ever visible as "Tool execution failed".
    expect(result.status).toBe('error');
    expect(result.output).toContain('notes.txt/inner.md');
  });

  it('keeps the Documents path out of the rejection message', async () => {
    const canonicalRoot = fs.realpathSync(documents);
    const result = await createSaveToDocumentsTool(documents).execute(
      { name: '../../outside.md', content: 'x' },
      { workspaceRoot: process.cwd() },
    );

    expect(result.status).toBe('error');
    // Jail errors quote the resolved absolute path. This tool is the one write
    // destination outside a workspace, so its message would otherwise publish
    // the user's home directory into provider context.
    expect(result.output).not.toContain(canonicalRoot);
    expect(result.output).toContain('outside.md');
  });
});

describe('Windows reserved file names', () => {
  it.each(['CON.txt', 'nul', 'aux.txt', 'COM1.log', 'LPT9.md', 'moderado/CON/note.md', 'PRN'])(
    'recognises %s as reserved',
    (name) => {
      expect(isReservedWindowsFileName(name)).toBe(true);
    },
  );

  it.each(['notes.txt', 'auxiliary.md', 'CON10.log', 'reconnect.txt', 'moderado/Reports/note.md', 'a_nul_x.md'])(
    'allows the ordinary name %s',
    (name) => {
      expect(isReservedWindowsFileName(name)).toBe(false);
    },
  );
});

describe('documentsDirectory', () => {
  it('uses the redirected Personal folder on Windows', () => {
    const root = documentsDirectory({
      platform: 'win32',
      homedir: () => 'C:\\Users\\marcuz',
      readPersonalFolder: () => 'D:\\OneDrive\\Documents',
    });

    // Explorer and Office show the redirected folder; saving somewhere else
    // means the user never sees the deliverable.
    expect(root).toBe('D:\\OneDrive\\Documents');
  });

  it('expands %USERPROFILE% in the registry value', () => {
    const root = documentsDirectory({
      platform: 'win32',
      homedir: () => 'C:\\Users\\marcuz',
      env: { USERPROFILE: 'C:\\Users\\marcuz' },
      readPersonalFolder: () => '%USERPROFILE%\\Documents',
    });

    expect(root).toBe('C:\\Users\\marcuz\\Documents');
  });

  it('falls back to the home Documents folder without a registry value', () => {
    const root = documentsDirectory({
      platform: 'win32',
      homedir: () => 'C:\\Users\\marcuz',
      readPersonalFolder: () => undefined,
    });

    expect(root).toBe(path.join('C:\\Users\\marcuz', 'Documents'));
  });

  it('ignores the registry on POSIX', () => {
    let called = false;
    const root = documentsDirectory({
      platform: 'linux',
      homedir: () => '/home/marcuz',
      readPersonalFolder: () => {
        called = true;
        return '/somewhere/else';
      },
    });

    expect(root).toBe(path.join('/home/marcuz', 'Documents'));
    expect(called).toBe(false);
  });
});
