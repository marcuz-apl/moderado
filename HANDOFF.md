# Project Handoff

Updated: 2026-09-16 21:57 UTC  
Branch: master  
Commit: in progress (Milestone 3 completed, ready to commit)  
Status: in progress  

## Summary

Completed **Milestone 3: Model Discovery & Provider Adapters (`packages/providers`)**. Implemented the in-memory `FakeProviderAdapter` for offline TDD orchestration, the live `NvidiaAdapter` using native Node.js `fetch` and `AbortController`, and a streaming Server-Sent Events (SSE) parser (`sse_parser.ts`). Tested completely offline using a local HTTP mock server. All 50 unit and integration tests pass across the workspace.

## Completed

- **Milestone 1**: Scaffolding, `tsconfig.base.json`, `vitest.config.ts`, pure contracts `@moderado/contracts`.
- **Milestone 2**: Workspace security jail, path canonicalization, diff generation, and 7 core tools `@moderado/tools`.
- **Milestone 3**:
  - `packages/providers/src/fake/fake_provider.ts`: In-memory mock adapter supporting model discovery, queuing text completions, queuing tool calls, simulating network errors, and recording calls for assertions.
  - `packages/providers/src/nvidia/sse_parser.ts`: Streaming SSE parser converting byte chunks into normalized `ChatCompletionChunk` instances with tool call deltas and usage stats.
  - `packages/providers/src/nvidia/nvidia_adapter.ts`: Native HTTP adapter targeting NVIDIA NIM `/v1/models` and `/v1/chat/completions`:
    - Zero external HTTP libraries (pure Node.js native `fetch`).
    - Maps wire formats into normalized `ChatMessage` and `ProviderToolDeclaration` contracts.
    - Error mapping: 401/403 $\to$ `AuthenticationError`, 429 $\to$ `RateLimitError` (extracting `Retry-After` header), 5xx $\to$ `ModelUnavailableError`.
    - Cancellation via `AbortSignal`.
- Authored and verified Vitest test suites:
  - `packages/providers/tests/fake_provider.test.ts` (4 tests passing)
  - `packages/providers/tests/nvidia_adapter.test.ts` (6 tests passing against local offline HTTP server)
  - Workspace total: 6 test files, 50 tests passing in 1.66s.
- Clean build: `tsc` compiles `@moderado/contracts`, `@moderado/tools`, and `@moderado/providers` with zero errors.

## In progress

- Staging and committing Milestone 3.

## Working tree

- Modified:
  - `VERSION` (`v0.1.0+2609164`)
  - `HANDOFF.md`
  - `package-lock.json`
- Added:
  - `packages/providers/`

## Checks

- `npm --workspace=@moderado/contracts run build` — PASS
- `npm --workspace=@moderado/tools run build` — PASS
- `npm --workspace=@moderado/providers run build` — PASS
- `npm test` — PASS (50 tests, 6 test files)

## Decisions and context

- Ponytail HTTP: Used native Node.js `fetch` and `ReadableStream` instead of Axios or third-party HTTP clients.
- Offline automated testing: Automated CI/Vitest runs must never hit live NVIDIA endpoints or require real keys; local mock HTTP server guarantees deterministic test runs.
- Model discovery resilience: Safely handles both array and `{ data: [...] }` formats from `/v1/models`.

## Blockers

- None.

## Next action

1. Commit Milestone 3: `git add . && git commit -m "v0.1.0+2609164 feat(providers): implement fake and NVIDIA NIM provider adapters with SSE streaming"` and push to `origin/master`.
2. Begin **Milestone 4: Core Agent Loop, Free-First Router & Policy Engine (`packages/core`)**.
