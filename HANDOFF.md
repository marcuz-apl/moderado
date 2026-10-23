# Moderado Project Handoff

Updated: 2026-10-23 (post-v0.4.34 fixes — turn summary, bounded answer area, one-step Moderado connect)
Branch: master (tracking origin/master)
Status: v0.4.34 plus the Unreleased fixes are in the working tree; the last
`getChatLayout` tweak was not re-verified with a build/test run (see below).

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

`npm run build` (tsc -b --force) and the full Vitest suite were green after the
first two fixes. The shell sandbox then failed session-wide
(`sandbox-exec: data object length 66215 exceeds maximum (65535)`), so the final
`getChatLayout` floor change and the new queued-commands test were reviewed
statically only. **Re-run `npm run build && npm test` before tagging.**

### Next action

Run the build and full suite, then tag the next patch (`cut -d+ -f1 VERSION`).

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
