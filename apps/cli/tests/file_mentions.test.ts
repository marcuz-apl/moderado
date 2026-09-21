import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  activeMentionToken,
  filterMentionCandidates,
  expandMentions,
  createWorkspaceFileSource,
  isImagePath,
  getImageMimeType,
  WorkspaceFileSource,
} from '../src/ui/file_mentions.js';

describe('Composer File Mentions and Image Attachments', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-mentions-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('activeMentionToken', () => {
    it('returns undefined when there is no @ at or before the caret', () => {
      expect(activeMentionToken('hello world', 5)).toBeUndefined();
      expect(activeMentionToken('hello @user world', 5)).toBeUndefined();
    });

    it('parses active mention token right at caret', () => {
      const input = 'look at @src/main.ts';
      const parsed = activeMentionToken(input, input.length);
      expect(parsed).toEqual({ token: 'src/main.ts', start: 8 });
    });

    it('parses empty token when user just typed @', () => {
      const input = 'check @';
      const parsed = activeMentionToken(input, input.length);
      expect(parsed).toEqual({ token: '', start: 6 });
    });

    it('normalizes backslashes in Windows paths', () => {
      const input = 'view @src\\app.ts';
      const parsed = activeMentionToken(input, input.length);
      expect(parsed).toEqual({ token: 'src/app.ts', start: 5 });
    });
  });

  describe('filterMentionCandidates', () => {
    const files = [
      'packages/core/src/agent.ts',
      'packages/tools/src/jail.ts',
      'README.md',
      'apps/cli/src/main.ts',
      'docs/demo.png',
    ];

    it('returns top candidates when token is empty', () => {
      const results = filterMentionCandidates(files, '', 3);
      expect(results).toHaveLength(3);
      expect(results).toEqual(files.slice(0, 3));
    });

    it('filters by filename prefix and path substring', () => {
      const results = filterMentionCandidates(files, 'agent');
      expect(results).toContain('packages/core/src/agent.ts');
      expect(results).not.toContain('README.md');
    });

    it('matches images', () => {
      const results = filterMentionCandidates(files, 'demo');
      expect(results).toEqual(['docs/demo.png']);
    });
  });

  describe('isImagePath and getImageMimeType', () => {
    it('identifies image extensions', () => {
      expect(isImagePath('photo.png')).toBe(true);
      expect(isImagePath('image.JPEG')).toBe(true);
      expect(isImagePath('vector.svg')).toBe(true);
      expect(isImagePath('code.ts')).toBe(false);
    });

    it('returns correct MIME type', () => {
      expect(getImageMimeType('photo.png')).toBe('image/png');
      expect(getImageMimeType('image.jpg')).toBe('image/jpeg');
      expect(getImageMimeType('vector.svg')).toBe('image/svg+xml');
    });
  });

  describe('expandMentions', () => {
    it('expands text file mentions with capped lines', async () => {
      const mockWorkspace: WorkspaceFileSource = {
        async listFiles(token) {
          return token === 'hello.txt' ? ['hello.txt'] : [];
        },
        async readFile(target) {
          return target === 'hello.txt' ? 'line 1\nline 2\nline 3' : '';
        },
      };

      const result = await expandMentions('Explain @hello.txt please', mockWorkspace, { maxExcerptLines: 2 });
      expect(result.unresolved).toHaveLength(0);
      expect(result.text).toContain('--- @hello.txt ---');
      expect(result.text).toContain('line 1\nline 2');
      expect(result.text).not.toContain('line 3');
      expect(result.text).toContain('--- end @hello.txt ---');
    });

    it('reports unresolved files and annotates prompt text', async () => {
      const mockWorkspace: WorkspaceFileSource = {
        async listFiles() { return []; },
        async readFile() { throw new Error('not found'); },
      };

      const result = await expandMentions('Check @missing.ts now', mockWorkspace);
      expect(result.unresolved).toContain('@missing.ts');
      expect(result.text).toBe('Check @missing.ts (file not found) now');
    });

    it('attaches images as model context using base64 data URI', async () => {
      const fakeImageBytes = Buffer.from('FAKE_PNG_BINARY_DATA');
      const mockWorkspace: WorkspaceFileSource = {
        async listFiles(token) {
          return token.includes('demo') ? ['docs/demo.png'] : [];
        },
        async readFile() { throw new Error('Binary file'); },
        async readImage() { return fakeImageBytes; },
      };

      const result = await expandMentions('Look at @docs/demo.png', mockWorkspace);
      expect(result.unresolved).toHaveLength(0);
      expect(result.text).toContain('--- @docs/demo.png (image) ---');
      expect(result.text).toContain('[Attached image: docs/demo.png (image/png, 20 bytes)]');
      expect(result.text).toContain(`data:image/png;base64,${fakeImageBytes.toString('base64')}`);
      expect(result.text).toContain('--- end @docs/demo.png ---');
    });

    it('handles large images gracefully with metadata notice', async () => {
      const largeBytes = Buffer.alloc(1024 * 1024 + 10);
      const mockWorkspace: WorkspaceFileSource = {
        async listFiles() { return ['docs/huge.jpg']; },
        async readFile() { throw new Error('Binary file'); },
        async readImage() { return largeBytes; },
      };

      const result = await expandMentions('Inspect @docs/huge.jpg', mockWorkspace);
      expect(result.text).toContain('exceeded 1MB inline limit');
    });
  });

  describe('createWorkspaceFileSource', () => {
    it('integrates with actual filesystem in workspace jail', async () => {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content in temp');
      const source = createWorkspaceFileSource(tempDir);

      const files = await source.listFiles('file');
      expect(files).toContain('file.txt');

      const content = await source.readFile('file.txt');
      expect(content).toBe('content in temp');

      if (source.readImage) {
        fs.writeFileSync(path.join(tempDir, 'icon.png'), Buffer.from([1, 2, 3]));
        const img = await source.readImage('icon.png');
        expect(img).toBeInstanceOf(Buffer);
        expect(img.length).toBe(3);
      }
    });
  });
});
