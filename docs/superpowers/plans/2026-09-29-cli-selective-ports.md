# Selective CLI Improvements

Owner approved the recommendations in chat on 2026-09-29. Work only on feature/cli-baseline-0.3.4; preserve v0.3.5 token accounting. No extension transport, context meter, publishing, new dependencies, or wholesale cherry-picks.

## Tasks

- [x] Provider selection: selectively port configurable presets/custom providers and evidence-based free-model menus/catalog diagnostics in config.ts, model_pricing.ts, commands/models.ts, ui/provider_connect.ts, ui/model_selector.ts. Keep trial credits distinct from guaranteed free; explicit nonzero pricing overrides preset declarations. Verify with offline CLI tests.
- [x] Streaming errors: port error classification and malformed-response reporting in providers/nvidia/sse_parser.ts and contracts/provider.ts, preserving strict usage parsing. Verify offline stream fixtures.
- [x] Core resilience: bounded, abortable retries before fallback; correct cancellation status; prevent duplicate streamed answers after retry; retain cumulative attempt usage. Test first, then implement in core/agent.ts.
- [x] Composer: move slash suggestions above the input while preserving keyboard cursor placement and live usage status. Test first in welcome.test.ts.
- [x] Review the combined change; run build, typecheck, offline suite, diff checks; update HANDOFF.md. Commit and push when instructed.

Each task follows red-green-refactor, reads existing interfaces, and uses only native APIs/existing dependencies.

Verification: build and typecheck passed; 57 offline suites / 408 tests passed. Reviewed locally after subagents reported an account usage limit. OrcaRouter carries a Free Models tag in /connect. Owner authorized commit and push in a later turn.

Custom selection configuration in ~/.moderado/config.json:

```json
{
  "connectProviders": {
    "enabled": ["nvidia-nim", "openrouter", "orcarouter"],
    "custom": [{ "id": "gateway", "name": "Gateway", "baseUrl": "https://gateway.example/v1", "defaultModel": "model-id" }]
  }
}
```
