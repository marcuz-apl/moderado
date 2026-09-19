# Release Readiness Design

**Date:** 2026-09-19  
**Milestone:** M5.3 — Distribution and operational polish

## Goal

Make Moderado installable and diagnosable without exposing provider credentials or requiring a source checkout.

## Distribution

`apps/cli` is the sole publishable npm package. Its package metadata names the
project, declares Node 20 or newer, MIT licensing, repository location, and
the `moderado` executable. The package publishes compiled CLI output and the
workspace packages it requires, never tests, source files, local sessions,
configuration, or diagnostic logs.

`npm pack --dry-run` is the release-content check. It must show the executable
and compiled application files and must not include secret-bearing user data.

## Local diagnostic logs

The CLI writes structured JSON Lines records to `~/.moderado/logs/` only for
operational failures that prevent a requested command from completing. A record
contains timestamp, command, a stable error category, and a redacted message.
It must not contain environment values, API keys, request bodies, tool output,
or workspace file content. Logging failure is ignored so it cannot mask the
original user-facing error.

The logger remains in `apps/cli`; core, provider, and tool packages do not
depend on it. Tests inject a temporary home path and inspect the written log
offline.

## User documentation

The README describes npm installation, supported Node versions, provider
connection, Windows Credential Manager behavior, environment-variable fallback,
`doctor`, and the explicit `--connectivity` live check. It labels every live
operation as optional and keeps automated tests offline.

## Acceptance criteria

- `npm pack --dry-run` validates the intended release contents.
- Failure logs redact common provider-key formats and are local only.
- A new user can install, connect a provider, choose a model, and run `doctor`
  from documented instructions.
- The roadmap marks M5 complete after tests, build, package inspection, and a
  manual CLI help check pass.

## Exclusions

This milestone does not publish an npm release, create CI release automation,
upload telemetry, add automatic updates, or add cloud log collection.
