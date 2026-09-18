# Project Handoff

Updated: 2026-09-18 18:59 UTC
Branch: master
Commit: b8366a1 (`v0.2.0+2609182 feat(cli): layer slash command windows over welcome`)
Status: ready for review

## Summary

The welcome screen remains visible as a dimmed background beneath `/help`, `/model`, and `/connect` popup layers. Every popup now uses a dark-grey surface with white foreground text for contrast against the black welcome screen. NVIDIA NIM remains the default provider; OpenRouter and Agnes AI are prefilled provider presets.

## Completed

- Added shared welcome-popup composition in `apps/cli/src/ui/welcome.ts`.
- Converted `/help` to an in-place centered overlay.
- Reused the shared compositor for `/model` and `/connect`.
- Added layered provider/credential entry in `apps/cli/src/ui/provider_connect.ts`; secret values are masked.
- Added the `/model` dark-surface picker with live free/paid counts and Esc/cancel guidance.
- Added OpenRouter and Agnes AI provider presets in `/connect`.
- Applied a shared dark-grey popup surface with white text to `/help`, `/model`, and `/connect`.
- Added tests for popup composition and secret masking.
- Fixed `/model` with no NVIDIA NIM connection: it now opens a visible `/connect`
  guidance popup rather than silently returning to the welcome screen.
- Extended `/model` for OpenRouter, Agnes AI, and other OpenAI-compatible
  connections. It discovers `/models` when supported, offers filterable browse
  and explicit model-ID entry, and persists a changed selection in the active
  provider profile.
- Agnes AI model choices are explicitly labelled `Free` in `/model`.
- OpenRouter `/model` now preserves API pricing metadata and separates live
  models into `Free` and `Paid` popup lists, with a badge on every model.

## In progress

- The current UI and `/model` unavailable-state changes are uncommitted.

## Working tree

- Modified: welcome, model-selection, provider-connection UI and tests, plus this handoff.

## Checks

- `npm run build` — PASS
- `npm run typecheck` — PASS
- `npm test` — PASS (122 tests)
- `git diff --check` — PASS

## Decisions and context

- Popup frames dim the complete centered welcome screen, then render a shadow and popup at the viewport center.
- The official Alfazen skill is installed globally. The repository hook path is `.githooks`.

## Blockers

- None.

## Next action

1. Run `moderado` in a real terminal and verify `/help`, `/model`, and `/connect`; then commit with the Alfazen hook.
