import { describe, it, expect, vi } from 'vitest';
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
  renderHelpPopupBox,
  renderExitMessage,
  MODERADO_ASCII_LOGO,
  COMMAND_HINT,
  stripAnsi,
  getMatchingCommands,
  promptInteractiveTurn,
  selectCommandCandidate,
} from '../src/ui/welcome.js';

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

    // Line 1: top dash line (OpenCode box-drawing style, centered)
    expect(stripAnsi(lines[0])).toBe(expectedIndent + '─'.repeat(expectedWidth));

    // Line 2: command taking text box with placeholder (centered)
    expect(stripAnsi(lines[1])).toBe(expectedIndent + '❯ Ask anything, I am all ears...');

    // Line 3: bottom dash line (OpenCode box-drawing style, centered)
    expect(stripAnsi(lines[2])).toBe(expectedIndent + '─'.repeat(expectedWidth));

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
    expect(stripAnsi(lines[1])).toBe(' ❯ refactor database layer');
    expect(stripAnsi(lines[3])).toContain('[Plan] / Execute (Tab)');
    expect(stripAnsi(lines[4])).toContain('Auto-approve all enabled (Shift+Tab)');
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
    expect(rendered).toContain('\x1b[48;5;236m\x1b[38;5;255m');
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

  it('recalls prior questions and restores the unfinished draft', () => {
    expect(navigateQuestionHistory(['first', 'second'], -1, 2, 'draft')).toEqual({ input: 'second', index: 1, draft: 'draft' });
    expect(navigateQuestionHistory(['first', 'second'], 1, 1, 'draft')).toEqual({ input: 'draft', index: 2, draft: 'draft' });
  });

  it('includes session management in the help popup without an extra content indent', () => {
    const plain = stripAnsi(renderHelpPopupBox('v0.2.0', 'd:\\test', 80).join('\n'));
    expect(plain).toContain('/session   Create, list, resume, export, or compact sessions');
    expect(plain).not.toContain('│   /session');
  });

  it('leaves horizontal placement to the popup layer instead of indenting the help box', () => {
    const plainLines = stripAnsi(renderHelpPopupBox('v0.2.0', 'd:\\test', 80).join('\n')).split('\n');
    expect(plainLines[0]).not.toMatch(/^\s/);
    expect(plainLines[1]).not.toMatch(/^\s/);
  });

  it('selects and completes slash command candidates by index', () => {
    expect(selectCommandCandidate('/se', 0, 0)?.name).toBe('/session');
    expect(selectCommandCandidate('/', 0, 1)?.name).toBe('/model');
    expect(selectCommandCandidate('/', 0, -1)?.name).toBe('/exit');
  });
});
