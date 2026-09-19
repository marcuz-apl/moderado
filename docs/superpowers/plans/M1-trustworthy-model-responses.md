# Trustworthy Model Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate assistant output and provide capability-aware, provider-neutral AUTO fallback.

**Architecture:** Extend provider model metadata and the core agent loop without importing concrete providers or CLI rendering. Providers expose capability and failure information through existing contracts; the CLI renders structured events.

**Tech Stack:** TypeScript, Zod contracts, Vitest fake providers.

**Spec:** `docs/superpowers/specs/M1-trustworthy-model-responses-design.md`

## Global Constraints

- Keep `packages/core` provider-independent and use dependency injection.
- Automated tests are offline and use fake provider responses.
- Do not expose credentials or raw provider transport data.

---

### Task 1: Model capability and empty-response contract

**Files:**
- Modify: `packages/contracts/src/*model*.ts`
- Modify: `packages/core/src/agent.ts`
- Test: `packages/core/tests/agent.test.ts`

- [ ] Write failing tests for an empty final response and a chat-only model.
- [ ] Run the focused tests and confirm empty output is currently accepted.
- [ ] Add tool-call capability metadata and reject empty final assistant content with a provider-neutral event.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Free-first fallback

**Files:**
- Modify: `packages/core/src/router.ts`
- Modify: `packages/core/src/agent.ts`
- Test: `packages/core/tests/router.test.ts`
- Test: `tests/integration/e2e_model_failover.test.ts`

- [ ] Write failing tests for AUTO fallback after an empty or unavailable model response and for pinned-model no-switch behavior.
- [ ] Run focused tests and confirm they fail.
- [ ] Retry eligible free-first candidates only and emit the replacement model identity.
- [ ] Run focused tests and confirm they pass.

### Task 3: Provider-neutral presentation and verification

**Files:**
- Modify: `apps/cli/src/ui/renderer.ts`
- Test: `apps/cli/tests/renderer.test.ts`

- [ ] Write a failing renderer test for a provider/model-specific error and sub-second duration.
- [ ] Implement compact provider-neutral output without raw transport details.
- [ ] Run `npm test`, `npm run build`, and `git diff --check`.
