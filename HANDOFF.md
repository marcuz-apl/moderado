# Project Handoff

Updated: 2026-09-21 05:41 UTC
Branch: master
Commit: 4339581 (`v0.2.40+2609213`)
Status: M7.8 committed; typecheck, build, and test suite green.

## Summary

Milestone M7.8 (Composer context: `/init`, `@` mentions, images) is fully implemented:
1. `/init` slash command scans the workspace through the workspace jail, scaffolds a customized `AGENTS.md` following Ponytail engineering principles, and writes it through `WriteFileTool` after interactive human approval.
2. `@` file-mention picker extends composer autocomplete, allowing interactive selection and Tab completion of files, backed by jail-safe `listFiles` helper in `@moderado/tools`.
3. Image attachments by path (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, etc.) are converted into explicit model context with MIME type and base64 data URI (or capped metadata if exceeding inline limit) without terminal-dependent drag-and-drop.
4. All previous typecheck and build blockers in `chat.ts` and `file_mentions.ts` are resolved.

## Completed

- `packages/tools/src/tools/list_files.ts`: Implemented and exported `listFiles` helper function with recursion and depth options; covered by unit tests in `packages/tools/tests/tools.test.ts`.
- `apps/cli/src/ui/file_mentions.ts`: Expanded to support image attachments (base64 context), `isImagePath`, `getImageMimeType`, `filterMentionCandidates`, and `createWorkspaceFileSource`; 14 unit tests in `apps/cli/tests/file_mentions.test.ts`.
- `apps/cli/src/commands/init.ts`: Implemented `scanWorkspaceProject`, `generateAgentsScaffold`, and `initWorkspace` with interactive human approval and `WriteFileTool` execution; 4 unit tests in `apps/cli/tests/init.test.ts`.
- `apps/cli/src/ui/welcome.ts`: Wired `/init` slash command, `@` mention autocomplete suggestions popup, Tab completion, and help documentation; 32 unit tests in `apps/cli/tests/welcome.test.ts`.
- `apps/cli/src/commands/chat.ts`: Wired `initWorkspace` into `onInit`, `listFiles` into `onMentionComplete`, and `expandMentions` into user turn submission before invoking the agent loop.
- `docs/CLI_CAPABILITY_ROADMAP.md`: Marked M7.8 complete.

## Working tree

- M7.8 changes:
  - `packages/tools/src/tools/list_files.ts`
  - `packages/tools/tests/tools.test.ts`
  - `apps/cli/src/ui/file_mentions.ts`
  - `apps/cli/tests/file_mentions.test.ts`
  - `apps/cli/src/commands/init.ts`
  - `apps/cli/tests/init.test.ts`
  - `apps/cli/src/ui/welcome.ts`
  - `apps/cli/tests/welcome.test.ts`
  - `apps/cli/src/commands/chat.ts`
- Documentation:
  - `docs/CLI_CAPABILITY_ROADMAP.md`
  - `HANDOFF.md`

## Checks

- `npm run typecheck` — PASS (0 errors)
- `npm run build` — PASS (all packages build cleanly)
- `npx vitest run --pool=threads --maxWorkers=1 --minWorkers=1` — PASS (47 files, 272 tests)
- `git diff --check` — PASS (clean formatting)

## Decisions and context

- Mentions are expanded on user prompt submission through jail-contained `expandMentions`, passing the expanded context to the model while preserving the concise question text in the TUI history.
- `/init` requests explicit human approval for `write_file` before writing `AGENTS.md` via `WriteFileTool.execute`.
- Images are detected by extension and encoded as standard base64 data URIs within model context, avoiding unsupported terminal-specific clipboard or drag-and-drop mechanisms on Windows/WSL.

## Blockers

- None. The build blocker reported in previous handoffs is resolved.

## Next action

- Proceed with M7.9 (`/session undo | redo | share`) or owner review and commit of M7.8 working-tree changes.
