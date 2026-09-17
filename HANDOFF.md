# Project Handoff

Updated: 2026-09-16 22:02 UTC  
Branch: master  
Commit: in progress (Milestone 4 completed, ready to commit)  
Status: in progress  

## Summary

Completed **Milestone 4: Core Agent Loop, Free-First Router & Policy Engine (`packages/core`)**. Implemented the multi-step `AgentLoop` orchestrator with Dependency Injection, the 4-stage Free-First `Router` (with fallback cascades and model pinning), and the `PolicyManager` (step bounding, read-only mode, and non-interactive enforcement). Configured project references for workspace-wide `tsc -b`. All 66 tests across 9 test files pass cleanly.

## Completed

- **Milestone 1**: Scaffolding, `tsconfig.base.json`, `vitest.config.ts`, pure contracts `@moderado/contracts`.
- **Milestone 2**: Workspace security jail, path canonicalization, diff generation, and 7 core tools `@moderado/tools`.
- **Milestone 3**: `FakeProviderAdapter`, SSE parser, and `NvidiaAdapter` in `@moderado/providers`.
- **Milestone 4**:
  - `packages/core/src/policy.ts`: Step limit checking, read-only mode validation, and non-interactive mode security checks.
  - `packages/core/src/router.ts`: Free-first AUTO selection algorithm, capability filtering, paid/unknown model exclusion without user opt-in, pinned model enforcement, and failover candidate cascading (`getNextFallback`).
  - `packages/core/src/agent.ts`: State machine and multi-step `AgentLoop`:
    - Dependency Injection: accepts provider, tools, approvals, and event listeners purely via contracts.
    - Emits structured lifecycle events (`progress`, `model_change`, `assistant_delta`, `tool_call_initiated`, `approval_request`, `approval_resolved`, `tool_result`, `completion`, `cancellation`).
    - Tool execution cycle: validates schemas, queries policy, delegates approval boundary, executes inside workspace, and feeds tool results back to conversation.
    - Side-effect protection and error recovery.
  - Root project references: `tsconfig.json` enabling `tsc -b` to build all packages in dependency order.
- Authored and verified Vitest test suites:
  - `packages/core/tests/policy.test.ts` (4 tests passing)
  - `packages/core/tests/router.test.ts` (5 tests passing)
  - `packages/core/tests/agent.test.ts` (7 tests passing)
  - Total across workspace: 9 test files, 66 tests passing in 1.70s.
- Clean build: `tsc -b` compiles all packages (`contracts`, `tools`, `providers`, `core`) with zero errors.

## In progress

- Staging and committing Milestone 4.

## Working tree

- Modified:
  - `VERSION` (`v0.1.0+2609165`)
  - `HANDOFF.md`
  - `package-lock.json`
  - `tsconfig.base.json`
- Added:
  - `tsconfig.json`
  - `packages/core/`

## Checks

- `npm run build` (`tsc -b`) — PASS
- `npm test` — PASS (66 tests, 9 test files)

## Decisions and context

- Pure Dependency Injection: `@moderado/core` does not import `@moderado/providers` or concrete tools in production runtime; dependencies are injected through interfaces.
- Free-first AUTO routing: Automatically prioritizes verified free/trial models with tool support, blocking paid inference unless explicitly allowed via `--allow-paid`.
- Approval boundary: Approval requests and decisions are emitted as typed events and tied to sequential/UUID request IDs.

## Blockers

- None.

## Next action

1. Commit Milestone 4: `git add . && git commit -m "v0.1.0+2609165 feat(core): implement core agent loop, policy manager, and free-first router"` and push to `origin/master`.
2. Begin **Milestone 5: CLI Presentation & Terminal UI (`apps/cli`)**.
