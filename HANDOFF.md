# Moderado Project Handoff

Updated: 2026-10-23
Branch: `master`
Status: release preparation in progress

## Summary

Preparing the next patch release (`v0.4.46`). Inline charts now support a
blue-to-red color transition; documentation and focused tests are updated.

## Completed

- Updated `CHANGELOG.md`, `docs/GUIDE.md`, and `docs/RELEASING.md` for inline
  chart colors, session cost reporting, and the upcoming release candidate.
- Added focused ANSI color and width coverage in `apps/cli/tests/chart.test.ts`.
- Prepared `VERSION`, `apps/cli/package.json`, and `package-lock.json` at
  `0.4.46`.

## In progress

- Release preflight, commit, and push. No tag or public release has been made.
- Approved shared-config coordination remains unimplemented; spec and plan are
  in `docs/superpowers/specs/2026-10-23-cross-client-config-coordination-design.md`
  and `docs/superpowers/plans/2026-10-23-cross-client-config-coordination.md`.

## Working tree

Release documentation, chart renderer and tests, and release version files are
modified or untracked; they are intended for the authorized release-prep commit.

## Checks

- `npm test -- --run apps/cli/tests/chart.test.ts` — PASS (2 tests)
- `npm run typecheck` — PASS
- `npm run build` — PASS
- `git diff --check` — PASS
- `npm test` — FAIL: existing terminal resize assertions, web-search timeout,
  and provider-connect failures (loopback bind `EPERM` and interactive timeouts).
  Stopped after the failures appeared.
- `npm run verify:package` — INTERRUPTED after its isolated `npm install` smoke-test step stalled in the restricted network environment.

## Decisions and context

- Chart colors are blue → cyan → green → yellow → orange → red. ANSI colors
  are disabled for non-TTY output and when `NO_COLOR` is set.
- Keep `v0.4.34` as the latest local release tag; later commits remain
  unreleased until a verified tag and publication.

## Blockers

- The full offline suite is not green in this environment. Release certification
  remains incomplete until the unrelated failures are resolved or verified in
  an environment that permits loopback servers and interactive tests.

## Next action

1. Resolve the terminal-layout test expectations and run release verification in an environment that permits loopback and package installation; then tag and publish only after verification.

## Resume notes

- Release candidate: `v0.4.46`.
- Push a release tag only after local preflight and CI artifact verification;
  public publication uses the guarded manual workflow in `docs/RELEASING.md`.
