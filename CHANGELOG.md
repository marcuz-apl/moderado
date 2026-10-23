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
                                                       live reasoning in the status row,
                                                       multi-row activity log, summary panel,
                                                       answer scrollback, /transcript,
                                                       contained approval dialog,
                                                       multi-line run log,
                                                       one scrollable turn transcript,
                                                       /model lists local-provider catalogs,
                                                       popups repaint on terminal resize)
```

## Milestone Change Log Details

### [Unreleased] — 2026-10-23 (`/model` lists the local-provider catalog; popups survive a resize)

**Fix: `/model` offered no models at all for Ollama and LM Studio**

- **Type**: `fix` / `patch-level`
- **Scope**: `apps/cli` model selector, `packages/providers` presets, popup layer
- **Key Deliverables**:
  - **Discovery worked; the menu threw the result away.** `selectCompatibleModelOverlay` fetched the catalog correctly for both local runtimes and then handed it to `buildCompatibleModelMenuItems`, whose only non-Gateway branch is a *free/paid split*. A local runtime publishes no `pricing` and no `access`, so nothing was ever classified free, `freeCount` was `0`, and the split contributed zero rows. The user got "Enter a model ID", "Keep Current Model" and "Cancel" — the discovered models were unreachable, which reads exactly like "discovery does nothing with `/model`". Connecting worked because `provider_connect.ts` lists the fetched ids directly; `/model` never did.
  - **The split now falls back to a direct listing.** `listModelsDirectly` is set for the Gateway, for a provider the preset marks `local`, and for *any* provider whose catalog turns out to have no free endpoints at all — so the empty-side case can no longer hide a whole catalog. `ProviderPresetMeta` gains a declared `local` flag (Ollama, LM Studio) resolved through a new `isLocalProvider` accessor, keeping "is this local" a property of the preset rather than an id check at the call site.
  - **Local rows are labelled honestly.** `compatibleModelPopupItem` returns `Local` / "Served locally by {provider} · no key, no cost." instead of the meaningless "Price unknown" every entry would otherwise carry. The Gateway `auto` row is now emitted only when an `autoLabel` is supplied, so a local runtime is no longer offered Gateway routing.
  - **The failure diagnostic names the provider.** `Could not load the {provider} model list: …` replaces a bare network message, so an unreachable Ollama says *Ollama* rather than `connect ECONNREFUSED 127.0.0.1:11434`.
  - **Popups repaint on terminal resize.** `selectListPopup` had no resize listener: dragging the window corner left the box at its old width and centring, and the composer's own resize repaint cleared it off screen entirely until the next keypress — the popup looked like it had vanished. It now re-renders at the new geometry and detaches the listener on exit. The `/help` overlay and the manual model-ID prompt do the same.
  - **Coverage**: `model_selector_cloud.test.ts` gains four regression tests (Ollama lists every discovered model with no `auto`/free-browse row; LM Studio likewise; the exact selected id is returned; a hosted all-unfree catalog still lists directly) and the two local-provider diagnostic tests no longer hang on stdin. Full suite green.

### [Unreleased] — 2026-10-23 (the turn transcript is one scrollable list)
**Feature: the activity log no longer disappears when the answer starts streaming**

- **Type**: `feat` / `patch-level`
- **Scope**: `apps/cli` chat frame, transcript rendering, composer scrolling
- **Key Deliverables**:
  - **The log was traded away for the answer.** It lived in a six-row block inside the answer area, and the moment the first token streamed the block handed its rows back and the one-line status row took over. On a fix turn — where the agent reads files, runs the build, and then explains at length — that meant the whole interesting part was one clipped row. The log and the answer are now **one list**: `buildChatTranscriptRows` puts the activity log first and appends the wrapped answer after it, `windowChatTranscriptAt` windows the merged rows, and `renderChatTranscriptWindow` paints them in place. Nothing is surrendered, so the record of what the agent did and the answer it produced are read in one place and scroll together — the Cline model.
  - **The phase header is pinned, not competing.** `renderChatTranscriptHeader` paints one row on the status row: `⠋ Thinking · 12s`. Everything that row used to squeeze into itself now lives in the transcript below it.
  - **The scroll position is shared, not reset.** The composer owns the offset (PgUp/PgDn, three rows per wheel notch) and now reports it through `onTranscriptScroll`; the turn loop paints at the reader's offset instead of yanking them back to the tail on every streamed delta. `getChatActivity` lets the composer compute the scroll *range* over the merged rows. A new turn resets to the tail.
  - **Narrow terminals are clamped, not painted over.** `getChatTranscriptWidth` takes the narrower of the card's inner width and the real viewport, and the log, the answer, the overflow note and the header are all wrapped or truncated to it. The answer window it replaced wrapped to the card width and painted anyway, which spilled past the right border below ~45 columns.
  - **The scroll row tells the truth.** The window is computed and clamped first, so an offset that no longer hides anything reports the live view, and sitting at the very top reports `Top of the turn · ↓ N below` instead of claiming to be at the tail.
  - **Dead code removed:** `renderChatActivityBlock`, `clearChatActivityBlock`, `getChatActivityRows`, `ACTIVITY_BLOCK_MAX_ROWS`, `renderChatAnswerWindow` and `windowChatAnswer` are gone, along with the tests that pinned the old block's geometry. Their replacements cover the merged transcript.
  - **Coverage**: `welcome.test.ts` (log survives the answer; log and answer scroll as one list with a truthful status row; every width 20–200 × height 12–40 clamped to the card and never reaching the composer), full suite **71 files / 702 tests** green.

### [Unreleased] — 2026-10-23 (the run log is multi-line and scrollable)
**Feature: `moderado run` prints a readable log instead of one clipped row per event**

- **Type**: `feat` / `patch-level`
- **Scope**: `apps/cli` `TerminalRenderer`, `run` command
- **Key Deliverables**:
  - **The log used to erase itself.** `paintTaskStatus` repainted one row with `\r\x1b[K` and `clearTransientProgress` wiped it, so a phase was gone the instant the next one began — the reader lost the sentence they were halfway through, and there was nothing above it to scroll back to. The live row is now *committed*: when the engine reports a new phase the old row is settled in place (`✔ Thinking · 12s`) and a newline pushes it into the scrollback. Exactly one row is ever rewritten, and it is always the last row on screen, so nothing above it can be damaged.
  - **Tool output was one clipped line.** `lines[0].slice(0, 75)` hid an entire payload behind `… (+37 lines)`, and the first line of a payload is rarely the interesting one. Output is now wrapped to the terminal width and given up to five rows, continuation rows aligned under the text, followed by a footer naming exactly how much was left out. An empty result prints `(no output)` instead of a bare glyph.
  - **The clock used to freeze.** A single inference can run for minutes with no event of any kind, and a row stuck at `· 0s` reads as a hang. A one-second, unref'd timer now ticks the live row's elapsed time while a phase is open and stops the moment it is committed; `run.ts` releases it in a `finally`.
  - **Two phases that share a label are still two rows.** The commit is keyed on the raw engine status, not the short display label, so `Inferring…` and `Inferring next action…` both appear rather than collapsing into one spinner.
  - **Reasoning stays hidden** (existing contract), and every committed row ends with a newline, so the terminal's own scrollback — mouse wheel, slider, PgUp — reaches the whole turn.
  - **Coverage**: `renderer.test.ts` (+4: five wrapped rows plus footer, commit-on-phase-change, every entry newline-terminated, empty output), full suite **71 files / 701 tests** green.

### [Unreleased] — 2026-10-23 (approval dialog contained, auto-approve honoured)
**Fix: the permission dialog no longer overflows, and the toggle actually covers `run_command`**

- **Type**: `fix` / `patch-level`
- **Scope**: `apps/cli` approval dialog, width math, approval policy
- **Key Deliverables**:
  - **The dialog was one cell wider than its own frame.** `⚠` is a narrow glyph, but `⚠️` (U+26A0 U+FE0F) asks for emoji presentation and terminals draw it two cells wide; `displayWidth` counted one. Every border row of `⚠️ Permission Required: run_command` was therefore a cell short, and the box appeared to spill out of the workspace. Width math is now cluster-based: a base code point plus its variation selectors, with U+FE0F forcing two cells. `sliceToWidth` / `sliceTailToWidth` use the same clusters, so truncation cannot split a pair either.
  - **The dialog was appended below the frame.** It is written at the cursor, which sits on the composer row, so a 20-row dialog scrolled the whole workspace up and out. `TerminalApprovalHandler` now takes a `renderLayer` and composites the dialog over the dimmed chat frame (`renderWelcomePopupLayer`), with the prompt anchored to the bottom row; `chat.ts` supplies the layer for the length of the turn. Without a layer (tests, headless) the inline path is unchanged.
  - **Height is budgeted, not fixed.** The diff preview is `min(10, rows - 13)` lines, so a 20-row terminal shows seven and a short one shows only the `+N -M` counts. The key row falls back to `[Y] Approve  [a] Always  [n] Deny  [q] Quit` when the full row does not fit — truncation used to eat `[q]`, the one key a stuck user needs.
  - **Auto-approve covers `run_command`.** `decideApproval` exempted commands that reach the network, so `curl`, `wget` and any command containing a URL raised a prompt while the composer said "Auto-approve enabled". The toggle is a session-wide opt-in and now applies to every local tool; MCP tools stay gated because they are third-party code. `isNetworkCommand` remains as the tested definition of "this leaves the machine", no longer as a gate. `docs/SECURITY.md` says so.
  - **Coverage**: `box.test.ts` (U+FE0F width, emoji-titled dialog rows all equal), `terminal_approval.test.ts` (layer compositing, narrow-terminal key row, height-budgeted preview), `chat.test.ts` and `run_approval.test.ts` (auto-approve approves a network command; prompts when it is off).

### [Unreleased] — 2026-10-23 (readable reports: panel, scrollback, transcript)
**Feature: the turn summary gets its own panel, the answer scrolls, and the session can be read back**

- **Type**: `feat` / `patch-level`
- **Scope**: `apps/cli` answer rendering, composer, turn summary, help
- **Key Deliverables**:
  - **The report looked like more prose.** It was `**Turn summary**` followed by three bold headings, appended to the answer with nothing to separate it from the model's own words. It is now a fenced block (` ```summary `) that the answer renderer paints as a panel: an accent rail `▍`, a tinted background reaching the right edge of the card, warm bold headings and `·` bullets. `#`/`##`/`-` keep it valid markdown outside the CLI.
  - **The fence is resolved before wrapping.** `wrapAnswerLines` walks the source lines, strips the markers, wraps summary prose two cells early (the rail costs two), and prefixes every wrapped line with an invisible mark. A long bullet therefore keeps its band across continuations, and a block whose top scrolled away stays styled — the two failure modes of styling after wrapping.
  - **The answer scrolls.** PgUp/PgDn move the window a page at a time and the mouse wheel moves it three rows a notch; the status row becomes `↑ 8 above · ↓ 6 below · PgUp/PgDn`, and the overflow note reads `… +18 earlier lines hidden · PgUp`. `windowChatAnswerAt` clamps the offset to the real scroll range, so holding PgUp cannot scroll into empty space, and every new turn starts at the tail.
  - **Past turns are readable.** `/transcript` writes the whole conversation — every question, every answer, the summary unfenced into a `### Turn summary` heading — to `~/.moderado/transcripts/<workspace>-<stamp>.md` and opens it in `$PAGER` (or `less -R`), restoring raw mode, mouse reporting and the frame on exit. With no pager it prints the path instead of pretending it showed something.
  - **Help column realigned**: `/transcript` is the longest command, so the dash column moved from 11 to 13.
  - **Coverage**: `welcome.test.ts` (band colour and width, continuation markers, scroll clamping and the position row), `transcript.test.ts` (turn numbering, fence removal, tool-only turns, filename), `turn_summary.test.ts` (fence contract), `help_content.test.ts` (realigned column).

### [Unreleased] — 2026-10-23 (live activity block)
**Feature: the processing log gets rows of its own, Cline-style, and cannot overflow**

- **Type**: `feat` / `patch-level`
- **Scope**: `apps/cli` status row, answer area, turn loop
- **Key Deliverables**:
  - **Symptom**: everything a running turn had to say was squeezed into one clipped row — `⠋ Thinking · 12s · …checking whether the cache key` — because the status row was the only surface available. A thought long enough to matter became a single `…` tail, and the tool log did not exist at all.
  - **The answer area is empty while the agent works.** `renderChatActivityBlock` borrows it: a phase header on the status row, then the tool log and the newest reasoning, wrapped over up to six rows. The block starts where the one-line status starts, so the eye does not jump when the two swap, and it hands every row back the moment the first token streams.
  - **A real log, not a spinner.** `tool_call_initiated` pushes `⠼ Reading src/ui/welcome.ts`; `tool_result` settles it to `✔` (success), `⊘` (denied), or `✖` (error). The tail is kept — twenty entries, bottom-aligned — so the newest work is always the row nearest the phase.
  - **Reasoning is wrapped, not clipped.** Two columns of indent mark it as subordinate to the phase; the newest words survive when it does not fit.
  - **No overflow, by construction and by test.** Every row is cleared with `\x1b[2K` before it is written and clamped to `min(cardWidth, terminalWidth - startColumn + 1)` in terminal cells — the card has a 70-column floor, the screen does not. The block can never reach the composer row. `welcome.test.ts` asserts both bounds at 9 widths (20–200) × 4 heights (12–40) with a 20-entry log and CJK reasoning.
  - **Ten quiet seconds, then every twenty**: `describeWait` keeps `Thinking` for the first ten seconds of silence — that is normal inference — then switches the phase to `Waiting on the model` and re-announces with `no output for 30s`, `no output for 50s`. The bucket is quantised to the repeat cadence so the row changes every twenty seconds instead of every repaint. Any real event ends it.
  - **Clock before message**: `⠋ Thinking · 12s · checking whether…`. The timer belongs to the phase, so the trailing text is what gets cut.
  - **The settled row lands where the live one was.** A wrapped question pushes the status row down; the turn-end repaint used to write to the default row 13 regardless. It now passes `layout.statusRow`, and a tool-only turn clears the block before settling instead of leaving six stale log rows under it.

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
