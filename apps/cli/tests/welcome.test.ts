import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  renderModeradoHeader,
  renderCenteredWelcomeScreen,
  renderChatScreen,
  renderChatComposerCursor,
  renderChatAnswerDelta,
  renderChatThoughtTimeUpdate,
  navigateQuestionHistory,
  renderWelcomePopupLayer,
  renderFullWelcomeScreen,
  renderWelcomeCard,
  renderQueuedCommandsBox,
  renderHelpPopupBox,
  renderExitMessage,
  MODERADO_ASCII_LOGO,
  COMMAND_HINT,
  stripAnsi,
  getMatchingCommands,
  promptInteractiveTurn,
  selectCommandCandidate,
  renderMentionSuggestionsBox,
  renderSuggestionsBox,
  SLASH_COMMANDS,
} from '../src/ui/welcome.js';
import { handleMcpCommand } from '../src/commands/chat.js';

type ComposerStdin = typeof process.stdin;
type ComposerContext = { writes: string[]; rows: number };

interface ComposerPosition {
  row: number;
  column: number;
}

/** Parse the composer's absolute cursor position from a cursor write. */
const parseComposerPosition = (write: string): ComposerPosition | undefined => {
  const match = /\x1b\[(\d+);(\d+)H/.exec(write);
  if (!match) return undefined;
  return { row: Number(match[1]), column: Number(match[2]) };
};

/** Find the cursor write for the composer's full-screen paint. */
const lastComposerWrite = (writes: string[]): ComposerPosition => {
  const positions = writes.map(parseComposerPosition).filter((position) => position !== undefined);
  if (positions.length === 0) throw new Error('no composer cursor write captured');
  return positions[positions.length - 1];
};

/**
 * Run one composer turn with mocked TTY stdio, capturing caret cursor writes,
 * then drive the composer through emitted keypress and mouse-report events.
 */
const runComposerTurn = async (
  drive: (stdin: ComposerStdin, context: ComposerContext) => void | Promise<void>,
  extraOptions: Record<string, any> = {}
): Promise<string> => {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const originalIsTTY = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
  const originalSetRawMode = stdin.setRawMode;
  const originalColumns = stdout.columns;
  const originalRows = stdout.rows;
  const writes: string[] = [];
  const resume = vi.spyOn(stdin, 'resume').mockImplementation(() => stdin);
  const pause = vi.spyOn(stdin, 'pause').mockImplementation(() => stdin);
  const write = vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true });
  stdin.setRawMode = () => stdin;
  Object.defineProperty(stdout, 'columns', { configurable: true, value: 80 });
  Object.defineProperty(stdout, 'rows', { configurable: true, value: 24 });
  const controller = new AbortController();
  try {
    const turnPromise = promptInteractiveTurn({
      model: 'test-model', tokens: 0, cost: '$0.00', workspace: 'd:\\\\test',
      signal: controller.signal,
      ...extraOptions,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await drive(stdin, { writes, rows: 24 });
    const result = await turnPromise;
    return result.text;
  } finally {
    controller.abort();
    write.mockRestore();
    pause.mockRestore();
    resume.mockRestore();
    stdin.setRawMode = originalSetRawMode;
    if (originalIsTTY) Object.defineProperty(stdin, 'isTTY', originalIsTTY);
    else delete (stdin as { isTTY?: boolean }).isTTY;
    Object.defineProperty(stdout, 'columns', { configurable: true, value: originalColumns });
    Object.defineProperty(stdout, 'rows', { configurable: true, value: originalRows });
  }
};

describe('OpenCode-style Welcome TUI', () => {
  it('renders the ASCII logo and command hint', () => {
    expect(MODERADO_ASCII_LOGO.length).toBe(5);
    const plainHint = stripAnsi(COMMAND_HINT);
    expect(plainHint).toContain('Use / for slash commands');
    expect(plainHint).toContain('@ for file mentions');
    expect(plainHint).not.toContain('Ctrl+P');

    const header = renderModeradoHeader();
    expect(header).toContain(COMMAND_HINT);
  });

  it('renders the welcome card with 5 lines and dash boundaries', () => {
    const output = renderWelcomeCard({
      model: 'moonshotai/kimi-k3',
      tokens: 0,
      cost: '$0.00',
      workspace: 'd:\\projects\\moderado',
      mode: 'Execute',
      autoApprove: false,
      width: 80,
    });

    const lines = output.split('\n');
    expect(lines.length).toBe(5);

    // Card is centered: width 80 terminal → card width 78, indent 1
    const expectedWidth = 78;
    const expectedIndent = ' '.repeat(1);

    // Line 1: top dark-gray surface row
    expect(stripAnsi(lines[0])).toBe(expectedIndent + ' '.repeat(expectedWidth));
    expect(output).toContain(String.fromCharCode(27) + '[48;5;236m');

    // Line 2: command taking text box with placeholder (centered)
    expect(stripAnsi(lines[1])).toContain(' ❯ Ask anything, I am all ears...');

    // Line 3: bottom dark-gray surface row
    expect(stripAnsi(lines[2])).toBe(expectedIndent + ' '.repeat(expectedWidth));

    // Line 4: model name, tokens, cost, mode
    const line4Plain = stripAnsi(lines[3]);
    expect(line4Plain).toContain('moonshotai/kimi-k3');
    expect(line4Plain).toContain('0 tokens / $0.00');
    expect(line4Plain).toContain('Plan / [Execute] (Tab)');

    // Line 5: working directory, auto-approve
    const line5Plain = stripAnsi(lines[4]);
    expect(line5Plain).toContain('d:\\projects\\moderado');
    expect(line5Plain).toContain('Auto-approve off (Shift+Tab)');
  });

  it('reflects typed input, Plan mode, and auto-approve enabled', () => {
    const output = renderWelcomeCard({
      model: 'meta/llama-3.3-70b-instruct',
      tokens: 1500,
      cost: '$0.00',
      workspace: '/workspace/app',
      mode: 'Plan',
      autoApprove: true,
      input: 'refactor database layer',
      width: 80,
    });

    const lines = output.split('\n');
    // Card centered on an 80-col terminal → 1-space indent
    expect(stripAnsi(lines[1])).toMatch(/^ ❯ refactor database layer\s+$/);
    expect(stripAnsi(lines[3])).toContain('[Plan] / Execute (Tab)');
    expect(stripAnsi(lines[4])).toContain('Auto-approve enabled (Shift+Tab)');
  });

  it('renders the full welcome screen correctly', () => {
    const full = renderFullWelcomeScreen({
      model: 'z-ai/glm-5.3-flash',
      tokens: 0,
      cost: '$0.00',
      workspace: 'd:\\test',
      mode: 'Execute',
      autoApprove: false,
    });

    const plain = stripAnsi(full);
    expect(plain).toContain(stripAnsi(MODERADO_ASCII_LOGO[0]));
    expect(plain).toContain('Use / for slash commands');
    expect(plain).toContain('❯ Ask anything, I am all ears...');
    expect(plain).toContain('z-ai/glm-5.3-flash');
  });

  it('does not present zero tokens or zero cost when provider usage is unavailable', () => {
    const output = renderWelcomeCard({
      model: 'Auto (Free-First)', tokens: 0, cost: 'Cost unknown', usageAvailable: false,
      workspace: 'd:\\projects\\moderado', mode: 'Execute', autoApprove: false, width: 100,
    });

    expect(stripAnsi(output)).toContain('Usage unavailable / Cost unknown');
  });

  it('renders a wide post-question chat layout with logo, elapsed time, answer, and anchored composer details', () => {
    const rendered = renderChatScreen({
      model: 'z-ai/glm-5.3-flash',
      tokens: 1500,
      cost: '$0.00',
      workspace: 'd:\\projects\\moderado',
      mode: 'Execute',
      autoApprove: false,
      chatQuestion: 'Explain this repository.',
      chatAnswer: 'It is a provider-independent coding agent.',
      chatThoughtTime: 12,
      outputTokenRate: 42,
      width: 140,
    }, 40);

    const plain = stripAnsi(rendered);
    expect(plain).toContain(stripAnsi(MODERADO_ASCII_LOGO[0]));
    expect(plain).toContain('Explain this repository.');
    expect(plain).toContain('Thought for 12s');
    expect(plain).toContain('It is a provider-independent coding agent.');
    expect(plain).toContain('z-ai/glm-5.3-flash');
    expect(plain).toContain('1500 tokens / $0.00');
    expect(plain).toContain('42 tok/s');
    expect(plain).toContain('d:\\projects\\moderado');
    expect(plain).toContain('Auto-approve off (Shift+Tab)');
  });

  it('shows a sub-second response time without reporting a misleading zero seconds', () => {
    const rendered = renderChatScreen({
      model: 'z-ai/glm-5.3-flash',
      tokens: 0,
      cost: '$0.00',
      workspace: 'd:\\projects\\moderado',
      mode: 'Execute',
      autoApprove: false,
      chatQuestion: 'Who are you?',
      chatAnswer: 'I am Moderado.',
      chatThoughtTime: 0.2,
      width: 100,
    }, 30);

    expect(stripAnsi(rendered)).toContain('Thought for <1s');
  });

  it('renders the Moderado logo above the clean-exit message', () => {
    const output = renderExitMessage('Goodbye!');
    expect(output).toContain(MODERADO_ASCII_LOGO[0]);
    expect(output).not.toContain('Use / for slash commands');
    expect(stripAnsi(output).split('\n')[0]).toBe(stripAnsi(MODERADO_ASCII_LOGO[0]));
    expect(output.indexOf(MODERADO_ASCII_LOGO[0])).toBeLessThan(output.indexOf('Goodbye!'));
  });

  it('updates only the elapsed counter while preserving a flashing composer cursor', () => {
    const rendered = renderChatScreen({
      model: 'nvidia/nemotron-3', tokens: 0, cost: '$0.00', workspace: 'd:\\projects\\moderado',
      mode: 'Execute', autoApprove: false, chatQuestion: 'Who are you?', chatThoughtTime: 0.2,
      width: 100,
    }, 30);

    expect(stripAnsi(rendered)).not.toContain('Thinking');
    expect(stripAnsi(rendered)).not.toContain('Thought for <1s');
    expect(renderChatComposerCursor({ width: 100 }, 0)).toBe('\x1b[1 q\x1b[?25h\x1b[4A\r\x1b[3C');
    expect(renderChatThoughtTimeUpdate(2.2)).toContain('Thought for 2s');
    expect(renderChatThoughtTimeUpdate(2.2)).toMatch(/^\x1b7\x1b\[13;1H/);
    expect(renderChatThoughtTimeUpdate(2.2)).toMatch(/\x1b8$/);
    expect(renderChatAnswerDelta('Hi', { row: 15, column: 1 }, 100)).toMatchObject({ row: 15, column: 3 });
  });

  it('centers the welcome screen vertically in the available terminal rows', () => {
    const rendered = renderCenteredWelcomeScreen({
      model: 'z-ai/glm-5.3-flash',
      tokens: 0,
      cost: '$0.00',
      workspace: 'd:\\test',
      mode: 'Execute',
      autoApprove: false,
      width: 100,
    }, 30);

    const firstContentRow = rendered.split('\n').findIndex((line) => stripAnsi(line).includes('Use / for slash commands'));
    expect(firstContentRow).toBeGreaterThan(12);
    expect(firstContentRow).toBeLessThan(18);
  });

  it('composites popups over a dimmed welcome window instead of appending them', () => {
    const rendered = renderWelcomePopupLayer({
      model: 'Auto (Free-First)', tokens: 0, cost: '$0.00', workspace: 'd:\\test',
      mode: 'Execute', autoApprove: false, width: 100,
    }, ['╭─ Connect ─╮', '│ NVIDIA NIM │', '╰───────────╯'], 100, 30);

    expect(rendered).toContain('\x1b[2m');
    expect(rendered).toContain('\x1b[?25l');
    expect(rendered).toContain('NVIDIA NIM');
  });

  it('renders slash command suggestions box when input starts with slash', () => {
    const output = renderWelcomeCard({
      model: 'moonshotai/kimi-k3',
      tokens: 0,
      cost: '$0.00',
      workspace: 'd:\\test',
      mode: 'Execute',
      autoApprove: false,
      input: '/',
      width: 80,
    });

    const plain = stripAnsi(output);
    expect(plain).toContain('/connect');
    expect(plain).toContain('/model');
    expect(plain).toContain('/session');
    expect(plain).toContain('/workflow');
    expect(plain).toContain('/clear');
    expect(plain).toContain('/help');
    expect(plain).toContain('/exit');
    expect(plain).toContain('Commands (Press Tab to autocomplete)');
  });

  it('filters slash commands suggestions by prefix', () => {
    const output = renderWelcomeCard({
      model: 'moonshotai/kimi-k3',
      tokens: 0,
      cost: '$0.00',
      workspace: 'd:\\test',
      mode: 'Execute',
      autoApprove: false,
      input: '/m',
      width: 80,
    });

    const plain = stripAnsi(output);
    expect(plain).toContain('/model');
    expect(plain).not.toContain('/clear');
    expect(plain).not.toContain('/help');
  });

  it('offers /mcp in slash-command completion', () => {
    expect(getMatchingCommands('/mc').map((command) => command.name)).toEqual(['/mcp']);
  });

  it('routes /mcp input through the MCP callback before submitting an agent turn', async () => {
    const stdin = process.stdin as typeof process.stdin & { setRawMode?: (mode: boolean) => typeof process.stdin };
    const originalIsTTY = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
    const originalSetRawMode = stdin.setRawMode;
    const resume = vi.spyOn(stdin, 'resume').mockImplementation(() => stdin);
    const pause = vi.spyOn(stdin, 'pause').mockImplementation(() => stdin);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true });
    stdin.setRawMode = () => stdin;
    const controller = new AbortController();
    const commands: string[] = [];

    try {
      const turnPromise = promptInteractiveTurn({
        model: 'test-model', tokens: 0, cost: '$0.00', workspace: 'd:\\test',
        signal: controller.signal,
        onMcp: async (command) => {
          commands.push(command);
          controller.abort();
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      for (const character of '/mcp status') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      stdin.emit('keypress', '\r', { name: 'return' });

      await expect(turnPromise).resolves.toMatchObject({ text: '' });
      expect(commands).toEqual(['/mcp status']);
    } finally {
      controller.abort();
      write.mockRestore();
      pause.mockRestore();
      resume.mockRestore();
      stdin.setRawMode = originalSetRawMode;
      if (originalIsTTY) Object.defineProperty(stdin, 'isTTY', originalIsTTY);
      else delete (stdin as { isTTY?: boolean }).isTTY;
    }
  });

  it('keeps an MCP result popup active until dismissal before rebinding the composer', async () => {
    const stdin = process.stdin as typeof process.stdin & { setRawMode?: (mode: boolean) => typeof process.stdin };
    const originalIsTTY = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
    const originalSetRawMode = stdin.setRawMode;
    const resume = vi.spyOn(stdin, 'resume').mockImplementation(() => stdin);
    const pause = vi.spyOn(stdin, 'pause').mockImplementation(() => stdin);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true });
    stdin.setRawMode = () => stdin;
    const controller = new AbortController();
    let dismissalStarted = false;
    let releaseDismissal!: () => void;
    const dismissal = new Promise<void>((resolve) => { releaseDismissal = resolve; });
    let callbackReturned = false;

    try {
      const turnPromise = promptInteractiveTurn({
        model: 'test-model', tokens: 0, cost: '$0.00', workspace: 'd:\\test', signal: controller.signal,
        onMcp: async (command, drawFrame) => {
          await handleMcpCommand(command, drawFrame, {
            reloadMcpTools: async () => {},
            promptText: async (label) => label.includes('name') ? 'broken' : label.includes('executable') ? 'missing-server' : '',
            discoverMcpServers: async () => [{ name: 'broken', enabled: true, tools: [], error: 'spawn failed' }],
            selectListPopup: async (_title, _items, options) => {
              dismissalStarted = true;
              options.drawFrame(['MCP add failed', 'spawn failed', 'Press Esc or Enter to return.']);
              await dismissal;
              return null;
            },
          });
          callbackReturned = true;
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      for (const character of '/mcp add') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      stdin.emit('keypress', '\r', { name: 'return' });
      await new Promise((resolve) => setImmediate(resolve));

      expect(dismissalStarted).toBe(true);
      expect(callbackReturned).toBe(false);
      releaseDismissal();
      await new Promise((resolve) => setImmediate(resolve));
      for (const character of 'after-popup') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      stdin.emit('keypress', '\r', { name: 'return' });
      await expect(turnPromise).resolves.toMatchObject({ text: 'after-popup' });
      expect(callbackReturned).toBe(true);
    } finally {
      controller.abort();
      releaseDismissal();
      write.mockRestore();
      pause.mockRestore();
      resume.mockRestore();
      stdin.setRawMode = originalSetRawMode;
      if (originalIsTTY) Object.defineProperty(stdin, 'isTTY', originalIsTTY);
      else delete (stdin as { isTTY?: boolean }).isTTY;
    }
  });

  it('does not route slash inputs that only begin with /mcp', async () => {
    const stdin = process.stdin as typeof process.stdin & { setRawMode?: (mode: boolean) => typeof process.stdin };
    const originalIsTTY = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
    const originalSetRawMode = stdin.setRawMode;
    const resume = vi.spyOn(stdin, 'resume').mockImplementation(() => stdin);
    const pause = vi.spyOn(stdin, 'pause').mockImplementation(() => stdin);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true });
    stdin.setRawMode = () => stdin;
    const controller = new AbortController();
    const commands: string[] = [];

    try {
      const turnPromise = promptInteractiveTurn({
        model: 'test-model', tokens: 0, cost: '$0.00', workspace: 'd:\\test', signal: controller.signal,
        onMcp: async (command) => { commands.push(command); },
      });
      await new Promise((resolve) => setImmediate(resolve));
      for (const character of '/mcpx') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      stdin.emit('keypress', '\r', { name: 'return' });
      await expect(turnPromise).resolves.toMatchObject({ text: '/mcpx' });
      expect(commands).toEqual([]);
    } finally {
      controller.abort();
      write.mockRestore();
      pause.mockRestore();
      resume.mockRestore();
      stdin.setRawMode = originalSetRawMode;
      if (originalIsTTY) Object.defineProperty(stdin, 'isTTY', originalIsTTY);
      else delete (stdin as { isTTY?: boolean }).isTTY;
    }
  });

  it('keeps a no-match MCP popup attached until dismissal before rebinding the composer', async () => {
    const stdin = process.stdin as typeof process.stdin & { setRawMode?: (mode: boolean) => typeof process.stdin };
    const originalIsTTY = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
    const originalSetRawMode = stdin.setRawMode;
    const resume = vi.spyOn(stdin, 'resume').mockImplementation(() => stdin);
    const pause = vi.spyOn(stdin, 'pause').mockImplementation(() => stdin);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true });
    stdin.setRawMode = () => stdin;
    const controller = new AbortController();
    const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-mcp-popup-test-'));
    let popupActive = false;
    let releaseDismissal!: () => void;
    const dismissal = new Promise<void>((resolve) => { releaseDismissal = resolve; });
    let callbackReturned = false;

    try {
      const turnPromise = promptInteractiveTurn({
        model: 'test-model', tokens: 0, cost: '$0.00', workspace: 'd:\\test', signal: controller.signal,
        onMcp: async (command, drawFrame) => {
          await handleMcpCommand(command, drawFrame, {
            configHome,
            reloadMcpTools: async () => {},
            selectListPopup: async (_title, _items, options) => {
              popupActive = true;
              options.drawFrame(['No matching local MCP servers are configured.', 'Press Esc or Enter to return.']);
              await dismissal;
              popupActive = false;
              return null;
            },
          });
          callbackReturned = true;
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      for (const character of '/mcp enable') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      stdin.emit('keypress', '\r', { name: 'return' });
      await new Promise((resolve) => setImmediate(resolve));

      expect(popupActive).toBe(true);
      expect(callbackReturned).toBe(false);
      releaseDismissal();
      await new Promise((resolve) => setImmediate(resolve));
      for (const character of 'after-no-match') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      stdin.emit('keypress', '\r', { name: 'return' });
      await expect(turnPromise).resolves.toMatchObject({ text: 'after-no-match' });
      expect(popupActive).toBe(false);
      expect(callbackReturned).toBe(true);
    } finally {
      controller.abort();
      releaseDismissal();
      write.mockRestore();
      pause.mockRestore();
      resume.mockRestore();
      stdin.setRawMode = originalSetRawMode;
      if (originalIsTTY) Object.defineProperty(stdin, 'isTTY', originalIsTTY);
      else delete (stdin as { isTTY?: boolean }).isTTY;
      fs.rmSync(configHome, { recursive: true, force: true });
    }
  });

  it('recalls prior questions and restores the unfinished draft', () => {
    expect(navigateQuestionHistory(['first', 'second'], -1, 2, 'draft')).toEqual({ input: 'second', index: 1, draft: 'draft' });
    expect(navigateQuestionHistory(['first', 'second'], 1, 1, 'draft')).toEqual({ input: 'draft', index: 2, draft: 'draft' });
  });

  it('includes session and MCP management in the help popup without an extra content indent', () => {
    const plain = stripAnsi(renderHelpPopupBox('v0.2.0', 'd:\\test', 80).join('\n'));
    expect(plain).toContain('/session   Create, resume, undo, redo, share, export, or compact sessions');
    expect(plain).toContain('/mcp       Manage local MCP servers');
    expect(plain).not.toContain('│   /session');
  });

  it('leaves horizontal placement to the popup layer instead of indenting the help box', () => {
    const plainLines = stripAnsi(renderHelpPopupBox('v0.2.0', 'd:\\test', 80).join('\n')).split('\n');
    expect(plainLines[0]).not.toMatch(/^\s/);
    expect(plainLines[1]).not.toMatch(/^\s/);
  });

  it('renderHelpPopupBox encloses all lines within boxWidth without spearing out', () => {
    const lines = renderHelpPopupBox('v0.2.0', 'd:\\test', 80);
    const plainLines = lines.map((line) => stripAnsi(line));
    const expectedWidth = 80;
    for (const line of plainLines) {
      expect(line.length).toBe(expectedWidth);
      expect(line.startsWith('╭') || line.startsWith('│') || line.startsWith('╰')).toBe(true);
      expect(line.endsWith('╮') || line.endsWith('│') || line.endsWith('╯')).toBe(true);
    }
  });

  it('renderSuggestionsBox encloses all lines within boxWidth and holds full command context', () => {
    const lines = renderSuggestionsBox(SLASH_COMMANDS, 80);
    const plainLines = lines.map((line) => stripAnsi(line));
    const expectedWidth = 80;
    for (const line of plainLines) {
      expect(line.length).toBe(expectedWidth);
      expect(line.startsWith('╭') || line.startsWith('│') || line.startsWith('╰')).toBe(true);
      expect(line.endsWith('╮') || line.endsWith('│') || line.endsWith('╯')).toBe(true);
    }
    const joined = plainLines.join('\n');
    expect(joined).toContain('/session');
    expect(joined).toContain('Create, resume, undo, redo, share, export, or compact sessions');
    expect(joined).toContain('/workflow');
    expect(joined).toContain('Inspect Git, build plans, or undo agent changes');
  });

  it('renderWelcomeCard encloses slash command candidates popup when user types /', () => {
    const card = renderWelcomeCard({
      model: 'meta/llama-3.3-70b-instruct',
      tokens: 0,
      cost: '$0.00',
      workspace: 'd:\\test',
      mode: 'Execute',
      autoApprove: false,
      input: '/',
      width: 80,
    });
    expect(card).toContain('Commands (Press Tab to autocomplete)');
    expect(card).toContain('/session');
    expect(card).toContain('Create, resume, undo, redo, share, export, or compact sessions');
  });

  it('selects and completes slash command candidates by index', () => {
    expect(selectCommandCandidate('/se', 0, 0)?.name).toBe('/session');
    expect(selectCommandCandidate('/', 0, 1)?.name).toBe('/model');
    expect(selectCommandCandidate('/', 0, -1)?.name).toBe('/exit');
  });

  it('documents the composer caret shortcuts in the help popup', () => {
    const plain = stripAnsi(renderHelpPopupBox('v0.2.0', 'd:\\\\test', 80).join('\n'));
    expect(plain).toContain('Left/Right   Move the caret inside the bottom input line');
    expect(plain).toContain('Mouse click  Place the caret on the input line');
  });

  it('moves the caret with arrow keys to edit inside typed text', async () => {
    const result = await runComposerTurn(async (stdin) => {
      for (const character of 'abcd') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      stdin.emit('keypress', '', { name: 'left' });
      stdin.emit('keypress', '', { name: 'left' });
      stdin.emit('keypress', 'X', { name: 'x', ctrl: false, meta: false });
      stdin.emit('keypress', '', { name: 'backspace' });
      stdin.emit('keypress', '', { name: 'right' });
      stdin.emit('keypress', '', { name: 'delete' });
      stdin.emit('keypress', '\r', { name: 'return' });
    });
    expect(result).toBe('abc');
  });

  it('clamps the caret at the start and end of the composer text', async () => {
    const result = await runComposerTurn(async (stdin) => {
      for (const character of 'ab') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      stdin.emit('keypress', '', { name: 'left' });
      stdin.emit('keypress', '', { name: 'left' });
      stdin.emit('keypress', '', { name: 'left' });
      stdin.emit('keypress', '', { name: 'backspace' });
      stdin.emit('keypress', '', { name: 'delete' });
      stdin.emit('keypress', '', { name: 'right' });
      stdin.emit('keypress', '', { name: 'right' });
      stdin.emit('keypress', '', { name: 'right' });
      stdin.emit('keypress', '\r', { name: 'return' });
    });
    expect(result).toBe('b');
  });

  it('places the caret where the composer line is clicked', async () => {
    const result = await runComposerTurn(async (stdin, context) => {
      for (const character of 'abcd') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      expect(context.writes.length).toBeGreaterThan(0);
      const composer = lastComposerWrite(context.writes);
      expect(composer.row).toBeGreaterThan(0);
      const row = composer.row;
      const column = composer.column - 2;
      const pressReport = `\x1b[<0;${column};${row}M`;
      stdin.emit('data', pressReport);
      stdin.emit('keypress', '0', { name: '0', ctrl: false, meta: false });
      stdin.emit('keypress', ';', { name: ';', ctrl: false, meta: false });
      stdin.emit('keypress', String(context.rows), { name: String(context.rows), ctrl: false, meta: false });
      stdin.emit('keypress', 'M', { name: 'm', ctrl: false, meta: false });
      await new Promise((resolve) => setImmediate(resolve));
      stdin.emit('keypress', 'X', { name: 'x', ctrl: false, meta: false });
      stdin.emit('keypress', '\r', { name: 'return' });
    });
    expect(result).toBe('abXcd');
  });

  it('ignores mouse reports that do not target the composer line', async () => {
    const result = await runComposerTurn(async (stdin) => {
      for (const character of 'ab') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      stdin.emit('data', `\x1b[<0;1;1M`);
      stdin.emit('keypress', '0', { name: '0', ctrl: false, meta: false });
      stdin.emit('keypress', ';', { name: ';', ctrl: false, meta: false });
      stdin.emit('keypress', '1', { name: '1', ctrl: false, meta: false });
      stdin.emit('keypress', 'M', { name: 'm', ctrl: false, meta: false });
      await new Promise((resolve) => setImmediate(resolve));
      stdin.emit('keypress', '\r', { name: 'return' });
    });
    expect(result).toBe('ab');
  });

  it('keeps every caret hop on the composer row (no cursor escape)', async () => {
    let positions: ComposerPosition[] = [];
    const result = await runComposerTurn(async (stdin, context) => {
      for (const character of 'ab') {
        stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      }
      for (let i = 0; i < 10; i++) stdin.emit('keypress', '', { name: 'left' });
      for (let i = 0; i < 10; i++) stdin.emit('keypress', '', { name: 'right' });
      positions = context.writes
        .map(parseComposerPosition)
        .filter((position): position is ComposerPosition => position !== undefined);
      stdin.emit('keypress', '\r', { name: 'return' });
    });
    expect(result).toBe('ab');
    expect(positions.length).toBeGreaterThan(0);
    // Every cursor hop — including the clamped ones past either end — must
    // land on the single composer row, otherwise the cursor escapes the box.
    expect(new Set(positions.map((position) => position.row)).size).toBe(1);
  });
  it('includes only /skills in slash completion and help popup', () => {
    expect(SLASH_COMMANDS.some((c) => c.name === '/skill')).toBe(false);
    expect(SLASH_COMMANDS.some((c) => c.name === '/skills')).toBe(true);
    const plain = stripAnsi(renderHelpPopupBox('v0.3.2', 'd:\\test', 80).join('\n'));
    expect(plain).not.toContain('/skill\n');
    expect(plain).toContain('/skills');
  });
  it('includes /init in SLASH_COMMANDS and help popup', () => {
    const initCmd = SLASH_COMMANDS.find((c) => c.name === '/init');
    expect(initCmd).toBeDefined();
    expect(initCmd?.desc).toContain('Scaffold AGENTS.md');

    const plain = stripAnsi(renderHelpPopupBox('v0.2.0', 'd:\\test', 80).join('\n'));
    expect(plain).toContain('/init');
    expect(plain).toContain('Scaffold AGENTS.md from workspace scan');
  });

  it('includes /btw in SLASH_COMMANDS and help popup', () => {
    const btwCmd = SLASH_COMMANDS.find((c) => c.name === '/btw');
    expect(btwCmd).toBeDefined();
    expect(btwCmd?.desc).toContain('side question');

    const plain = stripAnsi(renderHelpPopupBox('v0.2.0', 'd:\\test', 80).join('\n'));
    expect(plain).toContain('/btw');
    expect(plain).toContain('Ask an ephemeral side question (no session pollution)');
  });

  it('renders mention suggestions box with custom styling', () => {
    const lines = renderMentionSuggestionsBox(['src/main.ts', 'README.md'], 0);
    expect(lines.length).toBeGreaterThan(0);
    const plain = stripAnsi(lines.join('\n'));
    expect(plain).toContain('@src/main.ts');
    expect(plain).toContain('@README.md');
    expect(plain).toContain('Files (@ to mention, Tab to insert)');
  });

  it('autocompletes @ mention with Tab in composer turn', async () => {
    const result = await runComposerTurn(
      async (stdin) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        for (const character of 'check @age') {
          stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
        }
        stdin.emit('keypress', '\t', { name: 'tab', shift: false });
        stdin.emit('keypress', '\r', { name: 'return' });
      },
      {
        onMentionComplete: async () => ['packages/core/src/agent.ts', 'README.md'],
      }
    );
    expect(result).toBe('check @packages/core/src/agent.ts');
  });

  it('routes /init through onInit callback', async () => {
    let initCalled = false;
    await runComposerTurn(
      async (stdin) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        for (const character of '/init') {
          stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
        }
        stdin.emit('keypress', '\r', { name: 'return' });
        await new Promise((resolve) => setTimeout(resolve, 20));
        for (const character of 'done') {
          stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
        }
        stdin.emit('keypress', '\r', { name: 'return' });
      },
      {
        onInit: async () => { initCalled = true; },
      }
    );
    expect(initCalled).toBe(true);
  });

  it('renderWelcomeCard displays queued commands banner and generation placeholder', () => {
    // 1. Idle state without queue
    const idleCard = renderWelcomeCard({
      model: 'meta/llama-3.3-70b-instruct',
      tokens: 1200,
      cost: '$0.002',
      workspace: '/test/workspace',
      mode: 'Execute',
      autoApprove: false,
    });
    expect(idleCard).toContain('Ask anything, I am all ears...');
    expect(idleCard).not.toContain('Queued');

    // 2. Active generation state maintains normal placeholder
    const generatingCard = renderWelcomeCard({
      model: 'meta/llama-3.3-70b-instruct',
      tokens: 1200,
      cost: '$0.002',
      workspace: '/test/workspace',
      mode: 'Execute',
      autoApprove: false,
      chatAnswer: 'Thinking and implementing...',
      isTurnSettled: false,
    });
    expect(generatingCard).toContain('Ask anything, I am all ears...');

    // 3. Queued commands banner
    const queuedCard = renderWelcomeCard({
      model: 'meta/llama-3.3-70b-instruct',
      tokens: 1200,
      cost: '$0.002',
      workspace: '/test/workspace',
      mode: 'Execute',
      autoApprove: false,
      queuedCommands: ['npm test', 'git diff'],
    });
    const plainQueuedCard = stripAnsi(queuedCard);
    expect(plainQueuedCard).toContain('Queued Commands (2)');
    expect(plainQueuedCard).toContain('1. npm test');
    expect(plainQueuedCard).toContain('2. git diff');
    expect(plainQueuedCard).toContain('╭─');
    expect(plainQueuedCard).toContain('╰');
    // Ensure queue appears in a separate box ABOVE the editable question box marker (❯)
    const queuePos = plainQueuedCard.indexOf('Queued Commands (2)');
    const inputPos = plainQueuedCard.indexOf(String.fromCodePoint(0x276F));
    expect(queuePos).toBeGreaterThan(-1);
    expect(inputPos).toBeGreaterThan(-1);
    expect(queuePos).toBeLessThan(inputPos);

    // 4. Test renderQueuedCommandsBox directly
    const box = renderQueuedCommandsBox(['git status', 'npm run build', 'npm test', 'node index.js', 'echo extra'], 80);
    expect(box.length).toBeGreaterThan(0);
    expect(stripAnsi(box[0])).toContain('Queued Commands (5)');
    expect(stripAnsi(box[box.length - 1])).toContain('╰');
    expect(stripAnsi(box.join('\n'))).toContain('(+1 more - type /queue to inspect)');
  });
});
