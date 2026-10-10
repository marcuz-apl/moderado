# Moderado Gateway integration handoff

Date: 2026-10-06
Gateway contract: [`moderado-gateway/docs/CONTRACT.md`](../../moderado-gateway/docs/CONTRACT.md), stable v1.

## Goal

Let Moderado CLI use configured routes through the public Gateway, while preserving direct BYOK and local providers. This is a CLI-owned integration; coordinate wire contract changes with `moderado-gateway`.

## Existing support

CLI lists Gateway routes without a key through `/v1/models`. Free-route inference through `/v1/chat/completions` requires a valid Moderado website API key; paid routes remain open. Browser authorization uses the website OAuth flow. `/connect` selects the Gateway or a direct provider such as OpenRouter, NVIDIA NIM, Agnes AI, OrcaRouter, Ollama, LM Studio, or a custom OpenAI-compatible endpoint.

## CLI work

1. Use `/connect` for the **Moderado Gateway** profile. Offer browser authorization or a manual `mrd_…` website key for free routes; a keyless profile may list routes and use paid routes. Production uses `https://mod.alfazen.org/v1`; local development uses `http://127.0.0.1:4788/v1`. Keep existing saved BYOK/local profiles independent.
2. For browser auth, use `client_id=moderado-cli`, random state, PKCE S256, an exact loopback callback, then exchange at `https://mod.alfazen.org/oauth/token`. Verify state and bind the exact callback/client ID; reject redirects during token exchange. The exchanged access key expires in 30 days; there is no refresh token, so the Gateway path in `/connect` must allow reauthorization. Avoid logging or writing key material to plain config; use existing credential storage where available.
3. Fetch the Gateway inventory from unauthenticated `GET /v1/models`. Preserve route IDs and `access` (`free` or `paid`) and let `/model` browse configured routes. Send the stored website key on Gateway inference. Send `auto` to the Gateway so it follows configured routing and may choose either access tier; a pinned route targets its selected route. Keep local/BYOK profiles independent.
4. The current Gateway contract does not promise fallback status events; routing decisions happen in the Gateway and providers. Keep client request handling compatible with the published contract and surface typed errors without exposing upstream details.
5. Forward supported OpenAI-compatible request fields to the selected provider; the Gateway rewrites only the public model ID. The provider/model determines accepted fields, payload sizes, and limits. The CLI executes tool calls.
6. Keep provider discovery, OAuth, and error handling covered by offline fake-server tests. Tests must not make live provider calls.

## Contract facts / limits

- Gateway defaults to `https://mod.alfazen.org/v1`. The unified website/Gateway service runs on `127.0.0.1:4788` in local development; remote HTTPS URLs, including NAS deployments, are preserved. `MODERADO_CLOUD_BASE_URL` configures the URL before first connection. Later Gateway connections reuse the saved URL unless an environment override is set, and the picker displays the resolved Base URL. The CLI selects a URL; it does not detect the server's runtime mode. In PowerShell, set `$env:MODERADO_CLOUD_ENV = "development"` or `"production"` before running `npm run moderado` to force the built-in local or public URL; remove it with `Remove-Item Env:MODERADO_CLOUD_ENV` to return to the saved Gateway URL. A set `MODERADO_CLOUD_BASE_URL` should also be cleared when returning to the saved value. Legacy `api.mod.alfazen.org` and loopback port `8787` URLs migrate to the current defaults.
- Account UI: `https://mod.alfazen.org/authorize`; token exchange: `https://mod.alfazen.org/oauth/token`.
- OAuth access keys last 30 days; manual keys can have account-selected expiry and scope. Full key material is only shown once.
- Configured routes dispatch regardless of price, approval, freshness, enabled, or global-switch metadata. The Gateway applies no Moderado account, usage, request-size, token, or response caps; providers may enforce their own limits and prices.

## Implementation status

The CLI integration supports public model listing, website-key authorization for free Gateway routes, and keyless access to paid routes. The Gateway runs locally with the website service on port `4788`; the public base URL is `https://mod.alfazen.org/v1`.
