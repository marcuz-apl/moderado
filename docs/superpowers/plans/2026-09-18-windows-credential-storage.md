# Windows Credential Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Store Windows provider credentials outside Moderado configuration files while keeping explicit environment-variable fallback.

**Architecture:** A credential-store abstraction in the CLI separates OS access from provider config. Windows Credential Manager is the production store; tests use a fake store. Configuration retains references and provider metadata only.

**Tech Stack:** TypeScript, Node.js child processes, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-windows-credential-storage-design.md`

### Task 1: Store interface and fake tests

- [ ] Write failing tests for resolution order and generated credential references.
- [ ] Add `CredentialStore` and an in-memory fake test implementation.
- [ ] Run focused tests.

### Task 2: Windows Credential Manager implementation

- [ ] Write failing tests for command construction, no-shell policy, and errors without secret leakage.
- [ ] Implement a fixed PowerShell/C# Credential Manager bridge using `CredRead`, `CredWrite`, and `CredDelete`; pass secrets through standard input and redact errors.
- [ ] Run focused tests without calling the real vault.

### Task 3: Configuration migration and composition

- [ ] Write failing tests for successful migration, failure retention, and plaintext removal.
- [ ] Add credential references to config and migrate only after user confirmation in `/connect` or doctor.
- [ ] Preserve environment-variable precedence.

### Task 4: Documentation and validation

- [ ] Document Windows support and environment fallback.
- [ ] Run `npm test; npm run build; git diff --check`.
- [ ] Commit with Alfazen versioning.