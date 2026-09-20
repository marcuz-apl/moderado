# Practical Coding Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a reviewable Plan-to-Build workflow, safe Git inspection, patch previews, checkpoints, and conflict-safe undo.

**Architecture:** `packages/tools` owns safe Git inspection, exact multi-file patching, and checkpoint persistence. `apps/cli` owns slash-command popups, active-plan state, and approval rendering. `packages/core` continues to orchestrate only contract-defined tools and approvals.

**Tech Stack:** TypeScript, Node.js 20 standard library, existing Zod, Vitest, temporary local Git repositories.

**Spec:** `docs/superpowers/specs/M3-practical-coding-workflow-design.md`

## Global constraints

- Do not add runtime dependencies.
- Keep every test offline.
- Use fixed Git arguments with `--no-ext-diff --no-color --no-textconv`.
- Keep writes inside the existing workspace jail and preserve protected-file rules.
- Keep checkpoint contents outside the workspace in `~/.moderado/checkpoints`.
- Require interactive approval for mutations and undo.

---

### Task 1: Safe Git workspace inspection

**Files:**
- Create: `packages/tools/src/git_workspace.ts`
- Modify: `packages/tools/src/index.ts`
- Create: `packages/tools/tests/git_workspace.test.ts`

**Interfaces:**
- Produces `inspectGitWorkspace(root)` and `readGitDiff(root)`.
- `inspectGitWorkspace` returns `{ isRepository, branch?, ahead?, behind?, files }`.

- [x] **Step 1: Write failing Git summary tests**

Create a temporary repository with `git init`, one committed file, one modified
file, and one untracked file. Assert the summary has `isRepository: true`, a
branch, and both workspace-relative paths. Assert a plain temporary directory
returns `{ isRepository: false, files: [] }`.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- packages/tools/tests/git_workspace.test.ts`

Expected: FAIL because `git_workspace.ts` does not exist.

- [x] **Step 3: Implement fixed-command Git inspection**

Use `spawn('git', ['status', '--porcelain=v1', '--branch'], { shell: false })`
and parse only porcelain status records. Use fixed `git diff --no-ext-diff
--no-color --no-textconv` arguments for the diff helper. Treat exit code 128 as
a non-repository result; cap output at 100 KB.

- [x] **Step 4: Verify focused tests pass**

Run: `npm test -- packages/tools/tests/git_workspace.test.ts`

### Task 2: Validated multi-file patch tool and preview

**Files:**
- Create: `packages/tools/src/tools/apply_patch.ts`
- Modify: `packages/tools/src/registry.ts`
- Modify: `packages/tools/src/index.ts`
- Modify: `packages/contracts/src/tools.ts`
- Create: `packages/tools/tests/apply_patch.test.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

**Interfaces:**
- Adds `ApplyPatchParamsSchema` with `{ edits: PatchEdit[] }`.
- Registers an approval-required `apply_patch` tool.

- [x] **Step 1: Write failing contract and tool tests**

Assert a two-file edit returns one preview containing both paths. Assert a
missing or duplicate target rejects before either file is written. Assert an
out-of-workspace or protected path rejects.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- packages/contracts/tests/contracts.test.ts packages/tools/tests/apply_patch.test.ts`

Expected: FAIL because `ApplyPatchParamsSchema` and `apply_patch` are absent.

- [x] **Step 3: Implement validate-then-write behavior**

Validate every edit through `WorkspaceJail`, read each file, require one exact
target match, assemble all replacement content and unified previews, then use
the existing atomic-write mechanism only after every validation succeeds.

- [x] **Step 4: Verify focused tests pass**

Run: `npm test -- packages/contracts/tests/contracts.test.ts packages/tools/tests/apply_patch.test.ts`

### Task 3: Checkpoints and conflict-safe restore

**Files:**
- Create: `packages/tools/src/checkpoints.ts`
- Modify: `packages/tools/src/registry.ts`
- Create: `packages/tools/tests/checkpoints.test.ts`

**Interfaces:**
- Produces `WorkspaceCheckpointStore.capture()` and `restoreLatest()`.
- Restore returns `{ restored: string[] }` or `{ conflicts: string[] }`.

- [x] **Step 1: Write failing checkpoint tests**

Capture a file before a write, record its resulting SHA-256 digest, then assert
restore returns its previous bytes. Change the file after the write and assert
restore returns the conflicting path without altering any file.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- packages/tools/tests/checkpoints.test.ts`

Expected: FAIL because `WorkspaceCheckpointStore` does not exist.

- [x] **Step 3: Implement schema-validated checkpoint storage**

Hash the canonical workspace path with SHA-256, store one JSON checkpoint under
the user's Moderado directory, and record absent or present pre-write states.
Compare all post-write digests before restoring any file. Retain only the most
recent completed checkpoint per workspace.

- [x] **Step 4: Verify focused tests pass**

Run: `npm test -- packages/tools/tests/checkpoints.test.ts`

### Task 4: Wire previews and checkpoints into mutation approvals

**Files:**
- Modify: `packages/core/src/agent.ts`
- Modify: `packages/tools/src/registry.ts`
- Modify: `apps/cli/src/ui/terminal_approval.ts`
- Modify: `packages/core/tests/agent.test.ts`
- Modify: `apps/cli/tests/terminal_approval.test.ts`

**Interfaces:**
- Approval payload carries bounded `diffPreview` for write, edit, and patch.
- The registry captures a checkpoint immediately before an approved mutation.

- [x] **Step 1: Write failing approval tests**

Assert an edit approval request includes its unified preview. Assert denied
mutations do not create a checkpoint. Assert an approved mutation creates one
checkpoint before the filesystem changes.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- packages/core/tests/agent.test.ts apps/cli/tests/terminal_approval.test.ts`

Expected: FAIL because approval payloads do not yet carry previews or checkpoints.

- [x] **Step 3: Implement one visible approval path**

Generate previews before `requestApproval`, render them in the terminal handler
with a fixed display limit, and call checkpoint capture only after approval and
immediately before the mutation tool executes. Preserve auto-approve for read
tools only; mutation previews remain visible.

- [x] **Step 4: Verify focused tests pass**

Run: `npm test -- packages/core/tests/agent.test.ts apps/cli/tests/terminal_approval.test.ts`

### Task 5: Plan, Build, Git, Diff, and Undo CLI workflow

**Files:**
- Modify: `apps/cli/src/commands/chat.ts`
- Modify: `apps/cli/src/ui/welcome.ts`
- Create: `apps/cli/src/ui/workflow_popups.ts`
- Modify: `apps/cli/tests/welcome.test.ts`
- Modify: `apps/cli/tests/chat.test.ts`

**Interfaces:**
- Adds `/git`, `/diff`, `/build`, and `/undo` slash commands.
- Tracks `activePlan?: string` per session and uses existing popup layering.

- [x] **Step 1: Write failing UI and chat-flow tests**

Assert slash completion exposes all four commands. Assert Plan mode adds a
checklist instruction to the model request and preserves the completed answer
as `activePlan`. Assert `/build` cannot proceed without an active plan. Assert
`/undo` requests approval and reports conflicts without partial restore.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- apps/cli/tests/welcome.test.ts apps/cli/tests/chat.test.ts`

Expected: FAIL because M3 commands and active-plan state are absent.

- [x] **Step 3: Implement the popup workflow**

Register the commands in `SLASH_COMMANDS`. Render Git and diff outputs in
bounded scrollable popups. In Plan mode, prefix the user request with a
checklist instruction; retain the answer as the active plan. Require explicit
confirmation in `/build` before switching to Execute. Route `/undo` through
the existing approval handler and the checkpoint store.

- [x] **Step 4: Verify focused tests pass**

Run: `npm test -- apps/cli/tests/welcome.test.ts apps/cli/tests/chat.test.ts`

### Task 6: Documentation, validation, and commit

**Files:**
- Modify: `README.md`
- Modify: `docs/CLI_CAPABILITY_ROADMAP.md`
- Modify: `HANDOFF.md`

- [x] **Step 1: Document the workflow**

Explain `/git`, `/diff`, `/build`, and `/undo`; describe the local checkpoint
location, conflict behavior, and that Plan mode cannot execute mutations.

- [x] **Step 2: Mark M3 complete only after all acceptance criteria hold**

Update the roadmap and handoff with actual validation counts and the next
milestone. Do not claim completion if checkpoint restore or patch atomicity is
not covered by tests.

- [x] **Step 3: Run complete validation**

Run: `npm test; npm run build; git diff --check`

Expected: all offline tests pass, TypeScript builds, and no whitespace errors.

- [x] **Step 4: Commit with the Alfazen hook**

Run: `git commit -m "feat(cli): add practical coding workflow"`

