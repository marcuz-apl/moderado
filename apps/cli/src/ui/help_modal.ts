import { renderBox } from './box.js';
import { askQuestion } from './prompt.js';
import { renderModeradoHeader } from './welcome.js';

export async function showHelpModal(
  version: string,
  workspace: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return;

  const isTty = Boolean(process.stdout.isTTY);
  if (isTty) {
    // Open dedicated alternate screen popup window
    process.stdout.write('\x1b[?1049h\x1b[H\x1b[2J');
  }

  try {
    const lines = [
      '\x1b[1;38;5;75mSlash Commands:\x1b[0m',
      '  \x1b[1m/model\x1b[0m       Switch active AI model (Free, Paid, or Custom)',
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
      '---',
      `\x1b[38;5;245mWorkspace:\x1b[0m  \x1b[38;5;253m${workspace}\x1b[0m`,
      `\x1b[38;5;245mVersion:\x1b[0m    \x1b[1;38;5;75m${version}\x1b[0m`,
    ];

    process.stdout.write(
      '\x1b[2J\x1b[3J\x1b[H' +
        renderModeradoHeader() +
        '\n\n' +
        renderBox(lines, {
          title: 'Moderado Commands & Reference',
          minWidth: 64,
          borderColor: '\x1b[38;5;240m',
          titleColor: '\x1b[1;38;5;75m',
        }) +
        '\n\x1b[38;5;242mPress Enter or [q] to return to Moderado...\x1b[0m '
    );

    await askQuestion('', { signal });
  } finally {
    if (isTty) {
      // Restore previous chat terminal screen buffer
      process.stdout.write('\x1b[?1049l');
    }
  }
}
