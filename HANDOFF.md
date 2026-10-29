# Moderado Project Handoff

Updated: 2026-10-29 12:45 UTC
Branch: master
Commit: HEAD `7cae817` (pushed); release candidate `v0.4.53` staged but uncommitted
Status: release-ready — version bumped, docs updated, all pre-flight gates pass

## Summary

The CLI supports the Gateway's account-free models: a fresh install can chat
with no API key. The Gateway now marks its two pinned defaults in `/v1/models`
with `section: 'default'`, and keyless Moderado `/model` lists exactly those
entries for explicit selection (by stealth label) instead of an `auto` row.
Selecting one pins it, and every model in a keyless Moderado session is priced
at `$0.00`. All changes are uncommitted in both repositories.

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

Release prep for `v0.4.53` is complete locally. `npm run version:patch` moved
`VERSION` to `v0.4.53+2610291` and staged `VERSION`, `apps/cli/package.json`,
and `package-lock.json` together; the changelog now records both the unshipped
`v0.4.52` Gateway work and this release; README, `docs/RELEASING.md`, and
`docs/DISTRIBUTION.md` name `v0.4.53` as the candidate. No commit, tag, push,
or publish has been performed.

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
  `v0.4.34`/`v0.4.46`. `VERSION` is `v0.4.53+2610291`.

## In progress

- Nothing outstanding. `v0.4.53` is release-ready; commit/tag/push/publish wait
  for explicit owner instruction.

## Working tree

- `moderado`: staged `VERSION`, `apps/cli/package.json`, `package-lock.json`;
  unstaged source, test, `AGENTS.md`, and docs changes listed above, plus
  `CHANGELOG.md`, `README.md`, `docs/DISTRIBUTION.md`, `docs/RELEASING.md`, and
  this handoff; untracked `packages/tools/src/tools/save_to_documents.ts` and
  `packages/tools/tests/save_document.test.ts`.
- `moderado-gateway`: clean at `27565dd` (pushed to `master`).

## Checks

- `npm run build` — PASS
- `npm test` — PASS (74 files, 766 passed, 1 skipped)
- `npm run typecheck` — PASS
- `npm run verify:package` — PASS; `apps/cli/moderado-0.4.53.tgz` verified, tag
  candidate `v0.4.53` matches the package version.
- Real-path check: `save_to_documents` wrote and removed
  `C:\Users\MZou\Documents\moderado-save-check.txt`.
- `moderado-gateway` `npm test` — 226 pass, 1 skip, 1 fail; the failure is the
  pre-existing "clearing low-TPS benchmark results" test (`9 !== 8`), reproduced
  at HEAD and unrelated to these changes. New test: keyless pinned-default
  inference returns 200 while a non-default free route still returns 401.
- No live provider or Gateway calls are made by either suite; Gateway probes in
  tests use local mock servers and stubbed `fetch`.
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
  It requires approval, and auto-approve covers it like every other local tool.
- The tool carries the file content directly instead of copying a workspace file,
  so the model writes once and never needs a workspace staging copy.

## Blockers

- None.

## Next action

1. On owner instruction: commit the release (the staged version files must be
   part of the commit), tag `v0.4.53`, and push the tag so the read-only
   artifact workflow runs. Publication stays a manual `publish.yml` dispatch
   with `confirm=PUBLISH`.
2. Smoke-test in a live terminal: ask for a short note to download and confirm
   it lands in `C:\Users\MZou\Documents` with the path named; confirm the
   `#1a3838` three-row question band and composer pinning; test `/connect` ->
   Moderado -> **Change server**.
3. Deploy Gateway `27565dd` to production and set `MODERADO_DEFAULT_MODEL` (or
   `operator_state.default_model`) to two published stealth routes.

## Resume notes

- Tests: `node node_modules/vitest/vitest.mjs run apps/cli/tests/model_selector_cloud.test.ts`,
  `.../chat_usage.test.ts`, `.../auto_gateway.test.ts`; Gateway suites run with
  `node --test` from `E:\projects\moderado-gateway`.
- `@moderado/contracts` resolves to `dist`; run `node node_modules/typescript/bin/tsc -b`
  after contract edits before running tests.
- The Gateway contract is documented in `docs/CLOUD_GATEWAY_INTEGRATION.md`.
