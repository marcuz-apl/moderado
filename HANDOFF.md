# Moderado Project Handoff

Updated: 2026-10-23
Branch: `master`
Status: release candidate ready for artifact verification

## Summary

Preparing `v0.4.46`, which includes inline chart color gradients. Release notes,
usage documentation, tests, and version metadata are updated. The release-prep
commit `50cf873` is pushed to `origin/master`; a follow-up test-maintenance
commit refreshes the responsive-layout expectations.

## Completed

- Inline line charts transition blue → cyan → green → yellow → orange → red;
  bar colors reflect magnitude. `NO_COLOR` and non-TTY output disable ANSI color.
- Documented inline charts and unknown session cost in `docs/GUIDE.md`.
- Updated `CHANGELOG.md` and `docs/RELEASING.md` for the `v0.4.46` candidate.
- Updated stale chat-layout assertions to distinguish the full-width chat frame
  from the capped startup Welcome card.
- Full offline suite passes: 72 files, 710 tests. Package verification passes.

## In progress

- No release tag or public release has been created. Push tag `v0.4.46` when
  ready to start CI artifact verification; public publication remains a separate
  guarded workflow.
- Approved shared-config coordination remains unimplemented; its spec and plan
  are in `docs/superpowers/specs/2026-10-23-cross-client-config-coordination-design.md`
  and `docs/superpowers/plans/2026-10-23-cross-client-config-coordination.md`.

## Working tree

The handoff and layout-test updates are committed and pushed with the release
preparation work.

## Checks

- `npm test` — PASS (72 files, 710 tests; local-server suites required normal local permissions)
- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm run verify:package` — PASS (`moderado-0.4.46.tgz` installed and smoke-tested)
- `git diff --check` — PASS

## Decisions and context

- `v0.4.34` is the latest release tag in this checkout; subsequent versions are
  unreleased until a verified release tag is created.
- Cost is unknown when token counts are estimated, exact model prices are absent,
  multiple models were used, or a prior session turn had unknown cost.

## Blockers

None for the release candidate's local verification. CI artifact verification
and guarded publication remain outstanding.

## Next action

1. Push the `v0.4.46` tag when ready to trigger the read-only artifact workflow.
