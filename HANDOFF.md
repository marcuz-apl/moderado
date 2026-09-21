# Project Handoff

Updated: 2026-09-21 07:00 UTC
Branch: master
Commit: pending (`v0.2.45+260921e`)
Status: Coding prompt web search hijacking resolved, hardcoded Calgary prompt replaced, and OpenCode Zen removed from free presets. All 304 tests passing, packaging certified, and typecheck clean.

## Summary

1. **Coding Prompt Web Search Hijacking Resolved**:
   - Fixed `shouldFastRouteWebSearch` in `apps/cli/src/commands/chat.ts` to immediately bypass web search whenever a prompt requests coding, building, creating, implementing, or mentions technical coding terms (`write`, `create`, `build`, `make`, `app`, `webapp`, `component`, `widget`, `file`, `function`, `react`, `tailwind`, etc.).
   - Commands such as `"please write a weather webapp using React.JS and Tailwind CSS"` or `"create a weather widget component"` now directly invoke the coding agent loop without being hijacked by web search.
2. **Hardcoded City Example Removed from Prompt**:
   - Replaced `like "Currently in Calgary (September 20, 2026):".` in `buildSearchAnswerTask` with generic `like "Currently in [Location] ([Date]):".` to prevent models from hallucinating "Calgary" into unrelated responses.
3. **OpenCode Zen Gated-Tier Removed from Free Presets**:
   - Removed `opencode-zen` from `PROVIDER_PRESETS` in `apps/cli/src/ui/provider_connect.ts`, `apps/cli/src/commands/models.ts`, and `packages/providers/src/model_discovery.ts`.
   - Verified that OpenCode Zen requires a paid OpenCode Go subscription for premium models and actively blocks third-party clients from its free tier with `FreeTierError` (`"OpenCode's free tier can only be used from within OpenCode"`).
   - Preserved genuine free providers: **NVIDIA NIM**, **OpenRouter** (`:free` tier), and **Agnes AI**.

## Completed

- `apps/cli/src/commands/chat.ts`:
  - Added coding exclusion guard in `shouldFastRouteWebSearch`.
  - Replaced hardcoded Calgary string with neutral location placeholder in `buildSearchAnswerTask`.
  - Removed `opencode-zen` from `allModelsFree`.
- `apps/cli/src/ui/provider_connect.ts`:
  - Removed `opencode-zen` preset and interactive discovery branch.
- `apps/cli/src/commands/models.ts`:
  - Removed `OpenCode Zen` section from `handleModelsCommand`.
- `packages/providers/src/model_discovery.ts`:
  - Cleaned `SPIKE_PROVIDER_ENDPOINTS`.
- `apps/cli/tests/chat.test.ts`:
  - Added unit tests verifying coding requests are not hijacked by web search.
  - Asserted neutral location placeholder and absence of Calgary in evidence tasks.
- `apps/cli/tests/provider_connect.test.ts` & `apps/cli/tests/models.test.ts`:
  - Updated test assertions for NVIDIA NIM, OpenRouter, and Agnes AI.

## Checks

- `npm run typecheck` — PASS (0 errors)
- `npm run build` — PASS (all packages compile cleanly)
- `npm test` — PASS (48 test files, 304 passed)
- `npm run verify:package` — PASS (clean tarball packaging and smoke test)

## Decisions and context

- OpenCode Zen requires proprietary headers (`x-opencode-session`) and blocks non-OpenCode applications. To maintain Moderado's integrity as a 100% Free-First agent, it is excluded from default presets.
- Genuinely functional free tiers remain: OpenRouter (`:free`), NVIDIA NIM (free trial credits), and Agnes AI.

## Blockers

- None.


