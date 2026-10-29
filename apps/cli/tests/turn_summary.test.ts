import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TurnRecorder, appendSummaryToHistory, detectWebApp, formatTurnSummary } from '../src/turn_summary.js';
import type { AgentEvent } from '@moderado/contracts';

let workspace: string;

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-summary-')));
});

afterEach(() => {
  // A refused cleanup must not fail the assertions: some sandboxes block deletes
  // under the temp directory, and that is an environment fact, not a test result.
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function toolCall(toolCallId: string, toolName: string, parameters: Record<string, unknown>): AgentEvent {
  return { type: 'tool_call_initiated', toolCallId, toolName, parameters, timestamp: 0 };
}

function toolResult(toolCallId: string, toolName: string, status: 'success' | 'error' | 'denied', output = '', metadata?: Record<string, unknown>): AgentEvent {
  return { type: 'tool_result', toolCallId, result: { toolName, status, output, ...(metadata ? { metadata } : {}) }, timestamp: 0 };
}

function writePackage(relative: string, manifest: Record<string, unknown>): void {
  const target = path.join(workspace, relative, 'package.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(manifest), 'utf8');
}

describe('turn recorder', () => {
  it('separates created files from updated ones and lists commands', () => {
    fs.writeFileSync(path.join(workspace, 'existing.ts'), 'export const a = 1;\n', 'utf8');
    const recorder = new TurnRecorder(workspace);

    recorder.record(toolCall('1', 'write_file', { path: 'existing.ts', content: 'x' }));
    recorder.record(toolResult('1', 'write_file', 'success', 'ok'));
    recorder.record(toolCall('2', 'write_file', { path: 'src/new.ts', content: 'x' }));
    recorder.record(toolResult('2', 'write_file', 'success', 'ok'));
    recorder.record(toolCall('3', 'edit_file', { path: 'existing.ts' }));
    recorder.record(toolResult('3', 'edit_file', 'success', 'ok'));
    recorder.record(toolCall('4', 'run_command', { command: 'npm', args: ['test'] }));
    recorder.record(toolResult('4', 'run_command', 'success', 'passed', { exitCode: 0 }));

    const summary = recorder.build('completed', 4);
    expect(summary.created).toEqual(['src/new.ts']);
    expect(summary.modified).toEqual(['existing.ts']);
    expect(summary.commands).toEqual([{ command: 'npm test', ok: true, exitCode: 0, serverUrl: undefined }]);
    expect(summary.checks).toEqual([{ name: 'npm test', ok: true }]);
    expect(summary.leftover).toEqual([]);
    expect(recorder.hasWork()).toBe(true);
  });

  it('counts a saved document as work without calling it a workspace change', () => {
    writePackage('.', { scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } });
    const recorder = new TurnRecorder(workspace);
    const saved = path.join(workspace, 'Documents', 'brief.md');

    recorder.record(toolCall('1', 'save_to_documents', { name: 'brief.md', content: '# Brief' }));
    recorder.record(toolResult('1', 'save_to_documents', 'success', `Saved 1 lines (7 bytes) to '${saved}'.`, { path: saved }));

    expect(recorder.hasWork()).toBe(true);
    const summary = recorder.build('completed', 2);
    // A deliverable outside the jail is not a code change. Listed with the
    // workspace files it made the report offer to run the web app, and a saved
    // `notes.py` made it demand a test command for code nobody edited.
    expect(summary.saved).toEqual([saved]);
    expect(summary.created).toEqual([]);
    expect(summary.webApp).toBeUndefined();
    expect(summary.leftover).toEqual([]);
    expect(formatTurnSummary(summary, 'chat')).toContain(`- Saved \`${saved}\` to Documents`);
  });

  it('reports denied actions, failures, and unverified edits as leftover work', () => {
    const recorder = new TurnRecorder(workspace);
    recorder.record(toolCall('1', 'write_file', { path: 'src/app.ts', content: 'x' }));
    recorder.record(toolResult('1', 'write_file', 'success', 'ok'));
    recorder.record(toolCall('2', 'run_command', { command: 'npm', args: ['run', 'build'] }));
    recorder.record(toolResult('2', 'run_command', 'error', 'Type error in src/app.ts', { exitCode: 2 }));
    recorder.record(toolCall('3', 'write_file', { path: 'src/other.ts', content: 'x' }));
    recorder.record(toolResult('3', 'write_file', 'denied', 'Denied by user.'));

    const summary = recorder.build('step_limit_reached', 9);
    expect(summary.leftover).toEqual([
      '`npm run build` failed: Type error in src/app.ts',
      '1 action was denied; those changes were not applied.',
      'The step limit ended the task before it finished; run the task again to continue.',
      'No test, typecheck, or build command ran after these edits.',
    ]);
  });

  it('marks an already-started dev server as live', () => {
    writePackage('web', { scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } });
    const recorder = new TurnRecorder(workspace);
    recorder.record(toolCall('1', 'write_file', { path: 'web/src/App.tsx', content: 'x' }));
    recorder.record(toolResult('1', 'write_file', 'success', 'ok'));
    recorder.record(toolCall('2', 'run_command', { command: 'npm', args: ['run', 'dev'] }));
    recorder.record(toolResult('2', 'run_command', 'success', 'ready', { backgrounded: true, serverUrl: 'http://localhost:5173/' }));

    const summary = recorder.build('completed', 2);
    expect(summary.webApp).toEqual({
      directory: 'web',
      command: 'cd web && npm run dev',
      url: 'http://localhost:5173/',
      live: true,
    });
  });
});

describe('turn summary persistence', () => {
  it('adds the report to the saved exchange so a transcript keeps what was shown', () => {
    const history = [
      { role: 'user' as const, content: 'Build it' },
      { role: 'assistant' as const, content: 'Done.' },
    ];

    // The report is painted under the answer, so the saved turn has to carry it
    // too; an export used to stop where the prose ended.
    expect(appendSummaryToHistory(history, 'Done.', '```summary\n# COMPLETED!\n```')).toEqual([
      { role: 'user', content: 'Build it' },
      { role: 'assistant', content: 'Done.\n\n```summary\n# COMPLETED!\n```' },
    ]);
  });

  it('leaves the history alone when that answer was never stored', () => {
    const history = [{ role: 'user' as const, content: 'Build it' }];
    expect(appendSummaryToHistory(history, 'Done.', 'report')).toBe(history);
  });
});

describe('web app detection', () => {
  it('finds the nearest package with a start script and a web framework', () => {
    writePackage('.', { scripts: { build: 'tsc' }, devDependencies: { typescript: '^5' } });
    writePackage('apps/web', { scripts: { dev: 'vite' }, dependencies: { react: '^19', vite: '^6' } });

    expect(detectWebApp(workspace, ['apps/web/src/App.tsx'])).toEqual({
      directory: 'apps/web',
      command: 'cd apps/web && npm run dev',
      url: 'http://localhost:5173',
      live: false,
    });
  });

  it('does not claim a build-only library is runnable', () => {
    writePackage('.', { scripts: { build: 'tsc', test: 'vitest' }, devDependencies: { typescript: '^5' } });
    expect(detectWebApp(workspace, ['src/index.ts'])).toBeUndefined();
  });

  it('offers a static server for a bare index.html', () => {
    fs.writeFileSync(path.join(workspace, 'index.html'), '<!doctype html>', 'utf8');
    expect(detectWebApp(workspace, ['index.html'])).toEqual({
      directory: '.',
      command: 'npx --yes serve .',
      url: 'http://localhost:3000',
      live: false,
    });
  });

  it('uses npm start for a Next.js project', () => {
    writePackage('site', { scripts: { start: 'next start' }, dependencies: { next: '^15' } });
    expect(detectWebApp(workspace, ['site/pages/index.tsx'])).toMatchObject({
      directory: 'site',
      command: 'cd site && npm start',
      url: 'http://localhost:3000',
    });
  });
});

describe('turn summary formatting', () => {
  const summary = {
    status: 'completed' as const,
    steps: 3,
    created: ['src/new.ts'],
    modified: ['src/app.ts'],
    saved: [],
    commands: [{ command: 'npm test', ok: true, exitCode: 0 }],
    checks: [{ name: 'npm test', ok: true }],
    leftover: ['Review the diff before committing.'],
    webApp: { directory: 'web', command: 'cd web && npm run dev', url: 'http://localhost:5173', live: false },
  };

  it('renders a fenced markdown panel for the chat answer', () => {
    const rendered = formatTurnSummary(summary, 'chat');
    // The fence is the contract with the answer renderer: everything between the
    // markers is painted as a tinted panel, so the report reads as an afterword
    // instead of three more paragraphs of prose.
    expect(rendered.startsWith('```summary\n')).toBe(true);
    expect(rendered.endsWith('\n```')).toBe(true);
    expect(rendered).toContain('# COMPLETED!');
    expect(rendered).toContain('## Done');
    expect(rendered).toContain('- Added `src/new.ts`');
    expect(rendered).toContain('- Updated `src/app.ts`');
    expect(rendered).toContain('- Ran `npm test`');
    expect(rendered).toContain('## Checked');
    expect(rendered).toContain('## Left over');
    expect(rendered).toContain('## Run it');
    expect(rendered).toContain('`cd web && npm run dev` → `http://localhost:5173`');
    // No bold markers inside the panel: the renderer styles the headings itself.
    expect(rendered).not.toContain('**');
  });

  it('renders plain terminal bullets for moderado run', () => {
    const rendered = formatTurnSummary(summary, 'terminal');
    expect(rendered).toContain('Done');
    expect(rendered).toContain('•');
    expect(rendered).not.toContain('**');
    expect(rendered).not.toContain('`');
  });

  it('says nothing is outstanding when the turn was clean', () => {
    const rendered = formatTurnSummary({ ...summary, leftover: [] }, 'chat');
    expect(rendered).toContain('- Nothing outstanding.');
  });

  it.each([
    ['completed', '# COMPLETED!'],
    ['step_limit_reached', '# NOT FINISHED'],
    ['cancelled', '# STOPPED'],
    ['failed', '# FAILED'],
  ] as const)('heads a %s turn with the status it actually ended in', (status, title) => {
    // The heading used to be a constant, so a stopped or failed turn still read
    // COMPLETED! at the top of the one block the user trusts.
    const rendered = formatTurnSummary({ ...summary, status }, 'chat');
    expect(rendered.split('\n')[1]).toBe(title);
  });
});
