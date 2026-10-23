# Changelog

## Semantic Version Progression

```text
v0.4.28 (Help organization and interrupted-chat resilience)
  └─► v0.4.29 (Provider in status row, clearer search excerpts)
        └─► v0.4.30 (Moderado provider identity and endpoint)
              └─► v0.4.31 (Gateway auth recovery, live progress row)
                    └─► v0.4.32 (Short `modr` command alias)
                          └─► v0.4.33 (Approval boundary and width fixes)
                                └─► v0.4.34 (No frozen CLI — Ctrl+C always escapes)
                                      └─► Unreleased (Turn summary, bounded answer area, one-step Moderado connect,
                                                      jail canonicalization, chat/UI module split,
                                                      live reasoning in the status row)
```

## Milestone Change Log Details

### [Unreleased] — 2026-10-23 (three field fixes)
**Fix: wide text, oversized approval prompts, and approvals denied by Enter**

- **Type**: `fix` / `patch-level`
- **Scope**: `apps/cli` status row, box renderer, approval prompt
- **Key Deliverables**:
  - **Status row overflowed the card with CJK text.** The row clipped with `String#slice`, which counts UTF-16 units; a Chinese reasoning tail is two cells per glyph, so the line reached 109 cells in a 98-cell card, wrapped, and landed left of the frame. `sliceToWidth` / `sliceTailToWidth` / `truncateToWidth` in `ui/box.ts` clamp by terminal cells and copy ANSI sequences without counting them, and `elideMiddle` now measures cells too.
  - **The permission box grew past the workspace.** `renderBox` had no width ceiling: one long diff line widened the box past the terminal, wrapping the whole prompt. It now takes `maxWidth` (the whole box, borders included), truncates content to fit while re-asserting the colour reset, and keeps borders aligned. `TerminalApprovalHandler` passes the terminal width, caps the preview at 10 lines, and replaces the rest with `+N -M, K more lines` / `… K more lines not shown`.
  - **The box also stayed painted over the frame.** The prompt writes straight to stdout, so it used to sit on top of the chat card until the next answer paint; `chat.ts` now repaints the frame on `approval_resolved`.
  - **Enter denied the action.** The box advertised a capitalised default (`[y/A/n/q]`) while the code fell through to `denied` on empty input — which is how an ordinary `npx tailwindcss init -p` looked like a permissions bug. Enter now approves once (matching the advertised default), `a` still means always, `n` denies, and an unrecognised key re-asks instead of denying silently.
  - **Fails closed on a closed stream.** A stream that ends without a newline resolves like a bare Enter, so `prompt` reports it distinctly and the handler aborts rather than auto-approving an unattended session.
  - **Coverage**: `box.test.ts` (cell-based clamping, `maxWidth` at 40/50/60/80, aligned borders), `terminal_approval.test.ts` (Enter approves, EOF aborts, typo re-asks, box fits a 50-column terminal with a 40-line diff), `welcome.test.ts` (CJK reasoning stays inside the card at three widths).

### [Unreleased] — 2026-10-23 (live status row)
**Feature: the status row shows what the agent is doing, not its step counter**

- **Type**: `feat` / `patch-level`
- **Scope**: `apps/cli` chat status row and terminal renderer
- **Key Deliverables**:
  - **Symptom**: with reasoning hidden, a running turn printed `Step 1/25` and then sat still until text streamed. The counter read `Step 1/25` for minutes at a time while one inference ran, so it described the engine's loop rather than anything the reader could act on.
  - **The counter is gone.** `renderChatThoughtTimeUpdate` no longer takes a step budget, and `TerminalRenderer.paintTaskStatus` no longer prints `Processing task… Step N/M`.
  - **Tool targets instead of tool names**: `describeToolActivity` reads the call's parameters and names the work — `Reading apps/cli/src/chat.ts`, `Editing 3 files`, `Running npm test`, `Searching "renderChat"`, `Listing src/ui`. Unknown and MCP tools keep their own name rather than inventing a verb.
  - **Elapsed time in human units**: `8s`, `1m 04s`, `12m 30s`. The timer is reserved before the label gets any room, and a deep path is elided in the middle, so the verb, the filename and the clock all survive on one row.
  - **Honest long-wait state**: after 20 seconds with no event at all the phase becomes `Waiting on the model` instead of a frozen `Thinking`, and the reasoning tail stays visible through it.
  - **Reasoning preview**: `reasoning_delta` keeps a bounded 240-character tail and repaints the row at most every 100ms; the row keeps the newest words and truncates from the left. Cleared the moment the answer starts streaming, so it never competes with the answer area.
  - **Not a transcript**: reasoning is never accumulated for display and is not written to the conversation — one dim line, clipped to the card width.
  - **Coverage**: `welcome.test.ts` pins the phase map, the tool-target map, elapsed formatting, middle elision and card-width clipping; `renderer.test.ts` pins that the headless renderer shows the phase and no counter.
  - **Coverage**: `welcome.test.ts` pins the phase mapping, the de-duplicated step counter, the left-truncating tail and that the painted row stays inside the card.

### [Unreleased] — 2026-10-23 (repeat-question fix)
**Fix: a stopped task was replayed as if it were an answer**

- **Type**: `fix` / `patch-level`
- **Scope**: `apps/cli` chat session
- **Key Deliverables**:
  - **Symptom**: after a task was interrupted, asking the same question again returned the interruption notice verbatim (`[This task was interrupted before a response was produced. …]` or `Task stopped.`) instead of a real answer.
  - **Cause**: the consecutive-repeat cache in `handleChatSession` replayed `lastAnswer` whenever the new question matched the previous one. It only checked that the string was non-empty — but after a cancelled or failed turn `lastAnswer` holds a status note, and after resuming an interrupted session `restoreLastSessionTurn` restores that note as the last answer. So the note was served as a cache hit and the provider was never called.
  - **Fix**: `lastAnswerReplayable` tracks whether `lastAnswer` is a genuine answer. It is set only when a turn completes, or when a failed turn still produced usable web-search evidence, and cleared at turn start, on cancellation, on failure, on a budget stop, and when restoring an interrupted session. The cache now requires it, so a stopped task is re-asked rather than replayed. A successful repeated question is still replayed instantly — the cache itself is unchanged.
  - **Coverage**: `chat_replay.test.ts` asserts the provider is called again after a failed turn and after resuming an interrupted session, and that a genuinely answered repeated question is still served from the cache. All three fail without the flag except the last, which pins the existing behaviour.

### [Unreleased] — 2026-10-23 (structure pass)
**Refactor: split the two oversized modules; stop re-canonicalizing the jail root**

- **Type**: `refactor` + `perf` / `patch-level`
- **Scope**: `apps/cli` chat command and welcome UI, `packages/tools` jail and tools
- **Key Deliverables**:
  - **One canonicalization per operation**: `resolveInJail` re-ran `canonicalizeRoot` (exists/stat/realpath) on every call, so a caller resolving N paths paid a syscall pair per path. It is now a one-line wrapper over `resolveInJailFromRoot(canonicalRoot, path)`, which keeps every check unchanged; checkpoint `paths`/`capture`/`recordPostWrite`/`restore`, `git_diff`'s per-file validation and `apply_patch`'s `edits` canonicalize once and loop. `TurnRecorder` resolves its root once per turn, and `detectWebApp` once per scan. Single-path tools stay on `resolveInJail` — one or two calls per invocation leaves nothing to amortize, and the self-contained form is the safer API. A cache on the security boundary was still not added.
  - **`commands/chat.ts` 1965 → 1615 lines**: command routing (`chat_slash.ts`), local meta queries (`chat_meta.ts`), web-search routing (`chat_search.ts`) and turn outcomes (`chat_outcome.ts`) moved out and are re-exported, so `commands/chat.js` remains the single import surface. The file keeps the turn loop and the wiring.
  - **`ui/welcome.ts` 1477 → 772 lines**: the interactive composer loop moved to `ui/composer.ts` (731 lines), sliced byte-exactly rather than retyped. `MOUSE_REPORT_*` stay in `welcome.ts` because `exitCleanly` writes `MOUSE_REPORT_OFF`; keeping them in the composer would have made the pair circular.
  - **Test wiring**: a spy on a re-export does not change the original binding, so the three composer tests now import and spy `ui/composer.js`, which is also where `commands/chat.ts` imports `promptInteractiveTurn`. Their teardowns also swallow a refused `rmSync`, so a sandbox that blocks temp deletes reports assertions instead of teardown failures.

### [Unreleased] — 2026-10-23 (hardening pass)
**Fix: the `@` completion list, protected-path precision, and evidence for failed turns**

- **Type**: `fix` / `patch-level`
- **Scope**: `apps/cli` composer and diagnostic logs, `packages/tools` jail, docs
- **Key Deliverables**:
  - **`@` completion works again**: the interactive composer maintained a mention selection and reserved rows for it, but never passed `mentionFiles`/`mentionSelection` to the card, so the list was never painted and `Up`/`Down`/`Tab` operated on an invisible list. Both fields are now part of the composer options, and `welcome.test.ts` asserts the list is painted and the caret stays on the input row.
  - **Protected paths are exact**: the blacklist matched any segment starting with `id_`, so a legitimate `id_notes.md` could not be read or written at all. It now matches the SSH key names (`id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, with an optional suffix such as `.pub`). `docs/SECURITY.md` no longer claims `*secret*`/`*credential*` matching the code never had.
  - **Failed turns leave evidence**: a turn that fails without throwing — the loop reports a status plus an `error` event — reached neither the diagnostic log nor any support report. `chat` and `run` now append a redacted record to `~/.moderado/logs/moderado.jsonl`; a cancelled turn is user intent and is not logged.
  - **Measured, not assumed**: `resolveInJail` re-canonicalizes the jail root on every call (13.7 µs per call, 6.5 µs of it canonicalization). Call sites are one or two per tool invocation and directory walks do not call it per entry, so the saving is noise — a cache on the security boundary was deliberately not added. (The cost was later removed structurally instead; see the structure pass above.)

### [Unreleased] — 2026-10-23
**Fix: end-of-turn report, contained answer area, and a Moderado connect flow that stops interrogating**

- **Type**: `fix` / `patch-level`
- **Scope**: `apps/cli` chat layout, turn reporting, Moderado login, session redaction, docs
- **Key Deliverables**:
  - **Turn summary**: A turn that changed files or ran commands now ends with a report built from the event stream: what was added/updated/run, what verification passed, what is left over (denials, failures, unverified edits, step-limit), and — for a web app — the exact start command and URL. Shown in chat and by `moderado run`. `apps/cli/src/turn_summary.ts`.
  - **Contained answer area**: The chat frame now derives one fixed geometry (`getChatLayout`) shared by the frame, the streamed-answer painter, and the status rows. Long output is windowed to the rows between the status row and the composer, with a `+N earlier lines hidden` marker, so it can no longer overwrite the input card, mode row, or workspace row, and the frame never exceeds the viewport. The old streamed writer (absolute rows, character-counted wrapping, 2-row offset from the settled frame) is replaced by `renderChatAnswerWindow`.
  - **Composer-aware geometry**: The composer is measured before the layout (`getChatComposerRows`), so a queued-commands box or mention box that grows the card takes its rows from the answer area instead of pushing the frame past the viewport. Every settled frame goes through one `paintStaticChatFrame` helper in `chat.ts` (previously ~10 copies of the same options object, each positioning the caret with a relative `4A` that was wrong for a taller card), and `promptInteractiveTurn` anchors the caret on the composer's real input row in chat mode. `renderChatScreen` also clamps the frame as a hard guarantee, so no content can ever reach the bottom row.
  - **Moderado connect**: `/connect` → Moderado no longer asks for a provider name, base URL, or API key it can derive. The Gateway URL comes from `MODERADO_BASE_URL`, the configured Gateway, the saved profile, or a one-time Prod/Dev choice; a saved `mrd_…` key is reused silently; otherwise the user picks browser sign-in (the existing loopback OAuth flow, previously never called) or a pasted key. A rejected credential is not offered again (`forceReauthenticate`).
  - **Secret redaction**: Session exports and diagnostic logs now redact `mrd_…` Gateway keys and `Bearer` tokens, not just NVIDIA/OpenAI keys.
  - **Docs**: `docs/GUIDE.md` documents the turn summary, the bounded answer area, and the new connect flow.

### [v0.4.34] — 2026-10-21
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
