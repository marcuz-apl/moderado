# VS Code Extension and Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a locally installable VS Code extension backed by a validated Moderado sidecar, preserving approval and workspace security while reusing the current packages.

**Architecture:** Add versioned NDJSON host contracts in `packages/contracts`, a headless `moderado host` runtime in `apps/cli`, and a VS Code extension under `apps/vscode`. The extension starts the CLI with `spawn(..., { shell: false })`; it communicates through stdio and renders a task-oriented chat UI with explicit approvals.

**Tech Stack:** TypeScript, Node.js >=20, Zod, existing Moderado workspaces, VS Code Extension API, Vitest, VSIX packaging tooling.

**Spec:** [2026-09-24-vscode-extension-design.md](../specs/2026-09-24-vscode-extension-design.md)

## Global Constraints

- Product version stays within `0.3.x` during development; the completed plugin milestone is `0.4.0`.
- The extension is packaged as a local VSIX; Marketplace publishing is excluded.
- Sidecar and extension use protocol version `1` over newline-delimited JSON, with a 1 MiB maximum line.
- Provider credentials and tool execution stay in the sidecar; the webview gets neither credentials nor direct filesystem/process access.
- Reads follow existing auto-approval rules; every write and command requires explicit approval; disconnect and cancellation fail closed.
- Use existing dependencies and Node/VS Code APIs; add no runtime dependency without justification.
- Offline tests use fake providers and temporary workspaces; test runs make no live provider calls.
- Every commit has the repository connected version prefix; `feat` commits bump patch, `docs`/`fix` commits advance only the build suffix, and a `release(minor)` commit advances to the explicit milestone. When a feature commit changes root SemVer, update `apps/cli/package.json` in that same commit. No implementation commit is pushed unless requested.

## Review Focus

1. **Stale or repeated Git commit message:** hook tests must prove docs/fix commits do not inherit a previous `feat` bump, and feature commits receive the expected SemVer change.
2. **Oversized unterminated NDJSON input:** transport tests must prove the buffer is capped before a newline arrives and the process closes safely.
3. **Selection path traversal or symlink escape:** request contract/runtime tests must reject absolute paths, `..`, sensitive paths, and symlinks outside the workspace.
4. **Approval pending during cancellation or sidecar exit:** host tests must resolve it as aborted/denied and never approved.
5. **Broken sequence continuity across turns:** integration tests must prove stable sidecar session identity and strictly increasing sequence values across chat requests in one sidecar lifetime.

## File Map

- `.githooks/pre-commit`, `.githooks/prepare-commit-msg`, `.githooks/commit-msg`, and hook tests: make connected version stamping use the current commit message and verify its SemVer/build behavior.
- `packages/contracts/src/host_protocol.ts`, `packages/contracts/src/index.ts`, and `packages/contracts/tests/host_protocol.test.ts`: define and validate host requests, responses, events, and per-method payloads.
- `apps/cli/src/args.ts`, `apps/cli/src/index.ts`, `apps/cli/src/commands/host.ts`, and `apps/cli/src/host/*`: add headless dispatch, bounded NDJSON transport, request routing, and runtime/session composition.
- `apps/cli/tests/host_*.test.ts`: test parsing, protocol limits, config/session behavior, approvals, cancellation, and stream sequencing offline.
- `apps/vscode/package.json`, `apps/vscode/tsconfig.json`, `apps/vscode/src/extension.ts`, `apps/vscode/src/sidecar.ts`, and `apps/vscode/src/protocol.ts`: define extension contributions, process lifecycle, and validated transport.
- `apps/vscode/src/webview/*` and `apps/vscode/media/*`: implement the task transcript, composer, progress/tool cards, and explicit approval cards using VS Code theme tokens.
- `apps/vscode/tests/*`: test host lifecycle and webview message/event handling with injected VS Code adapters and fake child processes.
- Root/CLI docs and package metadata: document installation prerequisites and local VSIX use; align version metadata to `0.4.0` only at final acceptance.

## Task 1: Correct and test commit-version hook timing

**Files:**
- Modify: `.githooks/pre-commit`
- Modify: `.githooks/prepare-commit-msg`
- Modify: `.githooks/commit-msg`
- Create: `.githooks/post-commit`
- Create: `tests/version_hooks.test.ts`

**Interfaces:**
- `prepare-commit-msg` receives the current message path as `$1`; calculate the new connected identifier, stamp that message, and save the prior HEAD and target identifier under the Git directory without changing `VERSION`. Each attempt replaces stale pending state.
- `commit-msg` validates the stamped identifier against the current `VERSION`, pending subject, and saved target; it does not mutate `VERSION` before signing and ref updates succeed.
- `pre-commit` performs no message-dependent version calculation.
- `post-commit` writes and amends only `VERSION` into the just-created local commit; unrelated staged paths remain staged. If the amend fails, it reports the error and restores the exact prior HEAD, including for a user-initiated `git commit --amend`, leaving changes staged for retry. Successful commits clear pending state. It does not touch remote history.

- [x] **Step 1: Write hook regression tests**

Create a temporary Git repository per test with baseline `VERSION` `v0.3.4+${today}1`, where `today` is the current UTC date in `YYMMDD`; configure the baseline commit before enabling hooks, then make a `feat(test): first feature` commit followed by `docs: update notes`. Assert the feature commit changes SemVer to `0.3.5`; the docs commit retains `0.3.5` and advances only the build suffix. Assert each subject's first token equals `VERSION` in that commit's tree.

Development starts from `0.3.4`. Feature commits follow the repository hook and advance the patch within `0.3.x`; whenever the root SemVer changes, keep `apps/cli/package.json` aligned in the same commit. The published npm release remains `0.3.4` until an explicit release.

```ts
expect(readVersion(repo).split('+', 1)[0]).toBe('v0.3.5');
expect(readSubject(repo).split(' ', 1)[0]).toBe(readVersion(repo));
```

Also test that `release(minor): publish milestone` changes `0.3.5` to `0.4.0`, that `feat!: breaking API` fails without the major approval variable, that partial commits preserve unrelated staged files, and that commit rejection, signing failure, and both ordinary and user-initiated amend failures leave no invalid commit or version bump. Verify a retry replaces stale pending state. Use temporary git identity and no network.

- [x] **Step 2: Run the hook tests and confirm failure**

Run: `npm test -- tests/version_hooks.test.ts` and `npm test -- apps/cli/tests/package_metadata.test.ts`.
Expected: the hook regression fails because the current pre-commit hook reads the previous `COMMIT_EDITMSG`; package metadata passes with root and CLI versions aligned at `0.3.4`.

- [x] **Step 3: Move bumping to the hook that receives the current message**

Read `$1` in `.githooks/prepare-commit-msg`; strip any existing connected prefix; call `detect_bump_type` on the pending subject; calculate and validate the next ID; prefix the current message; and save the prior HEAD and target under the Git directory without changing `VERSION`. Leave `.githooks/pre-commit` as an empty successful hook. Make `.githooks/commit-msg` validate the prefix against the old version and saved target without mutating `VERSION`. Add executable `.githooks/post-commit` to write and amend only `VERSION` into the just-created local commit, with hooks disabled and inherited `GIT_INDEX_FILE` cleared. On amendment failure, restore the saved HEAD, restore the old worktree `VERSION`, and report recovery. When this `feat` commit advances root SemVer from `0.3.4` to `0.3.5`, update `apps/cli/package.json` to `0.3.5` in the same commit; later feature commits follow the same synchronization rule.

- [x] **Step 4: Run hook tests and verify the clean cycle**

Run: `npm test -- tests/version_hooks.test.ts`
Expected: all hook tests pass, including docs/fix build-only behavior, feat patch behavior, explicit minor behavior, and major approval gate.

- [x] **Step 5: Commit the hook correction**

Stage the four hook files, `tests/version_hooks.test.ts`, and this plan correction; mark `post-commit` executable in Git. Commit with a build-only `fix(versioning): read the pending commit subject` message. Verify that the connected prefix equals the committed tree's `VERSION` and that the worktree has no staged `VERSION` left behind.

## Task 2: Define versioned host protocol contracts

**Files:**
- Create: `packages/contracts/src/host_protocol.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/tests/host_protocol.test.ts`
- Modify: `apps/cli/package.json` to match the `0.3.5` patch version generated by this `feat` commit.
- Modify: `docs/superpowers/plans/2026-09-24-vscode-extension.md` to record the version-sync rule for feature commits.

**Interfaces:**
- `HostRequestSchema` discriminates `initialize`, `chat.send`, `chat.cancel`, `approval.respond`, `session.new`, and `session.resume`.
- `HostResponseSchema` uses `{ type: 'response', id, ok, result? | error? }` with the error code enum from the spec.
- `HostNotificationSchema` defines the `event` notification containing `HostEventEnvelope`.
- Export inferred request/result types for CLI and extension use.

- [x] **Step 1: Add failing schema tests**

Cover valid examples from the spec, unknown method rejection, missing IDs, empty or >100,000-character prompts, >20,000-character selection text, invalid status, unsupported protocol version, absolute/drive paths, and relative paths containing traversal segments in either slash style. Runtime tests own symlink and canonical-workspace checks.

```ts
expect(HostRequestSchema.safeParse({
  type: 'request', id: 'req-1', method: 'chat.send',
  params: { sessionId: 'session-1', text: 'review this' },
}).success).toBe(true);
expect(HostRequestSchema.safeParse({
  type: 'request', id: 'req-2', method: 'chat.send',
  params: { sessionId: 'session-1', text: 'review this', context: { selection: { relativePath: '../secret.txt', startLine: 1, endLine: 1, text: 'secret' } } },
}).success).toBe(false);
```

- [x] **Step 2: Confirm the new test fails**

Run: `npm test -- packages/contracts/tests/host_protocol.test.ts`
Expected: FAIL because host protocol schemas have not been exported.

- [x] **Step 3: Implement minimal Zod schemas**

Implement each union branch with the exact method names and caps in the spec. Validate only syntactic path properties at the contracts boundary; canonical/jail checks remain runtime responsibilities. Reuse `ApprovalStatusSchema` and `HostEventEnvelopeSchema`.

- [x] **Step 4: Run contract tests and package typecheck**

Run: `npm test -- packages/contracts/tests/host_protocol.test.ts` and `npm --prefix packages/contracts run typecheck`.
Expected: all protocol boundary cases pass and contracts compile independently.

- [x] **Step 5: Commit the host contracts**


Commit only contract source, exports, and tests with a connected `feat(contracts): define host protocol v1` subject.

## Task 3: Implement bounded NDJSON transport and host command dispatch

**Files:**
- Create: `apps/cli/src/host/ndjson.ts`
- Create: `apps/cli/src/host/protocol_server.ts`
- Create: `apps/cli/src/commands/host.ts`
- Modify: `apps/cli/src/args.ts`
- Modify: `apps/cli/src/index.ts`
- Create: `apps/cli/tests/host_transport.test.ts`
- Modify: `apps/cli/tests/args.test.ts`

**Interfaces:**
- `readHostMessages(input: NodeJS.ReadableStream, maxLineBytes = 1_048_576): AsyncIterable<unknown>` yields parsed JSON values and rejects malformed/oversized lines.
- `writeHostMessage(output: NodeJS.WritableStream, message: HostResponse | HostNotification): Promise<void>` writes exactly one JSON line and handles backpressure.
- `serveHostProtocol(input, output, sessionFactory, signal?)` validates requests, routes responses/events, and closes its runtime on EOF or protocol failure.
- `handleHostCommand(workspace, signal?)` owns process stdio and keeps stdout protocol-only; logs go to stderr.

- [x] **Step 1: Write transport tests**

Test split chunks, multiple lines in one chunk, CRLF, UTF-8 text, malformed JSON, EOF with an incomplete line, exact 1 MiB acceptance, a line over 1 MiB before newline, output backpressure, and zero stray stdout logging.

- [x] **Step 2: Run transport tests and confirm failure**

Run: `npm test -- apps/cli/tests/host_transport.test.ts`
Expected: FAIL because the host transport modules do not exist.

- [x] **Step 3: Implement the byte-capped reader and writer**

Accumulate buffers by bytes rather than decoded character count; fail immediately once an unterminated line exceeds 1 MiB; parse each complete UTF-8 line; reject invalid JSON; await `drain` after `write` returns false. Never print diagnostics on stdout.

- [x] **Step 4: Add host CLI parsing and dispatch**

Add `host` to `CliParsedArgs.command`, usage text, and `main()` dispatch. `moderado host --workspace <path> --protocol 1` must reject missing workspace and unsupported versions before serving; start no terminal prompt or TUI.

- [x] **Step 5: Run CLI argument, transport, and typecheck gates**

Run: `npm test -- apps/cli/tests/host_transport.test.ts apps/cli/tests/args.test.ts` and `npm --prefix apps/cli run typecheck`.
Expected: host command validation and transport cases pass.

- [x] **Step 6: Commit the transport and CLI entry point**

Commit the transport, command dispatch, and tests with a connected `feat(cli): add headless host transport` subject.


## Task 4: Compose headless sessions, approvals, and stable event stream

**Files:**
- Create: `apps/cli/src/host/runtime.ts`
- Create: `apps/cli/src/host/approval_queue.ts`
- Modify: `apps/cli/src/host/protocol_server.ts`
- Modify: `apps/cli/src/commands/host.ts`
- Create: `apps/cli/tests/host_runtime.test.ts`
- Create: `apps/cli/tests/host_approval.test.ts`

**Interfaces:**
- `createHostRuntime({ workspaceRoot, emit, dependencies? })` returns `initialize()`, `dispatch(request)`, and `close()` operations.
- Runtime owns a `SessionStore`, the active `StoredSession`, a single in-flight generation, and one `HostEventStream` whose identity and sequence persist across turns.
- `ApprovalQueue.requestApproval(request, signal)` returns a pending promise; `resolve(requestId, status)` accepts only one exact outstanding request; `close()` resolves all pending requests as `aborted`.
- Test dependencies allow injecting `FakeProviderAdapter`, a temporary config home, a tool registry, and deterministic credential/skill sources.

- [ ] **Step 1: Write runtime and approval tests first**

Cover initialize session list output, corrupted stored sessions omitted while new sessions remain available, new and resume session round trips, workspace/session mismatch, two turns with one sidecar session ID and increasing sequences, prompt selection context injection as untrusted user context, explicit allow/deny, stale and duplicate approval decisions, cancel, panel/transport close while waiting for approval, provider credential-store failure without secret leakage or provider switching, and tool invocation constrained to the canonical workspace. Include a symlink escape case where the platform supports symlinks.

- [ ] **Step 2: Run runtime tests and confirm failure**

Run: `npm test -- apps/cli/tests/host_runtime.test.ts apps/cli/tests/host_approval.test.ts`
Expected: FAIL because headless runtime and approval queue are not implemented.

- [ ] **Step 3: Implement the approval queue**

Store pending resolvers by approval request ID; reject duplicate IDs; on response return the existing `ApprovalDecision` shape. Abort signal or `close()` settles outstanding promises as `aborted`; no failure path returns `approved`.

- [ ] **Step 4: Implement runtime composition using current packages**

Resolve provider config/credentials using existing config APIs; canonicalize the workspace using `canonicalizeRoot`; build the existing tool registry and router/policy; load or create `StoredSession`; pass saved messages to `AgentLoop.run`; persist updated messages and usage after completion. Feed raw events into one session-level `HostEventStream` and notify the protocol server with its envelopes.

- [ ] **Step 5: Route host protocol requests to runtime**

Implement the six method branches from `HostRequestSchema`; reject concurrent `chat.send` with `BUSY`; require matching session IDs for turn, cancel, and approval; list resumable sessions at initialize; close approvals and abort generation during runtime shutdown.

- [ ] **Step 6: Run focused host tests and root typecheck**

Run: `npm test -- apps/cli/tests/host_runtime.test.ts apps/cli/tests/host_approval.test.ts apps/cli/tests/host_transport.test.ts` and `npm run typecheck`.
Expected: host interactions work offline, include stable event sequence behavior, and pass workspace jail, session corruption, credential, and approval cases.

- [ ] **Step 7: Commit the host runtime**

Commit runtime, approval queue, protocol wiring, and tests with a connected `feat(cli): compose headless agent sessions` subject.

## Task 5: Scaffold VS Code extension and safe sidecar lifecycle

**Files:**
- Create: `apps/vscode/package.json`
- Create: `apps/vscode/tsconfig.json`
- Create: `apps/vscode/src/extension.ts`
- Create: `apps/vscode/src/sidecar.ts`
- Create: `apps/vscode/src/protocol.ts`
- Create: `apps/vscode/tests/sidecar.test.ts`
- Modify: root `package.json` to expose the extension build, test, and packaging scripts.

**Interfaces:**
- `SidecarClient.start({ executable, workspaceRoot, onMessage, onExit })` spawns the executable using argument arrays, `shell: false`, and `cwd: workspaceRoot`.
- `SidecarClient.request(method, params, signal?)` sends a typed request and resolves only the matching response ID.
- `SidecarClient.close()` cancels/aborts active work, resolves pending approval actions as aborted, closes stdin, waits a bounded grace period, then terminates the child.
- Inject spawn and VS Code APIs into host-side classes for deterministic unit tests.

- [ ] **Step 1: Write extension manifest and spawn tests**

Create failing tests for safe argument passing when workspace path contains spaces/metacharacters, configured executable override, not-found message, protocol mismatch, child exit, output chunk parsing, and close while an approval is pending.

- [ ] **Step 2: Confirm sidecar tests fail**

Run: `npm test -- apps/vscode/tests/sidecar.test.ts`
Expected: FAIL because extension app files are absent.

- [ ] **Step 3: Add the workspace extension package**

Declare VS Code engine compatibility, extension activation events, Moderado Activity Bar container/view, `moderado.executablePath`, commands, scripts for typecheck/test/package, and `@types/vscode`/VSIX tooling as development dependencies only. Add `apps/vscode` to the relevant TypeScript project references without making root CLI builds import VS Code modules.

- [ ] **Step 4: Implement the sidecar client**

Resolve executable from setting or PATH; spawn with `shell: false`; send `host --workspace <root> --protocol 1` as separate arguments; validate every request/response/event line against shared contracts; enforce 1 MiB lines; capture bounded stderr; surface actionable startup and protocol errors; abort on shutdown.

- [ ] **Step 5: Implement activation and commands**

Register the view provider and focus/new/resume/cancel commands. Start at most one sidecar per workspace; initialize it with protocol version 1; dispose resources and approvals on deactivation.

- [ ] **Step 6: Run extension typecheck and focused tests**

Run: `npm --prefix apps/vscode run typecheck` and `npm test -- apps/vscode/tests/sidecar.test.ts`.
Expected: safe spawn, validation, startup failure, and shutdown behavior pass.

- [ ] **Step 7: Commit extension host scaffolding**

Commit manifest, extension host, sidecar client, and tests with a connected `feat(vscode): scaffold extension sidecar` subject.

## Task 6: Build the task-oriented chat webview and approval UX

**Files:**
- Create: `apps/vscode/src/webview/panel.ts`
- Create: `apps/vscode/src/webview/messages.ts`
- Create: `apps/vscode/media/index.html`
- Create: `apps/vscode/media/main.ts`
- Create: `apps/vscode/media/styles.css`
- Create: `apps/vscode/tests/webview_messages.test.ts`
- Create: `apps/vscode/tests/transcript.test.ts`

**Interfaces:**
- `WebviewToHostMessageSchema` allows only `send`, `cancel`, `newSession`, `resumeSession`, `approve`, `reject`, and `attachSelection` messages with validated payloads.
- `TranscriptState.apply(envelope: HostEventEnvelope)` updates a pure view model for assistant messages, progress/tool activity, pending approvals, completion, and error states.
- The extension host checks schemas and active session/request IDs before dispatching any webview message.

- [ ] **Step 1: Add failing pure UI state tests**

Test assistant deltas append to the current turn; progress/tool events group under the active task; repeated/old events are ignored; sequence gaps show a recoverable protocol state; approvals are shown once with exact request IDs; completion/error/cancellation close active state; malformed webview messages have no effect.

- [ ] **Step 2: Confirm UI state tests fail**

Run: `npm test -- apps/vscode/tests/webview_messages.test.ts apps/vscode/tests/transcript.test.ts`
Expected: FAIL because webview schemas and transcript reducer do not exist.

- [ ] **Step 3: Implement message schema and transcript reducer**

Use pure TypeScript functions and shared event types. Render no reasoning events. Do not include secrets in state, event text, or error diagnostics.

- [ ] **Step 4: Implement Cline-referenced layout and composer**

Build an Activity Bar task view with conversation history, new/resume task controls, streamed answer bubbles, grouped collapsible tool/progress cards, a composer, and active editor selection/file context. Use VS Code theme variables, CSP nonces, local scripts/styles only, keyboard navigation, and accessible labels. Do not implement arbitrary resource search or multi-root UI.

- [ ] **Step 5: Implement review and action cards**

Render a unified diff using existing bounded `diffPreview`; display exact command argv/cwd and tool intent; provide explicit Approve and Reject controls bound to the pending request ID. Keep the workspace unmodified until sidecar resolves approval. Show local-executable setup guidance if disconnected.

- [ ] **Step 6: Run extension tests and package compile**

Run: `npm test -- apps/vscode/tests/webview_messages.test.ts apps/vscode/tests/transcript.test.ts apps/vscode/tests/sidecar.test.ts` and `npm --prefix apps/vscode run typecheck`.
Expected: pure transcript behavior and webview boundary tests pass.

- [ ] **Step 7: Commit the VS Code view**

Commit UI, webview, styles, and tests with a connected `feat(vscode): add moderated task chat view` subject.

## Task 7: Verify integrated VSIX and document local developer workflow

**Files:**
- Modify: `README.md`
- Create: `apps/vscode/README.md`
- Modify: root `package.json`
- Create: `apps/vscode/tests/host_smoke.test.ts`
- Modify: `docs/CLI_CAPABILITY_ROADMAP.md`

**Interfaces:**
- Root scripts `build:vscode`, `test:vscode`, and `package:vscode` run the extension's own build/tests/package process.
- Local install instructions name Node >=20, VS Code, a discoverable `moderado` executable, the command to package a `.vsix`, and VS Code's `Install from VSIX...` workflow.

- [ ] **Step 1: Write a protocol-to-UI offline smoke test**

Connect the extension controller to a fake line server and fake provider; initialize, send a prompt with a selected-code context, receive assistant/progress events, request a write approval, deny it, and verify no file mutation occurs. Resume the persisted session and verify sequence continuation.

- [ ] **Step 2: Confirm integration smoke test fails**

Run: `npm test -- apps/vscode/tests/host_smoke.test.ts`
Expected: FAIL until extension and sidecar are connected through the real contracts.

- [ ] **Step 3: Wire workspace scripts and local VSIX documentation**

Ensure root build references contracts -> tools/providers/core -> CLI -> extension correctly; extension sources compile separately and do not leak VS Code types to CLI. Add scripts for offline tests and packaging. Document executable configuration and VSIX install instructions.

- [ ] **Step 4: Run full verification and inspect VSIX contents**

Run: `npm test`, `npm run typecheck`, `npm run build`, `npm --prefix apps/vscode run package`, then inspect the generated VSIX archive. Confirm it contains extension host/webview assets only and no keys, config files, workspace contents, or unnecessary source maps/dependencies.

- [ ] **Step 5: Commit integration and docs**

Commit the root scripts, docs, and offline smoke test with connected subject `test(vscode): verify host integration`.

## Task 8: Complete the `0.4.0` milestone metadata

**Files:**
- Modify: `VERSION`
- Modify: `apps/cli/package.json`
- Modify: `apps/vscode/package.json`
- Modify: product-version references in root `README.md` and `apps/vscode/README.md`.
- Review: release manifest/workflow version sources; update explicit product-version literals to `0.4.0` and retain dynamically derived release tags.

**Interfaces:**
- Root connected identifier has SemVer `0.4.0`; the corrected hook generates the current Alfazen build suffix.
- CLI and extension package metadata both identify the completed product milestone as `0.4.0`.

- [ ] **Step 1: Add a release metadata consistency test**

Assert normalized root `VERSION` SemVer equals both package versions; allow connected build metadata only in root `VERSION`. Include an explicit `0.4.0` fixture for the milestone check.

- [ ] **Step 2: Confirm metadata test fails before the milestone bump**

Run: `npm test -- apps/vscode/tests/version_metadata.test.ts`
Expected: FAIL while development metadata remains in `0.3.x`.

- [ ] **Step 3: Set the milestone version**

After every functional acceptance criterion is verified, align package metadata and release docs to `0.4.0`, then create the explicit `release(minor): complete VS Code extension alpha` commit from the latest `0.3.x` version. The corrected prepare-commit hook advances root `VERSION` to `0.4.0` with its current connected build suffix and stamps that commit. Keep Marketplace publishing excluded.

- [ ] **Step 4: Verify the final version and full release gates**

After the release commit, run `npm test`, `npm run typecheck`, `npm run build`, `npm --prefix apps/vscode run package`, and `npm test -- apps/vscode/tests/version_metadata.test.ts`; inspect the VSIX metadata.
Expected: all checks pass, root `VERSION` and both package manifests identify `0.4.0`, and the VSIX metadata reports `0.4.0`.

## Self-Review Coverage

- The six request methods, response envelope, event envelope, error codes, caps, and path/runtime boundary checks are owned by Tasks 2-4.
- Sidecar startup, malformed protocol, unsupported version, stderr bounds, cancellation, and cleanup are owned by Tasks 3-5.
- The task-oriented Activity Bar, transcript, selection context, progress/tool grouping, review cards, accessibility/CSP, and provider setup guidance are owned by Task 6.
- Local VSIX packaging, platform prerequisites, offline integration verification, and archive contents are owned by Task 7.
- The development version rule and final `0.4.0` milestone are covered by Tasks 1 and 8.
- The highest risk outside ordinary happy-path coverage is corrupted session data; Task 4 must add a test proving invalid stored sessions are omitted and a new safe session can start.
- A provider credential store failure must not leak secrets or silently switch providers; Task 4 must assert it returns a bounded authentication/setup error.
