# Project Handoff

Updated: 2026-09-17 21:05 UTC  
Branch: master  
Version: v0.1.14+260917r  
Status: complete  

## Summary

Upgraded `/model` to a **beautiful Cline/OpenCode-style popup layer** (background dimmed, drop shadow, interactive list window):
1. **Depth & polish** (`popup.ts`): `dimLines` dims the background so the popup floats above it; `shadowUnder` paints a soft `░` drop shadow under/right of the popup.
2. **Interactive list window** (`popup.ts` → `selectListPopup`): floating window layer with type-to-filter input (block cursor), `❯` cursor + highlighted selection row, selected item's description shown beneath the list, ↑/↓ scroll indicators, and a footer key-hint bar (`↑↓ navigate · Enter select · Esc cancel · count · Page n/m`). Navigation: ↑↓/jk, Home/End, PgUp/PgDn; Enter selects; Esc cancels (null). `selectConfirmPopup` provides Yes/No confirmation windows.
3. **Rewired flows** (`model_selector.ts` layer mode): the main menu is now an interactive list popup with descriptions and model-count badges; free/paid/all browsing and keyword search use the filterable popup (Esc opens a retry/cancel menu so the custom-ID escape hatch is preserved); save-default uses the confirmation popup. Standalone setup-mode flows unchanged.
4. **`welcome.ts` `drawFrame`**: dims the background, paints the shadow, then composites the popup centered on top — the main TUI never scrolls.

Previously completed: layered `/model` popup rendering (`overlayCentered`, `renderBoxLines`, `layerPromptBox`), whole selection flow inside the popup layer, `askModalChoice` echo option, and the terminal-lock fix (`process.on('exit')` restore hook in `chat.ts`).

## Completed

- `apps/cli/src/ui/popup.ts`: `dimLines`, `shadowUnder`, `selectListPopup`, `selectConfirmPopup`, `PopupListItem`, `ListPopupOptions` (plus earlier `renderBoxLines`, `overlayCentered`, `popupPosition`, `popupWidth`, `layerPromptBox`).
- `apps/cli/src/ui/model_selector.ts`: layer-mode main menu / sub-lists / search / confirm rewritten onto the interactive popup toolkit.
- `apps/cli/src/ui/welcome.ts`: dimmed backdrop + drop shadow in `drawFrame`.
- `apps/cli/src/commands/chat.ts`: guaranteed terminal restore on process exit (earlier session).

## Checks

- `npm run typecheck` / `npm run build`: Clean compilation across all workspaces.
- `npm test`: 108 tests passed across 22 test suites offline in ~1.9s.

## Next action

- Ready for user verification via `moderado` (chat → type `/model` → Enter): expect dimmed background, drop shadow, `❯`-cursor list window with type-to-filter.











