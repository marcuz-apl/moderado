# Project Handoff

Updated: 2026-09-21 20:15 UTC
Branch: master
<<<<<<< HEAD
<<<<<<< HEAD
Commit: `v0.2.52+260921l`
Status: Widened /help popup box and slash command candidate suggestions box to hold long descriptions without spearing out. All 317 tests passing, packaging certified, and typecheck clean.
=======
Commit: `v0.2.51+260921p`
Status: Fixed silent failure on model inference errors and rate limits; added instant zero-network identity resolution ("who are you?"); restored active connection to responsive provider. All 318 tests passing, packaging certified, and typecheck clean.
>>>>>>> c938df6 (v0.2.51+260921q fix(chat): prevent silent failure on inference errors and add instant identity query resolution)
=======
Commit: `v0.2.52+260921r`
Status: Fixed previous turn answer leak and OpenRouter rate-limit suppression. All 323 tests passing offline, typecheck clean, binary linked globally.
>>>>>>> d815520 (v0.2.52+260921s fix(chat): prevent previous turn answer leak and surface stream rate limits)

## Summary

1. **Root Cause of Previous Answer Leak ("Who are you" repeating)**:
   - In `apps/cli/src/commands/chat.ts`, `lastAnswer` was declared outside the turn loop. At the start of a subsequent question, `lastAnswer` was not reset, and `displayAnswer = lastAnswer || streamedAnswer;` rendered the previous question's answer during the new turn while waiting for inference.
   - Even worse: when a turn failed without generating a new assistant message, `[...result.messages].reverse().find(m => m.role === 'assistant')` searched through the full conversation history and found the assistant message from the *previous turn*!
   - Because `lastAnswer` was therefore populated with the previous turn's text, `if (!lastAnswer && (result.status === 'failed' || lastErrorEvent))` evaluated to `false`, silently suppressing the error diagnostic and re-displaying the previous turn's "Who are you" answer!
2. **Root Cause of SSE Stream Rate Limit Suppression**:
   - In `packages/providers/src/nvidia/sse_parser.ts`, when OpenRouter streamed an error payload (e.g. `data: {"error":{"message":"Rate limit reached...","code":429}}`), the parser ignored `parsed.error` because `choices` was undefined. It yielded 0 chunks, causing `agent.ts` to see an empty response rather than the actual rate limit.
   - In `packages/providers/src/nvidia/nvidia_adapter.ts`, HTTP 429 error bodies containing JSON errors were formatted with raw text instead of extracting clean `error.message`.
3. **Comprehensive Fixes Applied**:
   - `packages/providers/src/nvidia/sse_parser.ts`: Detects `parsed.error` and immediately throws `RateLimitError` or `ProviderError`.
   - `packages/providers/src/nvidia/nvidia_adapter.ts`: Cleanly extracts `error.message` on JSON HTTP error payloads.
   - `apps/cli/src/commands/chat.ts`:
     - Resets `lastAnswer = ''` and `streamedAnswer = ''` on turn start; `displayAnswer = streamedAnswer || lastAnswer`.
     - Added `resolveTurnAssistantAnswer` and `formatTurnFailureAnswer`: only evaluates messages produced during the current turn (`result.messages.slice(historyLength)`). If `result.status === 'failed'` or `lastErrorEvent` is present, it *never* falls back to earlier messages and always formats the visible error banner (`⚠️ **Model Error (ERR_RATE_LIMIT):**`).
     - Prevents failed turns from corrupting session history.
     - Updated `activateConnection` to respect the newly selected connection's `defaultModel`.
   - Relinked global CLI binary via `npm link --workspace moderado`.

## Checks

- `npm run typecheck` — PASS (0 errors)
- `npm run build` — PASS (all packages compile cleanly)
- `npm test` — PASS (48 test files, 323 passed)
- `npm link --workspace moderado` — PASS

## Blockers

- None.
