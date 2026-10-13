# Moderado Self-Update Design

## Goal

Let users update an existing Moderado installation from Terminal with `moderado update` or `moderado upgrade`.

## User-visible behavior

- `moderado update` installs the latest published release whose semantic version has the same major number as the installed version. This includes newer minor and patch releases.
- `moderado upgrade` installs the latest published release, including a major version change.
- Both commands report the installed version, target version, and outcome. If already current, they exit successfully and say so.
- Both commands update the current installation in place. They do not migrate the installation to a different distribution channel.
- If the installation source cannot be identified or updated safely, the command exits nonzero with the relevant manual update instruction.

## Installation channels

### npm global installation

Detect the active CLI package location and confirm it belongs to the `moderado` npm package before changing anything. Invoke npm with an argument array and `shell: false`, using the current Node/npm invocation where available, to install `moderado@<target-version>` globally. Preserve the existing npm global prefix. Do not update unrelated global packages.

### Standalone binary installed by the Moderado installer

Identify supported standalone installation locations and ensure the currently running executable is the managed `moderado` binary. Fetch published release metadata over HTTPS, validate its structure and semantic version, and choose a compatible target for `update` or the latest target for `upgrade`. Download the host platform artifact and checksum metadata, verify the artifact against both the checksum sidecar and release manifest, then replace the executable. Stage the verified file next to the destination and rename it into place so failed downloads or verification leave the current executable intact. Handle Windows replacement constraints explicitly; if safe replacement cannot be performed while running, report a restart/manual update instruction rather than corrupting or deleting the current binary.

### Package-manager-managed installs

Do not overwrite installations managed by Homebrew, Scoop, or another external package manager. Detect known package-manager ownership where feasible and print the package manager's update command. If ownership is ambiguous, fail closed with instructions rather than replacing a binary that may be managed elsewhere.

## Version selection

Parse the installed and remote release versions strictly. Strip the connected build metadata from Moderado's release identifier before semantic-version comparison. `update` filters to the installed major version and selects the highest available published release in that major. `upgrade` selects the highest available published release regardless of major. If no compatible release exists, report that and exit nonzero. A malformed remote version, invalid manifest, unsupported platform, missing artifact, or checksum mismatch fails closed without changing the installation.

## Architecture and boundaries

- Command routing and user-facing messages remain in `apps/cli`.
- Update orchestration belongs in a focused CLI command module and may reuse/extend the existing distribution manifest verification logic where that keeps behavior consistent.
- External JSON is runtime-validated before use. Keep dependencies unchanged and use Node built-ins for HTTPS, child processes, filesystem staging, hashing, and atomic rename where platform behavior permits.
- Never route an update through the agent tool system or its approval boundary; this is an explicit user-invoked CLI maintenance command.
- Child processes use executable plus argv with `shell: false`. Do not pass provider credentials or internal agent tokens to npm or other subprocesses.
- Do not execute a downloaded artifact before checksum verification.

## Errors and interruption

Network, metadata, version, platform, checksum, permission, process, and replacement failures produce concise actionable messages and nonzero exit codes. Temporary downloads are cleaned up on success, failure, or interruption. The existing executable remains usable if any step before final replacement fails.

## Verification

- Unit tests cover command parsing and routing, strict manifest/version validation, same-major versus cross-major target selection, package-manager guidance, npm invocation arguments, and failure paths.
- Standalone update tests use a local HTTP fixture and temporary install directory to verify checksum acceptance/refusal and replacement behavior without live network access.
- Existing installer checksum guarantees remain intact.
- Document both commands, channel behavior, and manual fallback in the CLI README and distribution documentation.
- No runtime dependency is added.

## Out of scope

- Automatic update checks during normal Moderado startup.
- Automatic migration between npm, binary, Homebrew, and Scoop channels.
- Updating Homebrew taps, Scoop buckets, or other package repositories from the CLI.
- Prerelease or arbitrary version selection flags.
