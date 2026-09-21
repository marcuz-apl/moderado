# Project Handoff

Updated: 2026-09-21 05:53 UTC
Branch: master
Commit: f94a4b6 (`v0.2.41+2609215`)
Status: M7.11 complete and committed; all 294 tests passing, typecheck and build green.

## Summary

Milestone M7.11 (Hardened Windows/WSL paths) is fully implemented:
1. Canonicalization of cross-platform Windows and WSL representations (`\\wsl$\<distro>\mnt\<drive>\...`, `\\wsl.localhost\<distro>\mnt\<drive>\...`, `/mnt/<drive>/...`, `C:\...`, and `\\?\` extended paths) into unified workspace jail paths in `packages/tools/src/jail.ts`.
2. Workspace pre-containment check before touching filesystem/network to prevent Windows SMB NetBIOS timeout hangs (4-5s delay) and NetNTLM hash leak risks on external UNC paths.
3. Windows drive-letter casing tolerance and strict cross-drive boundary enforcement (rejects `C:\...` when root is on `D:\...`, and vice versa).
4. Symlink and junction escape defense verifying canonical targets against workspace boundaries while allowing valid internal directory junctions.
5. Hardened `.git`, `.env`, and credential protection with case-insensitive matching across subdirectories and Windows NTFS Alternate Data Streams (ADS `::$DATA`) denial.
6. 28 comprehensive tests in `packages/tools/tests/jail.test.ts` verifying all Windows/WSL edge cases.

## Completed

- `packages/tools/src/jail.ts`:
  - Implemented `normalizeCrossPlatformPath` handling `/mnt/<drive>/...`, `\\wsl$\...`, `\\wsl.localhost\...`, `//wsl$/...`, extended-length prefixes (`\\?\`), and drive-letter canonicalization.
  - Implemented `isContainedInRoot` with Windows case-insensitive path comparison.
  - Hardened `resolveInJail` with pre-containment validation and symlink dereference checking.
  - Hardened `isProtectedPath` with recursive segment matching, case-insensitivity, and NTFS ADS stream stripping.
- `packages/tools/tests/jail.test.ts`:
  - Expanded from 6 to 28 tests covering cross-platform normalization, UNC security, cross-drive rejection, junctions/symlinks, and sensitive file denial.
- `docs/CLI_CAPABILITY_ROADMAP.md`:
  - Marked M7.11 complete.

## Working tree

- M7.11 changes:
  - `packages/tools/src/jail.ts`
  - `packages/tools/tests/jail.test.ts`
- Documentation:
  - `docs/CLI_CAPABILITY_ROADMAP.md`
  - `HANDOFF.md`

## Checks

- `npm run typecheck` — PASS (0 errors)
- `npm run build` — PASS (all packages build cleanly)
- `npx vitest run --pool=threads --maxWorkers=1 --minWorkers=1` — PASS (47 files, 294 tests)
- `git diff --check` — PASS (clean formatting)

## Decisions and context

- External UNC paths are pre-checked for workspace containment before any `fs.existsSync` or `fs.realpathSync` call to avoid SMB network resolution timeouts on Windows and NetNTLM hash exposure.
- Directory junctions on Windows are supported without administrator privileges, enabling jail symlink escape testing natively on Windows CI/dev environments.
- `.git` and `.env` protection uses case-insensitive segment checks and strips `::$DATA` to defend against Windows NTFS alternate stream bypasses.

## Blockers

- None.

## Next action

- Commit and push M7.11 changes, then proceed to M7.9 (`/session undo | redo | share`) or M7.3 release workflow.
