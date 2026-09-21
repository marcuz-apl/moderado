# Project Handoff

Updated: 2026-09-21 21:32 UTC
Branch: master
Commit: `v0.2.60+260921C`
Status: Implemented in-flight /btw side question overlays during active generation turns without pausing or waiting for the main mission to finish. All 333 tests passing offline, typecheck clean, binary linked globally.

## Summary

1. **In-Flight `/btw` Sidecar During Active Missions ([`apps/cli/src/commands/chat.ts`](file:///d:/projects/moderado/apps/cli/src/commands/chat.ts))**:
   - **Concurrent Side-Questioning**: Users can type `/btw <question>` even while Moderado is actively executing a task or generating code.
   - **Immediate Pop-up Interception**: Bypasses the FIFO command queue and immediately opens an ephemeral overlay popup (`executeBtwQuery`).
   - **Zero Context Pollution**: The in-flight query executes without tools, capped at 250 tokens and <35 words, and never enters the active conversation history.
   - **ESC Dismissal & Stream Cancellation**: Pressing `ESC` cancels the side inference or dismisses the popup and immediately restores the active generation screen without disturbing the main mission.
2. **Claude Code-style `/btw` Slash Command**:
   - Registered in `STANDARD_SLASH_COMMANDS`, `SLASH_COMMANDS`, and `/help`.
   - Bare `/btw` allows reviewing recent session side questions.
2. **Dedicated Bordered Queued Commands Box ([`apps/cli/src/ui/welcome.ts`](file:///d:/projects/moderado/apps/cli/src/ui/welcome.ts#L67-L94))**:
   - Implemented `renderQueuedCommandsBox`: renders a standalone bordered box (`╭─ Queued Commands (N) ──────────╮ ... ╰──────────────────────────╯`) using terminal box-drawing characters with amber highlights.
   - Positioned directly above the editable question composer card.
3. **Four-Layer Token Minimization & Brevity**:
   - **Layer 1**: System prompt brevity directives.
   - **Layer 2**: Ultra-compact local fast-routing.
   - **Layer 3**: 250-token output cap.
   - **Layer 4**: Conversational filler cleaner.
4. **Verification & Linking**:
   - All 48 test suites and 332 tests pass offline (`npm test`).
   - Rebuilt all packages (`npm run build; npm run prepare:package`).
   - Globally linked (`npm --prefix apps/cli link`).

## Checks

- `npm run typecheck` — PASS (0 errors)
- `npm run build; npm run prepare:package` — PASS
- `npm test` — PASS (48 test files, 332 tests passed)
- `npm --prefix apps/cli link` — PASS
- `node apps/cli/dist/index.js --version` — PASS (`v0.2.58+2609219`)

## Blockers

- None.

