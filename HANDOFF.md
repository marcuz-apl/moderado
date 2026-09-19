# Project Handoff

Updated: 2026-09-19 19:20 UTC
Branch: master
Commit: M6.1 local feature commit
Status: M6.1 complete locally and ready to push.

## Summary

Moderado now creates a standalone npm tarball that includes its compiled internal workspace runtime and can be installed into an empty temporary prefix. The release workflow verifies and uploads that artifact without publishing it.

## Completed

- M6.1 standalone runtime preparation and tarball verifier in `scripts/`.
- Windows-safe npm and CLI process invocation without `shell: true`.
- Artifact-only GitHub Actions workflow at `.github/workflows/release.yml`.
- User installation and maintainer release documentation in `README.md` and `docs/RELEASING.md`.

## In progress

- No implementation work is in progress.

## Working tree

- Handoff snapshot update pending inclusion in the M6.1 feature commit.

## Checks

- `npm.cmd test` - PASS (39 files, 180 tests).
- `npm.cmd run build` - PASS.
- `npm.cmd run verify:package` - PASS; packed tarball installed and `moderado --help` completed from an empty temporary prefix.
- `git diff --check` - PASS.

## Decisions and context

- M6.1 uploads a GitHub Actions package artifact only. It does not publish to npm and holds no npm token.
- A future M7.1 proposal should introduce controlled, approval-gated web search as a separate capability; it requires PRD, tool, architecture, and security documentation changes.

## Blockers

- None.

## Next action

1. Push the local M6.1 commits when requested, then design M7.1 controlled web search before implementation.

## Resume notes

- Run `npm.cmd run verify:package` for the release-only tarball check.
- The root `VERSION` is `v0.2.21+260919v`.