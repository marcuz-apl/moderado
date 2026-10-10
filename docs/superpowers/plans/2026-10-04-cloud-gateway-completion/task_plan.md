# Cloud Gateway Completion (Post-v0.4.0 Follow-up)

## Goal
Complete the approved Moderado Cloud Gateway integration: correct auto/pinned routing, enforce the v1 request subset, surface Gateway status/errors, and add PKCE browser login alongside manual keys.

## Constraints
- Keep the existing `v0.4.0` tag untouched. Feature commits after it belong to `0.4.1` by Alfazen versioning.
- No runtime dependencies; do not push or publish.
- Follow `docs/CLOUD_GATEWAY_INTEGRATION.md` and the stable v1 contract.
- Add offline tests before implementation; no live provider calls.
- Preserve BYOK/local behavior and existing credential-store boundaries.

## Tasks
- [x] Cloud auto/pinned routing, safe failover, with tests and scoped review.
- [x] Gateway request bounds and actionable typed error mapping, with tests and scoped review.
- [x] Parse/render `moderado_status` stream fallback metadata, with Cloud-only parsing and scoped review.
- [x] PKCE loopback browser login and token expiry/re-auth behavior, with tests and scoped security review.
- [x] Update user docs and `HANDOFF.md`; run requested verification.

## Decisions
- Approved scope: Cloud auto/pinned routing, request validation, error/fallback reporting, PKCE browser login; no dependencies; non-Windows credentials remain process-memory only.
- Release tag `v0.4.0` already exists and is pushed. Do not move it; changes will require a follow-up patch version.
