# Project Handoff

Updated: 2026-09-24 UTC
Branch: master
Last implementation commit: `b5a7b5e` (`v0.3.4+260924j`)
Status: release published; corrected history, tag, and workflow pushed

## Summary

`moderado@0.3.4` is published on npm and GitHub Release `v0.3.4` is live with all 11 assets. The Publish workflow failed after the npm step because `--verify-tag` was mistakenly passed a second tag argument; the workflow and release runbook are corrected and pushed.

## Completed

- Confirmed `.github/workflows/publish.yml` uses GitHub-hosted Ubuntu, `id-token: write`, environment `release`, Node 22, npm 11.5.1, and direct `npm publish`.
- Confirmed failed run `36028254282` reaches npm's publish request after generating provenance.
- Updated `docs/FIRST_PUBLISH.md` with the GitHub owner and npm Allowed actions requirement; removed a stale npm-version gap from `docs/DISTRIBUTION.md`.
- Downloaded the successful verification run's binary artifacts, verified their manifest and checksums, generated distribution manifests, and created the GitHub Release directly with the corrected `gh release create` invocation.
- Added a workflow regression test for the `--verify-tag` syntax and corrected `.github/workflows/publish.yml` and `docs/RELEASING.md`.
- Rewrote the last six commit subjects with consecutive `v0.3.4+260924d` through `...i` prefixes and force-pushed `master` and `v0.3.4` with leases. The original tip is retained locally at `refs/backup/pre-rewrite-v0.3.4`.
- Committed workflow, test, runbook, and distribution manifest fixes as `b5a7b5e` (`v0.3.4+260924j`).

## In progress

- Monitor the verification workflow triggered by the moved `v0.3.4` tag.

## Working tree

- All release fixes and generated distribution manifests are committed; this handoff is the only remaining edit at the time of writing.

## Checks

- `npx vitest run apps/cli/tests/release_workflow.test.ts` — PASS (3 tests) after a confirmed red regression.
- `npm run verify:binaries -- --directory artifacts/release` — PASS.
- `gh release view v0.3.4 --json ...` — PASS; published, 11 assets.
- `npm view moderado version --json` — PASS; `0.3.4`.
- `git diff --check` — PASS.
- `npm run typecheck` — PASS.
- `npm test` — PASS (51 files, 359 tests).

## Decisions and context

- npm trusted publisher connections created after 2026-09-03 allow staged publishing by default. Direct `npm publish` requires an explicit allowed action; this was resolved externally before run `36029087162`.
- Never rerun the full Publish workflow for `v0.3.4`; npm rejects republishing an existing version. The GitHub Release was completed directly.
- Moving the tag changes its commit ID from `5ac5aef` to `b506e2a`; npm's existing provenance still refers to the original source commit.

## Blockers

- None for `v0.3.4` publication.

## Next action

1. Check the verification workflow started by the moved `v0.3.4` tag. Do not rerun the Publish workflow for the already published npm version.
