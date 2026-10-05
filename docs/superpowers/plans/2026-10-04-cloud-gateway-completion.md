# Cloud Gateway Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved Cloud Gateway integration from the handoff.

**Architecture:** Keep Gateway-specific routing and request policy at the provider boundary and preserve the core's existing DI contract. Represent status/error metadata with typed provider and agent events; implement OAuth in the CLI composition layer with native Node modules and existing credential storage.

**Tech Stack:** Node.js >=20, TypeScript ESM, Zod, Vitest, native `crypto`, `http`, and `fetch`.

**Spec:** `docs/CLOUD_GATEWAY_INTEGRATION.md` and the stable Gateway v1 contract.

## Global Constraints
- No new runtime dependencies.
- Gateway URL is fixed to `https://api.mod.alfazen.org/v1`.
- OAuth authorize/token endpoints are fixed to `https://mod.alfazen.org/authorize` and `/oauth/token`.
- OAuth access credentials expire after 30 days; no refresh token exists.
- Manual and OAuth keys must not enter plain config or logs.
- Gateway requests: text-only, 1–32 messages, max_tokens 1–2048, at most 16 tools, complete request body <=32KiB; no separate aggregate messages/tools byte limit.
- Never client-failover a pinned route or retry ambiguous/post-output failures.
- Tests must use offline fake servers.

---

### Task 1: Correct Gateway auto/pinned routing

Files: `packages/core/src/agent.ts`, `packages/core/src/router.ts`, `apps/cli/src/commands/chat.ts`, core/CLI tests.

- [ ] Add failing tests proving Cloud `auto` reaches `streamChat` as literal `auto`, pinned route remains pinned, and Gateway auto is not client-routed/failovered.
- [ ] Run targeted tests and confirm they fail for the lost `auto` behavior.
- [ ] Implement the smallest Cloud-specific route path while preserving existing BYOK/local routing.
- [ ] Run targeted tests.

### Task 2: Validate Gateway requests and map errors

Files: `packages/providers/src/nvidia/nvidia_adapter.ts`, `packages/contracts/src/provider.ts`, `packages/providers/src/model_discovery.ts`, provider tests.

- [ ] Add fake-server tests for each request limit and each Gateway error code, including Retry-After and non-retryable scope denial.
- [ ] Run targeted tests and confirm failures.
- [ ] Add Cloud-only validation/error parsing and prevent unsafe retries.
- [ ] Run targeted tests.

### Task 3: Stream Gateway status/fallback metadata

Files: `packages/providers/src/nvidia/sse_parser.ts`, provider chunk schema, agent event schema/core, `apps/cli/src/commands/chat.ts` renderer, tests.

- [ ] Add failing parser/core/renderer tests for `event: moderado_status`, including route IDs and safe reason.
- [ ] Run targeted tests and confirm failures.
- [ ] Parse status payload, emit a typed agent event, and render an actionable fallback notice.
- [ ] Run targeted tests.

### Task 4: Add PKCE browser login and expiry handling

Files: `apps/cli/src/ui/provider_connect.ts`, auth helper module if needed, connection config, credential store wiring, tests.

- [ ] Add offline tests for S256/state/loopback validation, token exchange, 30-day expiry and re-auth UX, and absence of secret persistence.
- [ ] Run targeted tests and confirm failures.
- [ ] Implement fixed-endpoint loopback PKCE using native modules; clean up listener on every exit path; store only bearer key in current credential store and expiry metadata in config.
- [ ] Run targeted tests.

### Task 5: Docs and full verification

Files: `README.md`, `apps/cli/README.md`, `docs/CLOUD_GATEWAY_INTEGRATION.md`, `HANDOFF.md`.

- [ ] Document manual and browser login, fixed Gateway URL, route behavior, and platform credential persistence.
- [ ] Update handoff with actual branch/tag status and completed checks.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run verify:package`, and `git diff --check`.
- [ ] Review diff for contract coverage and secrets; do not commit/push/publish without explicit request.
