# Findings

- `HEAD`, `origin/master`, and tag `v0.4.0` are at `dd982e4`; `VERSION` is `v0.4.0+2610055`.
- Current branch is `cloud-login-0.4.0-local`, separate from master.
- Current `HANDOFF.md` is stale and says v0.4.0 is untagged; update it after implementation.
- `Agent.run` selects local catalog models and sends `currentModel.id`; chat currently maps `auto` to no pinned route, so Gateway `auto` is lost.
- Cloud `auto` now skips local inventory selection and retries, sends literal `auto`, and is scoped-reviewed with no defects found.
- Gateway request validation now serializes `{messages, tools}` together for the exact 4096-byte contract boundary; Gateway errors are sanitized/non-retryable; `Retry-After` handles delay-seconds and HTTP-date.
- OAuth callback validation compares exact loopback origin and `/callback` path and verifies state before code exchange; access key expiry is non-secret config metadata.
- Follow-up security review tightened raw request-target checking, duplicate `code`/`state` rejection, and disabled fetch redirects while exchanging the one-time code and verifier.
- Shared SSE parser now consumes Gateway status frames only for Moderado Cloud; non-Cloud frames, even malformed JSON, are skipped so BYOK streams cannot be affected.
- Quota errors now include parsed `Retry-After` seconds in the actionable error message.
- Gateway functionality shares the OpenAI-compatible adapter; provider-specific limits/errors must be conditional on `providerId === 'moderado-cloud'` to avoid changing BYOK.
- SSE parser currently ignores `event:` lines; contract status events need a typed chunk/event and CLI rendering path.
- Cloud login currently prompts for manual `mrd_` key only; OAuth callbacks can use Node built-ins and the existing credential store.
