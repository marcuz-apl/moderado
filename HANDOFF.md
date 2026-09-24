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
   - macOS `/var` → `/private/var` symlink resolution surfaced two further defects. [`packages/tools/src/tools/list_files.ts`](file:///d:/projects/moderado/packages/tools/src/tools/list_files.ts) computed workspace-relative paths against the *supplied* root while walking a canonicalized directory, so an existing-subdirectory query returned escaped paths (for example `../../private/var/...`) instead of `src/index.ts`; `listFiles` and `ListFilesTool` now canonicalize the walk root once and fall back to the supplied root when it cannot be resolved. The `/session share` assertion in [`apps/cli/tests/chat.test.ts`](file:///d:/projects/moderado/apps/cli/tests/chat.test.ts) now compares against the canonicalized root.
   - The `binary-metadata` merge gate then failed with `ENOENT ... collected/win/manifest.json` because `upload-artifact` keeps the `artifacts/<version>/<target>/` nesting (it roots the archive at the glob's static prefix), while `merge-binaries --source` expects the manifest at the source root; the merge step now resolves each per-target source directory through the connected version.
   - Reproduced that macOS class of defect locally with a Windows junction root (`path !== realpath`): the query form returned `../reprow-.../src/index.ts` before the fix and `src/index.ts` after it.

7. **README reorganized (`bbe1506`, `v0.3.1+2609225`, docs-only)**:
   - Added a simple **Tech Stack** section (TypeScript, Node.js >= 20, ESM, Zod, Vitest, npm workspaces, `@yao-pkg/pkg`, GitHub Actions OIDC).
   - Moved Highlights, Documentation Index, Workspace Layout, Practical coding workflow, Diagnostics evidence, TypeScript language intelligence, Local MCP tools, Host event protocol, and Doctor command byte-for-byte into the new [`docs/GUIDE.md`](file:///d:/projects/moderado/docs/GUIDE.md); no tests assert README structure, and the `#install-moderado` anchor used by `docs/FIRST_PUBLISH.md` still resolves.
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
3. Distribution follow-through: watch [winget-pkgs#439175](https://github.com/microsoft/winget-pkgs/pull/439175) to merge; AUR needs an Arch uploader for `moderado-bin`; per-release tap/bucket bumps are manual copies (auto-push needs a cross-repo `TAP_PUSH_TOKEN` — owner decision, see `docs/DISTRIBUTION.md` §6).

## Blockers

- None. Publish workflow failure 35665118071 (E404, no credentials) is the expected pre-bootstrap outcome, superseded by the manual first publish.
