# Moderado Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `moderado update` for the latest release within the installed major version and `moderado upgrade` for the latest release across majors.

**Architecture:** Route both explicit commands through the CLI composition layer into one focused maintenance command. Identify the current installation channel, validate remote release metadata, and dispatch to the matching updater. npm installs use a constrained global npm invocation; supported standalone installs use the existing release manifest and checksum guarantees before replacing the executable. Package-manager-owned installs receive exact manual instructions.

**Tech Stack:** TypeScript ESM, Node.js built-ins (`fetch`, `child_process.spawn`, `node:crypto`, `node:fs/promises`, `node:path`), Vitest local HTTP fixtures.

**Spec:** `docs/superpowers/specs/2026-10-12-self-update-design.md`

## Global Constraints

- Node.js >= 20; no new runtime dependencies.
- External release JSON and version strings are validated before use.
- Child processes receive executable and argv separately with `shell: false`.
- Never replace the current standalone executable before artifact checksums pass.
- Test release downloads against local fixtures; tests never call GitHub or npm registry.
- Preserve package-manager ownership and fail closed when install source is ambiguous.

---

### Task 1: Add update and upgrade to the CLI command surface

**Files:**
- Modify: `apps/cli/src/args.ts`
- Test: `apps/cli/tests/args.test.ts`

**Interfaces:**
- `CliParsedArgs.command` gains `'update' | 'upgrade'`.
- `parseCliArgs(['update'])` and `parseCliArgs(['upgrade'])` return the corresponding command.

- [x] **Step 1: Add failing parser assertions** for both commands and ensure `moderado update` is not interpreted as a run task.
- [x] **Step 2: Run** `npm test -- apps/cli/tests/args.test.ts`; confirm the new assertions fail because both positionals currently become run tasks.
- [x] **Step 3: Add the two command literals** to the command union and recognize them before implicit task routing.
- [x] **Step 4: Add both commands to `getHelpText()`** with short descriptions distinguishing same-major update from cross-major upgrade.
- [x] **Step 5: Re-run** `npm test -- apps/cli/tests/args.test.ts`; confirm it passes.

### Task 2: Implement release metadata validation and target selection

**Files:**
- Create: `apps/cli/src/self_update.ts`
- Test: `apps/cli/tests/self_update.test.ts`

**Interfaces:**
- Export a validated release type containing `tag_name`, `html_url`, and the parsed semantic version needed by selection.
- Export `selectUpdateRelease(releases, installedVersion, mode)` where mode is `'update' | 'upgrade'`; return the selected release or a typed error when none is compatible.
- Export a release-list fetch function accepting an injectable `fetch` implementation and signal for deterministic tests and cancellation.

- [x] **Step 1: Write failing tests** for valid release parsing, malformed JSON shapes, malformed tags, connected `+yymmddc` installed version parsing, same-major filtering, cross-major selection, already-current behavior, and no-compatible-release behavior.
- [x] **Step 2: Run** `npm test -- apps/cli/tests/self_update.test.ts`; confirm tests fail because the module does not exist.
- [x] **Step 3: Implement a strict runtime guard** for GitHub release objects and a narrow SemVer parser for `vM.N.P` tags; reject prereleases, drafts, duplicate/invalid tags, and unexpected structures.
- [x] **Step 4: Implement selection**: `update` filters to installed major and selects the numerically highest release; `upgrade` selects the numerically highest release regardless of major. Compare only `M.N.P`, ignoring connected build metadata in the installed version.
- [x] **Step 5: Fetch the published releases list** through native `fetch`, checking HTTP status and validating the top-level array before selection. Bound pagination to the documented release lookup needed to find the latest compatible version.
- [x] **Step 6: Re-run** `npm test -- apps/cli/tests/self_update.test.ts`; confirm all metadata and selection cases pass.

### Task 3: Identify install channels and safely update npm installs

**Files:**
- Modify: `apps/cli/src/self_update.ts`
- Test: `apps/cli/tests/self_update.test.ts`

**Interfaces:**
- Export `detectInstallChannel(executablePath, platform)` returning a discriminated result for `npm`, `standalone`, known package-manager ownership with update guidance, or `unknown`.
- Export `buildNpmUpdateInvocation(version, platform, npmExecPath?)` returning `{ command, args }`.

- [x] **Step 1: Write failing tests** for known npm package layout detection, standalone executable detection, Homebrew/Scoop ownership guidance, ambiguous paths, and npm invocation arguments on POSIX and Windows.
- [x] **Step 2: Run** `npm test -- apps/cli/tests/self_update.test.ts`; confirm these tests fail.
- [x] **Step 3: Inspect runtime paths from `process.argv[1]`, module URL, and platform** and implement detection only for verifiable layouts; unknown paths return an actionable unsupported result.
- [x] **Step 4: Build npm argv** to install only `moderado@<validated-version>` globally while preserving the user's npm prefix; use npm's current executable when `npm_execpath` is available, otherwise the platform npm executable.
- [x] **Step 5: Add a runner** based on `spawn(command, args, { shell: false, ... })`, remove provider/internal token environment variables, and surface spawn and nonzero-exit failures clearly.
- [x] **Step 6: Re-run** the focused tests and verify the runner never uses `shell: true` and never invokes a blanket global update.

### Task 4: Update standalone binaries from verified release artifacts

**Files:**
- Modify: `apps/cli/src/self_update.ts`
- Test: `apps/cli/tests/self_update.test.ts`
- Reference: `scripts/binaries.mjs`, `scripts/install.sh`

**Interfaces:**
- Export `updateStandalone(options)` where options provide the selected release, executable path, host platform/architecture, and injectable fetch implementation.
- Reuse the release manifest contract: artifact filename/platform/architecture/checksum and `.sha256` sidecar must agree before installation.

- [x] **Step 1: Add local HTTP fixture tests** for valid artifact replacement, missing host artifact, malformed manifest, bad sidecar, manifest checksum mismatch, truncated/network failure, and cleanup of staged files.
- [x] **Step 2: Run** `npm test -- apps/cli/tests/self_update.test.ts`; confirm the standalone tests fail.
- [x] **Step 3: Validate the release manifest** including version equality with the selected tag, unique artifact targets, supported host match, safe basename-only filename, integer size, 64-character lowercase SHA-256, and `signed: false` matching the published contract.
- [x] **Step 4: Download to a unique sibling temporary path**, verify the artifact digest against both the sidecar and manifest and verify size, then set executable permissions on POSIX.
- [x] **Step 5: Replace the executable with platform-aware behavior**: use same-volume rename where supported; on Windows handle running-image locks without deleting the original, and provide restart/manual instructions if replacement cannot safely complete. Always clean temporary files.
- [x] **Step 6: Re-run** the focused tests and confirm all network behavior is confined to the local fixture server.

### Task 5: Wire commands, cancellation, and user-facing messages

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/self_update.ts`
- Test: `apps/cli/tests/self_update.test.ts`

**Interfaces:**
- Export `handleSelfUpdateCommand(mode: 'update' | 'upgrade', installedVersion: string, signal: AbortSignal): Promise<number>`.
- Route only explicit `update` and `upgrade` commands to this handler before starting chat or run sessions.

- [x] **Step 1: Add handler tests** for current-version success, successful npm and standalone dispatch, package-manager manual instructions, unknown install source, abort, and each updater failure returning nonzero.
- [x] **Step 2: Run** `npm test -- apps/cli/tests/self_update.test.ts`; confirm handler tests fail.
- [x] **Step 3: Implement the handler** to resolve release target, report installed/target versions, return success when current, dispatch by detected source, and print exact manual update guidance for package-managed channels.
- [x] **Step 4: Wire command routing** in `index.ts` and pass the existing abort signal and resolved current version.
- [x] **Step 5: Run** `npm test -- apps/cli/tests/self_update.test.ts apps/cli/tests/args.test.ts`; confirm routing and handler tests pass.

### Task 6: Document the commands and validate the CLI build

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `docs/DISTRIBUTION.md`

- [ ] **Step 1: Document** `moderado update` (latest release within current major) and `moderado upgrade` (latest release including major changes), supported npm/standalone in-place behavior, package-manager commands, and fail-closed manual fallback.
- [ ] **Step 2: Run** `npm run typecheck` and `npm test -- apps/cli/tests/args.test.ts apps/cli/tests/self_update.test.ts apps/cli/tests/install_script.test.ts`; confirm types and focused tests pass.
- [ ] **Step 3: Review the diff** against the design spec and ensure package scripts, release workflows, and runtime dependencies did not change unnecessarily.

