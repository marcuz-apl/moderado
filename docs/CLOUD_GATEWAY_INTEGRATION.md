# Moderado Cloud Gateway integration handoff

Date: 2026-10-04
Cloud contract: [`moderado-cloud/docs/CONTRACT.md`](../../moderado-cloud/docs/CONTRACT.md), stable v1.

## Goal

Let Moderado CLI use the owner-configured, zero-price model pool through the Cloud Gateway, while preserving direct BYOK and local providers. This is a CLI-owned integration; do not change the Cloud wire contract without coordinating with `moderado-cloud`.

## Existing support

CLI already supports custom OpenAI-compatible endpoints, `/v1/models`, `/v1/chat/completions`, provider credential references, and streaming. A Gateway can likely be used today as a custom endpoint with a manually created `mrd_…` API key. The CLI login flow manages the Gateway base URL automatically and does not ask users to configure it.

## CLI work

1. Add `/login` for a named **Moderado Cloud** connection/profile. Offer a manual `mrd_…` key or browser authorization and set the base URL to `https://api.mod.alfazen.org/v1` internally. Retire `/connect` from the chat UI. Keep existing saved BYOK/local profiles independent.
2. For browser auth, use `client_id=moderado-cli`, random state, PKCE S256, an exact loopback callback, then exchange at `https://mod.alfazen.org/oauth/token`. Verify state and bind the exact callback/client ID; reject redirects during token exchange. The exchanged access key expires in 30 days; there is no refresh token, so `/login` must allow reauthorization. Avoid logging or writing key material to plain config; use existing credential storage where available.
3. Fetch the authenticated Gateway inventory from `GET /v1/models`. Preserve route IDs as model identifiers and let `/model` browse the Gateway's available free routes. Send `auto` to the Gateway so it follows the Admin pool; a pinned route never silently switches. Keep local/BYOK profiles independent.
4. Parse and surface streaming `event: moderado_status` fallback metadata before model output. Tell the user the destination route and a safe reason, and allow choosing/pinning another returned route without changing the Admin pool. The CLI currently uses streaming chat requests only; if a non-stream path is added later, it must also parse `moderado_fallback`.
5. Match the v1 request subset: text-only messages, required `max_tokens` (1–2048), tools/tool results, streaming, and usage option. Client executes tool calls. Show actionable errors, including `quota_exceeded` with `Retry-After`, `hosted_routes_unavailable`, scope denial, and unavailable model. Do not retry an ambiguous or post-output failure in a way that duplicates work.
6. Add offline fake-server tests for PKCE/state, token expiry/re-auth, model discovery, request validation, streaming status events, fallback display, and error mapping. No live provider calls in tests.

## Contract facts / limits

- Gateway: `https://api.mod.alfazen.org/v1`; local development: `http://127.0.0.1:8787/v1` when `MODERADO_CLOUD_ENV=development` (production is the default).
- Account UI: `https://mod.alfazen.org/authorize`; token exchange: `https://mod.alfazen.org/oauth/token`.
- OAuth access keys last 30 days; manual keys can have account-selected expiry and scope. Full key material is only shown once.
- `auto` only advances after an explicit upstream 429/503 before output. Pinned models do not fail over.
- Requests are text-only, at most 32 KiB, and messages/tools are bounded to 4096 encoded bytes. `max_tokens` is required and capped at 2048.
- Private beta quotas currently include 8 requests/account/key per UTC day and 80 globally per UTC day. Treat these as server policy; never advertise them as permanent.

## Implementation status (2026-10-05)

The implementation is pushed to `master` as follow-up work after the pushed `v0.4.0` tag. It implements the items above without adding runtime dependencies. The 0.4.0 tag remains unchanged; npm metadata is aligned to the current 0.4.2 source version. Full repository verification is recorded in [HANDOFF.md](../HANDOFF.md).
