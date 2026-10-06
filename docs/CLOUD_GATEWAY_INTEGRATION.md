# Moderado Gateway integration handoff

Date: 2026-10-06
Gateway contract: [`moderado-gateway/docs/CONTRACT.md`](../../moderado-gateway/docs/CONTRACT.md), stable v1.

## Goal

Let Moderado CLI use configured routes through the public Gateway, while preserving direct BYOK and local providers. This is a CLI-owned integration; coordinate wire contract changes with `moderado-gateway`.

## Existing support

CLI supports keyless Gateway inference through `/v1/models` and `/v1/chat/completions`; account authorization is optional and uses the website OAuth flow. The CLI login flow manages the Gateway base URL automatically and does not ask users to configure it.

## CLI work

1. Use `/login` for the **Moderado Gateway** profile. Offer keyless access or optional browser authorization/manual `mrd_…` key for account features. Production uses `https://mod.alfazen.org/v1`; local development uses `http://127.0.0.1:4788/v1`. Keep existing saved BYOK/local profiles independent.
2. For browser auth, use `client_id=moderado-cli`, random state, PKCE S256, an exact loopback callback, then exchange at `https://mod.alfazen.org/oauth/token`. Verify state and bind the exact callback/client ID; reject redirects during token exchange. The exchanged access key expires in 30 days; there is no refresh token, so `/login` must allow reauthorization. Avoid logging or writing key material to plain config; use existing credential storage where available.
3. Fetch the Gateway inventory from unauthenticated `GET /v1/models`. Preserve route IDs as model identifiers and let `/model` browse configured routes. Send `auto` to the Gateway so it follows configured routing; a pinned route targets its selected route. Keep local/BYOK profiles independent.
4. The current Gateway contract does not promise fallback status events; routing decisions happen in the Gateway and providers. Keep client request handling compatible with the published contract and surface typed errors without exposing upstream details.
5. Forward supported OpenAI-compatible request fields to the selected provider; the Gateway rewrites only the public model ID. The provider/model determines accepted fields, payload sizes, and limits. The CLI executes tool calls.
6. Keep provider discovery, OAuth, and error handling covered by offline fake-server tests. Tests must not make live provider calls.

## Contract facts / limits

- Gateway defaults to `https://mod.alfazen.org/v1`. The unified website/Gateway service runs on `127.0.0.1:4788` in local development; remote HTTPS URLs are preserved. `MODERADO_CLOUD_BASE_URL` configures the URL before first login. `MODERADO_CLOUD_ENV=development|production` remains an explicit override. Legacy `api.mod.alfazen.org` and loopback port `8787` URLs migrate to the current defaults.
- Account UI: `https://mod.alfazen.org/authorize`; token exchange: `https://mod.alfazen.org/oauth/token`.
- OAuth access keys last 30 days; manual keys can have account-selected expiry and scope. Full key material is only shown once.
- Configured routes dispatch regardless of price, approval, freshness, enabled, or global-switch metadata. The Gateway applies no Moderado account, usage, request-size, token, or response caps; providers may enforce their own limits and prices.

## Implementation status

The CLI integration supports public, keyless Gateway inference and optional browser authorization for account features. The Gateway runs locally with the website service on port `4788`; the public base URL is `https://mod.alfazen.org/v1`.
