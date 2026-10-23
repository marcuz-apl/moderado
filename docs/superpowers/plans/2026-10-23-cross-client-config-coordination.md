# Cross-client Shared Config Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Moderado CLI, IDE, and Desktop safely share `~/.moderado/config.json`, preserving independent updates and reporting stale same-field edits.

**Architecture:** Keep the IDE's existing `${configPath}.moderado-lock` protocol as the cross-client contract. Each client acquires that lock, rereads the complete JSON object, detects conflicts against the caller's expected values, merges only its patch, and atomically renames a private sibling temp file. Desktop stores global provider defaults under `desktop`; its secrets and session settings remain in their existing stores.

**Tech Stack:** Node.js 20+ ESM, TypeScript, existing Zod/Vitest setup, Rust/Tauri, serde_json, OS file/process primitives. Add no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-cross-client-config-coordination-design.md`

## Global Constraints

- The guarantee covers CLI, IDE, and Desktop versions that implement this protocol. Other writers that ignore the lock can still race.
- Sharing the profile does not make credentials portable between OS credential stores, and does not merge per-session history or settings.
- Existing CLI and IDE connection fields remain compatible. Desktop-specific global defaults live in a namespaced field and preserve unrelated fields.
- Use the existing bounded 5-second lock wait, `${configPath}.moderado-lock`, and exclusive `${configPath}.moderado-lock.reap` stale recovery claim.
- Never reclaim a lock based on age alone; verify the recorded PID is gone and ownership still matches before removal.
- Refuse writes for malformed or unreadable config, lock timeout, uncertain ownership, and same-field conflicts.
- Write a private sibling temp file and atomically rename it over the profile; release only a lock whose PID and token match this writer.
- Preserve unknown keys, keep secrets in OS credential stores, and never use the developer's real `~/.moderado` profile in tests.
- Do not add runtime dependencies.

---

## File Map

### CLI repository (`/Users/marcus/Desktop/projects/moderado`)

- Modify `apps/cli/src/config.ts`: implement a shared-protocol config patch writer; route all CLI config mutations and credential migration through it.
- Modify `apps/cli/tests/config.test.ts`: cover coordination outcomes and existing config mutation behavior.
- Modify CLI config mutation call sites in `apps/cli/src/commands/run.ts`, `apps/cli/src/commands/chat.ts`, `apps/cli/src/skills.ts`, and `apps/cli/src/ui/model_selector.ts` to pass expected values and handle conflict/error results.

### IDE repository (`/Users/marcus/Desktop/projects/moderado-ide`)

- Modify `extensions/moderado-agent/src/coordination.ts` only if conformance tests find a protocol mismatch; otherwise preserve the established implementation.
- Add `extensions/moderado-agent/test/coordination.test.ts` for cross-process interoperability and shared edge cases.
- Modify `extensions/moderado-agent/src/extension.ts` only if necessary to surface typed conflicts from shared protocol behavior.

### Desktop repository (`/Users/marcus/Desktop/projects/moderado-desktop`)

- Modify `src-tauri/src/provider/settings.rs`: represent the `desktop` profile namespace, preserve unknown profile keys, coordinate profile writes, and support legacy `provider.json` reads.
- Modify `src-tauri/src/lib.rs`: point global settings at `~/.moderado/config.json` and retain existing keychain/session boundaries.
- Modify `src-tauri/src/provider/settings.rs` tests for lock behavior, merge, conflict, malformed data, and legacy fallback.

## Protocol Interfaces

The Node clients expose a coordinated mutation with these semantics (keep signatures aligned with current code conventions):

```ts
type ConfigUpdateResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; reason: 'conflict' | 'timeout' | 'invalid' | 'io'; fields?: string[]; message: string };

function updateConfigCoordinated(
  configPath: string,
  patch: Record<string, unknown>,
  options?: { expected?: Record<string, unknown>; timeoutMs?: number },
): ConfigUpdateResult;
```

`expected` contains the values observed by the UI for every patched leaf. Compare only those paths; absent values compare as absent. For a record-valued field such as `connections`, compare the specific edited connection entry, not the entire record. A successful mutation rereads under lock and merges only the patch, preserving all unrelated values and unknown keys. CLI may retain a convenience `saveConfig` wrapper, but it must return/propagate `ConfigUpdateResult` and must not perform an unlocked read/modify/write.

Desktop uses the same on-disk lock record shape and JSON semantics as the IDE. Its Rust helper returns `Result<ProviderSettings, String>` at the Tauri command boundary; errors must identify conflict, timeout, invalid profile, and I/O cases sufficiently for the UI to request reload/retry.

## Task 1: Lock CLI mutations against the shared profile

**Files:**
- Modify: `apps/cli/src/config.ts`
- Test: `apps/cli/tests/config.test.ts`

**Interfaces:**
- Produces `updateConfigCoordinated(configPath, patch, options)` and typed `ConfigUpdateResult` as specified above.
- `saveConfig` and all exported mutation helpers return or propagate the result; no call site may silently ignore a failed write.

- [ ] **Step 1: Add failing tests for serialized merge and field conflict.** Use a temporary `customHome`; verify two independent patches retain both fields, a stale expected value returns `reason: 'conflict'` without changing the file, and unknown keys survive.
- [ ] **Step 2: Run the focused test to confirm failure.** Run `npm test -- --run apps/cli/tests/config.test.ts` from the CLI repo. Expected: the new coordination API is absent or the lost-update/conflict assertions fail.
- [ ] **Step 3: Add lock acquire/release and atomic patch implementation.** Match IDE lock filename, `{pid, token}` owner record, 5-second default wait, `.reap` claim, live-owner check, ownership-safe cleanup, malformed JSON refusal, private sibling temp file, and rename.
- [ ] **Step 4: Route every config writer through the patch API.** Update `saveConnection`, `saveMcpServer`, `setMcpServerEnabled`, `removeMcpServer`, `saveConfig`, and `migrateLegacyCredentials`; remove direct writes to `config.json` and do not turn parse errors into `{}` for writes.
- [ ] **Step 5: Update each CLI caller to provide expected values and display failures.** For values selected from a loaded config, pass that exact observed field/entry; after conflict, tell the user to reload/retry. For noninteractive mutation, return a nonzero command error.
- [ ] **Step 6: Run the focused test and typecheck.** Run `npm test -- --run apps/cli/tests/config.test.ts` and `npm run typecheck` from the CLI repo. Expected: both pass.

## Task 2: Prove IDE protocol interoperability

**Files:**
- Modify only if needed: `/Users/marcus/Desktop/projects/moderado-ide/extensions/moderado-agent/src/coordination.ts`
- Test: `/Users/marcus/Desktop/projects/moderado-ide/extensions/moderado-agent/test/coordination.test.ts`

**Interfaces:**
- Consumes the shared lock and result semantics defined in Task 1.
- Produces a conformance test showing an IDE write and a CLI-compatible write serialize on the same lock file and preserve independent keys.

- [ ] **Step 1: Add failing interoperability tests.** In a temporary profile, have separate child processes using the IDE helper and a minimal protocol-compatible writer contend on the same lock; assert both independent updates persist, stale same-field updates conflict, and malformed JSON is unchanged.
- [ ] **Step 2: Run the focused IDE test.** Run `npm --prefix extensions/moderado-agent test -- --run test/coordination.test.ts`. Expected: pass for current protocol or fail with the specific on-disk mismatch.
- [ ] **Step 3: Correct only demonstrated protocol mismatches.** Preserve the current IDE API and behavior when it already matches the contract; do not refactor callers unnecessarily.
- [ ] **Step 4: Run IDE focused tests and typecheck.** Run `npm --prefix extensions/moderado-agent test -- --run test/coordination.test.ts` and `npm --prefix extensions/moderado-agent run typecheck`. Expected: both pass.

## Task 3: Move Desktop global defaults to the shared profile

**Files:**
- Modify: `/Users/marcus/Desktop/projects/moderado-desktop/src-tauri/src/provider/settings.rs`
- Modify: `/Users/marcus/Desktop/projects/moderado-desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Keep the public `ProviderSettings` fields (`providerId`, `baseUrl`, `planModel`, `actModel`) and Tauri command names intact.
- Store these fields at `config.desktop` while retaining the rest of the root JSON object.
- Resolve the shared config path from the user's home directory; use the legacy `provider.json` only when `config.desktop` is absent. Do not delete or rewrite the legacy file as part of reading.

- [ ] **Step 1: Add failing Rust tests for desktop namespace merge and fallback.** Use `tempfile` profiles; verify existing CLI/IDE keys survive save, legacy settings load when `desktop` is absent, and the legacy file remains unchanged.
- [ ] **Step 2: Run focused Rust tests to confirm failure.** Run `cargo test --manifest-path src-tauri/Cargo.toml provider::settings`. Expected: new behavior fails against the existing standalone settings file implementation.
- [ ] **Step 3: Implement profile read/patch/write with the shared protocol.** Use Rust standard-library and existing dependencies only. Match the IDE lock record and `.reap` semantics, create owner tokens from OS-provided randomness without adding a crate, check process liveness with platform-native APIs, compare expected desktop values while holding the lock, preserve unknown root keys, write a mode-restricted sibling temp file where supported, and atomically rename.
- [ ] **Step 4: Integrate shared path and migration fallback.** Update `settings_path`/load/save command flow so global settings use `~/.moderado/config.json`; fallback to the existing app config `provider.json` only when there is no `desktop` namespace. Keep keychain secrets and session values outside the shared profile.
- [ ] **Step 5: Run focused Rust tests and formatting.** Run `cargo test --manifest-path src-tauri/Cargo.toml provider::settings` and `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`. Expected: both pass.

## Task 4: Cross-process protocol verification and user-facing errors

**Files:**
- Modify: `apps/cli/tests/config.test.ts`
- Modify: `/Users/marcus/Desktop/projects/moderado-ide/extensions/moderado-agent/test/coordination.test.ts`
- Modify: `/Users/marcus/Desktop/projects/moderado-desktop/src-tauri/src/provider/settings.rs`
- Modify only if required: client call sites named in Tasks 1–3

**Interfaces:**
- All three writers use `${configPath}.moderado-lock`, a matching owner record, reread-under-lock, same-field conflict behavior, stale owner verification plus `.reap`, atomic rename, and ownership-checked release.
- No client treats invalid JSON as an empty profile for a write.

- [ ] **Step 1: Add an offline two-process contention test.** Spawn two independent writers against one temporary `config.json`, one patching `connections.cli` and one patching `desktop`; assert both survive regardless of write order.
- [ ] **Step 2: Add stale-lock, timeout, and cleanup assertions.** Verify live owners are not reaped, dead owners are recovered only while holding `.reap`, timeout performs no write, and a process only removes its own token-matching lock.
- [ ] **Step 3: Add atomicity and malformed-profile assertions.** Verify a failed/invalid update leaves original bytes intact and no temporary or lock artifact remains after ordinary success/failure cleanup.
- [ ] **Step 4: Run all three focused suites and type checks.** CLI: `npm test -- --run apps/cli/tests/config.test.ts && npm run typecheck`; IDE: `npm --prefix extensions/moderado-agent test -- --run test/coordination.test.ts && npm --prefix extensions/moderado-agent run typecheck`; Desktop: `cargo test --manifest-path src-tauri/Cargo.toml provider::settings && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] **Step 5: Review all config write paths.** Search each repository for writes to `config.json` or the old `provider.json`; confirm all shared-profile mutations use the lock and Desktop only reads legacy `provider.json` as fallback.

## Self-review against the spec

- Shared locking, stale recovery, ownership-safe release, reread/merge, field conflicts, malformed-file refusal, and atomic replacement: Tasks 1–4.
- CLI migration and all mutation routes: Task 1.
- IDE compatibility and multi-process proof: Tasks 2 and 4.
- Desktop namespace, path, fallback, keychain/session boundaries: Task 3.
- Offline tests for unknown keys, unrelated updates, same-field conflicts, corruption, contention, recovery, timeout, and migration fallback: Tasks 1–4.
- Unknown root-field preservation and no new runtime dependencies: Global Constraints and Tasks 1/3.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-23-cross-client-config-coordination.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

The IDE and Desktop directories are outside the current writable root. Before implementation can edit them, execution must request the required filesystem escalation; the CLI plan and review work can proceed in this repository meanwhile.
