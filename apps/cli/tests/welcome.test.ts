import { describe, it, expect } from 'vitest';
import {
  renderModeradoHeader,
  renderCenteredWelcomeScreen,
  renderChatScreen,
  renderWelcomePopupLayer,
  renderFullWelcomeScreen,
  renderWelcomeCard,
  renderHelpPopupBox,
  MODERADO_ASCII_LOGO,
  COMMAND_HINT,
  stripAnsi,
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
      width: 140,
    }, 40);

    const plain = stripAnsi(rendered);
    expect(plain).toContain(stripAnsi(MODERADO_ASCII_LOGO[0]));
    expect(plain).toContain('Explain this repository.');
    expect(plain).toContain('Thought for 12s');
    expect(plain).toContain('It is a provider-independent coding agent.');
    expect(plain).toContain('z-ai/glm-5.3-flash');
    expect(plain).toContain('1500 tokens / $0.00');
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

  it('includes session management in the help popup without an extra content indent', () => {
    const plain = stripAnsi(renderHelpPopupBox('v0.2.0', 'd:\\test', 80).join('\n'));
    expect(plain).toContain('/session   Create, list, resume, export, or compact sessions');
    expect(plain).not.toContain('│   /session');
  });

  it('selects and completes slash command candidates by index', () => {
    expect(selectCommandCandidate('/se', 0, 0)?.name).toBe('/session');
    expect(selectCommandCandidate('/', 0, 1)?.name).toBe('/model');
    expect(selectCommandCandidate('/', 0, -1)?.name).toBe('/exit');
  });
});
