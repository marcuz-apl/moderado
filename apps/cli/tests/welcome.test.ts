import { describe, it, expect, vi } from 'vitest';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { displayWidth } from '../src/ui/box.js';
import {
  renderModeradoHeader,
  renderCenteredWelcomeScreen,
  renderChatScreen,
  renderChatComposerCursor,
  renderChatThoughtTimeUpdate,
  describeActivity,
  describeToolActivity,
  describeWait,
  WAIT_NOTICE_AFTER_MS,
  WAIT_NOTICE_REPEAT_MS,
  formatElapsed,
  navigateQuestionHistory,
  renderWelcomePopupLayer,
  renderFullWelcomeScreen,
  renderWelcomeCard,
  renderGatewayFallbackUpdate,
  renderQueuedCommandsBox,
  renderHelpPopupBox,
  renderExitMessage,
  MODERADO_ASCII_LOGO,
  COMMAND_HINT,
  stripAnsi,
  getMatchingCommands,
  selectCommandCandidate,
  renderMentionSuggestionsBox,
  renderSuggestionsBox,
  SLASH_COMMANDS,
  getWelcomeCardWidth,
  getWelcomeIndent,
  getChatAnswerArea,
  getChatLayout,
  getChatComposerRows,
  getComposerInputMaxRows,
  wrapComposerInput,
  composerView,
  composerCaretIndex,
  wrapAnswerLines,
  windowChatAnswerAt,
  buildChatTranscriptRows,
  windowChatTranscriptAt,
  renderChatTranscriptWindow,
  renderChatTranscriptHeader,
  renderAnswerLine,
  renderChatUsageUpdate,
} from '../src/ui/welcome.js';
import { promptInteractiveTurn } from '../src/ui/composer.js';
import { handleMcpCommand } from '../src/commands/chat.js';

type ComposerStdin = typeof process.stdin;
type ComposerContext = { writes: string[]; rows: number; resumeCount: () => number };

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
    await drive(stdin, { writes, rows: 24, resumeCount: () => resume.mock.calls.length });
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
  it('renders Gateway fallback destination and a safe reason in the chat status row', () => {
    const output = stripAnsi(renderGatewayFallbackUpdate({ type: 'gateway_status', fromModel: 'free/old', toModel: 'free/new', reason: 'rate_limited_or_unavailable', timestamp: 0 }, 100));
    expect(output).toContain('free/new');
    expect(output).toContain('rate limited or unavailable');
  });
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

    // Line 4: tokens, cost, and mode
    const line4Plain = stripAnsi(lines[3]);
    expect(line4Plain).toContain('0 tokens / $0.00');
    expect(line4Plain).toContain('Plan / [Execute] (Tab)');

    // Line 5: working directory, model, auto-approve
    const line5Plain = stripAnsi(lines[4]);
    expect(line5Plain).toContain('d:\\projects\\moderado');
    expect(line5Plain).toContain('moonshotai/kimi-k3');
    expect(line5Plain).not.toContain('0 tokens / $0.00');
    expect(line5Plain).toContain('Auto-approve off (Shift+Tab)');
  });

  it('shows the active provider before the model on the bottom row', () => {
    const lines = stripAnsi(renderWelcomeCard({
      provider: 'OpenRouter', model: 'openrouter/free', tokens: 0, cost: '$0.00',
      workspace: '/workspace', mode: 'Execute', autoApprove: false, width: 80,
    })).split('\n');
    expect(lines[4]).toContain('OpenRouter | openrouter/free');
    expect(lines[4].length).toBeLessThanOrEqual(80);
  });

  it('keeps a long provider and model inside the bottom row', () => {
    const row = stripAnsi(renderWelcomeCard({
      provider: 'A Provider With A Very Long Name',
      model: 'vendor/a-very-long-model-name-for-testing', tokens: 0, cost: '$0.00',
      workspace: '/workspace/with/long/path', mode: 'Execute', autoApprove: true, width: 80,
    })).split('\n')[4];
    expect(row).toContain(' | ');
    expect(row).toContain('Auto-approve enabled (Shift+Tab)');
    expect(row.length).toBeLessThanOrEqual(80);
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

  it('resumes stdin after returning from model selection', async () => {
    let resumeCountAfterSelection = 0;
    const emitKeypressEvents = vi.spyOn(readline, 'emitKeypressEvents').mockImplementation(() => {});
    try {
      const result = await runComposerTurn(async (stdin, context) => {
        for (const character of '/model') {
          stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
        }
        stdin.emit('keypress', '\r', { name: 'return' });
        await new Promise((resolve) => setImmediate(resolve));
        resumeCountAfterSelection = context.resumeCount();

        for (const character of 'hello') {
          stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
        }
        stdin.emit('keypress', '\r', { name: 'return' });
      }, {
        onModelSelect: async () => {
          process.stdin.pause();
          return 'selected-model';
        },
      });

      expect(resumeCountAfterSelection).toBeGreaterThan(1);
      expect(result).toBe('hello');
    } finally {
      emitKeypressEvents.mockRestore();
    }
  });

  it('refreshes the provider label after connecting inside the composer', async () => {
    let provider = 'NVIDIA NIM';
    const result = await runComposerTurn(async (stdin, context) => {
      for (const character of '/connect') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      stdin.emit('keypress', '\r', { name: 'return' });
      await new Promise((resolve) => setImmediate(resolve));
      const screen = stripAnsi(context.writes.join(''));
      expect(screen).toContain('OpenRouter | openrouter/free');
      for (const character of 'hello') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      stdin.emit('keypress', '\r', { name: 'return' });
    }, {
      getProviderName: () => provider,
      onConnect: async () => { provider = 'OpenRouter'; return 'openrouter/free'; },
    });
    expect(result).toBe('hello');
  });

  it('places process usage and token cost left of the mode on the composer row', () => {
    const output = renderWelcomeCard({
      model: 'model-tag',
      tokens: 1500,
      cost: '$0.00',
      workspace: '/workspace/app',
      mode: 'Execute',
      autoApprove: true,
      width: 100,
      chatQuestion: 'Submitted question',
      tokenUsage: {
        usage: { promptTokens: 1234, completionTokens: 2345, totalTokens: 3579 },
        estimated: false,
        generationMs: 1000,
        outputTokensPerSecond: 107,
      },
    });

    const lines = output.split('\n').map(stripAnsi);
    expect(lines[3]).toContain('Input 1234 | Output 2345 | Total 3579 | 107 tok/s | 1500 tokens / $0.00');
    expect(lines[3]).toContain('Plan / [Execute] (Tab)');
    expect(lines[4].indexOf('model-tag')).toBeLessThan(lines[4].indexOf('Auto-approve enabled (Shift+Tab)'));
    expect(lines[4]).not.toContain('1500 tokens / $0.00');
  });

  it('keeps the mode visible on narrow rows with long process usage', () => {
    const line = stripAnsi(renderWelcomeCard({
      model: 'model-tag', tokens: 987654, cost: '$123.45', workspace: '.',
      mode: 'Execute', autoApprove: true, width: 80, chatQuestion: 'Task',
      tokenUsage: {
        usage: { promptTokens: 123456, completionTokens: 234567, totalTokens: 358023 },
        estimated: false, generationMs: 1000, outputTokensPerSecond: 1234,
      },
    }).split('\n')[3]);

    expect(line).toContain('Input');
    expect(line).toContain('987654 tokens / $123.45');
    expect(line).toContain('Plan / [Execute] (Tab)');
    expect(line.length).toBeLessThanOrEqual(79);
  });

  it('starts the interactive workspace with auto-approve enabled', async () => {
    await runComposerTurn(async (stdin, { writes }) => {
      expect(stripAnsi(writes.join(''))).toContain('Auto-approve enabled (Shift+Tab)');
      stdin.emit('keypress', '\r', { name: 'return' });
    });
  });

  it('offers /review in slash suggestions', () => {
    expect(getMatchingCommands('/rev').map(command => command.name)).toContain('/review');
  });

  it('offers /map in slash suggestions', () => {
    expect(getMatchingCommands('/map').map(command => command.name)).toContain('/map');
  });

  it('offers /budget in slash suggestions', () => {
    expect(getMatchingCommands('/budget').map(command => command.name)).toContain('/budget');
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

  it('colors markdown section titles in a completed task answer', () => {
    const rendered = renderChatScreen({
      model: 'test-model', tokens: 0, cost: 'Cost unknown', workspace: '/workspace',
      mode: 'Execute', autoApprove: false, chatQuestion: 'Summarize',
      chatAnswer: '**Summary**\nDone.\n## Changes\nUpdated the CLI.', width: 100,
    });
    expect(rendered).toContain('\x1b[1;38;5;25mSummary\x1b[0m');
    expect(rendered).toContain('\x1b[1;38;5;25mChanges\x1b[0m');
    expect(stripAnsi(rendered)).not.toContain('**Summary**');
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
    expect(plain).toContain('MODERADO');
    expect(plain).toContain('Explain this repository.');
    expect(plain).toContain('Thought for 12s');
    expect(plain).toContain('It is a provider-independent coding agent.');
    expect(plain).toContain('z-ai/glm-5.3-flash');
    expect(plain).toContain('1500 tokens / $0.00');
    expect(plain).toContain('42 tok/s');
    expect(plain).toContain('d:\\projects\\moderado');
    expect(plain).toContain('Auto-approve off (Shift+Tab)');
  });

  it('keeps the chat title bar, question row, and answer inside the input card width when maximized', () => {
    const width = 220;
    const cardWidth = getChatAnswerArea(width).cardWidth;
    const indent = getChatAnswerArea(width).indent;
    const rendered = renderChatScreen({
      model: 'z-ai/glm-5.3-flash', tokens: 1500, cost: '.00', workspace: 'd:\\projects\\moderado',
      mode: 'Execute', autoApprove: false,
      chatQuestion: 'Q'.repeat(400),
      chatAnswer: 'word '.repeat(80).trim(),
      chatThoughtTime: 3, width,
    }, 50);

    const lines = stripAnsi(rendered).split(String.fromCharCode(10));
    // Nothing stretches to the screen edge: every painted row stays inside the card columns.
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      expect(line.length).toBeLessThanOrEqual(width);
    }

    // The question row starts on the card indent and wraps instead of running off the card.
    const questionRows = lines.filter((line) => line.includes('Q'.repeat(20)));
    expect(questionRows.length).toBeGreaterThan(1);
    expect(questionRows[0].search(/\S/)).toBe(indent);
    for (const row of questionRows) expect(row.length).toBe(indent + cardWidth);

    // The answer wraps to the card width, on the same indent.
    const answerRows = lines.filter((line) => line.includes('word'));
    expect(answerRows.length).toBeGreaterThan(1);
    for (const row of answerRows) expect(row.length).toBeLessThanOrEqual(indent + cardWidth);

    // The composer card sits at the bottom on the same columns as everything above it.
    const composerRows = lines.filter((line) => line.includes('Ask anything'));
    expect(composerRows.length).toBe(1);
    expect(composerRows[0].search(/\S/)).toBe(indent);
    expect(composerRows[0].length).toBe(indent + cardWidth);
  });

  it('windows a long answer inside the answer area instead of overwriting the composer', () => {
    const width = 100;
    const height = 24;
    const cardWidth = getWelcomeCardWidth(width);
    const indent = getWelcomeIndent(cardWidth, width);
    const question = 'Build a landing page for the new product';
    const layout = getChatLayout(width, height, question);
    const answer = Array.from({ length: 80 }, (_, index) => `answer line ${index + 1}`).join('\n');
    const frame = stripAnsi(renderChatScreen({
      model: 'z-ai/glm-5.3-flash', tokens: 900, cost: '$0.01', workspace: '/repo',
      mode: 'Execute', autoApprove: false, chatQuestion: question, chatAnswer: answer,
      chatThoughtTime: 9, width,
    }, height));
    const lines = frame.split('\n');

    // A frame taller than the viewport scrolls and drags the composer with it.
    expect(lines).toHaveLength(height);
    const composerRow = lines.findIndex((line) => line.includes('Ask anything'));
    expect(composerRow).toBeGreaterThan(layout.answerTop);
    expect(lines[composerRow + 2]).toContain('Plan / [Execute] (Tab)');
    expect(lines[composerRow + 3]).toContain('Auto-approve off (Shift+Tab)');
    expect(composerRow + 4).toBe(height - 1);

    // Newest output stays visible, older rows are reported instead of dropped silently.
    expect(frame).toContain('answer line 80');
    expect(frame).toContain('earlier lines hidden');
    expect(frame).not.toContain('answer line 1\n');
    // Nothing paints past the card columns on the rows that hold the bottom card.
    for (const line of lines.slice(composerRow)) expect(line.length).toBeLessThanOrEqual(indent + cardWidth);
  });

  it('keeps a long question from starving the answer area or the composer', () => {
    const width = 80;
    const height = 20;
    const layout = getChatLayout(width, height, 'Q '.repeat(400));
    const lines = stripAnsi(renderChatScreen({
      model: 'm', tokens: 0, cost: '$0', workspace: '.', mode: 'Execute', autoApprove: true,
      chatQuestion: 'Q '.repeat(400), chatAnswer: 'Short answer.', chatThoughtTime: 2, width,
    }, height)).split('\n');

    expect(lines).toHaveLength(height);
    expect(layout.answerRows).toBeGreaterThanOrEqual(1);
    expect(lines.findIndex((line) => line.includes('Ask anything'))).toBeGreaterThan(layout.answerTop);
    expect(stripAnsi(lines.join('\n'))).toContain('Short answer.');
  });

  it('keeps a queued-commands box inside the viewport instead of overflowing the frame', () => {
    const width = 80;
    const height = 24;
    const base = {
      model: 'm', tokens: 0, cost: '$0', workspace: '.', mode: 'Execute' as const, autoApprove: true,
      chatQuestion: 'Refactor the parser', chatAnswer: 'Done — see the summary.', chatThoughtTime: 2, width,
    };
    const options = { ...base, queuedCommands: ['/map', '/review'] };
    // The taller card is measured, not assumed: five card rows plus the box.
    const composerRows = getChatComposerRows(options);
    expect(composerRows).toBeGreaterThan(5);
    const layout = getChatLayout(width, height, options.chatQuestion, composerRows);
    const lines = stripAnsi(renderChatScreen(options, height)).split('\n');

    // The frame ends one row above the viewport bottom, so the trailing newline
    // cannot scroll the card out from under the user.
    expect(lines).toHaveLength(height);
    expect(layout.composerTop + composerRows).toBe(height);
    // The queued box starts exactly where the layout says the composer starts.
    expect(lines.findIndex((line) => line.includes('Queued Commands'))).toBe(layout.composerTop - 1);
    // The input, mode, and workspace rows survive at the bottom.
    expect(lines.join('\n')).toContain('Ask anything');
    expect(lines.join('\n')).toContain('Plan / [Execute] (Tab)');
    // And the answer area is not starved by the taller card.
    expect(layout.answerRows).toBeGreaterThanOrEqual(1);
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
    expect(renderChatComposerCursor({ width: 100 }, '')).toBe('\x1b[1 q\x1b[?25h\x1b[4A\r\x1b[3C');
    expect(renderChatThoughtTimeUpdate(2.2)).toContain('Thought for 2s');
    const thoughtArea = getChatAnswerArea(100);
    expect(renderChatThoughtTimeUpdate(2.2, 100)).toMatch(new RegExp(`^\\x1b7\\x1b\\[13;${thoughtArea.startColumn}H`));
    expect(renderChatThoughtTimeUpdate(2.2)).toMatch(/\x1b8$/);
    // A live activity row proves the turn is still running after text streams.
    expect(renderChatThoughtTimeUpdate(14.2, 100, { glyph: '⠹', label: 'Running npm test' }))
      .toContain('⠹ Running npm test · 14s');
    expect(renderChatThoughtTimeUpdate(14.2, 100, { glyph: '⠹', label: 'Working' }))
      .toContain('⠹ Working · 14s');
    expect(renderChatThoughtTimeUpdate(14.2, 100, { glyph: '✔', label: 'Done' }))
      .toContain('✔ Done · 14s');
    // The engine's step counter is gone: it was `Step 1/25` for minutes at a
    // time while one inference ran, and it told the reader nothing.
    const deduped = stripAnsi(renderChatThoughtTimeUpdate(12, 120, { glyph: '⠋', label: 'Step 1/25: Inferring next action with a-model' }));
    expect(deduped).toContain('⠋ Inferring next action with a-model · 12s');
    expect(deduped).not.toContain('Step');

    // While the model thinks, one dim line of the newest reasoning shows the turn
    // is alive without turning the row into a transcript.
    const paintedWidth = (sequence: string): number => stripAnsi(sequence).replace(/\x1b[78]/g, '').length;
    const cardWidth = getChatAnswerArea(120).cardWidth;
    const thinking = stripAnsi(renderChatThoughtTimeUpdate(12, 120, {
      glyph: '⠋', label: 'Thinking', reasoning: 'checking whether the cache key includes the model',
    }));
    // The clock belongs to the phase, so it sits right after the label and
    // before the message — the message is what gets clipped, not the time.
    expect(thinking).toContain('⠋ Thinking · 12s · checking whether');
    expect(paintedWidth(thinking)).toBeLessThanOrEqual(cardWidth);

    // A long thought keeps its newest words, truncates from the left, and stays in the card.
    const longThought = renderChatThoughtTimeUpdate(12, 120, {
      glyph: '⠋', label: 'Thinking', reasoning: `${'filler '.repeat(60)}NEWEST-WORDS`,
    });
    expect(stripAnsi(longThought)).toContain('⠋ Thinking · 12s · …');
    expect(stripAnsi(longThought)).toContain('NEWEST-WORDS');
    expect(paintedWidth(longThought)).toBeLessThanOrEqual(cardWidth);

    // A deep path is elided in the middle, so the verb, the filename and the
    // timer all survive on one row.
    const longPathLabel = `Editing ${'deep/'.repeat(40)}apply_patch.ts`;
    const longPath = stripAnsi(renderChatThoughtTimeUpdate(75, 120, { glyph: '⠼', label: longPathLabel }));
    expect(longPath).toContain('Editing deep/');
    expect(longPath).toContain('…');
    expect(longPath).toContain('apply_patch.ts');
    expect(longPath).toContain('1m 15s');
    expect(paintedWidth(longPath)).toBeLessThanOrEqual(cardWidth);
    const answerLayout = getChatLayout(100, 30, 'Who are you?');
    const answerWindow = renderChatTranscriptWindow(undefined, 'Hi', answerLayout);
    expect(answerWindow.startsWith('\x1b7')).toBe(true);
    expect(answerWindow.endsWith('\x1b8')).toBe(true);
    expect(answerWindow).toContain(`\x1b[${answerLayout.answerTop};${getChatAnswerArea(100).startColumn}H`);
    // Only the rows the layout reserves are repainted: the composer is untouched.
    expect(answerWindow).not.toContain(`\x1b[${answerLayout.composerTop};`);
    expect(answerWindow.match(/\x1b\[2K/g)).toHaveLength(answerLayout.answerRows);
  });

  it('names the phase the agent is in instead of echoing the engine sentence', () => {
    // The reasoning stream is not displayed, so this label is the only thing that
    // moves during a long silent inference.
    expect(describeActivity('Step 1/25: Inferring next action with z-ai/glm-5...')).toBe('Thinking');
    expect(describeActivity('Step 7/25: Inferring next action with a-model...')).toBe('Thinking');
    expect(describeActivity('Discovering and selecting models...')).toBe('Selecting model');
    expect(describeActivity('Retrying z-ai/glm-5 in 500ms...')).toBe('Retrying request');
    expect(describeActivity('Delegating sub-task: find the failing test...')).toBe('Delegating a sub-task');
    // Already short, caller-supplied phases pass through untouched.
    expect(describeActivity('Running read_file')).toBe('Running read_file');
    expect(describeActivity('Reviewing')).toBe('Reviewing');
    expect(describeActivity('   ')).toBe('Working');
  });

  it('names the file or command a tool is working on, not just the tool', () => {
    expect(describeToolActivity('read_file', { path: 'apps/cli/src/chat.ts' })).toBe('Reading apps/cli/src/chat.ts');
    expect(describeToolActivity('write_file', { path: 'src/new.ts' })).toBe('Writing src/new.ts');
    expect(describeToolActivity('edit_file', { path: 'src/app.ts' })).toBe('Editing src/app.ts');
    expect(describeToolActivity('apply_patch', { edits: [{ path: 'a.ts' }] })).toBe('Editing a.ts');
    expect(describeToolActivity('apply_patch', { edits: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }] }))
      .toBe('Editing 3 files');
    expect(describeToolActivity('run_command', { command: 'npm', args: ['test'] })).toBe('Running npm test');
    expect(describeToolActivity('run_command', {})).toBe('Running a command');
    expect(describeToolActivity('run_diagnostics', { script: 'typecheck' })).toBe('Running typecheck');
    expect(describeToolActivity('search_files', { query: 'renderChat' })).toBe('Searching "renderChat"');
    expect(describeToolActivity('list_files', { subpath: 'src/ui' })).toBe('Listing src/ui');
    expect(describeToolActivity('list_files', { subpath: '.' })).toBe('Listing the workspace');
    expect(describeToolActivity('web_search', {})).toBe('Searching the web');
    expect(describeToolActivity('git_diff', {})).toBe('Checking changes');
    // Unknown and MCP tools keep their name rather than inventing a verb.
    expect(describeToolActivity('mcp__github__create_issue', {})).toBe('Running mcp__github__create_issue');
    // A path that is not a string must not become `Reading undefined`.
    expect(describeToolActivity('read_file', { path: 42 })).toBe('Reading');
  });

  it('keeps wide-character reasoning inside the card', () => {
    // A CJK tail is twice as wide as its length suggests; measuring with
    // `String#length` let the row overflow and wrap outside the frame.
    for (const width of [60, 80, 120]) {
      const cardWidth = getChatAnswerArea(width).cardWidth;
      const painted = stripAnsi(renderChatThoughtTimeUpdate(42, width, {
        glyph: '⠋',
        label: 'Thinking',
        reasoning: '检查缓存键是否包含模型标识'.repeat(4),
      })).replace(/\x1b[78]/g, '');
      expect(displayWidth(painted)).toBeLessThanOrEqual(cardWidth);
      // The clock is reserved first, so it survives the clip.
      expect(painted).toContain('42s');
    }
  });

  it('formats elapsed time so a long turn does not read as a bare second count', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(0.4)).toBe('<1s');
    expect(formatElapsed(8)).toBe('8s');
    expect(formatElapsed(59.6)).toBe('1m 00s');
    expect(formatElapsed(64)).toBe('1m 04s');
    expect(formatElapsed(750)).toBe('12m 30s');
  });

  it('keeps the activity log on screen when the answer starts streaming', () => {
    // The regression this guards: the log used to be a separate block that
    // handed its rows back the moment the first token arrived, so a long fix
    // explanation left one clipped status row on screen.
    const layout = getChatLayout(100, 30, 'the weather app crashes, fix it', 5);
    const activity = {
      glyph: '⠋',
      label: 'Thinking',
      elapsedLabel: '12s',
      reasoning: 'the crash is a null map over forecast before the fetch resolves',
      history: [
        { glyph: '✔' as const, label: 'Reading src/WeatherCard.tsx', tone: 'done' as const },
        { glyph: '✔' as const, label: 'Running npm test', tone: 'done' as const },
      ],
    };
    const answer = 'The crash was a null map in WeatherCard. I added a loading guard and a fallback.';

    const { rows, answerStart } = buildChatTranscriptRows(activity, answer, layout.area.textWidth);
    // The log comes first and the answer is appended after it, in one list.
    expect(answerStart).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(answerStart);

    const text = stripAnsi(renderChatTranscriptWindow(activity, answer, layout));
    // Both halves are on screen at once — the log is not dropped for the answer.
    expect(text).toContain('✔ Reading src/WeatherCard.tsx');
    expect(text).toContain('✔ Running npm test');
    expect(text).toContain('the crash is a null map');
    expect(text).toContain('The crash was a null map in WeatherCard');

    // The pinned header carries the phase and the clock on one row.
    expect(stripAnsi(renderChatTranscriptHeader(activity, layout, 12))).toContain('⠋ Thinking · 12s');
  });

  it('scrolls the log and the answer as one list, and says where it is', () => {
    const layout = getChatLayout(100, 24, 'fix the weather app', 5);
    const history = Array.from({ length: 14 }, (_, index) => ({
      glyph: '✔' as const, label: `Reading src/component${index + 1}.tsx`, tone: 'done' as const,
    }));
    const activity = { glyph: '⠋' as const, label: 'Thinking' as const, elapsedLabel: '48s' as const, history };
    const answer = 'Fixed all fourteen components.';
    const { rows } = buildChatTranscriptRows(activity, answer, layout.area.textWidth);
    expect(rows.length).toBeGreaterThan(layout.answerRows);

    const base = {
      workspace: '/w', mode: 'Execute' as const, autoApprove: true, model: 'm', tokens: 0, cost: '$0',
      chatQuestion: 'fix the weather app', chatAnswer: answer, chatActivity: activity,
      chatThoughtTime: 48, width: 100,
    };
    // Tail view: the newest rows, with a note naming how many are hidden above.
    const live = stripAnsi(renderChatScreen(base, 24));
    expect(live).toContain('… +');
    expect(live).toContain('Reading src/component14.tsx');
    expect(live).toContain('Fixed all fourteen components.');

    // Scrolled up: the status row reports the position, and older rows appear.
    const scrolled = stripAnsi(renderChatScreen({ ...base, chatAnswerOffset: 2 }, 24));
    expect(scrolled).toContain('↑');
    expect(scrolled).toContain('below');
    expect(scrolled).toContain('Reading src/component4.tsx');
    expect(scrolled).not.toContain('Reading src/component1.tsx');

    // At the very top the log's first entry is still reachable.
    const top = stripAnsi(renderChatScreen({ ...base, chatAnswerOffset: 40 }, 24));
    expect(top).toContain('Top of the turn');
    expect(top).toContain('Reading src/component1.tsx');
  });

  it('never lets the transcript overflow the card or reach the composer', () => {
    // Every terminal width and height the CLI can meet, with a 20-entry log and
    // CJK reasoning plus a long answer: the widest glyphs and the longest
    // history at once.
    const history = Array.from({ length: 20 }, (_, index) => ({
      glyph: '✔', label: `Editing src/deeply/nested/path/file_${index}.ts`, tone: 'done' as const,
    }));
    const rowsOf = (sequence: string): Array<{ row: number; col: number; cells: number }> => {
      const parts = sequence.split(/\x1b\[(\d+);(\d+)H/);
      const painted: Array<{ row: number; col: number; cells: number }> = [];
      for (let index = 1; index < parts.length; index += 3) {
        painted.push({
          row: Number(parts[index]),
          col: Number(parts[index + 1]),
          cells: displayWidth(parts[index + 2].replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b[78]/g, '')),
        });
      }
      return painted;
    };
    for (const width of [20, 30, 40, 44, 60, 80, 100, 120, 200]) {
      for (const height of [12, 24, 30, 40]) {
        const layout = getChatLayout(width, height, 'A question long enough to wrap over several rows in a narrow terminal', 5);
        const area = getChatAnswerArea(width);
        // The card has a 70-column floor; the terminal does not.
        const budget = Math.min(area.cardWidth, Math.max(8, width - area.startColumn + 1));
        const painted = rowsOf(renderChatTranscriptWindow({
          glyph: '⠋', label: 'Thinking', reasoning: '检查缓存键是否包含模型标识'.repeat(20), history,
        }, 'A long answer that also has to stay inside the card. '.repeat(10), layout));
        for (const row of painted) {
          expect(row.row).toBeGreaterThanOrEqual(layout.answerTop);
          expect(row.row).toBeLessThan(layout.composerTop);
          expect(row.col).toBe(area.startColumn);
          expect(row.cells).toBeLessThanOrEqual(budget);
        }
      }
    }
    // A viewport this short leaves one safe transcript row above the composer.
    const tiny = getChatLayout(80, 12, 'Q', 5);
    expect(tiny.answerRows).toBe(1);
    expect(renderChatTranscriptWindow({ glyph: '⠋', label: 'Thinking' }, 'answer', tiny)).toContain('answer');
  });

  it('paints the turn summary as a tinted panel that survives wrapping', () => {
    const answer = [
      'Prose above the report.',
      '',
      '```summary',
      '# Turn summary',
      '## Done',
      `- ${'a very long action '.repeat(6)}`,
      '```',
    ].join('\n');
    const lines = wrapAnswerLines(answer, 40);
    // The fence is scaffolding, never content.
    expect(lines.join('')).not.toContain('```');
    const summaryLines = lines.filter((line) => line.startsWith('\u0001'));
    expect(summaryLines.length).toBeGreaterThanOrEqual(4);
    // The long bullet wraps, and every continuation keeps the marker — otherwise
    // the band would break in the middle of a sentence.
    expect(summaryLines.filter((line) => line.includes('a very long action')).length).toBeGreaterThan(1);

    const band = renderAnswerLine(summaryLines[0], 40);
    expect(band).toContain('\x1b[48;5;236m');
    expect(band).toContain('▍');
    // Exactly the card's text column: the tint reaches the right edge, no further.
    expect(displayWidth(stripAnsi(band))).toBe(40);
    // Headings lose their hashes and gain the warm bold tone.
    const heading = renderAnswerLine(`\u0001## Done`, 40);
    expect(stripAnsi(heading)).not.toContain('##');
    expect(heading).toContain('1;38;5;222');

    // Prose outside the fence is untouched.
    const prose = renderAnswerLine(lines[0], 40);
    expect(prose).not.toContain('48;5;236');
    expect(prose).toContain('Prose above the report.');
  });

  it('scrolls the answer window up from the tail and reports the position', () => {
    const answer = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
    const layout = getChatLayout(100, 30, 'Q', 5);
    const rows = layout.answerRows;

    const tail = windowChatAnswerAt(answer, rows, 90, 0);
    expect(tail.hiddenBelow).toBe(0);
    expect(tail.hiddenAbove).toBeGreaterThan(0);
    expect(tail.lines[tail.lines.length - 1]).toBe('line 30');

    const up = windowChatAnswerAt(answer, rows, 90, 5);
    expect(up.hiddenBelow).toBe(5);
    expect(up.hiddenAbove).toBe(tail.hiddenAbove - 5);
    expect(up.lines[up.lines.length - 1]).toBe('line 25');

    // The offset is clamped, so holding PgUp cannot scroll into empty space.
    const top = windowChatAnswerAt(answer, rows, 90, 10_000);
    expect(top.hiddenAbove).toBe(0);
    expect(top.lines[0]).toBe('line 1');

    // The status row carries the position while the reader is scrolled up.
    const frame = stripAnsi(renderChatScreen({
      model: 'z-ai/glm-5', tokens: 10, cost: '$0.00', workspace: '~/w',
      mode: 'Execute', autoApprove: false, chatQuestion: 'Q', chatAnswer: answer,
      chatThoughtTime: 9, chatTaskDone: true, chatAnswerOffset: 5, width: 100,
    }, 30));
    expect(frame).toContain('above');
    expect(frame).toContain('below');
    expect(frame).toContain('PgUp/PgDn');
  });

  it('says it is waiting only after ten quiet seconds, then every twenty', () => {
    // Normal inference is silent; ten seconds is not a stall and must not look
    // like one, otherwise every ordinary turn cries wolf.
    expect(describeWait(0)).toBeUndefined();
    expect(describeWait(9_999)).toBeUndefined();
    expect(describeWait(Number.NaN)).toBeUndefined();
    expect(describeWait(WAIT_NOTICE_AFTER_MS - 1)).toBeUndefined();

    // The first notice has no clock: "no output for 10s" is not yet informative.
    expect(describeWait(WAIT_NOTICE_AFTER_MS)).toEqual({ label: 'Waiting on the model' });
    expect(describeWait(25_000)).toEqual({ label: 'Waiting on the model' });

    // Then the length of the silence is quantised to the repeat cadence, so the
    // row changes every twenty seconds rather than on every repaint.
    expect(describeWait(30_000)?.elapsedLabel).toBe('no output for 30s');
    expect(describeWait(49_000)?.elapsedLabel).toBe('no output for 30s');
    expect(describeWait(50_000)?.elapsedLabel).toBe('no output for 50s');
    expect(describeWait(50_000 + WAIT_NOTICE_REPEAT_MS)?.elapsedLabel).toBe('no output for 70s');
  });

  it('keeps temporary status rows inside the chat card columns while the turn runs', () => {
    const width = 200;
    const { cardWidth, indent } = getChatAnswerArea(width);
    const startColumn = indent + 1;
    // Visible payload left after removing CSI codes and the DEC save/restore pair.
    const painted = (sequence: string): string => stripAnsi(sequence).replace(/\x1b[0-9]/g, '');
    const startsAtCard = (sequence: string): boolean => sequence.includes(`;${startColumn}H`);

    // Thinking / task-step timer shares the left edge of header, question and composer.
    const thought = renderChatThoughtTimeUpdate(2.2, width);
    expect(startsAtCard(thought)).toBe(true);
    expect(painted(thought).length).toBeLessThanOrEqual(cardWidth);

    // Usage snapshot row: clamped to the card instead of stretching terminal-wide.
    const usage = renderChatUsageUpdate(
      {
        type: 'usage', estimated: true,
        usage: { promptTokens: 1234, completionTokens: 567, totalTokens: 1801 },
        outputTokensPerSecond: 42.4, generationMs: 1000, final: false, timestamp: 0,
      },
      width, 'Budget ≥80%', '1801 tokens / ~$0.00', 40, 'Execute',
    );
    expect(startsAtCard(usage)).toBe(true);
    expect(painted(usage).length).toBeLessThanOrEqual(cardWidth);

    // Gateway fallback note: bounded by the card, not the raw terminal width.
    const fallback = renderGatewayFallbackUpdate(
      {
        type: 'gateway_status', fromModel: 'a/fast',
        toProvider: 'nvidia', toModel: 'some/extremely-long-fallback-model-name',
        reason: 'rate_limited_or_unavailable', timestamp: 0,
      },
      width,
    );
    expect(startsAtCard(fallback)).toBe(true);
    expect(painted(fallback).length).toBeLessThanOrEqual(cardWidth);
  });

  it('keeps every card element inside the composer card columns at any terminal width', () => {
    for (const terminalWidth of [74, 80, 120, 200]) {
      const cardWidth = getWelcomeCardWidth(terminalWidth);
      const indent = getWelcomeIndent(cardWidth, terminalWidth);
      const base = {
        model: 'moonshotai/kimi-k3',
        tokens: 0,
        cost: '$0.00',
        workspace: 'd:\\projects\\moderado',
        mode: 'Execute' as const,
        autoApprove: false,
        width: terminalWidth,
      };
      const frames = [
        renderWelcomeCard(base),
        // Slash-command suggestions box (previously forced a 78–82 fixed width).
        renderWelcomeCard({ ...base, input: '/s' }),
        // Mention box with a path too long for the card (previously fixed width, untruncated).
        renderWelcomeCard({ ...base, mentionFiles: ['apps/cli/src/ui/deeply/nested/structure/for/boundary/testing/file.ts'], mentionSelection: 0 }),
        // Queued-commands box.
        renderWelcomeCard({ ...base, queuedCommands: ['/map', '/review'] }),
      ];
      for (const frame of frames) {
        for (const line of stripAnsi(frame).split('\n')) {
          if (line.length === 0) continue; // blank separator rows carry no content
          // Every line begins at the card's left edge and ends exactly at its right edge.
          expect(line.startsWith(' '.repeat(indent))).toBe(true);
          expect(line.length).toBe(indent + cardWidth);
        }
      }
    }
  });

  it('marks a settled chat turn Done and leaves unsettled turns unchanged', () => {
    const base = {
      model: 'z-ai/glm-5.3-flash',
      tokens: 0,
      cost: '$0.00',
      workspace: 'd:\\projects\\moderado',
      mode: 'Execute' as const,
      autoApprove: false,
      chatQuestion: 'Who are you?',
      chatAnswer: 'I am Moderado.',
      chatThoughtTime: 2.2,
      width: 100,
    };

    expect(stripAnsi(renderChatScreen(base, 30))).toContain('Thought for 2s');
    expect(stripAnsi(renderChatScreen({ ...base, chatTaskDone: true }, 30))).toContain('✔ Done · Thought for 2s');
    expect(stripAnsi(renderChatScreen({ ...base, chatTaskDone: true, tokenUsage: usageSnapshot }, 30))).toContain('✔ Done · Thought for 2s');
    expect(stripAnsi(renderChatScreen({ ...base, tokenUsage: usageSnapshot }, 30))).not.toContain('Thought for');
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

  it('keeps the header, card, and chat frame centered on a maximized 200-column terminal', () => {
    const width = 200;
    const welcomeCardWidth = getWelcomeCardWidth(width);
    const welcomeIndent = getWelcomeIndent(welcomeCardWidth, width);
    const chatArea = getChatAnswerArea(width);
    expect(welcomeCardWidth).toBe(120);
    expect(welcomeIndent).toBe(40);
    expect(chatArea.cardWidth).toBe(width - 2);
    expect(chatArea.indent).toBe(1);

    const base = {
      model: 'moonshotai/kimi-k3', tokens: 0, cost: '$0.00', workspace: '/workspace',
      mode: 'Execute' as const, autoApprove: false, width,
    };
    const frames = [
      stripAnsi(renderModeradoHeader(width)),
      stripAnsi(renderWelcomeCard(base)),
      stripAnsi(renderChatScreen({ ...base, chatQuestion: 'Refactor the database layer', chatAnswer: 'Here is the plan.' }, 40)),
    ];
    for (const frame of frames) {
      const isChatFrame = frame.includes('Refactor the database layer');
      const indent = isChatFrame ? chatArea.indent : welcomeIndent;
      for (const line of frame.split('\n')) {
        // Nothing paints left of the relevant card's first column…
        expect(line.slice(0, indent)).toMatch(/^ *$/);
        // …and nothing escapes the terminal viewport.
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
    // The chat question row starts exactly at the card's first column.
    const chatLines = stripAnsi(renderChatScreen({ ...base, chatQuestion: 'Refactor the database layer', chatAnswer: 'Here is the plan.' }, 40)).split('\n');
    expect(chatLines.some((line) => line.startsWith(' '.repeat(chatArea.indent) + '❯ '))).toBe(true);
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
    expect(plain).not.toContain('/login');
    expect(plain).toContain('/connect');
    expect(plain).toContain('/model');
    expect(plain).toContain('/session');
    expect(plain).toContain('/workflow');
    expect(plain).toContain('/clear');
    expect(plain).toContain('/help');
    expect(plain).toContain('/exit');
    expect(plain).toContain('Commands (↑↓ browse, Tab to insert)');
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
      // A refused cleanup must not fail assertions that already passed.
      try {
        fs.rmSync(configHome, { recursive: true, force: true });
      } catch {
        // ignore
      }
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

  it('aligns the Up/Down keyboard shortcut with the other shortcut rows', () => {
    const plain = stripAnsi(renderHelpPopupBox('v0.2.0', 'd:\\test', 80).join('\n'));
    expect(plain).toContain('│  Up/Down       Browse slash commands after "/", else recall history');
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
    expect(card).toContain('Commands (↑↓ browse, Tab to insert)');
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

  it('keeps a long input and its caret inside the composer width', async () => {
    const input = 'x'.repeat(90);
    const card = stripAnsi(renderWelcomeCard({
      model: 'test-model', tokens: 0, cost: '$0.00', workspace: 'd:\\test',
      mode: 'Execute', autoApprove: true, input, width: 80,
    })).split('\n');
    expect(card[1].length).toBeLessThanOrEqual(80);

    const result = await runComposerTurn(async (stdin, context) => {
      for (const character of input) stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      expect(lastComposerWrite(context.writes).column).toBeLessThanOrEqual(80);
      stdin.emit('keypress', '\r', { name: 'return' });
    });
    expect(result).toBe(input);
  });

  it('keeps the caret beside the visible text when editing a long input', async () => {
    const input = 'x'.repeat(90);
    const result = await runComposerTurn(async (stdin, context) => {
      for (const character of input) stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      for (let index = 0; index < 20; index++) stdin.emit('keypress', '', { name: 'left' });
      stdin.emit('keypress', 'Z', { name: 'z', ctrl: false, meta: false });
      const cursor = lastComposerWrite(context.writes);
      const cardWrite = [...context.writes].reverse().find((write) => write.includes('Z'));
      expect(cardWrite).toBeDefined();
      const inputRow = stripAnsi(cardWrite!).split('\n').find((line) => line.includes('Z'));
      expect(inputRow).toBeDefined();
      expect(cursor.column).toBe(inputRow!.indexOf('Z') + 2);
      stdin.emit('keypress', '\r', { name: 'return' });
    });
    expect(result).toBe(`${'x'.repeat(70)}Z${'x'.repeat(20)}`);
  });

  it('paints the @ mention list in the composer and keeps the caret on the input line', async () => {
    let caretRow = 0;
    const result = await runComposerTurn(async (stdin, context) => {
      // The candidate cache is filled from a promise, so give it a tick.
      await new Promise((resolve) => setImmediate(resolve));
      for (const character of '@ap') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      await new Promise((resolve) => setImmediate(resolve));

      const frame = context.writes.filter((write) => write.includes('@app.ts')).pop();
      expect(frame).toBeDefined();
      const screen = stripAnsi(frame!);
      expect(screen).toContain('@app.ts');
      expect(screen).toContain('@apps/web.ts');

      // The caret has to stay on the input line even though the box grows the card.
      const lines = screen.split('\n');
      const inputLineIndex = lines.findIndex((line) => line.includes('❯ @ap'));
      expect(inputLineIndex).toBeGreaterThan(0);
      const scrolled = Math.max(0, lines.length - context.rows);
      caretRow = lastComposerWrite(context.writes).row;
      expect(caretRow).toBe(inputLineIndex + 1 - scrolled);

      stdin.emit('keypress', '\r', { name: 'return' });
    }, { onMentionComplete: async () => ['app.ts', 'apps/web.ts'] });

    expect(result).toBe('@ap');
    expect(caretRow).toBeGreaterThan(0);
  });

  it('keeps the composer status row inside the terminal width', () => {
    const card = stripAnsi(renderWelcomeCard({
      model: 'provider/very-long-model-name-for-testing', tokens: 0, cost: '$0.00',
      workspace: 'E:\\a-very-long-workspace-path\\with-more-segments',
      mode: 'Execute', autoApprove: true, width: 80,
    })).split('\n');
    expect(Math.max(...card.map((line) => line.length))).toBeLessThanOrEqual(80);
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

const usageSnapshot = { type: 'usage' as const, usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 }, estimated: true, outputTokensPerSecond: 10, generationMs: 2000, final: false, timestamp: 0 };
describe('token usage display', () => {
  it('labels estimates and clips fixed row updates without moving the cursor', async () => {
    const { formatTokenUsage, renderChatUsageUpdate } = await import('../src/ui/welcome.js');
    expect(formatTokenUsage(usageSnapshot)).toBe('Input ~100 | Output ~20 | Total ~120 | ~10 tok/s');
    expect(formatTokenUsage({ ...usageSnapshot, estimated: false, generationMs: 0 })).toBe('Input 100 | Output 20 | Total 120');
    const update = renderChatUsageUpdate(usageSnapshot, 20, undefined, undefined, 24);
    expect(update.startsWith('\x1b7\x1b[22;2H\x1b[K')).toBe(true);
    expect(update.endsWith('\x1b8')).toBe(true);
    expect(update).toContain('Input ~100 | Outpu');
    expect(update).not.toContain('\n');
    expect(renderChatUsageUpdate(usageSnapshot, 120, undefined, '1500 tokens / $0.42'))
      .toContain('Input ~100 | Output ~20 | Total ~120 | ~10 tok/s | 1500 tokens / $0.42');
    const liveRow = stripAnsi(renderChatUsageUpdate(usageSnapshot, 80, undefined, '1500 tokens / $0.42', 24, 'Execute')).replace(/\x1b[0-9]/g, '');
    expect(liveRow).toContain('Plan / [Execute] (Tab)');
    const paintedRow = liveRow.replace('\x1b8', '');
    expect(paintedRow).toContain('1500 tokens / $0.42');
    expect(paintedRow.length).toBeLessThanOrEqual(getWelcomeCardWidth(80));
  });
  it('replaces the thought row in the full screen', () => {
    const screen = stripAnsi(renderChatScreen({ model: 'test', tokens: 1500, cost: '$0.42', workspace: '.', mode: 'Plan', autoApprove: false, chatQuestion: 'Hi', chatAnswer: 'Hello', tokenUsage: usageSnapshot, width: 80 }, 30));
    const lines = screen.split('\n');
    const modeRow = lines.findIndex(line => line.includes('[Plan] / Execute (Tab)'));
    expect(lines[modeRow]).toContain('Input ~100 | Output ~20 | Total … | 1500 tokens / $0.42');
    expect(lines[modeRow].length).toBeLessThanOrEqual(79);
    const questionRow = lines.findIndex(line => line.includes('❯ Hi'));
    expect(lines[questionRow + 1]?.trim()).toBe('');
    expect(screen).not.toContain('Thought for');
  });
});
it('keeps cumulative token and cost details with process usage instead of the model tag', () => {
  const composer = stripAnsi(renderWelcomeCard({ model: 'test', tokens: 120, cost: 'unavailable', workspace: '.', mode: 'Plan', autoApprove: false, usageEstimated: true, chatQuestion: 'Hi' })).split('\n');
  expect(composer[3]).toContain('~120 tokens / unavailable');
  expect(composer[4]).toContain('test');
  expect(composer[4]).not.toContain('~120 tokens');
});

it('targets the exact usage row in the chat frame', async () => {
  const { renderChatUsageUpdate } = await import('../src/ui/welcome.js');
  const screen = stripAnsi(renderChatScreen({ model: 'test', tokens: 0, cost: '$0', workspace: '.', mode: 'Plan', autoApprove: false, chatQuestion: 'Hi', chatAnswer: 'Hello', tokenUsage: usageSnapshot, width: 80 }, 30));
  const row = screen.split('\n').findIndex(line => line.includes('[Plan] / Execute (Tab)')) + 1;
  expect(renderChatUsageUpdate(usageSnapshot, 80, undefined, undefined, 30)).toContain(`\x1b[${row};${getChatAnswerArea(80).startColumn}H`);
});

describe('Multi-line composer', () => {
  const baseCard = {
    model: 'test-model', tokens: 0, cost: '$0.00', workspace: 'd:\\test',
    mode: 'Execute' as const, autoApprove: true, width: 80,
  };

  it('wraps a long prompt at word boundaries without losing text', () => {
    const input = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    const rows = wrapComposerInput(input, 40);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(displayWidth(row.text)).toBeLessThanOrEqual(37);
    expect(rows.map((row) => row.text).join(' ')).toBe(input);
  });

  it('hard-breaks a word that cannot fit on a row', () => {
    const input = 'x'.repeat(90);
    const rows = wrapComposerInput(input, 40);
    for (const row of rows) expect(displayWidth(row.text)).toBeLessThanOrEqual(37);
    expect(rows.map((row) => row.text).join('')).toBe(input);
  });

  it('keeps explicit line feeds as their own rows', () => {
    expect(wrapComposerInput('one\ntwo\n\nthree', 80).map((row) => row.text)).toEqual(['one', 'two', '', 'three']);
  });

  it('tracks the caret onto the row it belongs to', () => {
    const input = 'first\nsecond';
    const view = composerView(input, input.length, 80);
    expect(view.caretRow).toBe(1);
    expect(view.caretColumn).toBe(6);
    expect(composerCaretIndex(input, view.rows, 0, 3)).toBe(3);
    expect(composerCaretIndex(input, view.rows, 1, 2)).toBe(8);
  });

  it('scrolls the input rows inside the box once the prompt is taller than the terminal', () => {
    const input = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
    const view = composerView(input, input.length, 80, 5);
    expect(view.rows).toHaveLength(5);
    expect(view.hiddenAbove).toBe(25);
    expect(view.rows[view.caretRow].text).toBe('line 29');
    expect(getComposerInputMaxRows(24)).toBe(11);
  });

  it('grows the card by one row per wrapped line and stays inside the terminal', () => {
    expect(renderWelcomeCard({ ...baseCard, input: 'hello' }).split('\n')).toHaveLength(5);
    const card = renderWelcomeCard({ ...baseCard, input: 'one\ntwo\nthree' }).split('\n');
    expect(card).toHaveLength(7);
    for (const line of card) expect(displayWidth(stripAnsi(line))).toBeLessThanOrEqual(80);
    const tall = Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n');
    const frame = stripAnsi(renderChatScreen({ ...baseCard, chatQuestion: 'q', chatAnswer: 'a', input: tall, inputCaret: tall.length }, 24)).split('\n');
    expect(frame.length).toBeLessThanOrEqual(24);
  });

  it('gives the answer area up to a taller composer instead of pushing the card off screen', () => {
    const short = getChatLayout(80, 24, 'q', 5);
    const tall = getChatLayout(80, 24, 'q', 9);
    expect(tall.composerTop).toBe(15);
    expect(tall.answerRows).toBeLessThan(short.answerRows);
  });

  it('line-feeds on Shift+Enter instead of submitting', async () => {
    const result = await runComposerTurn(async (stdin) => {
      for (const character of 'first') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      stdin.emit('keypress', '\r', { name: 'return', shift: true });
      for (const character of 'second') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      stdin.emit('keypress', '\r', { name: 'return' });
    });
    expect(result).toBe('first\nsecond');
  });

  it('line-feeds on Ctrl+J and moves the caret to the new row', async () => {
    const chatQuestion = 'hi';
    const result = await runComposerTurn(async (stdin, context) => {
      for (const character of 'ab') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      stdin.emit('keypress', '\n', { name: 'enter' });
      for (const character of 'cd') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      const layout = getChatLayout(80, 24, chatQuestion, getChatComposerRows({ ...baseCard, chatQuestion, input: 'ab\ncd' }));
      expect(lastComposerWrite(context.writes).row).toBe(layout.composerTop + 2);
      stdin.emit('keypress', '\r', { name: 'return' });
    }, { chatQuestion });
    expect(result).toBe('ab\ncd');
  });

  it('line-feeds when the terminal reports Shift+Enter as a modified key', async () => {
    const result = await runComposerTurn(async (stdin) => {
      for (const character of 'one') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      stdin.emit('data', '\x1b[27;2;13~');
      await new Promise((resolve) => setImmediate(resolve));
      for (const character of 'two') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      stdin.emit('keypress', '\r', { name: 'return' });
    });
    expect(result).toBe('one\ntwo');
  });

  it('places the caret on the clicked row of a wrapped prompt', async () => {
    const chatQuestion = 'hi';
    const result = await runComposerTurn(async (stdin) => {
      for (const character of 'first') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      stdin.emit('keypress', '\n', { name: 'enter' });
      for (const character of 'second') stdin.emit('keypress', character, { name: character, ctrl: false, meta: false });
      const layout = getChatLayout(80, 24, chatQuestion, getChatComposerRows({ ...baseCard, chatQuestion, input: 'first\nsecond' }));
      // First text cell of the second input row.
      stdin.emit('data', `\x1b[<0;${getChatAnswerArea(80).startColumn + 2};${layout.composerTop + 2}M`);
      await new Promise((resolve) => setImmediate(resolve));
      stdin.emit('keypress', 'X', { name: 'x', ctrl: false, meta: false });
      stdin.emit('keypress', '\r', { name: 'return' });
    }, { chatQuestion });
    expect(result).toBe('first\nXsecond');
  });
});
