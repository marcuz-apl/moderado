import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSaveToDocumentsTool, createDefaultToolRegistry } from '../src/index.js';

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
});
