# Project Handoff

Updated: 2026-09-21 03:09 UTC
Branch: master
Commit: 6db8058 (`v0.2.38+2609211`)
Status: M7.10 complete in the working tree; awaiting owner review/commit.

## Summary

M7.10 now provides a core-owned, dependency-injected `subagent` declaration. A child agent shares the parent’s registry, approval handler, policy, mutation lifecycle hooks, and event stream; nested delegation is prohibited. The existing `run_command` and `search_files` tools advertise shell/grep UX aliases without introducing new tool contracts.

## Completed

- Core subagent declaration is exposed only to tool-capable root agents and validates a trimmed, non-empty task up to 2,000 characters.
- Child agents preserve read-only, non-interactive, timeout, approval, and M7.9 checkpoint lifecycle behavior; child events reach ordinary and host listeners.
- Nested or hallucinated child delegation is rejected, bounding each delegation to one child with at most five steps.
- `run_command` remains `shell: false` and `search_files` returns grep-style `path:line:content` output; neither `bash` nor `grep` exists as a tool.
- Roadmap marks M7.10 complete.

## Working tree

- M7.10 changes: `packages/core/src/agent.ts`, `packages/core/src/subagent.ts`, `packages/core/tests/agent.test.ts`, `packages/core/tests/subagent.test.ts`, `packages/tools/src/registry.ts`, `packages/tools/src/tools/run_command.ts`, `packages/tools/src/tools/search_files.ts`, and `packages/tools/tests/tools.test.ts`.
- Documentation/handoff: `docs/CLI_CAPABILITY_ROADMAP.md`, `HANDOFF.md`.

## Checks

- `npx vitest run --pool=threads --maxWorkers=1 --minWorkers=1` — PASS (45 files, 249 tests)
- `git diff --check` — PASS before documentation-only updates
- `npm run typecheck` — FAIL only in the pre-existing M7.8 files `apps/cli/src/commands/chat.ts` and `apps/cli/src/ui/file_mentions.ts` (`onInit`, `initWorkspace`, and `listFiles` are incomplete).
- `npm run build` — FAIL for the same pre-existing M7.8 errors.

## Decisions and context

- The `subagent` provider declaration is core-owned, not a tools-package contract, so it cannot be independently registered or used to bypass the injected parent policy.
- M7.10 does not repair the separate M7.8 composer implementation; it remains the only typecheck/build blocker.

## Blockers

- Full typecheck/build cannot pass until M7.8 is finished or its incomplete committed code is repaired.

## Next action

1. Review and commit the M7.10 working-tree changes, or continue directly with M7.8 to remove the build blocker.

## Resume notes

- Keep full Vitest constrained to one worker on this Windows environment: `npx vitest run --pool=threads --maxWorkers=1 --minWorkers=1`.
- Owner explicitly requested that the completed M7.10 working-tree changes be committed and pushed.
