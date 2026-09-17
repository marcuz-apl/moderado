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

  return [
    hr,
    textBox,
    hr,
    line4,
    line5,
  ].join('\n');
}

export function renderFullWelcomeScreen(options: WelcomeLayoutOptions): string {
  return [
    '',
    ...MODERADO_ASCII_LOGO,
    '',
    COMMAND_HINT,
    '',
    renderWelcomeCard(options),
    '',
  ].join('\n');
}

export interface InteractiveTurnResult {
  text: string;
  mode: 'Plan' | 'Execute';
  autoApprove: boolean;
}

export async function promptInteractiveTurn(options: {
  model: string;
  tokens: number;
  cost: string;
  workspace: string;
  initialMode?: 'Plan' | 'Execute';
  initialAutoApprove?: boolean;
  isFirstTurn?: boolean;
  signal?: AbortSignal;
}): Promise<InteractiveTurnResult> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  let currentMode: 'Plan' | 'Execute' = options.initialMode ?? 'Execute';
  let currentAutoApprove = options.initialAutoApprove ?? false;
  let input = '';

  const getOptions = (): WelcomeLayoutOptions => ({
    model: options.model,
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

  // Position cursor on Line 2 with flashing block
  const positionCursorOnInput = () => {
    const cursorCol = 2 + input.length;
    // \x1b[1 q = flashing block cursor, \x1b[?25h = show cursor
    // Line 2 is 4 lines above the bottom of the card
    stdout.write(`\x1b[1 q\x1b[?25h\x1b[4A\r\x1b[${cursorCol}C`);
  };

  if (options.isFirstTurn) {
    stdout.write('\x1b]0;Moderado\x07');
    stdout.write(renderFullWelcomeScreen(getOptions()));
  } else {
    stdout.write(renderWelcomeCard(getOptions()) + '\n');
  }
  positionCursorOnInput();

  const redrawCard = () => {
    // From Line 2, move up 1 line to Line 1, clear down, reprint card, reposition cursor
    stdout.write('\x1b[1A\r\x1b[J' + renderWelcomeCard(getOptions()) + '\n');
    positionCursorOnInput();
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      stdout.write('\x1b[0 q');
      if (stdin.isTTY) {
        try {
          stdin.setRawMode(false);
        } catch {
          // ignore
        }
      }
    };

    const onAbort = () => {
      cleanup();
      stdout.write('\x1b[4B\r\n\x1b[0 q');
      resolve({ text: '', mode: currentMode, autoApprove: currentAutoApprove });
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    const onKeypress = (str: string, key: any) => {
      if (options.signal?.aborted) {
        cleanup();
        stdout.write('\x1b[4B\r\n\x1b[0 q');
        resolve({ text: '', mode: currentMode, autoApprove: currentAutoApprove });
        return;
      }

      if (!key) {
        if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
          input += str;
          redrawCard();
        }
        return;
      }

      // Ctrl+C
      if (key.ctrl && key.name === 'c') {
        cleanup();
        stdout.write('\x1b[4B\r\n\x1b[0 q\x1b[33mSession cancelled.\x1b[0m\n\n');
        process.exit(0);
      }

      // Shift+Tab or Backtab sequence (\x1b[Z)
      if ((key.name === 'tab' && key.shift) || key.sequence === '\x1b[Z') {
        currentAutoApprove = !currentAutoApprove;
        redrawCard();
        return;
      }

      // Tab alone (toggle Plan / Execute)
      if (key.name === 'tab' && !key.shift) {
        currentMode = currentMode === 'Plan' ? 'Execute' : 'Plan';
        redrawCard();
        return;
      }

      // Enter
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        // Move from Line 2 down 4 lines to bottom, reset cursor to default
        stdout.write('\x1b[4B\r\n\x1b[0 q');
        resolve({ text: input.trim(), mode: currentMode, autoApprove: currentAutoApprove });
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
