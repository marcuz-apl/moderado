export interface WelcomeLayoutOptions {
  model: string;
  tokens: number;
  cost: string;
  workspace: string;
  mode: 'Plan' | 'Execute';
  autoApprove: boolean;
  input?: string;
  width?: number;
}

export const MODERADO_ASCII_LOGO = [
  '\x1b[38;5;75m    __  _______  ____  __________  ___    ____  ____ \x1b[0m',
  '\x1b[38;5;75m   /  |/  / __ \\/ __ \\/ ____/ __ \\/   |  / __ \\/ __ \\\x1b[0m',
  '\x1b[38;5;81m  / /|_/ / / / / / / / __/ / /_/ / /| | / / / / / / /\x1b[0m',
  '\x1b[38;5;81m / /  / / /_/ / /_/ / /___/ _, _/ ___ |/ /_/ / /_/ / \x1b[0m',
  '\x1b[38;5;87m/_/  /_/\\____/_____/_____/_/ |_/_/  |_/_____/\\____/  \x1b[0m',
];

export const COMMAND_HINT =
  '\x1b[38;5;242mUse \x1b[38;5;75m/\x1b[38;5;242m for slash commands, \x1b[38;5;75m@\x1b[38;5;242m for file mentions, \x1b[38;5;75mCtrl+P\x1b[38;5;242m for menu\x1b[0m';

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function renderWelcomeCard(options: WelcomeLayoutOptions): string {
  const terminalWidth = options.width ?? (process.stdout.columns || 80);
  const width = Math.max(60, Math.min(terminalWidth, 80));
  const hr = `\x1b[38;5;238m${'─'.repeat(width)}\x1b[0m`;

  const displayInput =
    options.input && options.input.length > 0
      ? options.input
      : '\x1b[38;5;242mAsk anything, I am all ears...\x1b[0m';

  const textBox = `\x1b[1;38;5;75m❯\x1b[0m ${displayInput}`;

  // Line 4: model & tokens / cost (left) ... Plan / Execute (Tab) (right)
  const left4Raw = `${options.model}  ${options.tokens} tokens / ${options.cost}`;
  const left4 = `\x1b[38;5;180m${options.model}\x1b[0m  \x1b[38;5;244m${options.tokens} tokens / ${options.cost}\x1b[0m`;
  
  const right4 =
    options.mode === 'Plan'
      ? '\x1b[1;38;5;75m[Plan]\x1b[0m / Execute (Tab)'
      : 'Plan / \x1b[1;38;5;75m[Execute]\x1b[0m (Tab)';
  const right4Raw = options.mode === 'Plan' ? '[Plan] / Execute (Tab)' : 'Plan / [Execute] (Tab)';

  const spaces4Count = Math.max(1, width - left4Raw.length - right4Raw.length);
  const line4 = left4 + ' '.repeat(spaces4Count) + right4;

  // Line 5: Working directory (left) ... Auto-approve (right)
  const shortWs =
    options.workspace.length > 36
      ? '...' + options.workspace.slice(-33)
      : options.workspace;
  const left5 = `\x1b[38;5;245m${shortWs}\x1b[0m`;

  const right5 = options.autoApprove
    ? '\x1b[38;5;114mAuto-approve all enabled (Shift+Tab)\x1b[0m'
    : '\x1b[38;5;242mAuto-approve off (Shift+Tab)\x1b[0m';
  const right5Raw = options.autoApprove
    ? 'Auto-approve all enabled (Shift+Tab)'
    : 'Auto-approve off (Shift+Tab)';
  const spaces5Count = Math.max(1, width - shortWs.length - right5Raw.length);
  const line5 = left5 + ' '.repeat(spaces5Count) + right5;

  const cardLines = [
    hr,
    textBox,
    hr,
    line4,
    line5,
  ];

  if (options.input && options.input.startsWith('/')) {
    const matching = getMatchingCommands(options.input);
    if (matching.length > 0) {
      cardLines.push(...renderSuggestionsBox(matching));
    }
  }

  return cardLines.join('\n');
}

export interface SlashCommand {
  name: string;
  desc: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/model', desc: 'Switch active AI model' },
  { name: '/clear', desc: 'Reset conversation memory' },
  { name: '/help', desc: 'Display commands, shortcuts & version' },
  { name: '/exit', desc: 'Exit Moderado' },
];

export function getMatchingCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  const q = input.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(q));
}

export function renderSuggestionsBox(commands: SlashCommand[]): string[] {
  if (commands.length === 0) return [];
  const lines: string[] = [];
  lines.push('\x1b[38;5;240m  ╭─ Commands (Press Tab to autocomplete) ──────────────╮\x1b[0m');
  for (const cmd of commands) {
    const nameStr = `\x1b[1;38;5;75m${cmd.name.padEnd(8)}\x1b[0m`;
    const descStr = `\x1b[38;5;244m${cmd.desc.padEnd(38)}\x1b[0m`;
    lines.push(`\x1b[38;5;240m  │\x1b[0m  ${nameStr} ${descStr}\x1b[38;5;240m│\x1b[0m`);
  }
  lines.push('\x1b[38;5;240m  ╰─────────────────────────────────────────────────────╯\x1b[0m');
  return lines;
}

export function renderModeradoHeader(): string {
  return [
    '',
    ...MODERADO_ASCII_LOGO,
    '',
    COMMAND_HINT,
  ].join('\n');
}

export function renderFullWelcomeScreen(options: WelcomeLayoutOptions): string {
  return [
    renderModeradoHeader(),
    '',
    renderWelcomeCard(options),
  ].join('\n') + '\n';
}

export function renderHelpPopupBox(version: string, workspace: string, width?: number): string[] {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  const boxWidth = Math.min(terminalWidth, 74);
  const padLeft = Math.max(0, Math.floor((terminalWidth - boxWidth) / 2));
  const indent = ' '.repeat(padLeft);
  const innerW = boxWidth - 4;

  const titleStr = 'Moderado Help & Shortcuts';
  const remainingDashes = Math.max(0, boxWidth - titleStr.length - 5);
  const shortWs = workspace.length > 38 ? '...' + workspace.slice(-35) : workspace;

  const content: string[] = [
    '\x1b[1;38;5;75mSlash Commands:\x1b[0m',
    '  \x1b[1m/model\x1b[0m       Switch active AI model (Free, Paid, or Custom)',
    '  \x1b[1m/clear\x1b[0m       Reset conversation memory and context history',
    '  \x1b[1m/help\x1b[0m        Display this commands, shortcuts & version guide',
    '  \x1b[1m/exit\x1b[0m        Exit Moderado session cleanly',
    '',
    '\x1b[1;38;5;114mKeyboard Shortcuts:\x1b[0m',
    '  \x1b[1mTab\x1b[0m          Toggle between [Plan] and [Execute] mode',
    '  \x1b[1mShift+Tab\x1b[0m    Toggle Auto-approval on / off for actions',
    '  \x1b[1mCtrl+C\x1b[0m       Cancel active inference or exit session',
    '',
    `\x1b[38;5;245mWorkspace:\x1b[0m  \x1b[38;5;253m${shortWs}\x1b[0m`,
    `\x1b[38;5;245mVersion:\x1b[0m    \x1b[1;38;5;75m${version}\x1b[0m`,
    '',
    '\x1b[38;5;244mPress \x1b[1;38;5;75m[Esc]\x1b[0;38;5;244m or \x1b[1;38;5;75m[Enter]\x1b[0;38;5;244m to close\x1b[0m',
  ];

  const lines: string[] = [];
  lines.push(indent + '\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + titleStr + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m');
  for (const item of content) {
    const plain = item.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const spaces = Math.max(0, innerW - plain.length);
    lines.push(indent + '\x1b[38;5;240m│\x1b[0m  ' + item + ' '.repeat(spaces) + '\x1b[38;5;240m│\x1b[0m');
  }
  lines.push(indent + '\x1b[38;5;240m╰' + '─'.repeat(boxWidth - 2) + '╯\x1b[0m');
  return lines;
}

export interface AvailableModelItem {
  key: string;
  id: string;
  name: string;
  desc: string;
}

export const POPUP_MODELS: AvailableModelItem[] = [
  { key: '1', id: 'auto', name: 'Auto (Free-First)', desc: 'Smart auto-routing favoring free hosted models' },
  { key: '2', id: 'meta/llama-3.3-70b-instruct', name: 'meta/llama-3.3-70b-instruct', desc: 'Powerful general coding & reasoning' },
  { key: '3', id: 'meta/llama-3.1-405b-instruct', name: 'meta/llama-3.1-405b-instruct', desc: 'Frontier 405B flagship model' },
  { key: '4', id: 'deepseek-ai/deepseek-r1', name: 'deepseek-ai/deepseek-r1', desc: 'Deep reasoning and code generation' },
  { key: '5', id: 'qwen/qwen2.5-coder-32b-instruct', name: 'qwen/qwen2.5-coder-32b-instruct', desc: 'Fast specialized coder' },
];

export function renderModelPopupBox(currentModel: string, width?: number): string[] {
  const terminalWidth = width ?? (process.stdout.columns || 80);
  const boxWidth = Math.min(terminalWidth, 74);
  const padLeft = Math.max(0, Math.floor((terminalWidth - boxWidth) / 2));
  const indent = ' '.repeat(padLeft);
  const innerW = boxWidth - 4;

  const titleStr = 'Select Active AI Model';
  const remainingDashes = Math.max(0, boxWidth - titleStr.length - 5);

  const lines: string[] = [];
  lines.push(indent + '\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + titleStr + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m');
  lines.push(indent + '\x1b[38;5;240m│\x1b[0m' + ' '.repeat(innerW + 2) + '\x1b[38;5;240m│\x1b[0m');

  for (const m of POPUP_MODELS) {
    const isCur =
      currentModel.toLowerCase().includes(m.id.toLowerCase()) ||
      (m.id === 'auto' && (currentModel === 'auto' || currentModel.toLowerCase().includes('auto')));
    const numTag = `\x1b[1;38;5;75m[${m.key}]\x1b[0m`;
    const namePart = isCur
      ? `\x1b[1;38;5;114m${m.name} (Active)\x1b[0m`
      : `\x1b[1;38;5;253m${m.name}\x1b[0m`;
    const lineStr = `  ${numTag} ${namePart}`;
    const plain = lineStr.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const spaces = Math.max(0, innerW - plain.length);
    lines.push(indent + '\x1b[38;5;240m│\x1b[0m' + lineStr + ' '.repeat(spaces) + '  \x1b[38;5;240m│\x1b[0m');

    const descStr = `      \x1b[38;5;244m${m.desc}\x1b[0m`;
    const descPlain = descStr.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const descSpaces = Math.max(0, innerW - descPlain.length);
    lines.push(indent + '\x1b[38;5;240m│\x1b[0m' + descStr + ' '.repeat(descSpaces) + '  \x1b[38;5;240m│\x1b[0m');
  }

  lines.push(indent + '\x1b[38;5;240m│\x1b[0m' + ' '.repeat(innerW + 2) + '\x1b[38;5;240m│\x1b[0m');
  const footerStr =
    '  Press \x1b[1;38;5;75m[1-5]\x1b[0;38;5;244m to select, or \x1b[1;38;5;75m[Esc / Enter]\x1b[0;38;5;244m to cancel\x1b[0m';
  const footerPlain = footerStr.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const footerSpaces = Math.max(0, innerW - footerPlain.length);
  lines.push(indent + '\x1b[38;5;240m│\x1b[0m' + footerStr + ' '.repeat(footerSpaces) + '  \x1b[38;5;240m│\x1b[0m');

  lines.push(indent + '\x1b[38;5;240m╰' + '─'.repeat(boxWidth - 2) + '╯\x1b[0m');
  return lines;
}

export interface InteractiveTurnResult {
  text: string;
  mode: 'Plan' | 'Execute';
  autoApprove: boolean;
}

export interface PromptInteractiveTurnOptions {
  model: string;
  tokens: number;
  cost: string;
  workspace: string;
  version?: string;
  initialMode?: 'Plan' | 'Execute';
  initialAutoApprove?: boolean;
  isFirstTurn?: boolean;
  signal?: AbortSignal;
  onModelChange?: (newModelId: string) => void;
  onClear?: () => void;
}

export async function promptInteractiveTurn(
  options: PromptInteractiveTurnOptions
): Promise<InteractiveTurnResult> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  let currentModel = options.model;
  let currentMode: 'Plan' | 'Execute' = options.initialMode ?? 'Execute';
  let currentAutoApprove = options.initialAutoApprove ?? false;
  let input = '';
  let activeModal: 'help' | 'model' | null = null;

  const getOptions = (): WelcomeLayoutOptions => ({
    model: currentModel,
    tokens: options.tokens,
    cost: options.cost,
    workspace: options.workspace,
    mode: currentMode,
    autoApprove: currentAutoApprove,
    input,
  });

  // Non-TTY fallback
  if (!stdin.isTTY) {
    if (options.isFirstTurn) {
      stdout.write('\x1b]0;Moderado\x07');
      stdout.write(renderFullWelcomeScreen(getOptions()));
    } else {
      stdout.write(renderWelcomeCard(getOptions()) + '\n');
    }
    const readlineModule = await import('node:readline');
    return new Promise((resolve) => {
      const rl = readlineModule.createInterface({ input: stdin, output: stdout });
      rl.question('\x1b[1;38;5;75m❯\x1b[0m ', (answer) => {
        rl.close();
        resolve({ text: answer.trim(), mode: currentMode, autoApprove: currentAutoApprove });
      });
    });
  }

  // TTY Interactive Loop
  const readlineModule = await import('node:readline');
  readlineModule.emitKeypressEvents(stdin);
  stdin.setRawMode(true);

  const getExtraLines = () => {
    if (!input.startsWith('/')) return 0;
    const matching = getMatchingCommands(input);
    return matching.length > 0 ? matching.length + 2 : 0;
  };

  // Position cursor on Line 2 with flashing block
  const positionCursorOnInput = () => {
    if (activeModal !== null) return;
    const cursorCol = 2 + input.length;
    const moveUp = 4 + getExtraLines();
    stdout.write(`\x1b[1 q\x1b[?25h\x1b[${moveUp}A\r\x1b[${cursorCol}C`);
  };

  const redrawScreen = () => {
    stdout.write('\x1b[H\x1b[J');
    stdout.write(renderFullWelcomeScreen(getOptions()));

    if (activeModal === 'help') {
      stdout.write('\x1b[?25l');
      const modalLines = renderHelpPopupBox(
        options.version ?? 'v0.1.14',
        options.workspace
      );
      stdout.write('\n' + modalLines.join('\n') + '\n');
      return;
    }

    if (activeModal === 'model') {
      stdout.write('\x1b[?25l');
      const modalLines = renderModelPopupBox(currentModel);
      stdout.write('\n' + modalLines.join('\n') + '\n');
      return;
    }

    positionCursorOnInput();
  };

  const redrawCard = () => {
    if (activeModal !== null) {
      redrawScreen();
      return;
    }
    // From Line 2, move up 1 line to Line 1, clear down, reprint card, reposition cursor
    stdout.write('\x1b[1A\r\x1b[J' + renderWelcomeCard(getOptions()) + '\n');
    positionCursorOnInput();
  };

  if (options.isFirstTurn) {
    stdout.write('\x1b]0;Moderado\x07');
    stdout.write('\x1b[2J\x1b[3J\x1b[H');
    stdout.write(renderFullWelcomeScreen(getOptions()));
  } else {
    stdout.write(renderWelcomeCard(getOptions()) + '\n');
  }
  positionCursorOnInput();

  return new Promise((resolve) => {
    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      stdout.write('\x1b[0 q\x1b[?25h');
      if (stdin.isTTY) {
        try {
          stdin.setRawMode(false);
        } catch {
          // ignore
        }
      }
      try {
        stdin.pause();
      } catch {
        // ignore
      }
    };

    const onAbort = () => {
      cleanup();
      const moveDown = 4 + getExtraLines();
      stdout.write(`\x1b[${moveDown}B\r\n\x1b[0 q\x1b[?25h`);
      resolve({ text: '', mode: currentMode, autoApprove: currentAutoApprove });
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    const onKeypress = (str: string, key: any) => {
      if (options.signal?.aborted) {
        cleanup();
        const moveDown = 4 + getExtraLines();
        stdout.write(`\x1b[${moveDown}B\r\n\x1b[0 q`);
        resolve({ text: '', mode: currentMode, autoApprove: currentAutoApprove });
        return;
      }

      // Ctrl+C
      if (key && key.ctrl && key.name === 'c') {
        cleanup();
        const moveDown = 4 + getExtraLines();
        stdout.write(`\x1b[${moveDown}B\r\n\x1b[0 q\x1b[33mSession cancelled.\x1b[0m\n\n`);
        process.exit(0);
      }

      // When a modal popup is open
      if (activeModal === 'help') {
        if (
          (key && (key.name === 'escape' || key.name === 'return' || key.name === 'enter')) ||
          str === 'q' ||
          str === 'Q'
        ) {
          activeModal = null;
          input = '';
          redrawScreen();
        }
        return;
      }

      if (activeModal === 'model') {
        if (
          (key && (key.name === 'escape' || key.name === 'return' || key.name === 'enter')) ||
          str === 'q' ||
          str === 'Q'
        ) {
          activeModal = null;
          input = '';
          redrawScreen();
          return;
        }

        if (str && ['1', '2', '3', '4', '5'].includes(str)) {
          const selected = POPUP_MODELS.find((m) => m.key === str);
          if (selected) {
            currentModel = selected.id === 'auto' ? 'Auto (Free-First)' : selected.id;
            options.onModelChange?.(selected.id);
            activeModal = null;
            input = '';
            redrawScreen();
          }
          return;
        }
        return;
      }

      // Normal mode (activeModal === null)
      if (!key) {
        if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
          input += str;
          redrawCard();
        }
        return;
      }

      // Shift+Tab or Backtab sequence (\x1b[Z)
      if ((key.name === 'tab' && key.shift) || key.sequence === '\x1b[Z') {
        currentAutoApprove = !currentAutoApprove;
        redrawCard();
        return;
      }

      // Tab alone
      if (key.name === 'tab' && !key.shift) {
        if (input.startsWith('/')) {
          const matching = getMatchingCommands(input);
          if (matching.length > 0) {
            const exactIdx = matching.findIndex((m) => m.name.toLowerCase() === input.toLowerCase());
            if (exactIdx === -1) {
              input = matching[0].name;
            } else {
              input = matching[(exactIdx + 1) % matching.length].name;
            }
            redrawCard();
            return;
          }
        }
        currentMode = currentMode === 'Plan' ? 'Execute' : 'Plan';
        redrawCard();
        return;
      }

      // Enter
      if (key.name === 'return' || key.name === 'enter') {
        const trimmed = input.trim();

        if (trimmed === '/help') {
          activeModal = 'help';
          redrawScreen();
          return;
        }

        if (trimmed === '/model') {
          activeModal = 'model';
          redrawScreen();
          return;
        }

        if (trimmed === '/clear') {
          input = '';
          options.onClear?.();
          redrawScreen();
          return;
        }

        if (trimmed === '/exit' || trimmed === '/quit' || trimmed.toLowerCase() === 'exit') {
          cleanup();
          stdout.write('\x1b[0 q\x1b[?25h\x1b[32mGoodbye! Stay Tuned with Moderado!\x1b[0m\n\n');
          process.exit(0);
        }

        cleanup();
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        const moveDown = 4 + getExtraLines();
        stdout.write(`\x1b[${moveDown}B\r\n\x1b[0 q\x1b[?25h`);
        resolve({ text: trimmed, mode: currentMode, autoApprove: currentAutoApprove });
        return;
      }

      // Backspace
      if (key.name === 'backspace') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          redrawCard();
        }
        return;
      }

      // Normal printable text character
      if (str && str.length === 1 && str.charCodeAt(0) >= 32 && !key.ctrl && !key.meta) {
        input += str;
        redrawCard();
      }
    };

    stdin.on('keypress', onKeypress);
  });
}
