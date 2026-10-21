# Changelog

## Semantic Version Progression

```text
v0.4.28 (Help organization and interrupted-chat resilience)
  └─► v0.4.29 (Provider in status row, clearer search excerpts)
        └─► v0.4.30 (Moderado provider identity and endpoint)
              └─► v0.4.31 (Gateway auth recovery, live progress row)
                    └─► v0.4.32 (Short `modr` command alias)
                          └─► v0.4.33 (Approval boundary and width fixes)
```

## Milestone Change Log Details

### [Unreleased]
**Fix: no frozen CLI — Ctrl+C always has a way out**
- **Type**: `fix` / `patch-level`
- **Scope**: `apps/cli` popups, chat generation input, `/btw` overlay, SIGINT handling
- **Key Deliverables**:
  - **Popups honor Ctrl+C**: A raw-mode TUI turns Ctrl+C into a keypress instead of SIGINT, so list and confirm popups swallowed it — the user could neither type nor leave. Popups now cancel on the first press and return to the composer.
  - **Generation escape hatch**: During a turn the first Ctrl+C aborts the run; if a stalled provider stream or hung tool ignores the abort, a second press force-exits instead of freezing with no way out. The same escalation covers the `/btw` overlay, which previously only listened for Escape.
  - **Safe hard exit**: `forceExit` drains undici sockets for up to 300ms before exiting, so the escape hatch never trips the Node 24 `UV_HANDLE_CLOSING` libuv assertion, and a second SIGINT outside raw mode exits with code 130 the same way.
  - **Coverage**: `freeze_escape.test.ts` asserts the escape hatch terminates with the requested exit code, with and without an undici global dispatcher.

### [v0.4.33] — 2026-10-21
**Fix: Restore the approval boundary in `run`, align wide-glyph layout, and harden the test harness**
- **Type**: `fix` / `patch-level`
- **Scope**: `apps/cli` run approval, composer mentions, TUI width math, test configuration, docs
- **Key Deliverables**:
  - **Approval boundary**: `moderado run` no longer auto-approves workspace mutations. It prompts like the chat session, skips prompts only with `-y/--auto-approve`, always prompts for network commands and MCP tools, and denies instead of hanging when stdin is not a terminal. Saved `allowPaid`/`allowUnknown` preferences are honored again, because the boolean flags had made `??` dead code.
  - **Composer mentions**: `@file` expansion replaces the exact matched token, so a repeated mention no longer rewrites the first occurrence, and file content containing `$&` or `$1` is no longer interpreted as a replacement pattern.
  - **Wide-glyph layout**: A shared `displayWidth` helper counts CJK and emoji glyphs as two cells and combining marks as zero, so box borders, popup padding, and `wrapText` stay aligned for non-ASCII paths and prompts.
  - **Test harness**: Raises Vitest `testTimeout`/`hookTimeout` to 30s because process-spawning suites take 0.5-3s per spawn on Windows, and retries Windows `EBUSY` cleanup in the git workspace test. The full offline suite now passes in one run.
  - **Housekeeping**: Removes the unused `interactive_menu` command, strips a BOM from `sessions.ts`, stops `moderado models` from prompting when stdin is not a TTY, and documents `--provider` and `--connectivity` in `--help`.
  - **Docs**: Records v0.4.29-v0.4.33, replaces absolute `file:///d:/...` links with repository-relative links, documents the Shift+Tab auto-approve toggle, and refreshes release/distribution runbooks for `0.4.33`.

### [v0.4.32] — 2026-10-20
**Feat: Short `modr` command alias**
- **Type**: `feat`
- **Scope**: `apps/cli` package metadata, argument parser, docs
- **Key Deliverables**:
  - **Alias**: The package publishes both `moderado` and `modr` bin entries, so every command works through the short name.
  - **Coverage**: `package_metadata.test.ts` asserts both bin entries, and `--help` documents the alias.

### [v0.4.31] — 2026-10-20
**Fix: Gateway authorization recovery and a live progress row**
- **Type**: `fix`
- **Scope**: `apps/cli` chat session, provider connect, welcome renderer, `packages/core` routing
- **Key Deliverables**:
  - **Auth recovery**: A turn that fails with `ERR_GATEWAY_UNAUTHORIZED` offers key re-entry instead of ending the session, and the authorization messages name the failing provider.
  - **Credential persistence**: The Moderado website key is persisted on platforms without a credential store.
  - **Progress row**: The status row keeps a live "still running" indicator during streaming and silent tool execution.
  - **Resize**: The chat view re-centers immediately after a terminal resize.
  - **Identity**: Core routing recognizes the canonical `moderado` provider id alongside the legacy `moderado-cloud` id.

### [v0.4.30] — 2026-10-20
**Refactor: Canonical Moderado provider identity and endpoint**
- **Type**: `refactor` / `fix`
- **Scope**: `packages/providers` presets, `apps/cli` config
- **Key Deliverables**:
  - **Identity**: The provider preset id and display name are canonicalized to `moderado` / `Moderado`.
  - **Endpoint**: The production Gateway endpoint is updated.
  - **Migration**: Legacy `moderado-cloud` configuration entries are migrated on load, preferring the canonical record when both exist.

### [v0.4.29] — 2026-10-20
**Feat: Provider shown beside the model, clearer search excerpts**
- **Type**: `feat` / `fix`
- **Scope**: `apps/cli` composer status line, web search answers
- **Key Deliverables**:
  - **Composer status**: The bottom row shows the active provider before the model as `provider | model`, including after switching connections.
  - **Search excerpts**: Direct web search answers state their excerpts plainly without listing sources or URLs.

### [v0.4.28] — 2026-10-15
**Fix: Organized help navigation and resilient chat recovery**
- **Type**: `feat` / `fix` / `patch-level`
- **Scope**: `apps/cli` help UI, chat session handling, release metadata
- **Key Deliverables**:
  - **Help organization**: Groups slash commands into Configuration, Workspace, Session, and Help sections with consistent ordering across chat output, the popup, and the modal.
  - **Keyboard ergonomics**: Aligns the `Up/Down` shortcut row with the other keyboard shortcuts and documents its slash-completion versus history behavior.
  - **Chat resilience**: Preserves interrupted streamed answers in the outer error path so failed turns can be checkpointed and resumed safely.
  - **Release readiness**: Syncs the publishable package metadata to `0.4.28` and updates the release documentation for the candidate.
