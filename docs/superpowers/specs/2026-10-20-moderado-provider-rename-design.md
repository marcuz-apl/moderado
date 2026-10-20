# Moderado Provider Rename Design

## Goal

Replace the “Moderado Cloud” name with “Moderado” throughout the current codebase, including user-facing copy, error messages, documentation, tests, and provider-specific code names. Use `moderado` as the canonical built-in provider ID while preserving existing user configurations, credentials, and exported API compatibility.

## Scope

- Rename the built-in preset ID from `moderado-cloud` to `moderado` and update provider metadata, adapter checks, OAuth helpers, config references, SSE option names, and related tests.
- Rename `ModeradoCloud`, `moderadoCloud`, and `MODERADO_CLOUD_*` identifiers to Moderado equivalents. New environment variables use `MODERADO_ENV` and `MODERADO_BASE_URL`.
- Replace human-readable “Moderado Cloud” references in source, tests, and current documentation with “Moderado”. Update the existing design/planning documents in the repository, but do not rewrite Git history.
- Keep unrelated “Gateway” wording and behavior unchanged.

## Compatibility

- Keep deprecated aliases for previously exported `MODERADO_CLOUD_*` constants/helpers, the legacy preset ID type, and old environment variables. Internal code and new documentation use canonical Moderado names; aliases delegate to the new implementation.
- Normalize legacy `moderado-cloud` IDs when reading saved provider connections, active connection selection, and enabled preset configuration. Write normalized data using `moderado` on subsequent config saves.
- Normalize a legacy connection display name of “Moderado Cloud” to “Moderado” when loading configuration.
- If both legacy and canonical connection entries exist, the canonical `moderado` entry wins. Preserve any explicit `credentialReference` found on the selected entry so credentials stored under the old reference remain resolvable.
- Prefer `MODERADO_ENV` and `MODERADO_BASE_URL`, falling back to `MODERADO_CLOUD_ENV` and `MODERADO_CLOUD_BASE_URL` only when the corresponding new variable is unset.
- Do not delete or blindly move old credential-store entries. Existing stored references remain usable; newly stored credentials use `moderado/provider/moderado`.
- Normalize the legacy provider ID in persisted session records when they are loaded for active use, while retaining historical content and messages.

## Validation

- Add regression tests for config normalization, canonical-entry precedence, legacy credential-reference preservation, legacy environment-variable fallback, preset alias handling, and session provider-ID normalization.
- Update adapter/SSE, OAuth, provider metadata, UI, and gateway-error tests to the canonical names.
- Run focused package tests for contracts, providers, and CLI, then the workspace typecheck and full test suite.
- Search tracked source and documentation for obsolete `Moderado Cloud`, `moderado-cloud`, `ModeradoCloud`, `moderadoCloud`, and `MODERADO_CLOUD` references; remaining occurrences should be limited to deliberate backward-compatibility aliases and tests asserting those aliases.
