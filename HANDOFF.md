# Project Handoff

Updated: 2026-09-17 20:35 UTC  
Branch: master  
Version: v0.1.13+260917k  
Status: complete  

## Summary

Implemented a true Cline/OpenCode-style popup window for `/model` rendered as a **new layer on top of the main app window** (background stays as-is):
1. **Layered popup rendering**:
   - New `apps/cli/src/ui/popup.ts`: ANSI-aware `renderBoxLines` (bordered popup box builder), `popupWidth`, `overlayCentered` (composites popup lines centered on top of the current screen at a fixed position), and `layerPromptBox`.
   - `welcome.ts` `/model` handler passes a `drawFrame` callback: it repaints the background welcome TUI exactly as-is, then overlays the popup window centered on top. The main TUI never scrolls — every step redraws the full frame.
2. **Whole selection flow runs inside the popup layer**:
   - `model_selector.ts`: `selectModelOverlay` accepts `drawFrame`; catalog query status, main menu, sub-lists (free/paid/catalog), search results, pagination, confirmations, and save prompts all redraw via the layer. Non-chat callers (`selectModelInteractive`) keep the alternate-screen flow.
   - `prompt.ts`: `askModalChoice` gained an `echo` option so layer-mode inputs don't paint stray characters over the frame.
3. **Terminal lock fix ("all lock" symptom)**:
   - Root cause: interrupted runs left the terminal with hidden cursor (`\x1b[?25l`), active alternate screen (`\x1b[?1049h`), and/or stdin in raw mode — terminal appears frozen.
   - Fix: `chat.ts` now registers a `process.on('exit')` `restoreTerminal` hook that always restores cursor visibility, sane cursor style, non-raw stdin, and the primary screen buffer on any exit path (only the `exit` event is used — `unhandledRejection` listeners were deliberately avoided because they suppress Node's default fail-closed crash).

## Completed

- `apps/cli/src/ui/popup.ts`: New popup window primitives (`renderBoxLines`, `overlayCentered`, `popupWidth`, `layerPromptBox`).
- `apps/cli/src/ui/model_selector.ts`: Layer-aware `selectModelOverlay` via `drawFrame`; all sub-flows redraw inside the popup layer.
- `apps/cli/src/ui/welcome.ts`: `/model` handler composites background + popup layer and restores the TUI after selection.
- `apps/cli/src/ui/prompt.ts`: `echo` option for `askModalChoice`.
- `apps/cli/src/commands/chat.ts`: `drawFrame` threaded through; guaranteed terminal restore on process exit.
- `apps/cli/tests/prompt.test.ts`: Unit tests for `askModalChoice` (existing, still green).

## Checks

- `npm run typecheck` / `npm run build`: Clean compilation across all workspaces.
- `npm test`: 108 tests passed across 22 test suites offline in ~1.9s.

## Next action

- Ready for user verification via `moderado` (chat → type `/model` → Enter). If a terminal still looks locked from an earlier run, run `reset` or restart the terminal pane.






