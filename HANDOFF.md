# Moderado Project Handoff

Updated: 2026-10-29 16:55 UTC
Branch: master
Commit: prior HEAD `64379d4` (`v0.4.54+2610295`), pushed; this fix commit follows it
Status: `v0.4.54` is tagged and pushed, but the tag's read-only artifact
verification failed on the Linux and macOS runners. The platform-dependent
Documents resolution is fixed in this commit, so the tag has to move here before
`publish.yml` can run.

## Summary

The CLI supports the Gateway's account-free models: a fresh install can chat
with no API key. The Gateway now marks its two pinned defaults in `/v1/models`
with `section: 'default'`, and keyless Moderado `/model` lists exactly those
entries for explicit selection (by stealth label) instead of an `auto` row.
Selecting one pins it, and every model in a keyless Moderado session is priced
at `$0.00`. The Gateway and CLI changes are committed and pushed.

Built-in dev/prod URLs are treated as probe results, not explicit choices: a
keyless profile that saved `https://modr.alfazen.org/v1` (or the dev URL) is
re-probed dev-first on every start, so a running development Gateway is reached
even when the saved profile points at production. Keyed accounts, custom
Gateway URLs, and `MODERADO_ENV`/`MODERADO_BASE_URL` remain authoritative.

An explicit deployment choice is now possible without prompting on every
`/connect`: the Moderado sign-in menu has a **Change server** row (tagged with
the current server) that opens a Production/Development picker and returns to
the same menu. The choice is saved as `gatewayEnvironment` on the profile and
then overrides the dev-first probe on later starts. The row is hidden when an
environment override or a custom Gateway URL already pins the deployment.

Production is not updated yet: its `/v1/models` has no `section`/stealth
entries and it lacks the keyless pinned-default exemption, so until Gateway
`27565dd` is deployed and `MODERADO_DEFAULT_MODEL` (or
`operator_state.default_model`) pins two published stealth routes, switching to
Production shows an empty default list and keyless inference returns `401`.

The Gateway now serves its pinned defaults without a Moderado key. Previously
every `access: "free"` route demanded an `mrd_` key, so a keyless CLI session
selected a stealth default and received `401`; the CLI then showed "The Gateway
rejected the keyless free defaults." The pinned defaults are exempt; all other
free routes still require a key.

The sent question in the chat transcript is now a padded band: a blank
padding row, the wrapped `❯ question`, and another blank row, on `#1a3838`
(truecolor `48;2;26;56;56`). Every transcript question — the live turn and each
history turn — uses the same band; the bottom composer keeps its gray surface.
The colour changed from gray to dark blue to dark green and settled on the
owner's exact `#1a3838`.

Files the user asks for are now saved where they can find them. The CLI could
only write inside the workspace, so asking for a downloadable markdown file put
it in the workspace root. A new `save_to_documents` tool writes into the user's
Documents folder (`os.homedir()/Documents`), requires approval like any other
write, reuses the jail's canonicalization (absolute paths, `..`, protected
names, and symlink escapes are rejected), and returns the absolute path so the
summary can name it. The system prompt routes user-facing deliverables to it;
code, tests, and config still use `write_file`.

Release prep for `v0.4.53` was pushed as `8ce95f8` (`v0.4.53+2610292`) and the
Turn Summary fix as `f5ab882` (`v0.4.53+2610293`). The cross-validation and
`/detail` batch is committed as `e62fefb`
(`v0.4.54+2610294 feat(cli): add /detail answer tone, bound stalled tools, show
web-search progress`), because a `feat:` commit advances `p`. No version is
tagged or published.

The cross-validation pass over the AI-authored code is implemented, not just
recorded:

- `save_to_documents` resolves Documents from the Windows registry when OneDrive
  redirects it, rejects reserved device names on Windows, hides the real path
  from the model after a save, and shows the destination plus the content in the
  approval prompt. `save_to_documents` is gated like MCP tools: auto-approve
  never covers a write that leaves the workspace.
- The Turn Summary heading reports the real outcome (`COMPLETED!`, `NOT
  FINISHED`, `STOPPED`, `FAILED`), saved documents are listed separately from
  workspace edits, a saved document no longer triggers a "start the web app"
  hint, and the summary is persisted into the session and the transcript.
- Web search is visible and bounded: the pre-turn lane ticks the elapsed time on
  the status row and stops at two minutes, and the agent loop aborts any tool
  call that goes silent past `DEFAULT_TOOL_STALL_MS` (two minutes), tells the
  user on the activity row, and lets the turn continue.
- **Change server** is reachable again after signing in: a saved key now opens a
  **Moderado Connection** menu (Connect to <server> / Change server / Sign in
  again) instead of connecting silently, and a saved `gatewayEnvironment` marker
  outranks the dev-first probe.
- The suite is hermetic: `vitest.setup.ts` refuses any non-loopback `fetch`, so
  a test that quietly reaches a real service fails instead of passing until that
  service misbehaves.
- Answers are no longer locked to one length. `/detail` toggles the session
  between `concise` (still the default) and `expanded`, and
  `AgentRunOptions.answerDetail` selects the tone block in the system prompt that
  the loop already rebuilds each turn, so the next answer changes shape and
  nothing else moves: output caps, step bounds, and approval policy are
  untouched. `"answerDetail"` in `~/.moderado/config.json` sets the starting tone
  and the footer shows `· detailed` only while expanded.
- Documentation that contradicted the code was corrected (README, `docs/GUIDE.md`,
  `docs/SECURITY.md`, `docs/DISTRIBUTION.md`) and the dead `isNetworkCommand`
  predicate was deleted. `0.4.52`/`0.4.53`/`0.4.54` are now described as
  unpublished and
  the install examples point at `v0.4.51`, the only published tag.

## Completed

- `E:\projects\moderado-gateway\apps\gateway\src\index.js` — `/v1/models` emits
  the pinned defaults first with `section: 'default'`; stealth labels hide the
  upstream identity, and an unlabeled default is listed under its route ID so it
  stays selectable.
- `E:\projects\moderado-gateway\apps\web\src\index.js` — website `/api/models`
  applies the same default-first masking and `section` semantics.
- `packages/contracts/src/models.ts` — `ModelInventoryEntrySchema` accepts
  optional `name` and `section: 'default' | 'other'`.
- `packages/providers/src/nvidia/nvidia_adapter.ts` — keyless Moderado `auto`
  omits `model`; discovery preserves `name` and `section`.
- `apps/cli/src/config.ts` — `isModeradoGatewayAvailable` and
  `resolveAutoModeradoBaseUrl`: explicit `MODERADO_ENV`/`MODERADO_BASE_URL` and a
  keyed or custom saved profile win; otherwise dev
  (`http://127.0.0.1:4788/v1`, 500 ms) is probed and prod
  (`https://modr.alfazen.org/v1`) is the fallback. `isAutomaticModeradoBaseUrl`
  recognizes the two built-in URLs, and `resolveModeradoSessionConnection`
  re-probes a keyless profile that carries one of them.
- `apps/cli/src/commands/chat.ts` — startup resolves the credential, then runs
  `resolveModeradoSessionConnection` so a keyless profile saved at a built-in URL
  reaches the currently running Gateway.
- `apps/cli/src/ui/provider_connect.ts` — `/connect` offers
  "Use free models without an account" before sign-in, and that option now opens
  the keyless model picker so a stealth default is selected explicitly instead
  of leaving the session on `auto`. Saved/active built-in URLs no longer skip the
  probe; env and custom URLs still win. The sign-in menu adds **Change server**
  (tagged Production/Development, hidden when the deployment is pinned) opening
  the Production/Development picker, with Esc returning to the menu.
- `apps/cli/src/config.ts` — `ProviderConnection.gatewayEnvironment` persists an
  explicit deployment choice. `resolveAutoModeradoBaseUrl` order is: env override
  -> custom saved URL -> explicit `gatewayEnvironment` -> keyed built-in URL ->
  dev-first probe. `resolveModeradoSessionConnection` moves both keyless and
  keyed profiles to the chosen deployment without probing.
- `apps/cli/src/ui/popup.ts` — `ListPopupOptions.initialValue` highlights the
  current row when the server picker opens.
- `apps/cli/src/ui/model_selector.ts` — keyless Moderado `/model` lists only
  `section === 'default'` entries, offers manual model ID entry, and explains an
  empty or unavailable catalog; no `auto` row. The keep row reads
  "Gateway free defaults".
- `apps/cli/src/commands/chat.ts` — first run auto-connects when no connections
  are saved; `isKeylessGatewaySession` prices any selected model at `$0.00` for
  restored sessions and per-turn usage.
- Tests: `packages/providers/tests/nvidia_adapter.test.ts`,
  `apps/cli/tests/model_selector_cloud.test.ts`,
  `apps/cli/tests/chat_usage.test.ts`, `apps/cli/tests/chat.test.ts`,
  `apps/cli/tests/provider_connect.test.ts`, `apps/cli/tests/auto_gateway.test.ts`,
  `apps/cli/tests/config.test.ts`, `moderado-gateway` gateway and web suites.
  New coverage: explicit deployment persistence and resolver precedence, the
  keyed session re-point, the Change server -> picker -> menu choreography, and
  the row's absence when a custom URL pins the Gateway.
- `E:\projects\moderado-gateway\apps\gateway\src\index.js` — the pinned defaults
  (up to two from `MODERADO_DEFAULT_MODEL`/`operator_state.default_model`) are
  exempt from the free-route key check; every other `access: "free"` route still
  returns `401` without a valid `mrd_` key. Keyless default dispatches record
  null usage attribution.
- `E:\projects\moderado-gateway\docs\CONTRACT.md` and `docs/ARCHITECTURE.md` —
  document `section: "default"`, the keyless pinned-default exception, and null
  attribution for keyless default usage.
- `apps/cli/src/ui/welcome.ts` — `renderAnswerLine` paints question rows
  `#1a3838` (`48;2;26;56;56`), and `buildChatTranscriptRows` wraps each question
  (live and history) in blank band rows, so a sent turn is three rows tall.
  `describeToolActivity` labels `save_to_documents` calls. Tests in
  `apps/cli/tests/welcome.test.ts` assert the band's colour, height, and width.
- `packages/contracts/src/tools.ts` — `SaveDocumentParamsSchema` (`name`,
  `content`).
- `packages/tools/src/tools/save_to_documents.ts` — `documentsDirectory()` and
  `createSaveToDocumentsTool(root?)`; atomic write, jail canonicalization reused,
  absolute path in the result. Registered in `createDefaultToolRegistry`;
  exported from `packages/tools/src/index.ts`.
- `packages/core/src/agent.ts` — the system prompt tells the model to use
  `save_to_documents` for files the user wants to keep or download and to state
  the path; `write_file` stays for workspace files.
- `apps/cli/src/turn_summary.ts` — `TurnRecorder` records a successful save by
  its absolute metadata path (`created`), so the Turn Summary appears for a
  save-only turn and lists the document under **Done**. Covered by the new case
  in `apps/cli/tests/turn_summary.test.ts`.
- Tests: `packages/tools/tests/save_document.test.ts` (write, subfolders,
  traversal rejection, absolute-path rejection, registry presence),
  `packages/tools/tests/tools.test.ts` (13 default tools), and
  `apps/cli/tests/welcome.test.ts`. A live check wrote and removed
  `Documents\moderado-save-check.txt`.
- Docs updated: `README.md`, `apps/cli/README.md`, `docs/GUIDE.md`,
  `docs/CLOUD_GATEWAY_INTEGRATION.md`, `packages/providers/src/presets.ts`,
  `docs/TOOLS.md`, `docs/SECURITY.md`, `AGENTS.md`.
- Release docs: `CHANGELOG.md` adds `[v0.4.53]` (Documents tool, question band)
  and the missing `[v0.4.52]` entry (account-free Gateway defaults, Change
  server) and extends the progression diagram; `README.md` version table and
  curl examples name 0.4.53; `docs/RELEASING.md` release context and
  `docs/DISTRIBUTION.md` now reference the `v0.4.53` candidate instead of
  `v0.4.34`/`v0.4.46`. `VERSION` is `v0.4.53+2610292` at `8ce95f8`.

## In progress

- Nothing is being written. The cross-validation fixes and the `/detail` batch
  are committed as `e62fefb`. This branch now carries one more commit: the
  `documentsDirectory` platform fix that unblocks the `v0.4.54` artifact
  verification. Publish and deploy still wait for explicit owner instruction.

## Committed changes

- `moderado`: `e62fefb` carries 35 files — 32 source, test and document paths
  plus the `VERSION`, `apps/cli/package.json` and lockfile moved by the hooks —
  including the new `vitest.setup.ts` and
  `apps/cli/src/answer_detail.ts` (with `apps/cli/tests/answer_detail.test.ts`) —
  the Documents tool (`packages/tools/src/tools/save_to_documents.ts`), the
  approval gate and prompt
  (`packages/core/src/agent.ts`, `apps/cli/src/commands/chat.ts`,
  `apps/cli/src/commands/init.ts`), the answer-tone directive and
  `AgentRunOptions.answerDetail` (`packages/core/src/agent.ts`), the
  `/detail` command, footer tag, and slash suggestions
  (`apps/cli/src/commands/chat.ts`, `chat_slash.ts`, `ui/welcome.ts`,
  `ui/composer.ts`, `ui/help_content.ts`, `src/config.ts`), the turn summary
  (`apps/cli/src/turn_summary.ts`), the tool-stall watchdog
  (`packages/core/src/agent.ts`, `apps/cli/src/commands/chat_search.ts`), the
  Gateway server menu (`apps/cli/src/ui/provider_connect.ts`), the dead
  `isNetworkCommand` removal (`apps/cli/src/commands/chat_meta.ts`), the
  contracts key cleanup (`packages/contracts/src/approvals.ts`), the offline
  guard (`vitest.config.ts`, `vitest.setup.ts`), tests, and docs
  (`README.md`, `CHANGELOG.md`, `docs/GUIDE.md`, `docs/SECURITY.md`,
  `docs/DISTRIBUTION.md`,
  this handoff). `VERSION` is `v0.4.54+2610295` at `64379d4`.
- The release-blocking platform bug: `documentsDirectory()` resolved the
  declared Windows folder through the host's `path`, so on a Linux or macOS
  runner `path.isAbsolute('D:\OneDrive\Documents')` was false and the
  redirected folder was dropped for the posix-joined fallback. Fixed by
  selecting `path.win32` / `path.posix` from the declared `platform`
  (`packages/tools/src/tools/save_to_documents.ts`) and by making the two
  tautological `path.join` assertions in
  `packages/tools/tests/save_document.test.ts` host-independent literals.
- `moderado-gateway`: clean at `27565dd` (pushed to `master`).

## Checks

- `npm run build` — PASS (exit 0)
- `npm test` — PASS (75 files, 810 passed, 1 skipped)
- `npm run typecheck` — PASS
- `npm run verify:package` — PASS: `Verified moderado-0.4.54.tgz`
- `v0.4.54` tag verification run `40893379089` — FAIL on `verify-package`,
  `binary-package (ubuntu-latest)` and `binary-package (macos-latest)` at
  `Run npm test`: 2 failed / 809 passed, both in `documentsDirectory`.
  `windows-latest` passed.
- Red/green evidence for the platform fix: a scratch suite mocked `node:path` to
  posix (a POSIX runner on this Windows host) and the pre-fix module reproduced
  the CI message `expected 'C:\Users\marcuz/Documents' to be
  'D:\OneDrive\Documents'` while the fixed module returned the redirected
  folder; the scratch files are deleted.
- Real-path check: `save_to_documents` wrote and removed
  `C:\Users\MZou\Documents\moderado-save-check.txt`.
- Not verified in a real terminal this session: the live "Searching the web ·
  12s" row, the two-minute stall message, the new **Moderado Connection**
  menu, and the `/detail` toggle (the `· detailed` footer tag and a visibly
  longer answer). These are covered by unit tests only; the TUI was not driven
  manually.
- `moderado-gateway` `npm test` — 226 pass, 1 skip, 1 fail; the failure is the
  pre-existing "clearing low-TPS benchmark results" test (`9 !== 8`), reproduced
  at HEAD and unrelated to these changes. New test: keyless pinned-default
  inference returns 200 while a non-default free route still returns 401.
- No live provider or Gateway calls are made by either suite; `vitest.setup.ts`
  now refuses any non-loopback `fetch`, so an accidental live call fails loudly.
- Live check: the dev Gateway (`127.0.0.1:4788`) was stopped during
  verification, so the resolver correctly fell back to production; prod's
  catalog currently returns no `section: 'default'` entries (not deployed yet).

## Decisions and context

- The two pinned defaults are identified by the Gateway contract
  (`section: 'default'`), not by guessing from `access` or model names; the
  committed Gateway test already expected the field.
- Pool masking is preserved: stealth labels hide upstream identities, and an
  unlabeled default appears under its route ID (never its upstream model name).
- `auto` remains the keyless wire sentinel when no model is pinned; the picker no
  longer offers it, but the adapter behavior is unchanged.
- The probe result is never persisted; it runs again on each start because a
  local development Gateway may come and go. Only an explicit **Change server**
  choice is persisted, so automatic behavior stays resilient to a dev Gateway
  starting or stopping.
- Built-in dev/prod URLs are automatic probe results, not explicit choices. A
  keyless profile saved at either URL is re-probed unless it carries a
  `gatewayEnvironment`; a keyed profile, a custom URL, or an env override is
  otherwise left alone.
- There is no deployment prompt on every `/connect` (deliberately): a user may
  stay on one server for a long time. The picker appears only from the
  **Change server** row, and a single Moderado profile is kept per user (no
  per-server key vault); switching servers keeps the same saved key.
- The pinned defaults are the account-free models by definition (the pinning
  feature's own contract says "API-key-free fallback"), so the key check exempts
  exactly the configured defaults. All other free routes keep the account
  requirement and its usage attribution.
- Production handling is URL-agnostic: the picker lists whatever
  `section: 'default'` entries the reachable Gateway returns. Prod will serve the
  stealth defaults only after its Gateway is deployed with the pinned-defaults
  contract.
- Auto-connect only runs when no connections are saved, so unselected saved
  profiles are never replaced.
- A keyless Moderado session is priced at `$0.00` for any selected model, since
  the operator covers the launch cost.
- The question band was chosen explicitly by the owner: three rows, now the
  exact `#1a3838` (`48;2;26;56;56`). The transcript keeps its own width (the
  scrollbar column is reserved there); only the height and colour changed.
- Documents is the only destination outside the workspace, and only through
  `save_to_documents`. The tool reuses `resolveInJailFromRoot`, so it inherits
  traversal, symlink, and protected-name rejection; the allowlist must not widen.
  Auto-approve does **not** cover it: `OUT_OF_WORKSPACE_TOOLS` is the one
  exception to the session toggle, next to MCP tools, because a write that leaves
  the jail is a decision the operator makes each time. The prompt names the
  canonical Documents path and shows the content, and the tool result reports the
  path as `Documents/<name>` so the real home directory never enters model
  context. On Windows the folder is read from the registry first, because OneDrive
  redirection makes `homedir()/Documents` the wrong guess.
- A tool call that stops answering is ended, not waited on. The loop budget is
  `DEFAULT_TOOL_STALL_MS` (two minutes, injectable as `toolStallMs`) and the
  pre-turn search lane uses the same deadline; both report the stall to the user
  instead of leaving a silent screen. The budget lives in `packages/core` because
  it bounds the engine, and the CLI passes nothing — the default is the policy.
- The `gatewayEnvironment` marker outranks the dev-first probe. A saved
  Production choice that got re-probed onto a local Development Gateway was
  silently changing servers; only an unmarked profile may be probed.
- A saved key no longer connects with zero keystrokes. It opens the **Moderado
  Connection** menu, because the alternative was a `Change server` row that
  became unreachable exactly when the user needed it. One Enter still connects.
- Answer length is a prompt directive, not a budget. `buildSystemPrompt` carries
  two tone blocks and `answerDetail` picks one; `maxOutputTokens`, step bounds and
  approval policy are unchanged, because cutting tokens mid-answer produces
  truncation rather than a shorter, well-formed reply. Concise stays the default
  so existing behavior and every current test premise hold.
- Banned filler is not part of the trade. The greeting, sign-off, and
  restating-the-question bans live in a block shared by both tones, so expanding
  an answer buys substance, not padding.
- `/detail` does not write config. The toggle is session state like Plan/Execute
  and auto-approve; `~/.moderado/config.json` `answerDetail` is the way to change
  the default permanently.
- The tool carries the file content directly instead of copying a workspace file,
  so the model writes once and never needs a workspace staging copy.
- The Turn Summary treats a saved document as work: `TurnRecorder` stores the
  absolute path from the tool result metadata and lists it under **Done**. The
  recorder stays event-driven; no model prose is involved, and the gate
  (`hasWork`) keeps unanswered question turns summary-free.

## Blockers

- None.

## Next action

1. Move the `v0.4.54` tag to the platform-fix commit (`git tag -f` plus a forced
   tag push, or delete and re-push), let the read-only artifact workflow go
   green on all three platforms, then dispatch `publish.yml` with
   `confirm=PUBLISH` and `tag=v0.4.54`. The tag already pushed points at
   `64379d4`, which still contains the failing test; no GitHub Release or npm
   version exists for it yet.
2. Smoke-test in a live terminal, because unit tests cannot see the TUI: ask a
   current-information question and watch the `Searching the web · Ns` row tick;
   stop the search backend (or point `MODERADO_WEB_SEARCH_ENDPOINT` at a black
   hole) and confirm the two-minute stop is reported; `/connect` -> **Moderado**
   with a saved key and confirm **Connect to Production / Change server / Sign in
   again**, then move to Development; type `/detail` and confirm the footer gains
   `· detailed`, the next answer explains itself instead of answering in one line,
   and `/detail` alone returns to concise; ask for a downloadable note and confirm the
   prompt names the Documents path, the save lands in `C:\Users\MZou\Documents`,
   and the Turn Summary lists it under **Done**.
3. Deploy Gateway `27565dd` to production and set `MODERADO_DEFAULT_MODEL` (or
   `operator_state.default_model`) to two published stealth routes.

## Resume notes

- Tests: `node node_modules/vitest/vitest.mjs run apps/cli/tests/model_selector_cloud.test.ts`,
  `.../chat_usage.test.ts`, `.../auto_gateway.test.ts`; Gateway suites run with
  `node --test` from `E:\projects\moderado-gateway`.
- `@moderado/contracts` resolves to `dist`; run `node node_modules/typescript/bin/tsc -b`
  after contract edits before running tests.
- The Gateway contract is documented in `docs/CLOUD_GATEWAY_INTEGRATION.md`.
