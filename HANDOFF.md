# VS Code Extension Milestone 1

Updated: 2026-09-29
Branch: `codex/vscode-extension` (from `master` at `9c87697`, CLI `v0.3.8`)
Status: Milestone 1 of [`docs/superpowers/plans/2026-09-29-vscode-extension-rebuild.md`](file:///d:/projects/moderado/docs/superpowers/plans/2026-09-29-vscode-extension-rebuild.md) is implemented and green. Nothing is pushed to `origin` yet.

## Completed

- Extracted the provider preset catalog and the free-model policy out of the CLI presentation layer into [`packages/providers/src/presets.ts`](file:///d:/projects/moderado/packages/providers/src/presets.ts); `apps/cli/src/config.ts` and `apps/cli/src/model_pricing.ts` now re-export from it. CLI behavior is unchanged.
- Added the versioned webview host protocol ([`packages/contracts/src/host_protocol.ts`](file:///d:/projects/moderado/packages/contracts/src/host_protocol.ts)): ten intents and ten results, all `.strict()`, with request IDs and `protocolVersion`.
- Added the extension host: [`apps/vscode/src/agent_host.ts`](file:///d:/projects/moderado/apps/vscode/src/agent_host.ts) (intent dispatch, turn lifecycle, session registry), [`approval_handler.ts`](file:///d:/projects/moderado/apps/vscode/src/approval_handler.ts) (five categories, host-side gate), `provider_service.ts` (catalog + proven-free filter), and [`extension.ts`](file:///d:/projects/moderado/apps/vscode/src/extension.ts) (webview view provider, SecretStorage keys, per-workspace state).
- Removed a duplicate approval gate bug found while writing the host: `resolve_approval` was consulting the settings-level gate while turns ran under a per-turn gate; the per-turn gate is now tracked in `activeGate`.
- `scripts/build_vscode.mjs` resolves entry and output from the repo root, because npm runs workspace scripts with `cwd` set to the workspace.
- Removed stale `apps/vscode/dist/` artifacts left over from deleted `extension.ts`, `protocol.ts`, `sidecar.ts`, and `webview/*` sources.

## Checks

- `npm.cmd run build` — PASS.
- `npm.cmd run typecheck` — PASS.
- `npm.cmd test` — PASS: 64 files / 460 tests, offline.
- `npm.cmd run build --workspace apps/vscode` — PASS: emits `dist/extension.cjs`.

## Decisions

- `filterProvenFreeModels(connectionId, entries)` takes the connection id and resolves the free policy itself. Letting the webview pass a policy object would let a caller widen the free list, so the host rejects any model the provider cannot substantiate (`MODEL_NOT_FREE`).
- `packages/providers/tests/presets.test.ts` asserted seven preset metas; shipped `0.3.8` has six, because `openai-compatible` is a CLI pick-list entry with no fixed base URL. The test now asserts the six metas and that the id list still contains `openai-compatible`.
- `listProviderPresets` does not yet append the `openai-compatible` pick-list entry. Milestone 2 owns the provider picker; the existing test pins the current two-source list (enabled built-ins plus configured custom connections).

## Blockers

- None.

## Next action

1. Milestone 2: API Configuration and About. `extension.ts` currently has no credential-entry flow, so `createProvider` reads a key that nothing can set yet; add the SecretStorage write path and the `openai-compatible` / custom-provider entries, then the About page sourced from packaged metadata.

---

The following is historical handoff content from the tag, not current verification.

# Project Handoff

Updated: 2026-09-22 22:37 UTC
Branch: master
Commit: `bbe1506` (`v0.3.1+2609225`)
Status: npm `moderado@0.3.0` is PUBLISHED (manual first publish, no `--provenance`); GitHub Release `v0.3.0` carries all 7 binary assets. README reorganized (`bbe1506`, `v0.3.1+2609225`): Tech Stack section, feature/reference sections moved to `docs/GUIDE.md`, Install Moderado rewritten per-OS (Linux/macOS/Windows) with no "Other install channels". All distribution channels except Chocolatey (deliberately out of scope) are DONE: curl installer (`scripts/install.sh`, dual checksum gate, 2 offline tests), Homebrew tap `marcuz-apl/homebrew-moderado` and Scoop bucket `marcuz-apl/scoop-moderado` seeded with byte-identical v0.3.0 manifests, winget submission open as [winget-pkgs#439175](https://github.com/microsoft/winget-pkgs/pull/439175) (validation queued), AUR payload attached to the Release (awaiting an Arch uploader). CI wiring landed on master (`9530ddc`, `v0.3.1+2609223`): `release.yml` distribution job, `publish.yml` release attachments + `npm@latest` OIDC fix. Local checks green (50 suites, 347 tests; typecheck clean). Docs: `docs/DISTRIBUTION.md`, `docs/FIRST_PUBLISH.md`, `docs/GUIDE.md`.

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

2. **Release metadata aligned to `0.3.0` ([`apps/cli/package.json`](file:///d:/projects/moderado/apps/cli/package.json), [`package-lock.json`](file:///d:/projects/moderado/package-lock.json), [`README.md`](file:///d:/projects/moderado/README.md), [`apps/cli/README.md`](file:///d:/projects/moderado/apps/cli/README.md))**:
   - The publishable package version and the `apps/cli` lockfile workspace entry are `0.3.0`, so `verify:package` emits `moderado-0.3.0.tgz` and the GitHub Release cannot attach a mislabelled artifact; npm installs report `v0.3.0` through the `package.json` fallback in [`apps/cli/src/index.ts`](file:///d:/projects/moderado/apps/cli/src/index.ts).
   - Both README badges read `v0.3.0+260921I` at release time (since refreshed to `v0.3.1+2609225` by the README reorg below).

3. **Release runbook updated ([`docs/RELEASING.md`](file:///d:/projects/moderado/docs/RELEASING.md))**:
   - Pre-flight Step 0 requires the npm version to match the SemVer portion of `VERSION`; all examples now reference `v0.3.0` and `moderado-0.3.0.tgz`.
   - Step 2 derives the tag from `cut -d+ -f1 VERSION` instead of hard-coding a version.

4. **Verification & package preparation**:
   - `npm run typecheck` â€” clean; `npm test` â€” 49 suites, 343 tests passing offline.
   - `npm run verify:package` â€” vendored bundle, importer rewrite, tarball policy, isolated global install, and `moderado --help` smoke test all pass as `moderado-0.3.0.tgz`.
   - Removed the superseded local `moderado-0.2.61.tgz` so a `npm publish apps/cli/*.tgz` glob cannot ship two versions.

5. **Alfazen hook finding and the workaround used (owner decision still open)**:
   - `.githooks/pre-commit` classifies `.git/COMMIT_EDITMSG`, which `git commit -m`/`-F` only refreshes *after* pre-commit has run. Every commit is therefore classified against the **previous** commit's subject; that previously mis-bumped the prep commit (`v0.2.61` â†’ `v0.2.62`).
   - Reproduced deterministically against the real hooks: a `docs:` commit followed by a `release(minor):` commit committed with `-m` produced no minor bump.
   - Workaround used for this release: pre-seed `.git/COMMIT_EDITMSG` with the release subject before committing. The hook then computed `v0.3.0+260921I`, staged `VERSION`, and `commit-msg` restamped the subject exactly as designed.
   - Consequence to watch: any commit made immediately after a `release(minor):` subject will be mis-bumped to `v0.4.0` unless the hook is fixed. Recommended fix (needs owner approval, shared Alfazen infrastructure): classify the message Git is actually committing, e.g. move the bump into `prepare-commit-msg`.

6. **Release gate repaired (surfaced by the first-ever tag-push verification run)**:
   - `.github/workflows/release.yml` and `.github/workflows/publish.yml` ran `npm test` on a fresh clone where the workspace packages have no `dist/`, so 24 suites failed to resolve `@moderado/core`, `@moderado/contracts`, `@moderado/providers`, and `@moderado/tools`. Both workflows now run `npm run build` before `npm test`, matching the documented pre-flight order.
   - `packages/tools/tests/jail.test.ts` asserted that backslash-only UNC notation escapes the jail, which is only true on Windows. That assertion is now guarded by the same drive-letter check the neighbouring tests use, while the POSIX-absolute and WSL-UNC escape assertions still run on every platform.
   - `apps/cli/tests/npm_package.test.ts` no longer depends on the ambient `npm_execpath` and now passes the target platform explicitly, so the Windows invocation contracts are asserted on every runner instead of only on Windows.
   - Reproduced and re-verified in a fresh clone of the tag commit: without the build 24 suites fail exactly as CI reported, and with `npm run build` first the full 49 suites / 343 tests pass.
   - macOS `/var` â†’ `/private/var` symlink resolution surfaced two further defects. [`packages/tools/src/tools/list_files.ts`](file:///d:/projects/moderado/packages/tools/src/tools/list_files.ts) computed workspace-relative paths against the *supplied* root while walking a canonicalized directory, so an existing-subdirectory query returned escaped paths (for example `../../private/var/...`) instead of `src/index.ts`; `listFiles` and `ListFilesTool` now canonicalize the walk root once and fall back to the supplied root when it cannot be resolved. The `/session share` assertion in [`apps/cli/tests/chat.test.ts`](file:///d:/projects/moderado/apps/cli/tests/chat.test.ts) now compares against the canonicalized root.
   - The `binary-metadata` merge gate then failed with `ENOENT ... collected/win/manifest.json` because `upload-artifact` keeps the `artifacts/<version>/<target>/` nesting (it roots the archive at the glob's static prefix), while `merge-binaries --source` expects the manifest at the source root; the merge step now resolves each per-target source directory through the connected version.
   - Reproduced that macOS class of defect locally with a Windows junction root (`path !== realpath`): the query form returned `../reprow-.../src/index.ts` before the fix and `src/index.ts` after it.

7. **README reorganized (`bbe1506`, `v0.3.1+2609225`, docs-only)**:
   - Added a simple **Tech Stack** section (TypeScript, Node.js >= 20, ESM, Zod, Vitest, npm workspaces, `@yao-pkg/pkg`, GitHub Actions OIDC).
   - Moved Highlights, Documentation Index, Workspace Layout, Practical coding workflow, Diagnostics evidence, TypeScript language intelligence, Local MCP tools, Host event protocol, and Doctor command byte-for-byte into the new [`docs/GUIDE.md`](file:///d:/projects/moderado/docs/GUIDE.md); no tests assert README structure, and the `#install-moderado` anchor used by `docs/FIRST_PUBLISH.md` still resolves.
   - Rewrote **Install Moderado** as per-OS subsections (Linux, macOS, Windows) covering every live channel; the "Other install channels" table was folded in and removed as a heading.

## Checks

- `npm run typecheck` â€” PASS (0 errors)
- `npm run build` â€” PASS
- `npm test` â€” PASS (50 test files, 347 tests passed; one earlier run flaked a timing-sensitive test under parallel load, two consecutive reruns green)
- `npm run verify:package` â€” PASS (`Verified moderado-0.3.0.tgz`)
- `git diff --check` â€” PASS (CRLF advisories only)

## Remaining release steps (owner-gated)

**Smallest next action:** configure the npm trusted publisher (item 1) â€” it is the only gate blocking the automated release path.

1. Configure the npm trusted publisher at `https://www.npmjs.com/package/moderado/access` (Trusted Publisher â†’ GitHub Actions): repository `marcuz-apl/moderado`, workflow filename `publish.yml`, environment `release` (or blank). Package now exists.
2. **Decision recorded â€” do NOT release 0.3.1 yet.** Everything since `v0.3.0` is docs + CI/distribution wiring that does not change the shipped CLI, so `0.3.0` already satisfies the public-release gate. Cutting `0.3.1` now would also stale in-flight winget PR #439175 and would have to be manual again (trusted publisher not yet configured). Recommended: release `0.3.1` later purely as a low-stakes validation of the full OIDC pipeline (sync `apps/cli/package.json` â†’ pre-flight â†’ tag `v0.3.1` â†’ green Verify run â†’ dispatch Publish with `confirm: PUBLISH`), ideally after #439175 merges; otherwise skip it and let the next `feat` commit take over as `v0.4.0`. `VERSION` reading `v0.3.1+2609225` while npm sits at `0.3.0` is normal between releases under Alfazen.
3. Distribution follow-through: watch [winget-pkgs#439175](https://github.com/microsoft/winget-pkgs/pull/439175) to merge; AUR needs an Arch uploader for `moderado-bin`; per-release tap/bucket bumps are manual copies (auto-push needs a cross-repo `TAP_PUSH_TOKEN` â€” owner decision, see `docs/DISTRIBUTION.md` Â§6).

## Blockers

- None. Publish workflow failure 35665118071 (E404, no credentials) is the expected pre-bootstrap outcome, superseded by the manual first publish.
