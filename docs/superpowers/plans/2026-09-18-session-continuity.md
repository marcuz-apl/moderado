# M2 Session Continuity Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with tests before implementation. Steps use checkbox syntax for tracking.

**Goal:** Persist and resume safe local coding sessions, show actual provider usage and cost, and expose the workflow through one session command family.

**Architecture:** apps/cli owns validated filesystem persistence, export, compaction, and popup interactions. packages/core only returns normalized provider usage with each run. The existing TUI composes session popups above the current welcome or chat surface.

**Tech Stack:** TypeScript, Node.js 20 standard library, Zod, Vitest.

**Spec:** docs/superpowers/specs/2026-09-18-session-continuity-design.md

## Global constraints

- Do not add runtime dependencies.
- Keep packages/core provider-independent and filesystem-independent.
- Use Zod for persisted and external data boundaries.
- Keep every automated test offline.
- Exclude credentials, request headers, environment values, and raw request bodies from session records and exports.
- Preserve all existing tool approval and workspace-jail behaviour.

---

## File structure

- apps/cli/src/sessions.ts: session schema, atomic store, export formatter,
  deterministic compaction, usage and cost helpers.
- apps/cli/tests/sessions.test.ts: storage, corruption, redaction, export,
  compaction, and pricing tests.
- packages/core/src/agent.ts: aggregate streamed usage into AgentRunResult.
- packages/core/tests/agent.test.ts: provider usage return-value tests.
- apps/cli/src/commands/chat.ts: active session lifecycle and run persistence.
- apps/cli/src/ui/welcome.ts: session command completion and popup dispatch.
- apps/cli/tests/welcome.test.ts: session command completion tests.
- apps/cli/tests/chat.test.ts: resume and save integration with injected store.

### Task 1: Return provider usage from the core loop

**Files:**
- Modify: packages/core/src/agent.ts
- Modify: packages/core/tests/agent.test.ts

**Interfaces:**
- Consumes: ChatCompletionChunk.usage from contracts.
- Produces: AgentRunResult.usage of type ChatUsage or undefined.

- [ ] **Step 1: Write a failing core test**

Queue a fake response containing usage and assert that the completed result has
the same values.

~~~ts
provider.queueResponse([
  { contentDelta: 'Done.' },
  { usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 } },
]);
const result = await loop.run('Answer', options);
expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });
~~~

- [ ] **Step 2: Verify the test fails**

Run: npm test -- packages/core/tests/agent.test.ts
Expected: FAIL because AgentRunResult has no usage value.

- [ ] **Step 3: Implement the smallest core change**

Add optional usage to AgentRunResult, retain the most recent chunk.usage while
iterating, and include it in every successful, failed, cancelled, and
step-limited return object.

- [ ] **Step 4: Verify the focused test passes**

Run: npm run build; npm test -- packages/core/tests/agent.test.ts
Expected: PASS.

### Task 2: Build a safe local session store

**Files:**
- Create: apps/cli/src/sessions.ts
- Create: apps/cli/tests/sessions.test.ts

**Interfaces:**
- Consumes: ChatMessage and ChatUsage from contracts.
- Produces: StoredSessionSchema, SessionStore, createSession,
  loadLatestSession, listSessions, saveSession, and calculateSessionCost.

- [ ] **Step 1: Write failing storage tests**

Cover creation and loading, latest-first ordering, malformed JSON skip, atomic
save replacement, and the absence of an apiKey key in serialized output.

~~~ts
const store = new SessionStore(tempHome);
const session = createSession('C:/repo', { providerId: 'openrouter', modelId: 'model-a' });
store.save(session);
expect(store.loadLatestSession('C:/repo')?.id).toBe(session.id);
expect(JSON.stringify(store.loadLatestSession('C:/repo'))).not.toContain('apiKey');
~~~

- [ ] **Step 2: Verify the tests fail**

Run: npm test -- apps/cli/tests/sessions.test.ts
Expected: FAIL because the session module does not exist.

- [ ] **Step 3: Implement the store**

Use node:crypto SHA-256 for workspace directories and randomUUID for IDs. Parse
records with Zod. Write JSON to a random same-directory temporary name and
rename it into place. Keep only the fields in the specification.

- [ ] **Step 4: Add usage and pricing tests**

Test known pricing, missing pricing, and missing usage.

~~~ts
expect(calculateSessionCost(
  { promptTokens: 1000, completionTokens: 2000, totalTokens: 3000 },
  { prompt: '0.000001', completion: '0.000002' }
)).toEqual({ costKnown: true, costUsd: 0.005 });
~~~

- [ ] **Step 5: Verify the focused tests pass**

Run: npm run build; npm test -- apps/cli/tests/sessions.test.ts
Expected: PASS.

### Task 3: Add export and deterministic compaction

**Files:**
- Modify: apps/cli/src/sessions.ts
- Modify: apps/cli/tests/sessions.test.ts

**Interfaces:**
- Consumes: StoredSession.
- Produces: exportSessionMarkdown(session) and compactSessionMessages(messages).

- [ ] **Step 1: Write failing export and compaction tests**

Verify export includes user and assistant content, omits a simulated secret, and
compaction preserves the newest four conversational messages while replacing
earlier messages with a system summary.

~~~ts
const compacted = compactSessionMessages(messages);
expect(compacted[0]).toMatchObject({ role: 'system' });
expect(compacted.some((m) => JSON.stringify(m).includes('nvapi-secret'))).toBe(false);
~~~

- [ ] **Step 2: Verify the tests fail**

Run: npm test -- apps/cli/tests/sessions.test.ts
Expected: FAIL because export and compaction helpers do not exist.

- [ ] **Step 3: Implement deterministic redaction and reduction**

Render Markdown from normalized message fields only. Omit tool payload details.
Build one summary from older user/assistant excerpts and tool name/status pairs;
retain the newest four conversational messages and their adjacent tool results.

- [ ] **Step 4: Verify the focused tests pass**

Run: npm test -- apps/cli/tests/sessions.test.ts
Expected: PASS.

### Task 4: Integrate session state into chat

**Files:**
- Modify: apps/cli/src/commands/chat.ts
- Modify: apps/cli/tests/chat.test.ts

**Interfaces:**
- Consumes: SessionStore and AgentRunResult.usage.
- Produces: restored conversationHistory, persisted active session, actual status
  tokens/cost, and testable store injection options.

- [ ] **Step 1: Write failing chat integration tests**

Inject a temporary store containing a prior session. Assert the chat handler
passes restored history into the agent run and saves a changed session after the
turn.

- [ ] **Step 2: Verify the tests fail**

Run: npm test -- apps/cli/tests/chat.test.ts
Expected: FAIL because chat has no session-store lifecycle.

- [ ] **Step 3: Implement lifecycle integration**

Create or load the workspace session before the prompt loop. Restore only
messages, mode, and model label. After each agent result, replace session
messages, apply returned usage, calculate cost from discovered pricing when
available, update timestamps, and save atomically. Replace character-count
token estimation with provider usage display.

- [ ] **Step 4: Verify the focused tests pass**

Run: npm run build; npm test -- apps/cli/tests/chat.test.ts apps/cli/tests/sessions.test.ts
Expected: PASS.

### Task 5: Add the /session popup command family

**Files:**
- Modify: apps/cli/src/ui/welcome.ts
- Modify: apps/cli/src/commands/chat.ts
- Modify: apps/cli/tests/welcome.test.ts
- Modify: apps/cli/tests/chat.test.ts

**Interfaces:**
- Consumes: SessionStore and drawFrame popup callback.
- Produces: /session, /session new, /session list, /session resume,
  /session export, and /session compact command dispatch.

- [ ] **Step 1: Write failing command-completion tests**

Assert slash completion lists only /session for a slash prefix and that the
description explains the five session actions.

~~~ts
expect(getMatchingCommands('/s')).toEqual([
  expect.objectContaining({ name: '/session', desc: expect.stringContaining('session') }),
]);
~~~

- [ ] **Step 2: Verify the tests fail**

Run: npm test -- apps/cli/tests/welcome.test.ts
Expected: FAIL because /session is not registered.

- [ ] **Step 3: Implement popup actions**

Register the one top-level command. Route /session and each spaced subcommand
to a dark-grey popup. Use the existing selectListPopup and selectConfirmPopup
components. /session new starts a record, list/resume loads a selection, export
writes only inside the canonical workspace after confirmation, and compact
shows the proposed reduction before confirmation.

- [ ] **Step 4: Verify focused UI and chat tests pass**

Run: npm run build; npm test -- apps/cli/tests/welcome.test.ts apps/cli/tests/chat.test.ts
Expected: PASS.

### Task 6: Full validation and documentation

**Files:**
- Modify: README.md
- Modify: HANDOFF.md
- Modify: docs/CLI_CAPABILITY_ROADMAP.md

- [ ] **Step 1: Update user documentation**

Document session location, each /session action, local privacy limits, and the
meaning of Usage unavailable and Cost unknown.

- [ ] **Step 2: Mark M2 complete in the roadmap and handoff**

Record the implementation result, test evidence, and the next roadmap
milestone.

- [ ] **Step 3: Run the full validation set**

Run: npm run build; npm test; git diff --check
Expected: build succeeds, every offline test passes, and the patch contains no
whitespace errors.

- [ ] **Step 4: Commit after validation**

Run the configured Alfazen hook through a conventional commit subject:
git commit -m "feat(cli): add persistent session workflows"
