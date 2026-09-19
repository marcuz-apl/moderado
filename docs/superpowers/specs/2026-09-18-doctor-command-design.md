# Doctor Command Design

**Date:** 2026-09-18
**Milestone:** M5.1 — Local environment diagnostics

## Goal

Let a user diagnose a Moderado installation and workspace without reading source code or exposing credentials.

## Scope

`moderado doctor` performs only local checks: supported Node version, workspace read access, Moderado home-directory write access, active provider configuration, API-key presence, selected model, and `git`/`npm` availability. It prints pass, warning, and failure rows with remediation text.

`moderado doctor --connectivity` additionally makes one explicit provider catalog request using the active connection. This is opt-in, never called by the default command, and excluded from offline tests.

## Architecture

`apps/cli` owns the command because it composes configuration, workspace selection, and terminal presentation. A small pure `doctor.ts` module produces typed checks that can be tested with injected filesystem, process, and connectivity functions. Provider adapters remain unchanged.

## Security and behavior

Credentials are represented only as configured or missing. Output never includes API keys, raw environment values, or provider headers. Local checks use read-only access except a temporary write/delete probe within `~/.moderado`. Missing optional tools are warnings; unreadable workspace, unsupported Node runtime, or an invalid configured provider are failures. The command returns one when a failure exists and zero for warnings only.

## Testing

Offline tests inject fake dependencies to cover healthy setup, missing key, failed workspace access, unavailable `git`, redaction, exit status, and that connectivity is not called unless explicitly requested.

## Exclusions

M5.1 does not install dependencies, repair configuration, alter credentials, update Moderado, or write logs.