import { describe, it, expect } from 'vitest';
import {
  renderModeradoHeader,
  renderFullWelcomeScreen,
  renderWelcomeCard,
  renderHelpPopupBox,
  renderModelPopupBox,
  MODERADO_ASCII_LOGO,
  COMMAND_HINT,
  stripAnsi,
} from '../src/ui/welcome.js';

describe('OpenCode-style Welcome TUI', () => {
  it('renders the ASCII logo and command hint', () => {
    expect(MODERADO_ASCII_LOGO.length).toBe(5);
    const plainHint = stripAnsi(COMMAND_HINT);
    expect(plainHint).toContain('Use / for slash commands');
    expect(plainHint).toContain('@ for file mentions');
    expect(plainHint).toContain('Ctrl+P for menu');

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

    // Line 1: top dash line (OpenCode box-drawing style)
    expect(stripAnsi(lines[0])).toBe('─'.repeat(80));

    // Line 2: command taking text box with placeholder
    expect(stripAnsi(lines[1])).toBe('❯ Ask anything, I am all ears...');

    // Line 3: bottom dash line (OpenCode box-drawing style)
    expect(stripAnsi(lines[2])).toBe('─'.repeat(80));

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
    expect(stripAnsi(lines[1])).toBe('❯ refactor database layer');
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
    expect(plain).toContain('/model');
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

  it('renders help popup box on top with commands, shortcuts, version and workspace', () => {
    const lines = renderHelpPopupBox('v0.1.14', 'd:\\projects\\moderado', 80);
    expect(lines.length).toBeGreaterThan(10);

    const full = stripAnsi(lines.join('\n'));
    expect(full).toContain('Moderado Help & Shortcuts');
    expect(full).toContain('/model');
    expect(full).toContain('/clear');
    expect(full).toContain('/help');
    expect(full).toContain('/exit');
    expect(full).toContain('Tab');
    expect(full).toContain('Shift+Tab');
    expect(full).toContain('Ctrl+C');
    expect(full).toContain('Workspace:');
    expect(full).toContain('d:\\projects\\moderado');
    expect(full).toContain('Version:');
    expect(full).toContain('v0.1.14');
    expect(full).toContain('Press [Esc] or [Enter] to close');
  });

  it('renders model popup box on top with choices and active model indicator', () => {
    const lines = renderModelPopupBox('Auto (Free-First)', 80);
    expect(lines.length).toBeGreaterThan(10);

    const full = stripAnsi(lines.join('\n'));
    expect(full).toContain('Select Active AI Model');
    expect(full).toContain('[1] Auto (Free-First) (Active)');
    expect(full).toContain('[2] meta/llama-3.3-70b-instruct');
    expect(full).toContain('[3] meta/llama-3.1-405b-instruct');
    expect(full).toContain('[4] deepseek-ai/deepseek-r1');
    expect(full).toContain('[5] qwen/qwen2.5-coder-32b-instruct');
    expect(full).toContain('Press [1-5] to select, or [Esc / Enter] to cancel');
  });
});
