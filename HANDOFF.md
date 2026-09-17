# Project Handoff

Updated: 2026-09-17 19:05 UTC  
Branch: master  
Version: v0.1.14+260917l  
Status: complete  

## Summary

Implemented true OpenCode / Cline TUI popup modal windows for `/help` and `/model` with background persistence, exact cursor restoration, and updated exiting message:
1. **Persistent Main App Window as Background**:
   - The main app window (Ascii logo, command hints, and guided command box `❯ Ask anything, I am all ears...`) remains visibly anchored in the background when `/help` or `/model` popup windows are open.
   - Zero alternate screen blanking (`\x1b[?1049h` eliminated from TUI interactive turns).
2. **Popup Modal Windows on Top**:
   - `/help`: Renders a boxed popup window on top of the main app window displaying all commands, shortcuts, workspace root, and canonical version.
   - `/model`: Renders a boxed popup window on top of the main app window with options [1-5], indicating `(Active)` on the current model.
3. **Cursor Restoration (<kbd>Esc</kbd> / <kbd>Enter</kbd>)**:
   - Pressing <kbd>Esc</kbd> or <kbd>Enter</kbd> (or `q`) dismisses the popup window immediately.
   - Cursor returns directly to where it was (Line 2 inside `❯ Ask anything, I am all ears...` with flashing block `\x1b[1 q\x1b[?25h`). No new terminal line or prompt is printed.
4. **Updated Exiting Message**:
   - Updated exit message across `welcome.ts`, `chat.ts`, and `interactive_menu.ts` to:
     `Goodbye! Stay Tuned with Moderado!`

## Completed

- `apps/cli/src/ui/welcome.ts`: Exported `renderHelpPopupBox`, `renderModelPopupBox`, and integrated `activeModal: 'help' | 'model' | null` state machine directly into `promptInteractiveTurn`.
- `apps/cli/src/commands/chat.ts`: Wired `promptInteractiveTurn` across all turns with `onModelChange`, `onClear`, and updated exiting message.
- `apps/cli/src/commands/interactive_menu.ts`: Updated exiting message to `Goodbye! Stay Tuned with Moderado!`.
- `apps/cli/tests/welcome.test.ts`: Added unit tests for `renderHelpPopupBox` and `renderModelPopupBox`.
- `VERSION`: Updated to `v0.1.14+260917l`.

## Checks

- `npm run build` (`tsc -b --force`): Clean compilation across all workspaces.
- `npm test` (`vitest run`): 110 tests passed across 22 test suites offline in 1.88s.
- `npm link --workspace moderado`: Re-linked global CLI binary.

## Next action

- Ready for user verification via `moderado`.





