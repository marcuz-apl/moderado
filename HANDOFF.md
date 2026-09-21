# Project Handoff

Updated: 2026-09-21 06:45 UTC
Branch: master
Commit: pending (`v0.2.45+260921d`)
Status: Free-Only Model Catalog implemented across NVIDIA NIM, OpenRouter, OpenCode Zen, and Agnes AI. All 304 tests passing, packaging certified, and typecheck clean.

## Summary

1. **Free-First Model Catalog Differentiation**:
   - Moderado now exclusively lists and selects verified free models across 4 free providers: **NVIDIA NIM**, **OpenRouter**, **OpenCode Zen**, and **Agnes AI**.
   - Completely eliminated "Browse Paid Models" and all paid endpoints from the interactive model selector UI and CLI commands.
2. **OpenCode Zen Integration**:
   - Added `opencode-zen` preset (`OpenCode Zen`, `https://opencode.ai/zen/v1`, tag: `Free Models`).
   - Integrated OpenCode Zen model auto-discovery into provider connection workflows and chat sessions (`allModelsFree: true`).
3. **Curated Free Models CLI Hub (`moderado models`)**:
   - Upgraded `moderado models` command to discover and present the free model catalog across all 4 free providers with clear tier indicators (`[Free NIM]`, `[Free OpenRouter]`, `[Free OpenCode]`, `[Free Agnes]`).
   - Added `--provider <name>` filter flag allowing focused inspection per provider.
4. **Interactive Model Picker Guardrails**:
   - Removed paid model browsing choices from `buildCompatibleModelMenuItems`.
   - Filtered `selectCompatibleModelOverlay` so only verified free endpoints are selectable.
   - Provider model discovery uses dependency-injected `fetchImpl` for deterministic, offline testing.

## Completed

- `packages/providers/src/model_discovery.ts`:
  - Added optional `{ signal, fetchImpl }` parameter to `fetchProviderModels` for offline-safe model listing.
- `apps/cli/src/args.ts`:
  - Added `provider?: string` parsing to `CliParsedArgs`.
- `apps/cli/src/commands/models.ts`:
  - Upgraded `handleModelsCommand` to discover free models across NVIDIA NIM, OpenRouter, OpenCode Zen, and Agnes AI.
  - Added formatted console output with provider tags and model identifiers.
- `apps/cli/src/commands/chat.ts`:
  - Configured `opencode-zen` with `allModelsFree: true` for automatic free-tier compatibility.
- `apps/cli/src/ui/provider_connect.ts`:
  - Added `opencode-zen` to `PROVIDER_PRESETS` and auto-discovery dispatch.
- `apps/cli/src/ui/model_selector.ts`:
  - Strictly limited interactive model selection to free models (`isFreeCompatibleModel`), removing all paid model items.
- `apps/cli/tests/models.test.ts`:
  - Added unit test suite validating free model output and provider filtering.
- `apps/cli/tests/model_selection.test.ts` & `apps/cli/tests/provider_connect.test.ts`:
  - Updated and expanded test suites for 100% free model picker and OpenCode Zen preset.

## Checks

- `npm run typecheck` — PASS (0 errors)
- `npm run build` — PASS (all packages compile cleanly)
- `npm test` — PASS (48 test files, 304 passed)
- `npm run verify:package` — PASS (clean tarball packaging and smoke test)

## Decisions and context

- Moderado differentiates itself from Cline, Cursor, Claude Code, and Aider by being 100% Free-First: zero surprise charges, zero paid model browsing, zero required credit cards for default usage.
- All network interactions in tests utilize injected `fetchImpl` mocks to guarantee 100% offline test compliance.

## Blockers

- None.

