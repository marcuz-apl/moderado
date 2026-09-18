# Project Handoff

Updated: 2026-09-18 17:13 UTC
Branch: master
Commit: 6d1cb51 (`v0.2.0+2609181 feat(cli): add deferred provider connection`)
Status: ready for review

## Summary

The welcome screen remains visible as a dimmed background beneath `/help`, `/model`, and `/connect` popup layers. `/connect` uses the same layer for provider selection and every credential or model-ID field. `/model` now has a dark dedicated picker with curated popular-free shortcuts ahead of dynamic catalog actions.

## Completed

- Added shared welcome-popup composition in `apps/cli/src/ui/welcome.ts`.
- Converted `/help` to an in-place centered overlay.
- Reused the shared compositor for `/model` and `/connect`.
- Added layered provider/credential entry in `apps/cli/src/ui/provider_connect.ts`; secret values are masked.
- Added the `/model` dark-surface picker with live free/paid counts and Esc/cancel guidance.
- Added tests for popup composition and secret masking.

## In progress

- Changes are uncommitted and awaiting visual verification in a live terminal.

## Working tree

- Modified: `apps/cli/src/commands/chat.ts`, `apps/cli/src/ui/provider_connect.ts`, `apps/cli/src/ui/welcome.ts`, related tests, and this handoff.

## Checks

- `npm run build` — PASS
- `npm run typecheck` — PASS
- `npm test` — PASS (117 tests)
- `git diff --check` — PASS

## Decisions and context

- Popup frames dim the complete centered welcome screen, then render a shadow and popup at the viewport center.
- The official Alfazen skill is installed globally. The repository hook path is `.githooks`.

## Blockers

- None.

## Next action

1. Run `moderado` in a real terminal and verify `/help`, `/model`, and `/connect`; then commit with the Alfazen hook.
