# Project Handoff

Updated: 2026-09-21 06:25 UTC
Branch: master
Commit: d8ebbbc (`v0.2.43+2609217`)
Status: Multi-token command parsing, Windows cmd/batch resolution, and default timeout handling fixed; all 302 tests passing, typecheck and build green.

## Summary

1. **Multi-Token Command Parsing (`splitCommandString` & `parseCommandLine`)**:
   - Fixed `run_command` so that multi-token command strings like `"ls -la"` or `"git commit -m 'message'"` are properly tokenized into executable and arguments instead of searching for an executable named literally `"ls -la.exe"` (`spawn ENOENT`).
   - Handles quoted arguments (both single and double quotes), escaped characters, and unquoted Windows paths with spaces (`C:\Program Files\...`).
2. **Timeout Fallback Bug Resolved**:
   - Fixed a fatal bug where omitted/undefined `params.timeoutSeconds` resulted in `NaN * 1000 = NaN`, causing Node's `setTimeout(NaN)` to fire after 1 millisecond and kill the child process prematurely with `Command timed out after undefined seconds`.
   - Now safely defaults to 60 seconds (`const timeoutSecs = ... ?? 60`).
3. **Windows Batch & Built-in Resolution**:
   - Commands that are `.cmd` / `.bat` batch files or common Node command shims (`npm`, `npx`, `pnpm`, `yarn`, `tsc`, `corepack`) as well as `cmd.exe` built-ins (`dir`, `del`, `copy`, `type`) are automatically executed via `cmd.exe /d /s /c` with `shell: false`.
4. **Auto-Approved Workspace File Writes & `[A] Always approve`**:
   - All workspace file mutations (`write_file`, `edit_file`, `apply_patch`) are auto-approved by default in the workspace jail.
   - Interactive prompt `[A] Always approve` and `-y` / `--auto-approve` CLI flags fully functional.

## Completed

- `packages/tools/src/tools/run_command.ts`:
  - Added `splitCommandString(str)` for robust shell-like tokenization preserving quotes.
  - Added `parseCommandLine(command, args)` supporting multi-token strings and path resolution.
  - Wrapped Windows batch, Node shims, and shell built-ins with `COMSPEC` (`cmd.exe /d /s /c`) when on `win32`.
  - Fixed timeout handling with safe default (`timeoutSecs = params.timeoutSeconds ?? 60`).
- `packages/tools/tests/tools.test.ts`:
  - Added unit tests for `splitCommandString` with quotes and spaces.
  - Added unit tests for `parseCommandLine`.
  - Added test verifying execution of multi-token commands with empty `args`.
  - Added test verifying execution without explicit `timeoutSeconds` runs to completion.

## Checks

- `npm run typecheck` — PASS (0 errors)
- `npm run build` — PASS (all packages build cleanly)
- `npx vitest run --pool=threads --maxWorkers=1 --minWorkers=1` — PASS (47 files, 302 tests)
- `git diff --check` — PASS (clean formatting)

## Decisions and context

- Kept `shell: false` to eliminate arbitrary shell injection vulnerabilities; tokenization and Windows cmd wrapping provide safe execution without exposing raw subshell expansions.
- Sanitized environment variables (`NVIDIA_API_KEY`, tokens) continue to be purged before spawning child processes.

## Blockers

- None.
