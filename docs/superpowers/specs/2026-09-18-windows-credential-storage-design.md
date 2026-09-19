# Windows Credential Storage Design

**Date:** 2026-09-18
**Milestone:** M5.2 — Secure provider credentials

## Goal

Keep provider API keys out of Moderado configuration files on Windows while retaining explicit environment-variable support everywhere.

## Design

`apps/cli` defines a `CredentialStore` interface with read, write, and delete operations. A Windows implementation invokes Credential Manager through `cmdkey` using fixed argument arrays, hidden windows, and scrubbed output. Tests use an in-memory fake store.

Configuration retains provider metadata and an optional credential reference, never a secure-store value. Resolution order is environment variable, secure-store reference, then a legacy plaintext config key. Legacy values remain readable only for migration. A successful migration writes the key to the store, removes the plaintext key from config atomically, and reports only that migration completed.

## User flow

During `/connect`, Moderado writes the selected provider key to the credential store and saves a reference. If Credential Manager is unavailable, it explains that the user can set the provider environment variable. `moderado doctor` reports configured credential source without printing a secret. Legacy config keys are migrated only after a user confirms the action.

## Security

No command output, diagnostic output, exception, session export, or configuration rendering may contain an API key. The process always uses `shell: false`; password values are passed only to the OS credential command and never through a shell. A failed write leaves the legacy configuration unchanged.

## Testing

Offline tests use the fake store for resolution order, reference generation, migration success, migration failure, plaintext removal, and redaction. They never call Credential Manager.

## Exclusions

This increment does not add macOS Keychain, Linux Secret Service, cloud sync, credential sharing, or automatic migration without confirmation.