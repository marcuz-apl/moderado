# Moderado Project Handoff

Updated: 2026-10-23 (summary panel, answer scrollback, /transcript)
Branch: master (tracking origin/master)
Status: everything through the three field fixes is committed (`2a6b001`,
`v0.4.34+261023c`). **Two change sets are in the working tree, uncommitted**:
the multi-row activity log + wait notice, and the summary panel + scrollback +
`/transcript`. Build clean, affected suites green.

## Session 2026-10-23 — readable reports (panel, scrollback, transcript)

Follow-up to two questions: the turn summary ran past one page with no way back,
and it looked like more prose.

### The summary is a panel

`formatTurnSummary(..., 'chat')` now emits a fenced block:

```
```summary
# Turn summary
## Done
- Added `src/App.jsx`
```

`wrapAnswerLines` (in `ui/welcome.ts`) strips the fence and prefixes every
wrapped line with `SUMMARY_MARK` (`\u0001`); `renderAnswerLine` turns a marked
line into a band — rail `▍`, `48;5;236` background padded to the card edge, warm
bold headings. Resolving the fence *before* wrapping is the whole trick: a long
bullet keeps its band across continuations, and a block whose top scrolled away
stays styled.

### The answer scrolls

- `windowChatAnswerAt(text, maxRows, textWidth, offset)` — offset measured in
  rows up from the tail, clamped to the real range. `windowChatAnswer` is now a
  wrapper with offset 0.
- `WelcomeLayoutOptions.chatAnswerOffset` flows through both painters.
- Composer: PgUp/PgDn by a page, wheel by 3 rows, status row shows
  `↑ 8 above · ↓ 6 below · PgUp/PgDn`.

### Past turns

`/transcript` → `src/transcript.ts` writes
`~/.moderado/transcripts/<workspace>-<stamp>.md` (summary unfenced into
`### Turn summary`) and opens it in `$PAGER`/`less -R`, restoring raw mode, mouse
reporting and the frame afterwards. Wired through
`PromptInteractiveTurnOptions.onTranscript`; `chat.ts` supplies the history.

Note: `/transcript` is 11 characters, so `getHelpCommandLines` pads to 13 now.

## Session 2026-10-23 — the processing log gets rows (Cline-style)

Follow-up to "the processing message is squeezed into one line".

### What Cline does that we did not

Cline renders the turn as a short live log in the transcript area: a phase
header with a spinner and a clock, indented sub-lines for each tool call with a
✓/✗ when it settles, and the model's current thought wrapped over several rows.
The block collapses into the answer once text streams. We had one clipped row.

### What changed

- `renderChatActivityBlock` / `clearChatActivityBlock` / `getChatActivityRows` /
  `ActivityEntry` / `ChatActivityBlock` in `ui/welcome.ts`.
- The block starts at `layout.statusRow` — the same row the one-line status
  uses — and runs to `composerTop - 2`, capped at `ACTIVITY_BLOCK_MAX_ROWS = 6`.
  It only paints while `streamedAnswer` is empty, so it borrows the empty answer
  area for free and returns it on the first token.
- `chat.ts` keeps `activityHistory` (20 entries) and `activityBlockPainted`.
  `tool_call_initiated` pushes `⠼ <verb> <target>`; `tool_result` settles the
  entry to `✔` / `⊘` / `✖`. `paintActivity` picks block vs one-liner per frame.
- `describeWait` (10s quiet → `Waiting on the model`, then every 20s with
  `no output for 30s`); `chat.ts` tracks `lastEventAt` and `waitElapsedLabel`.
- The settled row at turn end now passes `layout.statusRow` instead of the
  default row 13, and a tool-only turn clears the block before settling.

### Overflow guarantees

Every row is `\x1b[2K`-cleared then written with `truncateToWidth` to
`min(cardWidth, terminalWidth - startColumn + 1)` cells — the card has a
70-column floor, the screen does not. `ChatLayout` gained `terminalWidth` for
exactly this. The test asserts both the row bounds and the cell bounds at 9
widths × 4 heights with CJK reasoning and a 20-entry log.

## Session 2026-10-23 — three field fixes (from a real weather-app run)

Reported after building a React/Tailwind/OpenStreetMap app with the CLI.

### 1. Wide text escaped the frame

The status row clipped with `String#slice`, which counts UTF-16 units. A CJK
reasoning tail is two cells per glyph: measured 109 cells in a 98-cell card, so
the terminal wrapped it onto the next row, left of the card.

- `sliceToWidth` / `sliceTailToWidth` / `truncateToWidth` in `ui/box.ts` clamp by
  cells and pass ANSI sequences through uncounted.
- `elideMiddle` and the status row now measure cells; the timer width is still
  reserved first, so the clock survives the clip.

### 2. The permission prompt overflowed the workspace

- `renderBox` gained `maxWidth` — the whole box, borders included. Content is
  truncated to fit with the colour reset re-asserted, so borders stay aligned.
- `TerminalApprovalHandler` passes the terminal width (capped at 100), shows at
  most 10 diff lines, and summarises the rest as `+N -M, K more lines`.
- The prompt writes straight to stdout and used to sit on top of the chat card;
  `chat.ts` now repaints the frame on `approval_resolved`.

### 3. `npx tailwindcss init -p` was denied

The box advertised `[y/A/n/q]` — a capitalised default — but the code fell
through to `denied` on empty input, so a bare Enter denied the command.

- Enter now approves once, `a` = always, `n` = deny, `q` = quit.
- An unrecognised key re-asks instead of denying silently.
- A closed stdin resolves like a bare Enter, so `prompt` reports `NO_INPUT`
  separately and the handler aborts — an unattended session must not become an
  auto-approver.

### Verification

`tsc -b --force` clean; `apps/cli/tests` **41 files / 437 tests, 0 failures**.
`packages/*` were not re-run: this change touches only `apps/cli`.

## Session 2026-10-23 — status row v2

### Summary

Reported, after the first pass: the row still showed `1/25 steps`, which is
plain and gives a waiting user nothing to read. Removed the counter entirely and
replaced it with the work itself.

### Completed

- **Step counter removed**: `renderChatThoughtTimeUpdate` no longer takes a
  step budget, and `TerminalRenderer.paintTaskStatus` no longer prints
  `Processing task… Step N/M`. `Step 1/25` was true for minutes at a time while
  one inference ran, so it measured the engine's loop, not the user's wait.
- **Tool targets**: `describeToolActivity(toolName, parameters)` names the work
  — `Reading apps/cli/src/chat.ts`, `Editing 3 files`, `Running npm test`,
  `Searching "renderChat"`, `Listing src/ui`. Unknown and MCP tools keep their
  name rather than inventing a verb.
- **Elapsed in human units**: `8s`, `1m 04s`, `12m 30s` (`formatElapsed`). The
  timer width is reserved before the label gets room, and a deep path is elided
  in the middle (`elideMiddle`), so verb + filename + clock all survive.
- **Honest long wait**: after 20s with no event, the phase becomes
  `Waiting on the model` instead of a frozen `Thinking`, and the reasoning tail
  stays visible through it.
- **Reasoning preview** (unchanged in spirit): 240-character tail, repaint at
  most every 100ms, cleared on the first `assistant_delta`.

Example rows at width 100:

```text
⠋ Thinking · 3s
⠋ Waiting on the model · 22s
⠼ Reading apps/cli/src/ui/welcome.ts · 41s
⠴ Running npm test · 1m 15s
⠦ Editing 3 files · 1m 34s
⠇ Thinking · …e key may not include the model id, so a retry could replay… · 2m 08s
✔ Done · 2m 20s
```

### Verification

`tsc -b --force` clean. `apps/cli/tests` **41 files / 430 tests, 0 failures**.
The `packages/*` suites were not re-run because this change touches only
`apps/cli`; run the full suite once before a release.

### Notes

- The build counter in `VERSION` is hexadecimal and is stamped by
  `.githooks/pre-commit` + `commit-msg`; a subject typed as `+2610240` is
  rewritten to `+261023a`. Let the hooks stamp it rather than computing it.

## Session 2026-10-23 — live status row (first pass)

### Summary

Reported: with reasoning hidden, a running turn showed `Step 1/25` and then sat
still, which reads as a hung CLI rather than a thinking one.

### Completed

- **Phase label**: `describeActivity` (`ui/welcome.ts`) collapses the engine's
  progress sentence into a short phase — `Inferring next action…` becomes
  `Thinking`, plus `Selecting model`, `Retrying request`, `Delegating a
  sub-task`. `renderChatThoughtTimeUpdate` also strips a leading `Step n/m:`
  from the label, so the counter no longer prints twice.
- **Reasoning preview**: `reasoning_delta` appends to a 240-character tail and
  repaints at most every 100ms. `ChatActivity.reasoning` is only set during the
  `Thinking` phase; the renderer keeps the newest words and truncates from the
  left, then clips the finished line to the card width.
- **Phase progression**: `Thinking` → `Writing` → `Running <tool>` →
  `Reviewing`. The tail is cleared on the first `assistant_delta`, so the row
  never competes with the answer area.
- **Not a transcript**: reasoning is never accumulated for display and is not
  written to the conversation.

### Verification

`tsc -b --force` clean. Full suite 70 files / 672 tests. The first full run
timed out eight workers (`[vitest-worker]: Timeout calling "fetch" with
["/@vite/env","ssr"]`, machine-load related, no assertion failures); all eight
files were then run directly and pass.

### Notes

- The build counter in `VERSION` is hexadecimal and is stamped by
  `.githooks/pre-commit` + `commit-msg`; a subject typed as `+2610240` is
  rewritten to `+261023a`. Let the hooks stamp it rather than computing it.

## Session 2026-10-23 — repeat-question fix

### Summary

Reported: after stopping a task, asking the same question again returned the
interruption notice verbatim instead of an answer.

### Completed

- **Cause**: `handleChatSession` has a consecutive-repeat cache that replays
  `lastAnswer` when the new question matches the previous one. It only checked
  that the string was non-empty. After a cancelled or failed turn `lastAnswer`
  holds a status note (`Task stopped.`, or the `[This task was interrupted…]`
  marker written by `saveFailedTurnPrompt`), and after resuming an interrupted
  session `restoreLastSessionTurn` restores that marker as the last answer. The
  note was therefore served as a cache hit and the provider was never called.
- **Fix**: a `lastAnswerReplayable` flag records whether `lastAnswer` is a
  genuine answer. Set only when a turn completes, or when a failed turn still
  produced usable web-search evidence; cleared at turn start, on cancellation,
  on failure, on a budget stop, and when restoring an interrupted session. The
  cache requires it. The cache itself is unchanged, so a genuinely answered
  repeated question is still replayed instantly.
- **Coverage**: `apps/cli/tests/chat_replay.test.ts` — the provider is called
  again after a failed turn and after resuming an interrupted session, and a
  repeated question that *was* answered is still served from the cache. The two
  bug cases fail without the flag; the third pins the existing behaviour.

### Verification

`tsc -b --force` clean; full suite 70 files / 671 tests pass. Committed as
`8503342` (`v0.4.34+2610238`) and pushed.

## Session 2026-10-23 — structure pass

### Summary

Two review items: remove the redundant root canonicalization in the workspace
jail, and split the two oversized modules. Each was built and tested before
moving on.

### Completed

- **One canonicalization per operation (`packages/tools`)**: `resolveInJail`
  re-ran `canonicalizeRoot` (exists + stat + realpath) on every call. It is now
  a one-line wrapper over the new `resolveInJailFromRoot(canonicalRoot, path)`,
  which keeps every check — empty path, traversal, symlink escape, protected
  path — byte for byte. Converted the real per-path loops: checkpoint
  `paths`/`capture`/`recordPostWrite`/`restore`, `git_diff`'s `filePaths`
  validation, `apply_patch`'s `edits` (both `preview` and `execute`).
  `TurnRecorder` resolves its root once per turn instead of once per tool call,
  and `detectWebApp` canonicalizes once per scan instead of twice per candidate
  directory. Single-path tools (`read_file`, `write_file`, `edit_file`,
  `list_files`, `search_files`, `run_command`) stay on `resolveInJail`: one or
  two calls per invocation leaves nothing to amortize, and the self-contained
  form is the safer API. `jail.test.ts` asserts the canonical-root resolver
  returns the identical path and still throws for `../escape.txt`, `.env`,
  `.git/config` and `''`.
- **`commands/chat.ts` 1965 → 1615 lines**: `chat_slash.ts` (command list, edit
  distance, typo advice), `chat_meta.ts` (local session questions and the
  network-command predicate), `chat_search.ts` (web-search routing and evidence
  shaping) and `chat_outcome.ts` (failure formatting, answer resolution,
  interrupted-prompt bookkeeping, exit/share/cancel predicates). All four are
  re-exported from `chat.ts`, so `commands/chat.js` stays the single import
  surface the tests rely on; the symbols still used inside `chat.ts` are also
  imported explicitly, because `export *` does not put names in local scope.
  `chat.ts` keeps the turn loop and the wiring.
- **`ui/welcome.ts` 1477 → 772 lines**: the interactive composer
  (`InteractiveTurnResult`, `PromptInteractiveTurnOptions`, `isMcpCommandInput`,
  `promptInteractiveTurn`) moved to `ui/composer.ts` (731 lines). Moved by
  byte-exact slicing, not retyped. `MOUSE_REPORT_PATTERN/ON/OFF` stay in
  `welcome.ts` because `exitCleanly` writes `MOUSE_REPORT_OFF`; putting them in
  the composer would have made the pair circular. `composerInputWindow` is now
  exported from `welcome.ts` — both modules use it.
- **Test wiring**: a spy on a re-export does not change the original binding, so
  `chat_resize.test.ts`, `chat_usage.test.ts` and `welcome.test.ts` now import
  and spy `ui/composer.js`, which is also where `chat.ts` imports
  `promptInteractiveTurn` from. Those three teardowns, plus
  `turn_summary.test.ts`, now swallow a refused `rmSync` — a sandbox that blocks
  temp deletes was failing assertions that had already passed.

### Verification

`tsc -b --force` clean; full suite 69 files / 668 tests pass, run once after the
last edit. Committed as `e591cb2` (`v0.4.34+2610234`) and `5276f49`
(`v0.4.34+2610235`), both pushed.

### Next action

Nothing outstanding from the review list. Three things worth knowing before the
next session:

1. **Running the test suite repeatedly in this sandbox kills the shell.** Each
   denied file delete adds a rule to the profile passed to `sandbox-exec`; it
   grows past the 65535-byte argument limit and then every command fails
   (`echo`, `tsc`, `git`, and `Grep`, which shells out to ripgrep) while
   `Read`/`Write`/`Edit`/`Glob` keep working. Restarting the session clears it.
2. **Git cannot rewrite `.git/index` here** ("unable to write new index file").
   The failed attempt leaves `.git/index.lock` behind; move it aside with
   `node -e "fs.renameSync('.git/index.lock', '/tmp/…')"` and retry, or grant
   the permission.
3. Test runs in a restricted sandbox can leave 4-byte `blat` placeholders in
   the repo root; the twelve from this session were cleared, so the tracked tree
   and the untracked set are both empty. If more appear, they are safe to move
   aside — but check size and content first, and never glob a delete.

## Session 2026-10-23 — hardening pass

### Summary

The review items from the previous session, worked one at a time with a build
and test cycle after each.

### Completed

- **`@` completion restored (`ui/welcome.ts`)**: `promptInteractiveTurn` kept a
  mention selection, reserved rows for the list, and bound Up/Down/Tab to it,
  but `getOptions()` never passed `mentionFiles`/`mentionSelection` to
  `renderWelcomeCard`, so the list was never painted. Both fields are now part
  of the composer options. `welcome.test.ts` drives a real composer turn with an
  `@ap` token, asserts the list is painted, and asserts the caret row still
  matches the input line after the card grows.
- **Protected-path precision (`packages/tools/src/jail.ts`)**: `/^id_[a-zA-Z0-9_]+/i`
  blocked any file starting with `id_` — `id_notes.md` could not be read or
  written. Now `/^id_(rsa|dsa|ecdsa|ed25519)(\.[a-zA-Z0-9]+)?$/i`, covered by
  `jail.test.ts` (SSH keys still blocked, ordinary `id_*` files allowed).
  `docs/SECURITY.md` was corrected: it claimed `*secret*`/`*credential*`
  matching that the code never implemented.
- **Failed turns are logged (`commands/chat.ts`, `commands/run.ts`)**: only a
  fatal error escaping `main()` reached `writeDiagnosticLog`. A turn that fails
  as a status plus an `error` event left no evidence. Both paths now append a
  redacted record (`chat.turn`, `run.turn`); cancelled turns are not logged.
- **Rejected after measurement**: memoizing `canonicalizeRoot` inside
  `resolveInJail`. Benchmarked at 13.7 µs per `resolveInJail` call (6.5 µs of it
  canonicalization); call sites are one or two per tool invocation and the
  directory walk in `list_files` does not call it per entry. A cache on the
  security boundary would buy nothing measurable.

### Verification

`tsc -b --force` clean; full suite 69 files / 667 tests pass.

### Next action

Done: committed as `eecf296` (VERSION auto-bumped to `v0.4.34+2610232` by the
pre-commit hook) and pushed to `origin/master`. Remaining known item:
`commands/chat.ts` (~2k lines) and `ui/welcome.ts` (~1.5k lines) still mix
routing, execution, and rendering; splitting them is a refactor with no
user-visible payoff and should be scheduled on its own.

## Session 2026-10-23 — three reported glitches fixed

### Summary

Three user-reported defects, fixed against the code rather than `HANDOFF.md`:

1. **No end-of-turn report** — a finished coding task ended silently.
2. **Runaway output damaged the layout** — long answers painted over the input
   card and pushed the bottom rows off screen.
3. **`/connect` → Moderado interrogated the user** — it asked for a provider,
   base URL, and API key it already had.

### Completed

- **Turn summary (`apps/cli/src/turn_summary.ts`, new)**: `TurnRecorder` turns
  the agent event stream into a deterministic report — files created/modified,
  commands run with exit codes, checks that passed, denials, failures, and a
  "no verification followed these edits" note. `detectWebApp` walks the changed
  paths for a framework (`next`, `nuxt`, `remix`, `astro`, `vite`, `sveltekit`,
  CRA, parcel, angular, or a bare `index.html`) and reports the start command
  and URL. Moderado never holds a dev server in the foreground, so the report
  prints the command; when `run_command` already started one, its `serverUrl` is
  reused. Rendered in `commands/chat.ts` (markdown, inside the answer area) and
  `commands/run.ts` (ANSI bullets).
- **Bounded answer area (`ui/welcome.ts`, `commands/chat.ts`)**: one geometry
  (`getChatLayout`) now drives the settled frame, the streamed painter
  (`renderChatAnswerWindow`), the status row, and the caret. `getChatComposerRows`
  measures the real composer — queued-commands box, mention box, suggestions box
  — before the layout, so a taller card takes rows from the answer area instead
  of pushing the frame past the viewport; `renderChatScreen` pads/truncates to
  `composerTop - 1` as a final guarantee. Long answers window to the newest
  lines with a `… +N earlier lines hidden` marker. `renderChatAnswerDelta` and
  `ChatAnswerPosition` are gone. `chat.ts` lost ~10 duplicated
  `renderFullWelcomeScreen({...})` blocks in favour of `chatFrameOptions` /
  `layoutFor` / `paintStaticChatFrame`, and `promptInteractiveTurn` anchors the
  caret on the composer's real input row.
- **One-step Moderado connect (`ui/provider_connect.ts`)**: the Gateway URL is
  derived (`MODERADO_BASE_URL` → option → saved profile → active connection →
  one-time Prod/Dev choice), a saved `mrd_…` key is reused silently, and the
  loopback browser OAuth that already existed is finally offered. No provider
  name, base URL, or mode prompt; a rejected credential is not offered twice
  (`forceReauthenticate`).
- **Secret redaction (`sessions.ts`, `diagnostic_log.ts`)**: `mrd_…` keys and
  `Bearer …` tokens are redacted in session exports and diagnostic logs.
- **Docs**: `docs/GUIDE.md` documents the turn summary, the composer-aware answer
  area, and the new connect flow; `CHANGELOG.md` carries the Unreleased entry.

### Verification

`npm run build` (tsc -b --force) and the full Vitest suite pass — 69 files /
665 tests at the time of the commit (667 after the hardening pass). An earlier
attempt was blocked when the shell sandbox failed session-wide
(`sandbox-exec: data object length … exceeds maximum`); it recovered before the
commit, so the last `getChatLayout` change and the queued-commands test were
verified rather than only reviewed.

### Next action

Done: committed as `1d36247` and pushed to `origin/master`. Continue with the
hardening pass below.

## Session 2026-10-21 — v0.4.33 release preparation

### Summary

Full-codebase review ahead of the next release. Five defects were fixed, the
offline suite was made deterministic on Windows, and every document was synced
to the current version.

### Completed

- **Approval boundary (`apps/cli/src/commands/run.ts`)**: `moderado run`
  auto-approved every mutating tool regardless of `--auto-approve`, so `-y` was
  dead and `write_file`/`run_command` never prompted. It now shares
  `decideApproval` with chat: interactive by default, `-y` to skip, network
  commands and MCP always prompt, and a non-TTY session denies with guidance
  instead of blocking on stdin. `createRunApprovalHandler` is covered by
  `apps/cli/tests/run_approval.test.ts`.
- **Routing preferences (`run.ts`)**: `args.allowPaid ?? config.allowPaid` could
  never read the saved value because the flag is a boolean. Flags now OR with
  the persisted preference.
- **Composer mentions (`ui/file_mentions.ts`)**: expansion is index-based, so a
  repeated `@token` no longer rewrites the first occurrence, and file content
  containing `$&`/`$1` is inserted literally.
- **Wide-glyph layout (`ui/box.ts`, `ui/welcome.ts`, `ui/popup.ts`)**: new
  `displayWidth` counts CJK/emoji as two cells and combining marks as zero;
  box padding, popup width, and `wrapText` use it.
- **Test harness**: `testTimeout`/`hookTimeout` raised to 30s; `run_command`
  success paths allow 20s (process creation costs 0.5-3s on Windows);
  `install_script` cases allow 60s; temp-directory cleanup in the git, install,
  and self-update suites tolerates sandboxed-fs trash timeouts.
- **Housekeeping**: deleted the unused `interactive_menu` command, removed a BOM
  from `sessions.ts`, stopped `moderado models` from prompting on a non-TTY
  stdin, and documented `--provider`/`--connectivity` in `--help`.
- **Docs**: CHANGELOG now covers v0.4.29-v0.4.33; README, CLI README, GUIDE,
  RELEASING, DISTRIBUTION, and ARCHITECTURE are synced to 0.4.33; every
  `file:///d:/...` link is repository-relative; ARCHITECTURE no longer claims a
  `SessionStateMachine` that does not exist.
- **Verification**: `npm run build`, `npm run typecheck`, `npm test`
  (66 files, exit 0), and `npm run verify:package` pass.

### Decision recorded

Interactive chat keeps starting with auto-approve enabled (asserted by
`welcome.test.ts`). Documentation now states that default and the `Shift+Tab`
toggle instead of claiming every write prompts.

### Next action

Tag `v0.4.33` (`cut -d+ -f1 VERSION`) and run the guarded publish workflow when
the release is approved. No code work is pending.

## Session 2026-10-15 — v0.4.28 release preparation

- Added `CHANGELOG.md` with the curated v0.4.28 milestone entry.
- Updated README, CLI README, guide, distribution runbook, and release runbook
  for the v0.4.28 release candidate.
- Synced `apps/cli/package.json` and `package-lock.json` to `0.4.28`.
- Release tag `v0.4.28` and guarded publication workflow are not yet run.
- Root `build`, `typecheck`, and test scripts now invoke the local TypeScript and
  Vitest Node entry points directly, avoiding the WSL `.bin` shell-shim socket warning.
- Full offline suite passes with process permission enabled. Package verification
  produces `apps/cli/moderado-0.4.28.tgz`; its final smoke-test output should be
  confirmed separately before tagging.

### Next action

Run `npm run build`, `npm test`, `npm run typecheck`, and `npm run verify:package`
in a standard environment, then review and tag `v0.4.28` only after all pass.

## Session 2026-10-14 — chat temporary status rows width fix

### Summary

While the CLI is answering in chat mode, the settled frame (header, question,
composer card) is capped to a centered card (`getWelcomeCardWidth`), but the
three *temporary* painters painted at terminal column 1 with up to full-terminal
width: the thought/step timer (`\x1b[13;1H`), the usage snapshot row
(`width - 1`), and the Gateway fallback note (`width - 1`). On a 200-column
terminal they spanned columns 1–199 while the card occupied 41–160.

All three now derive their geometry from `getChatAnswerArea(width)` and paint
from `startColumn` clamped to `cardWidth`, matching the streamed-answer columns.

### Completed

- `renderChatThoughtTimeUpdate`: optional `width` param; paints at
  `13;startColumn`, text clamped to `cardWidth`; `chat.ts` passes
  `process.stdout.columns` at both call sites.
- `renderChatUsageUpdate` / `renderGatewayFallbackUpdate`: row width is
  `area.cardWidth` and paint starts at `area.startColumn` (the trailing `\r`
  was dropped since the cursor now positions absolutely).
- Tests: new regression "keeps temporary status rows inside the chat card
  columns" (width 200, asserts start column and painted width for all three
  painters); stale pins updated to the card geometry.
- Full boundary sweep (follow-up): the first streamed answer line no longer
  paints from column 1 (`answerPosition` now initializes from
  `getChatAnswerArea(...).startColumn` in chat.ts); `renderSuggestionsBox` uses
  exactly the passed card width (was forced to a 78–82 fixed width that
  escaped narrow cards); `renderMentionSuggestionsBox` takes the card width,
  is flush-left like the queued box, and truncates long file labels.
  Regression test asserts every non-empty card line starts at the card's left
  edge and ends exactly at its right edge at 74/80/120/200 columns.

### Versioning note

Commit `1c074e5` (`v0.4.25+2610149`) was created mid-session and captured the
source edits; `apps/cli/package.json` was left at 0.4.24, failing
`package_metadata.test.ts`. Synced to 0.4.25. The follow-up `fix(cli):` commit
still received a patch bump to `v0.4.26+261014a` because `pre-commit` reads the
stale `COMMIT_EDITMSG` (previous `feat(cli)` message) when classifying; the
manifest was re-synced to 0.4.26 in a subsequent build-bump commit.

### Checks

- Full workspace suite: PASS (615 tests, 63 files).
- npx tsc -b --force: PASS. git diff --check: PASS.
- Live geometry check at width 200: all three painters start at column 41 and
  end within column 160 (card edge).

### Next action

1. Include the width fix in the next Moderado build/release.

---

## Summary

Runs previously gave no visible progress signal beyond a bare "Thinking..."
spinner (non-interactive) and an elapsed-time row (chat), and finished without
any explicit "Done" state.

`TerminalRenderer` (used by `moderado run`) now tracks `step`/`maxSteps` from
`progress` events and paints the transient line as `⠋ Processing task… Step N/M`
(falling back to `⠋ Processing task…` when a delegation event carries no step
budget). When a run completes it prints `✔ Done (N steps)` above the Session
Finished banner; cancelled/failed/timeout runs never get the Done marker.

In interactive chat, `progress` events update the fixed status row to
`Processing task… Step N/M · Xs` while the model is thinking, the ticking
thought-time timer carries the same step info, and a settled successful turn
renders `✔ Done · Thought for Xs` via the new `chatTaskDone` layout flag
(all pre-existing behavior unchanged when the flag is unset).

## Completed

- `TerminalRenderer`: task status line with step counter plus `✔ Done (N steps)`
  on completion; step-less delegation events degrade to a plain "Processing
  task…" line.
- Chat frame: step-aware thought-time row; `chatTaskDone` threaded through
  `WelcomeLayoutOptions`, `PromptInteractiveTurnOptions`, the per-turn redraw,
  and the next prompt; successful turns show `✔ Done · Thought for Xs`.
- Split the session work into two commits so both patch versions appear in
  history: `v0.4.23` covers the run-command spinner/step line/Done marker,
  `v0.4.24` the chat status row and this handoff. The pre-existing amend cycle
  (which had overwritten the original `v0.4.23` commit) was rewritten away with
  a backup branch (`backup/task-progress`).
- Synced `apps/cli/package.json` with the hook-bumped VERSION in each commit
  (0.4.23 / 0.4.24), fixing the pre-existing `package_metadata` mismatch left by
  the v0.4.22 bump.

## In progress

- None.

## Working tree

- Modified: apps/cli/src/ui/renderer.ts, apps/cli/src/ui/welcome.ts,
  apps/cli/src/commands/chat.ts, apps/cli/tests/renderer.test.ts,
  apps/cli/tests/welcome.test.ts, apps/cli/package.json, HANDOFF.md.

## Checks

- apps/cli full suite: PASS (373 tests, 34 files — incl. Done-marker and
  step-line regressions plus the package metadata check).
- Rest of workspace (contracts/core/providers/tools): PASS (240 tests, 29 files).
- npm run typecheck: PASS.
- git diff --check: PASS.
- Note: earlier sessions saw pre-existing failures in tests/binaries.test.ts,
  tests/install_script.test.ts, and tests/release_workflow.test.ts; the current
  run of those suites is green in this environment.

## Decisions and context

- The Done marker only appears for `completed` runs — a cancelled or failed task
  must never claim completion.
- Subagent delegation progress events emit `step: -1` with no `maxSteps`; the UI
  treats missing/negative steps as "no step budget" instead of rendering
  "Step -1/undefined".
- In chat, the step row only paints before the first answer delta, so streamed
  answer text is never overwritten.

## Blockers

- None.

## Next action

1. Include the task progress/Done marker in the next Moderado build/release.

## Resume notes

- Published installs keep the old behavior until the next release is built.

## Release record (v0.3.10)

1. Release commit `bb9a20d` (`v0.3.10+260930d`); hook fix `4006a9d`.
2. Verification run `36774093914` � all six jobs green.
3. Downloaded the CI artifact and ran the actual Windows binary: reports
   `v0.3.10+260930d`. `manifest.json` revision `4006a9d`.
4. Publish run `36774560319` (`confirm: PUBLISH`) succeeded. npm `latest` ?
   0.3.10; GitHub Release with 11 assets.
5. Checksums (verified against the release sidecars):
   - `moderado-win-x64.exe` `54263b4801995d99147fb1a720dd52f104c38c4ba76ea6e74d0d2b5cbafeff0f`
   - `moderado-linux-x64` `b017f640f21939e766d0386c3f0e2bde55237b441aecbc28ebe0d606d40d7689`
   - `moderado-macos-arm64` `d6fbdcb748eb01e40e3d93ab96dd282ba73bf2a748d7088c04a5e13171f87054`
6. Homebrew tap ? 0.3.10 (`e968625`); Scoop bucket ? 0.3.10 (`f7d2e9d`).
7. winget PR #444475 was updated **in place** from 0.3.9 to 0.3.10
   (`d997c44`) and passed validation, but remains open pending moderator
   approval. The package is not yet available by ID in winget.

### Channel state after v0.3.10

| Channel | Version | Status |
|---|---|---|
| npm `latest` | **0.3.10** | live |
| GitHub Release | **v0.3.10** | 11 assets |
| curl installer | 0.3.10 | tracks latest |
| Homebrew tap | **0.3.10** | `e968625` |
| Scoop bucket | **0.3.10** | `f7d2e9d` |
| winget | **0.3.10** | PR #444475 open; awaiting moderator approval |


### Alfazen commit hook bug found and fixed

The `release(patch):` commit for 0.3.10 initially stamped `v0.3.9+260930c`
instead of `v0.3.10+260930d`. Root cause: `.githooks/pre-commit` classified the
bump using a `1s/.../` sed that stripped at most one leading version stamp.
`.git/COMMIT_EDITMSG` still holds the *previous* commit's already-stamped
message during `git commit -m`, so `detect_bump_type` received
`v0.3.9+260930c release(patch): ...`, the `case` glob did not match, and the
bump was treated as a plain `build`.

Fixed in `.githooks/pre-commit` by stripping all leading stamps:
`s/^(v[0-9]+\.[0-9]+\.[0-9]+[+-][0-9]{6}[0-9a-zA-Z] )+//`. Verified against a
synthetic stale message � it now yields `v0.3.10+260930d`.

### Release follow-up (historical)

1. Decide whether to create and push the `v0.4.0` tag. Do not publish until
   the release verification workflow passes and publication is explicitly
   requested.
2. Continue Cloud Gateway work with browser authorization, request limits,
   visible fallback handling, and Gateway error mapping.

## Release record (v0.3.9)

1. Committed the documentation corrections as `cbbf47d` (`v0.3.9+2609305`); the Alfazen hook advanced only the build suffix.
2. Pushed `master`, tagged `v0.3.9`, and pushed the tag. The tag satisfies the CI gate `test "$GITHUB_REF_NAME" = "$(cut -d+ -f1 VERSION)"`.
3. Verification run `36746258969` passed all four jobs (438 tests, `verify:package`, three native binaries, merged metadata, generated manifests).
4. Publish run `36746585342` (`confirm: PUBLISH`, `tag: v0.3.9`) succeeded: npm `latest` ? 0.3.9 with sigstore provenance (log index 3022283679), and the GitHub Release with 11 assets.
5. Smoke-tested the **published** tarball via `npm pack moderado@0.3.9` into an isolated prefix: `--help`, `--version` (reports `v0.3.9`), `skills` (4 built-ins + 23 user skills), and `doctor` (exit 0, no secrets) all pass. Only `zod` was installed alongside it.
6. Pointed `README.md`, `apps/cli/README.md`, `docs/DISTRIBUTION.md`, and the `install.sh` usage comment at v0.3.9.

### Channel state after v0.3.9

| Channel | Version | Action needed |
|---|---|---|
| npm `latest` | **0.3.9** | none |
| GitHub Release | **v0.3.9** (11 assets) | none |
| curl installer | 0.3.9 (tracks latest) | none |
| Homebrew tap | **0.3.9** | done � `a82ccc1` |
| Scoop bucket | **0.3.9** | done � `f0e47d9` |
| winget | 0.3.9 PR open | blocked on a community moderator; see below |


The Homebrew and Scoop repos were verified live and were both still pinned at 0.3.0 � older than the 0.3.7 the runbook previously claimed. Both were bumped to 0.3.9 by copying the canonical manifests from the v0.3.9 GitHub Release, after confirming all three binary checksums matched the published `.sha256` sidecars byte for byte:

| Binary | SHA-256 |
|---|---|
| `moderado-linux-x64` | `ee0d1a5bdaa5bd8ee4508e4728776bcd0150598e7c89016eea5dc33c656c575d` |
| `moderado-macos-arm64` | `b5d7362d7e4ea082ae1b0ae6434cb35b56554de8b6d3687d7c64f42dba7b9d36` |
| `moderado-win-x64.exe` | `ebade87fa82bfeb81ed5409d26d9bedd4ee05ad3d896f84a4ea2307110f7c6b7` |

### winget 0.3.9 is submitted

Closed the stale 0.3.0 PR #439175 and opened
[microsoft/winget-pkgs#444475](https://github.com/microsoft/winget-pkgs/pull/444475)
for 0.3.9 (`MERGEABLE`). It adds the three required manifests under
`manifests/m/MarcuzApl/Moderado/0.3.9/` � version, installer (portable, x64),
and defaultLocale (en-US) � with `InstallerSha256` taken from the v0.3.9
release sidecar.

Microsoft's 10-stage validation pipeline is the authoritative check, and a
full pass on 2026-09-30 went green through `07. Installers Scan` (which
downloads and scans the 62 MB binary). The pipeline re-queues and is slow; check
`gh pr checks 444475 --repo microsoft/winget-pkgs` instead of assuming failure.

A local `winget validate` on `v1.30.140-preview` reports "multi file manifest is
incomplete", but it produces the **identical** error for an unmodified,
already-merged Microsoft manifest (`Microsoft.PowerShell` 7.6.6.0) on the same
machine. That message is a limitation of the local preview build, not a defect
in these files, and the PR body states this so a reviewer need not rediscover it.

The remaining gate is a community moderator review. Nothing further is
actionable locally until that lands.

### v0.3.9 binaries reported a wrong version (fixed after release)

A user installing the v0.3.9 standalone binary saw `moderado --version` print
`v0.1.0`. Cause: `pkg` snapshots the filesystem, so inside the executable
neither the root `VERSION` file nor `apps/cli/package.json` exists. `getVersion()`
in `apps/cli/src/index.ts` therefore always fell through to a hardcoded `v0.1.0`
literal, and `apps/cli/src/commands/run.ts` had a second, independent
`Moderado v0.1.0` banner literal. npm installs were unaffected because
`package.json` ships in the tarball.

`pkg` has no `--define`, so `scripts/binaries.mjs` now writes
`apps/cli/dist/injected_version.js` immediately before packaging, and the CLI
reads it as the last-resort fallback. `getVersion()` is exported as
`resolveVersion()` so the `run` banner can no longer drift from `--version`. A
missing or blank value yields `unknown` rather than a false version claim.

Verified by building a real `node22-win-x64` binary and running it: `--version`
prints the connected version, and `--help`/`doctor` still work. Every future
standalone release inherits the fix. **The already-published v0.3.9 binaries
still carry the bug** and are only correct once re-released.

## Completed

- Removed the `codex/vscode-extension` branch locally and on `origin`; pruned the remote-tracking ref. The tip commit `193ba46` is retained only as the tag `backup/codex-vscode-extension`. No VS Code extension code was ever merged into `master`, so no product code was reverted.
- Cleaned the workspace of untracked leftovers from that branch: `apps/vscode/` (stale `dist/` + `node_modules/`), `.vscode/` (an `extensions.json` recommending the abandoned extension), and `artifacts/vsix/`. All three were gitignored build output, so the removal changed no tracked file.
- Repaired a UTF-8 mojibake corruption (`U+FFFD`) in `docs/GUIDE.md` and `apps/cli/README.md` � the apostrophe in "workspace's `package.json`" had been replaced with a replacement character.
- Corrected stale documentation: `docs/GUIDE.md` claimed v0.3.7 while the project is at v0.3.9; both READMEs described "the 7 tools" when 12 are registered plus 2 core-owned plus dynamic MCP tools.
- Added a �2 Tool Inventory table to `docs/TOOLS.md` listing all tools with their approval gate and source file, then renumbered the old �2 Tool Specifications to �3 and the error taxonomy to �4.
- Added `docs/COMPETITIVE_ANALYSIS.md`: a verified survey of Cline CLI and OpenCode CLI from vendor documentation, Moderado's confirmed baseline read from source, a three-tier ranked gap list, and explicit non-goals. Linked from `README.md`, `docs/GUIDE.md`, `docs/TOOLS.md`, `apps/cli/README.md`, and `docs/CLI_CAPABILITY_ROADMAP.md`.
- Added four compact built-in coding skills: code review, implementation planning, systematic debugging, and test-driven development.
- User `SKILL.md` files are discovered but disabled by default. `/skills on NAME` and `moderado skills on NAME` persist selected user skills in `~/.moderado/config.json`; `off` reverses this without deleting files. An enabled user skill can override a built-in by name.
- The model receives short metadata for active skills and loads full instructions only through `load_skill` or an explicit `skill:NAME` task mention. `/skills` now groups built-in and user skills and shows the user directory.
- Updated CLI help and `docs/GUIDE.md`.
- Confirmed the core has a bounded `subagent` tool: one child agent loop, shared provider/tools/approval policy, five steps, no nesting.
- Reviewed the local `D:\projects\alfazen-skills\alfazen-coding` bundle. It is a useful source, but its full 20-skill set should not be injected into every prompt; some workflows expect orchestration tools the CLI does not expose.
- Squash-merged `codex/cli-provider-presets`: provider preset metadata and free-model policy now live in `packages/providers`, with CLI re-exports preserving existing imports. No `apps/vscode` code was merged.

## Checks

- `npm.cmd run build` and `npm.cmd run typecheck`: pass.
- Offline tests: 60 files / 438 tests pass with temp fixtures inside the workspace and `GIT_CEILING_DIRECTORIES` set to the workspace root.
- `node apps/cli/dist/index.js skills`: lists four built-ins and 23 local user skills, all user skills currently off. The default skill context on this profile fell from about 143,500 body characters to 520 catalogue characters.

## Decision

- Keep a small built-in set on master. Enable user skills selectively before considering more of `alfazen-coding`.
- Keep package version 0.3.9 through the provider refactor; its squash commit advances only the connected build suffix.
- IDE extensions are out of product scope. `codex/vscode-extension` is deleted; keep only the `backup/codex-vscode-extension` tag until the owner confirms the work is unrecoverable-needed, then drop the tag.
- Do not chase OpenCode/Cline parity. Themes, keybinds, formatters, web UI, server mode, kanban, hub daemon, scheduling, and a plugin/hook runtime stay out � they are presentation and orchestration surface, not agent capability.
- Do not adopt Cline's auto-approve-by-default. The approval-first default is Moderado's identity.

## Next action

1. Decide whether and when to release v0.4.0. It should carry the binary version fix (`v0.3.9` standalone binaries report `v0.1.0`) so corrected binaries are actually shipped. The Tier 1 gap list in [docs/COMPETITIVE_ANALYSIS.md](docs/COMPETITIVE_ANALYSIS.md) is the natural scope after that: **granular pattern-based approval policies** first (ask/allow/deny keyed on tool input, deny wins over `--auto`), then `moderado run --plan`, custom Markdown slash commands, and `--continue`/`--session`/`--fork` for `run`.
2. winget: #444475 (0.3.9) is open and mergeable, gated only on a volunteer moderator. After it merges, `winget install MarcuzApl.Moderado` works. Optional: a single polite ping after ~2 weeks.

---

The following is historical handoff content from the tag, not current verification.

# Project Handoff

Updated: 2026-09-22 22:37 UTC
Branch: master
Commit: `bbe1506` (`v0.3.1+2609225`)
Status: npm `moderado@0.3.0` is PUBLISHED (manual first publish, no `--provenance`); GitHub Release `v0.3.0` carries all 7 binary assets. README reorganized (`bbe1506`, `v0.3.1+2609225`): Tech Stack section, feature/reference sections moved to `docs/GUIDE.md`, Install Moderado rewritten per-OS (Linux/macOS/Windows) with no "Other install channels". All distribution channels except Chocolatey (deliberately out of scope) are DONE: curl installer (`scripts/install.sh`, dual checksum gate, 2 offline tests), Homebrew tap `marcuz-apl/homebrew-moderado` and Scoop bucket `marcuz-apl/scoop-moderado` seeded with byte-identical v0.3.0 manifests, winget submission open as [winget-pkgs#439175](https://github.com/microsoft/winget-pkgs/pull/439175) (validation queued), CI wiring landed on master (`9530ddc`, `v0.3.1+2609223`): `release.yml` distribution job, `publish.yml` release attachments + `npm@latest` OIDC fix. Local checks green (50 suites, 347 tests; typecheck clean). Docs: `docs/DISTRIBUTION.md`, `docs/FIRST_PUBLISH.md`, `docs/GUIDE.md`.

## Current feature implementation

- User skills are discovered from `~/.moderado/skills/<name>/SKILL.md` and injected into the model system context as untrusted advisory instructions.
- Supported metadata: `name` and `description`; malformed, oversized, mismatched, and symlinked skill files are ignored.
- Interactive TUI command: `/skill` lists and reloads installed skills.
- Skills do not grant tools or bypass approval, workspace jail, non-interactive, or secret protections.
- Validation: `npm run typecheck`, `npm run build`, and `npm test` pass (51 files, 350 tests).


## Summary

1. **CLI `v0.3.0` released (Alfazen minor increment)**:
   - `release(minor):` is the Alfazen trigger for a minor bump, so `v0.2.61` became `v0.3.0`, the version the roadmap declares as the CLI public-distribution gate.
   - The real `.githooks/pre-commit` hook performed the bump to `v0.3.0+260921I`, staged `VERSION`, and `commit-msg` stamped the subject (see item 5 for the hook caveat and the workaround used).

2. **Release metadata aligned to `0.3.0` ([`apps/cli/package.json`](apps/cli/package.json), [`package-lock.json`](package-lock.json), [`README.md`](README.md), [`apps/cli/README.md`](apps/cli/README.md))**:
   - The publishable package version and the `apps/cli` lockfile workspace entry are `0.3.0`, so `verify:package` emits `moderado-0.3.0.tgz` and the GitHub Release cannot attach a mislabelled artifact; npm installs report `v0.3.0` through the `package.json` fallback in [`apps/cli/src/index.ts`](apps/cli/src/index.ts).
   - Both README badges read `v0.3.0+260921I` at release time (since refreshed to `v0.3.1+2609225` by the README reorg below).

3. **Release runbook updated ([`docs/RELEASING.md`](docs/RELEASING.md))**:
   - Pre-flight Step 0 requires the npm version to match the SemVer portion of `VERSION`; all examples now reference `v0.3.0` and `moderado-0.3.0.tgz`.
   - Step 2 derives the tag from `cut -d+ -f1 VERSION` instead of hard-coding a version.

4. **Verification & package preparation**:
   - `npm run typecheck` — clean; `npm test` — 49 suites, 343 tests passing offline.
   - `npm run verify:package` — vendored bundle, importer rewrite, tarball policy, isolated global install, and `moderado --help` smoke test all pass as `moderado-0.3.0.tgz`.
   - Removed the superseded local `moderado-0.2.61.tgz` so a `npm publish apps/cli/*.tgz` glob cannot ship two versions.

5. **Alfazen hook finding and the workaround used (owner decision still open)**:
   - `.githooks/pre-commit` classifies `.git/COMMIT_EDITMSG`, which `git commit -m`/`-F` only refreshes *after* pre-commit has run. Every commit is therefore classified against the **previous** commit's subject; that previously mis-bumped the prep commit (`v0.2.61` → `v0.2.62`).
   - Reproduced deterministically against the real hooks: a `docs:` commit followed by a `release(minor):` commit committed with `-m` produced no minor bump.
   - Workaround used for this release: pre-seed `.git/COMMIT_EDITMSG` with the release subject before committing. The hook then computed `v0.3.0+260921I`, staged `VERSION`, and `commit-msg` restamped the subject exactly as designed.
   - Consequence to watch: any commit made immediately after a `release(minor):` subject will be mis-bumped to `v0.4.0` unless the hook is fixed. Recommended fix (needs owner approval, shared Alfazen infrastructure): classify the message Git is actually committing, e.g. move the bump into `prepare-commit-msg`.

6. **Release gate repaired (surfaced by the first-ever tag-push verification run)**:
   - `.github/workflows/release.yml` and `.github/workflows/publish.yml` ran `npm test` on a fresh clone where the workspace packages have no `dist/`, so 24 suites failed to resolve `@moderado/core`, `@moderado/contracts`, `@moderado/providers`, and `@moderado/tools`. Both workflows now run `npm run build` before `npm test`, matching the documented pre-flight order.
   - `packages/tools/tests/jail.test.ts` asserted that backslash-only UNC notation escapes the jail, which is only true on Windows. That assertion is now guarded by the same drive-letter check the neighbouring tests use, while the POSIX-absolute and WSL-UNC escape assertions still run on every platform.
   - `apps/cli/tests/npm_package.test.ts` no longer depends on the ambient `npm_execpath` and now passes the target platform explicitly, so the Windows invocation contracts are asserted on every runner instead of only on Windows.
   - Reproduced and re-verified in a fresh clone of the tag commit: without the build 24 suites fail exactly as CI reported, and with `npm run build` first the full 49 suites / 343 tests pass.
   - macOS `/var` → `/private/var` symlink resolution surfaced two further defects. [`packages/tools/src/tools/list_files.ts`](packages/tools/src/tools/list_files.ts) computed workspace-relative paths against the *supplied* root while walking a canonicalized directory, so an existing-subdirectory query returned escaped paths (for example `../../private/var/...`) instead of `src/index.ts`; `listFiles` and `ListFilesTool` now canonicalize the walk root once and fall back to the supplied root when it cannot be resolved. The `/session share` assertion in [`apps/cli/tests/chat.test.ts`](apps/cli/tests/chat.test.ts) now compares against the canonicalized root.
   - The `binary-metadata` merge gate then failed with `ENOENT ... collected/win/manifest.json` because `upload-artifact` keeps the `artifacts/<version>/<target>/` nesting (it roots the archive at the glob's static prefix), while `merge-binaries --source` expects the manifest at the source root; the merge step now resolves each per-target source directory through the connected version.
   - Reproduced that macOS class of defect locally with a Windows junction root (`path !== realpath`): the query form returned `../reprow-.../src/index.ts` before the fix and `src/index.ts` after it.

7. **README reorganized (`bbe1506`, `v0.3.1+2609225`, docs-only)**:
   - Added a simple **Tech Stack** section (TypeScript, Node.js >= 20, ESM, Zod, Vitest, npm workspaces, `@yao-pkg/pkg`, GitHub Actions OIDC).
   - Moved Highlights, Documentation Index, Workspace Layout, Practical coding workflow, Diagnostics evidence, TypeScript language intelligence, Local MCP tools, Host event protocol, and Doctor command byte-for-byte into the new [`docs/GUIDE.md`](docs/GUIDE.md); no tests assert README structure, and the `#install-moderado` anchor used by `docs/FIRST_PUBLISH.md` still resolves.
   - Rewrote **Install Moderado** as per-OS subsections (Linux, macOS, Windows) covering every live channel; the "Other install channels" table was folded in and removed as a heading.

## Checks

- `npm run typecheck` — PASS (0 errors)
- `npm run build` — PASS
- `npm test` — PASS (50 test files, 347 tests passed; one earlier run flaked a timing-sensitive test under parallel load, two consecutive reruns green)
- `npm run verify:package` — PASS (`Verified moderado-0.3.0.tgz`)
- `git diff --check` — PASS (CRLF advisories only)

## Remaining release steps (owner-gated)

**Smallest next action:** configure the npm trusted publisher (item 1) — it is the only gate blocking the automated release path.

1. Configure the npm trusted publisher at `https://www.npmjs.com/package/moderado/access` (Trusted Publisher → GitHub Actions): repository `marcuz-apl/moderado`, workflow filename `publish.yml`, environment `release` (or blank). Package now exists.
2. **Decision recorded — do NOT release 0.3.1 yet.** Everything since `v0.3.0` is docs + CI/distribution wiring that does not change the shipped CLI, so `0.3.0` already satisfies the public-release gate. Cutting `0.3.1` now would also stale in-flight winget PR #439175 and would have to be manual again (trusted publisher not yet configured). Recommended: release `0.3.1` later purely as a low-stakes validation of the full OIDC pipeline (sync `apps/cli/package.json` → pre-flight → tag `v0.3.1` → green Verify run → dispatch Publish with `confirm: PUBLISH`), ideally after #439175 merges; otherwise skip it and let the next `feat` commit take over as `v0.4.0`. `VERSION` reading `v0.3.1+2609225` while npm sits at `0.3.0` is normal between releases under Alfazen.
3. Distribution follow-through: watch [winget-pkgs#439175](https://github.com/microsoft/winget-pkgs/pull/439175) to merge per-release tap/bucket bumps are manual copies (auto-push needs a cross-repo `TAP_PUSH_TOKEN` — owner decision, see `docs/DISTRIBUTION.md` §6).

## Blockers

- None. Publish workflow failure 35665118071 (E404, no credentials) is the expected pre-bootstrap outcome, superseded by the manual first publish.

## Release record (v0.4.8)

1. Release tag `v0.4.8` points to `d5e263e`; release verification run `37513672522` passed all jobs.
2. Publish run `37514489475` succeeded. npm `moderado@0.4.8` is live as `latest`; GitHub Release has 11 assets.
3. Verified the actual npm tarball and Windows binary report `v0.4.8`; Windows binary SHA-256 matches its release sidecar.
4. Homebrew tap updated to `0.4.8` at `marcuz-apl/homebrew-moderado` commit `72cbaba`; Scoop bucket updated at `marcuz-apl/scoop-moderado` commit `952c93f`.
5. Distribution documentation and installation instructions were updated in the root README, CLI README, and release/distribution docs.
6. `npm run build`, `npm test` (513 tests), `npm run typecheck`, and `npm run verify:package` passed before tagging.

### Channel state after v0.4.8

| Channel | Version | Status |
|---|---|---|
| npm `latest` | **0.4.8** | live |
| GitHub Release | **v0.4.8** | 11 assets |
| curl installer | 0.4.8 | tracks latest |
| Homebrew tap | **0.4.8** | `72cbaba` |
| Scoop bucket | **0.4.8** | `952c93f` |

## Gateway website-key integration (2026-10-09)

- Uncommitted CLI changes send the stored Moderado website key for Gateway inference. Public model listing and keyless paid-route inference remain supported. Gateway access metadata labels free and paid routes; auto has no blanket free-cost assumption.
- npm run build passed. npm test -- --run passed: 515 tests in 62 files. git diff --check passed with line-ending advisories only. Tests use fake providers.
- Git status: modified README.md, docs/CLOUD_GATEWAY_INTEGRATION.md, CLI command/UI and tests, contracts model schema, provider preset and tests. No commit, tag, or release.
- Decision: a free route requires a valid, unexpired, unrevoked Moderado website API key; paid routes and public discovery do not. The Gateway may choose either access type for auto.
- Blocker: none for code changes. This historical file already contains invalid UTF-8 bytes, so the note was appended without rewriting its existing bytes.
- Smallest next action: review and commit the CLI change with the corresponding Gateway and IDE contract updates when ready.
## Composer provider and model status (2026-10-20 07:40 UTC)

- Branch: `master`; HEAD carries the composer status work.
- Bottom composer row now displays the active connection name before the model as `provider | model`, including immediately after `/connect`; long names are shortened to stay within the card width.
- CLI package and lockfile metadata synced to the connected version; current connected version is `v0.4.29+2610201`, with package version `0.4.29`.
- Checks: `npm run build` PASS; `npm test` PASS (65 files, 628 tests); focused composer and metadata tests PASS.
- Blockers: None. Next action: Commit and push the verified status row and metadata changes.

## Centered CLI on terminal resize (2026-10-20 15:01 UTC)

- Branch: `master`; chat generation now repaints the frame when the terminal width changes, so maximized windows keep the question, answer, and composer centered. The resize listener is removed when generation ends.
- Tests cover a 200-column static frame and a resize during streamed output. Checks: `npm run build` PASS; `npm test` PASS (65 files, 632 tests); `git diff --check` PASS.
- Blockers: None. Next action: Review the centered-layout diff and commit the change.

## Version history renumbering (2026-10-20)

- The active branch jumped from v0.4.28 to v0.4.30 when the v0.4.29 commit was removed from master. The owner authorized renumbering the active history.
- October 20 builds now run without gaps from `2610201` through `261020a`. The first two commits are v0.4.29, the next four are v0.4.30, and the CLI provider-flow rename commit and later work are v0.4.31.
- Every rewritten commit aligns its subject, VERSION, CLI package version, and lockfile package version. Current connected version: v0.4.31+261020a; CLI package: 0.4.31.
- The previous master tips are preserved locally at backup/pre-2026-10-20-version-renumber and backup/pre-2026-10-20-sequence-fix. Checks on the rewritten tree: npm run build passed; npm test passed (65 files, 632 tests); git diff --check passed.
- Blockers: none. Smallest next action: verify the rewritten master tip on origin after the authorized force push.
