import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTranscriptMarkdown, writeTranscript } from '../src/transcript.js';

const created: string[] = [];

const tempHome = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-transcript-'));
  created.push(directory);
  return directory;
};

afterEach(() => {
  // The sandbox refuses some temp-dir deletes; a blocked cleanup must not fail
  // assertions that already passed.
  for (const directory of created.splice(0)) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('session transcript', () => {
  it('numbers each turn and keeps questions and answers in order', () => {
    const markdown = buildTranscriptMarkdown({
      workspace: '/work/weather',
      model: 'z-ai/glm-5',
      sessionId: 'abc123',
      now: new Date('2026-10-23T14:05:00Z'),
      messages: [
        { role: 'user', content: 'Build a weather app.' },
        { role: 'assistant', content: 'Scaffolding it now.' },
        { role: 'user', content: 'Add a city search.' },
        { role: 'assistant', content: 'Added it.' },
      ],
    });
    expect(markdown).toContain('# Moderado transcript');
    expect(markdown).toContain('`/work/weather`');
    expect(markdown).toContain('`z-ai/glm-5`');
    expect(markdown).toContain('`abc123`');
    expect(markdown).toContain('## 1 · You\n\nBuild a weather app.');
    expect(markdown).toContain('## 1 · Moderado\n\nScaffolding it now.');
    expect(markdown).toContain('## 2 · You\n\nAdd a city search.');
    expect(markdown).toContain('## 2 · Moderado\n\nAdded it.');
  });

  it('turns the summary fence into a heading so a markdown viewer reads it as prose', () => {
    const markdown = buildTranscriptMarkdown({
      workspace: '/w', model: 'm',
      messages: [
        { role: 'user', content: 'Do the thing.' },
        { role: 'assistant', content: 'Done.\n\n```summary\n# Turn summary\n## Done\n- Added `a.ts`\n```' },
      ],
    });
    expect(markdown).toContain('### Turn summary');
    expect(markdown).not.toContain('```summary');
    expect(markdown).not.toContain('\n```\n');
  });

  it('skips tool-only assistant turns and says so when nothing happened', () => {
    const empty = buildTranscriptMarkdown({ workspace: '/w', model: 'm', messages: [] });
    expect(empty).toContain('no completed turns');
    const onlyTools = buildTranscriptMarkdown({
      workspace: '/w', model: 'm',
      messages: [{ role: 'assistant', content: null }, { role: 'assistant', content: '   ' }],
    });
    expect(onlyTools).toContain('no completed turns');
  });

  it('writes a timestamped markdown file under the transcript directory', () => {
    const home = tempHome();
    const file = writeTranscript({
      messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
      workspace: '/work/my project',
      model: 'm',
      home,
      now: new Date('2026-10-23T14:05:06Z'),
    });
    expect(file).toBe(path.join(home, '.moderado', 'transcripts', 'my-project-20261023-140506.md'));
    expect(fs.readFileSync(file, 'utf8')).toContain('## 1 · You');
  });
});
