import readline from 'node:readline';
import { renderBox } from './box.js';

export async function showHelpModal(
  version: string,
  workspace: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return;

  const stdin = process.stdin;
  const stdout = process.stdout;
  const isTty = Boolean(stdout.isTTY && stdin.isTTY);

  const lines = [
    '\x1b[1;38;5;75mSlash Commands:\x1b[0m',
    '  \x1b[1m/model\x1b[0m       Switch active AI model (Free, Paid, or Custom)',
    '  \x1b[1m/skills\x1b[0m     List installed user skills and reload them',
    '  \x1b[1m/clear\x1b[0m       Reset conversation memory and context history',
    '  \x1b[1m/help\x1b[0m        Display this commands, shortcuts & version guide',
    '  \x1b[1m/exit\x1b[0m        Exit Moderado session cleanly',
    '',
    '\x1b[1;38;5;114mKeyboard Shortcuts:\x1b[0m',
    '  \x1b[1mTab\x1b[0m          Toggle between [Plan] (read-only) and [Execute] mode',
    '  \x1b[1mShift+Tab\x1b[0m    Toggle Auto-approval on / off for file and command actions',
    '  \x1b[1mCtrl+C\x1b[0m       Cancel active inference or exit session',
    '',
    '\x1b[1;38;5;180mInline Assist:\x1b[0m',
    '  \x1b[1m/\x1b[0m            Type slash to reveal auto-completion popup',
    '  \x1b[1m@\x1b[0m            Reference files in your prompt',
    '─────────────────────────────────────────────────────────────',
    `\x1b[38;5;245mWorkspace:\x1b[0m  \x1b[38;5;253m${workspace}\x1b[0m`,
    `\x1b[38;5;245mVersion:\x1b[0m    \x1b[1;38;5;75m${version}\x1b[0m`,
  ];

  if (!isTty) {
    stdout.write(
      '\n' +
        renderBox(lines, {
          title: 'Moderado Commands & Reference',
          minWidth: 64,
          borderColor: '\x1b[38;5;240m',
          titleColor: '\x1b[1;38;5;75m',
        }) +
        '\n'
    );
    return;
  }

  // Open dedicated alternate screen popup window and hide cursor
  stdout.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');

  const cols = stdout.columns || 80;
  const rows = stdout.rows || 24;
  const boxWidth = Math.min(Math.max(66, Math.min(cols - 4, 72)), cols);
  const leftPad = Math.max(0, Math.floor((cols - boxWidth) / 2));
  const topPad = Math.max(1, Math.floor((rows - (lines.length + 6)) / 2));

  let out = '\x1b[H\x1b[2J' + '\n'.repeat(topPad);
  const pad = ' '.repeat(leftPad);

  // Border top
  const titleStr = 'Moderado Commands & Reference';
  const remainingDashes = Math.max(0, boxWidth - titleStr.length - 5);
  out += pad + '\x1b[38;5;240m╭─ \x1b[1;38;5;75m' + titleStr + '\x1b[0;38;5;240m ' + '─'.repeat(remainingDashes) + '╮\x1b[0m\n';

  for (const line of lines) {
    const plain = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const spaces = Math.max(0, boxWidth - 4 - plain.length);
    out += pad + '\x1b[38;5;240m│\x1b[0m  ' + line + ' '.repeat(spaces) + '\x1b[38;5;240m│\x1b[0m\n';
  }

  // Border bottom
  out += pad + '\x1b[38;5;240m╰' + '─'.repeat(Math.max(0, boxWidth - 2)) + '╯\x1b[0m\n';

  // Footer key hint
  const footerPlain = 'Press [Esc] or [Enter] to close';
  const footer = 'Press \x1b[1;38;5;75m[Esc]\x1b[0;38;5;244m or \x1b[1;38;5;75m[Enter]\x1b[0;38;5;244m to close';
  const footerPad = ' '.repeat(Math.max(0, Math.floor((cols - footerPlain.length) / 2)));
  out += '\n' + footerPad + '\x1b[38;5;244m' + footer + '\x1b[0m\n';

  stdout.write(out);

  return new Promise<void>((resolve) => {
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      stdin.removeListener('keypress', onKeypress);
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore
      }
      stdout.write('\x1b[?25h\x1b[?1049l');
    };

    const onKeypress = (str: string, key: any) => {
      if (
        (key && (key.name === 'escape' || key.name === 'return' || key.name === 'enter')) ||
        str === 'q' ||
        str === 'Q' ||
        (key && key.ctrl && key.name === 'c')
      ) {
        cleanup();
        resolve();
      }
    };

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          cleanup();
          resolve();
        },
        { once: true }
      );
    }

    stdin.on('keypress', onKeypress);
  });
}
