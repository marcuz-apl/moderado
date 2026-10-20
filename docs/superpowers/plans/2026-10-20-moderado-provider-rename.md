# Moderado Provider Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make “Moderado” the canonical provider name and ID across the codebase without breaking existing configs, credentials, environment settings, or exported API consumers.

**Architecture:** The providers package owns the canonical ID, metadata, base-URL helpers, and compatibility aliases. The CLI normalizes old persisted values at its config/session boundaries and writes canonical values going forward; UI, errors, tests, and docs use Moderado wording.

**Tech Stack:** Node.js >= 20, TypeScript, Zod, Vitest, npm workspaces.

**Spec:** [2026-10-20-moderado-provider-rename-design.md](../specs/2026-10-20-moderado-provider-rename-design.md)

## Global Constraints

- Use `moderado` as the canonical built-in provider ID.
- Preserve existing user configurations, credentials, and exported API compatibility.
- Prefer `MODERADO_ENV` and `MODERADO_BASE_URL`, falling back to the old variables only when the corresponding new variable is unset.
- Prefer `MODERADO_API_KEY`, falling back to `MODERADO_CLOUD_API_KEY` only when the canonical key variable is unset.
- Do not delete or blindly move old credential-store entries.
- If both legacy and canonical connection entries exist, the canonical `moderado` entry wins.
- Keep unrelated “Gateway” wording and behavior unchanged.
- Use `https://modr.alfazen.org/v1` for production mode and retain `http://127.0.0.1:4788/v1` for local development.
- Normalize the legacy provider ID in persisted session records when they are loaded for active use, while retaining historical content and messages.
- Preserve the user's current uncommitted preset-label, provider-list, documentation, and status-name changes; integrate the rename without discarding them.

---

## File Structure

- `packages/providers/src/presets.ts` owns preset IDs, metadata, base-URL names, and their deprecated aliases.
- `packages/providers/src/nvidia/nvidia_adapter.ts` and `sse_parser.ts` recognize the canonical Moderado ID and status option.
- `packages/providers/src/model_discovery.ts` recognizes current and legacy Moderado Gateway hosts for typed errors.
- `packages/contracts/src/provider.ts` owns sanitized Gateway error copy.
- `packages/core/src/agent.ts` preserves Moderado routing and history behavior for both provider IDs.
- `apps/cli/src/config.ts` normalizes old config and env names while preserving stored credential references.
- `apps/cli/src/ui/provider_connect.ts` owns connection identity, OAuth helper names, and provider-facing prompts.
- `apps/cli/src/ui/model_selector.ts` and `apps/cli/src/commands/chat.ts` render canonical provider wording and ID.
- `apps/cli/src/sessions.ts` normalizes provider identity in loaded session records.
- Existing focused test files cover each changed behavior; no runtime dependency is added.
- Root and CLI README, Gateway integration handoff, and existing planning documents receive the wording update. The design and implementation-plan documents retain explicit legacy spellings where needed to specify compatibility.

## Task 1: Establish canonical provider contracts and metadata

**Files:**
- Modify: `packages/contracts/src/provider.ts`
- Test: `packages/contracts/tests/contracts.test.ts`
- Modify: `packages/providers/src/presets.ts`
- Test: `packages/providers/tests/presets.test.ts`
- Modify: `packages/providers/src/model_discovery.ts`
- Test: `packages/providers/tests/model_discovery.test.ts`
- Modify: `packages/providers/src/nvidia/nvidia_adapter.ts`
- Modify: `packages/providers/src/nvidia/sse_parser.ts`
- Test: `packages/providers/tests/nvidia_adapter.test.ts`
- Test: `packages/providers/tests/sse_usage.test.ts`

**Interfaces:**
- Produce canonical `moderado` preset metadata and provider checks.
- Keep `moderado-cloud` as a deprecated accepted preset-ID alias.
- Export canonical `MODERADO_PRODUCTION_BASE_URL`, `MODERADO_DEVELOPMENT_BASE_URL`, `MODERADO_BASE_URL`, and `resolveModeradoBaseUrl`; retain old exported names as aliases to the canonical values/helper.
- Parse Moderado status events using the canonical option while continuing to accept the old `moderadoCloud` option.

- [x] **Step 1: Add failing shared-preset and error-copy assertions**

In `packages/providers/tests/presets.test.ts`, assert that canonical metadata uses ID `moderado` and label `Moderado`, that the ID list still contains the legacy alias, and that the old and new base-URL helpers return identical values. In `packages/contracts/tests/contracts.test.ts`, assert Gateway errors mention `Moderado`, not `Moderado Cloud`.

```ts
expect(CONNECT_PROVIDER_PRESET_META.find((item) => item.id === 'moderado'))
  .toMatchObject({ label: 'Moderado', defaultModel: 'auto' });
expect(CONNECT_PROVIDER_PRESET_IDS).toContain('moderado-cloud');
expect(resolveModeradoCloudBaseUrl('development'))
  .toBe(resolveModeradoBaseUrl('development'));
expect(freeModelPolicyFor('moderado-cloud')).toEqual(freeModelPolicyFor('moderado'));
expect(new GatewayError('unauthorized', 401).message)
  .toContain('Moderado rejected the API key');
```

- [x] **Step 2: Run the focused contract and preset tests to verify failure**

Run: `npm test -- --run packages/contracts/tests/contracts.test.ts packages/providers/tests/presets.test.ts`

Expected: FAIL because the canonical names/metadata/helper do not exist yet and the old user-facing error copy is still present.

- [x] **Step 3: Add failing canonical adapter and SSE assertions**

In `packages/providers/tests/nvidia_adapter.test.ts`, exercise `NvidiaAdapter` with `providerId: 'moderado'` and verify it handles the Gateway status event. In `packages/providers/tests/sse_usage.test.ts`, use `{ moderado: true }` for the canonical option and retain a separate assertion proving `{ moderadoCloud: true }` remains accepted.

```ts
const adapter = new NvidiaAdapter({ providerId: 'moderado', baseUrl: serverUrl });
expect(adapter.id).toBe('moderado');
for await (const chunk of parseSseStream(bytes(), { moderado: true })) chunks.push(chunk);
```

- [x] **Step 4: Run the focused adapter and SSE tests to verify failure**

Run: `npm test -- --run packages/providers/tests/nvidia_adapter.test.ts packages/providers/tests/sse_usage.test.ts`

Expected: FAIL because the adapter and parser only recognize the legacy ID/option.

- [x] **Step 5: Implement canonical names and compatibility aliases**

Define canonical preset ID/metadata, base-URL constants and helper in `presets.ts`; keep deprecated aliases pointing at the same values/helper and accept both IDs in the exported ID type. Change provider-facing error strings to “Moderado”. Make the adapter recognize both IDs during transition and let the SSE parser prefer `moderado` while accepting the legacy option.

```ts
export const MODERADO_PRODUCTION_BASE_URL = 'https://modr.alfazen.org/v1';
export const MODERADO_DEVELOPMENT_BASE_URL = 'http://127.0.0.1:4788/v1';
export const MODERADO_BASE_URL = MODERADO_PRODUCTION_BASE_URL;
export const MODERADO_CLOUD_BASE_URL = MODERADO_BASE_URL;
export const resolveModeradoCloudBaseUrl = resolveModeradoBaseUrl;
this.isModerado = this.id === 'moderado' || this.id === 'moderado-cloud';
```

- [x] **Step 6: Run all focused package tests**

Run:

```bash
npm --workspace @moderado/contracts run build
npm --workspace @moderado/providers run build
npm test -- --run packages/contracts/tests/contracts.test.ts packages/providers/tests/presets.test.ts packages/providers/tests/nvidia_adapter.test.ts packages/providers/tests/sse_usage.test.ts
```

Expected: PASS, including both canonical behavior and legacy API aliases. Build workspace packages before CLI tests because CLI imports their generated package outputs.

- [x] **Step 7: Commit the provider contract change**

Commit the Task 1 files with subject `refactor(providers): canonicalize Moderado identity`; include the required Copilot co-author trailer.

## Task 2: Normalize legacy configuration and preserve credential access

**Files:**
- Modify: `apps/cli/src/config.ts`
- Test: `apps/cli/tests/config.test.ts`
- Reuse without changing: `apps/cli/src/credentials.ts`

**Interfaces:**
- `loadConfig()` returns canonical connection key/ID `moderado` and display name `Moderado` for a legacy profile.
- Legacy enabled preset IDs normalize to `moderado`.
- An explicit old `credentialReference` remains unchanged when loading the old connection.
- New credentials saved for the canonical provider use `moderado/provider/moderado`.
- New env variables take precedence; old env variables remain fallback aliases.

- [x] **Step 1: Add failing tests for legacy config normalization**

Write raw legacy JSON to the temporary config file, then assert canonical active ID, connection key/ID, and display name. Add a case with both old and canonical entries and assert the canonical entry wins. Add an enabled-presets case with the old ID and expect the canonical value.

```ts
expect(loadConfig(tempDir)).toMatchObject({
  activeConnectionId: 'moderado',
  connections: {
    moderado: {
      id: 'moderado',
      displayName: 'Moderado',
      credentialReference: 'moderado/provider/moderado-cloud',
    },
  },
});
expect(loadConfig(tempDir).connectProviders?.enabled).toContain('moderado');
```

- [x] **Step 2: Run the focused config tests to verify failure**

Run: `npm test -- --run apps/cli/tests/config.test.ts`

Expected: FAIL because current config loading retains the legacy ID/name and does not normalize enabled aliases.

- [x] **Step 3: Add failing tests for credential and environment compatibility**

Store a secret under `moderado/provider/moderado-cloud`, load the legacy profile, and prove `resolveConnectionCredential()` retrieves it. Verify a newly created canonical connection writes to `moderado/provider/moderado`. Test that `MODERADO_ENV`/`MODERADO_BASE_URL` override old variables, and that old variables still work when the new ones are unset. Also verify `MODERADO_API_KEY` takes precedence over the legacy key variable.

```ts
await store.set('moderado/provider/moderado-cloud', 'mrd_existing');
expect((await resolveConnectionCredential(legacyConnection, store)).apiKey).toBe('mrd_existing');
process.env.MODERADO_ENV = 'production';
process.env.MODERADO_CLOUD_ENV = 'development';
expect(loadConfig(tempDir).connections?.moderado?.baseUrl).toBe('https://modr.alfazen.org/v1');
```

- [x] **Step 4: Run config tests to verify compatibility failures**

Run: `npm test -- --run apps/cli/tests/config.test.ts`

Expected: FAIL only on the newly asserted compatibility behavior.

- [x] **Step 5: Implement config normalization**

Normalize `moderado-cloud` connection IDs and map keys to `moderado`, giving an explicit canonical entry precedence over a legacy one. Set a legacy display name to `Moderado`, translate old enabled preset IDs, and preserve any explicit credential reference. Resolve base URL settings from the new environment variable first and the old variable second; do not delete old keychain values.

```ts
const canonicalId = item.id === 'moderado-cloud' ? 'moderado' : item.id;
const displayName = item.displayName === 'Moderado Cloud' ? 'Moderado' : item.displayName;
const mode = process.env.MODERADO_ENV ?? process.env.MODERADO_CLOUD_ENV;
const gatewayUrl = process.env.MODERADO_BASE_URL ?? process.env.MODERADO_CLOUD_BASE_URL;
const apiKey = process.env.MODERADO_API_KEY ?? process.env.MODERADO_CLOUD_API_KEY;
```

- [x] **Step 6: Run focused config tests**

Run: `npm test -- --run apps/cli/tests/config.test.ts`

Expected: PASS, including existing credential-storage, URL, and keyless-connection behavior.

- [x] **Step 7: Commit the CLI configuration change**

Commit the Task 2 files with subject `fix(cli): migrate legacy Moderado provider config`; include the required Copilot co-author trailer.

## Task 3: Rename interactive flows and normalize active session identity

**Files:**
- Modify: `packages/core/src/agent.ts`
- Test: `packages/core/tests/agent.test.ts`
- Modify: `apps/cli/src/ui/provider_connect.ts`
- Test: `apps/cli/tests/provider_connect.test.ts`
- Modify: `apps/cli/src/ui/model_selector.ts`
- Test: `apps/cli/tests/model_selection.test.ts`
- Test: `apps/cli/tests/model_selector_cloud.test.ts`
- Test: `apps/cli/tests/moderado_oauth.test.ts`
- Modify: `apps/cli/src/commands/chat.ts`
- Test: `apps/cli/tests/chat.test.ts`
- Modify: `apps/cli/src/sessions.ts`
- Test: `apps/cli/tests/sessions.test.ts`
- Test: `apps/cli/tests/chat_usage.test.ts`

**Interfaces:**
- New connection and OAuth helper exports use `Moderado` names; retain deprecated `ModeradoCloud` aliases.
- The Moderado connection has canonical ID `moderado` and display name `Moderado`.
- `getProviderStatusName(connection?: Pick<ProviderConnection, 'id' | 'displayName'>): string | undefined` returns `Moderado` for either canonical or legacy Moderado ID and preserves other provider names.
- Session reads normalize legacy provider ID and legacy display name without rewriting message history.

- [x] **Step 1: Add failing interactive-flow assertions**

Update provider-connect tests to require canonical Moderado ID/display name and canonical helper exports. Keep a test that the deprecated helper alias still produces the same connection. Update the current pending status-name regression test to assert both legacy and canonical IDs map to `Moderado`.

```ts
expect(buildModeradoConnection()).toMatchObject({
  id: 'moderado',
  displayName: 'Moderado',
});
expect(getProviderStatusName({ id: 'moderado-cloud', displayName: 'Moderado Cloud' }))
  .toBe('Moderado');
expect(getProviderStatusName({ id: 'moderado', displayName: 'Moderado' }))
  .toBe('Moderado');
expect(getProviderStatusName({ id: 'openrouter', displayName: 'OpenRouter' }))
  .toBe('OpenRouter');
```

- [x] **Step 2: Run focused connection, OAuth, selector, and chat tests to verify failure**

Run: `npm test -- --run apps/cli/tests/provider_connect.test.ts apps/cli/tests/moderado_oauth.test.ts apps/cli/tests/model_selection.test.ts apps/cli/tests/model_selector_cloud.test.ts apps/cli/tests/chat.test.ts`

Expected: FAIL because the old helper names and provider identity are still in production code. The existing status-name regression assertion must become green as part of this task.

- [x] **Step 3: Add failing session normalization assertions**

In `apps/cli/tests/sessions.test.ts`, write a stored session JSON record using legacy provider ID/name and assert `loadLatestSession()` returns canonical ID/name while retaining its messages.

```ts
expect(store.loadLatestSession('C:/repo')).toMatchObject({
  providerId: 'moderado',
  providerName: 'Moderado',
  messages: [{ role: 'user', content: 'keep this history' }],
});
```

- [x] **Step 4: Run the focused session test to verify failure**

Run: `npm test -- --run apps/cli/tests/sessions.test.ts`

Expected: FAIL because session loading currently returns stored provider names and IDs unchanged.

- [x] **Step 5: Implement canonical CLI flow names and status display**

Use the canonical base-URL helper and aliases from Task 1. Update connection creation, `/connect`, OAuth and retry copy, model selector provider checks, and all main-chat status-row render calls to use `getProviderStatusName()`. Retain the currently requested preset labels and removals. In `SessionStore.listSessions()`, normalize only the returned active-use session data; do not edit old on-disk history unless a session is next saved.

```ts
export function getProviderStatusName(
  connection?: Pick<ProviderConnection, 'id' | 'displayName'>,
): string | undefined {
  return connection?.id === 'moderado' || connection?.id === 'moderado-cloud'
    ? 'Moderado'
    : connection?.displayName;
}

try {
  const checked = StoredSessionSchema.parse(JSON.parse(fs.readFileSync(sessionPath, 'utf8')));
  return [{
    ...checked,
    providerId: checked.providerId === 'moderado-cloud' ? 'moderado' : checked.providerId,
    providerName: checked.providerName === 'Moderado Cloud' ? 'Moderado' : checked.providerName,
  }];
} catch {
  return [];
}
```

- [x] **Step 6: Run focused CLI tests**

Run: `npm test -- --run apps/cli/tests/provider_connect.test.ts apps/cli/tests/moderado_oauth.test.ts apps/cli/tests/model_selection.test.ts apps/cli/tests/model_selector_cloud.test.ts apps/cli/tests/chat.test.ts apps/cli/tests/sessions.test.ts apps/cli/tests/chat_usage.test.ts`

Expected: PASS with canonical new-flow behavior and legacy helper/session compatibility.

- [x] **Step 7: Commit the CLI flow change**

Commit the Task 3 files with subject `refactor(cli): rename Moderado provider flow`; include the required Copilot co-author trailer.

## Task 4: Update documentation and verify repository-wide rename

**Files:**
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/CLOUD_GATEWAY_INTEGRATION.md`
- Modify: `docs/superpowers/plans/2026-10-04-cloud-gateway-completion/findings.md`
- Modify: `docs/superpowers/plans/2026-10-04-cloud-gateway-completion/task_plan.md`
- Review: `docs/superpowers/specs/2026-10-20-moderado-provider-rename-design.md`
- Review: `docs/superpowers/plans/2026-10-20-moderado-provider-rename.md`

- [x] **Step 1: Update user-facing and historical documentation**

Replace “Moderado Cloud” as a product label with “Moderado” in README/help/handoff text and historical planning documents. Use the canonical `moderado` ID and new environment-variable names in current usage guidance. Keep old names only when documenting backward compatibility; preserve history unless explicitly requested. The owner later authorized correcting the published commit prefix.

- [x] **Step 2: Check all old-name occurrences**

Run:

```bash
rg -n 'Moderado Cloud|moderado-cloud|ModeradoCloud|moderadoCloud|MODERADO_CLOUD' \
  apps packages README.md docs
```

Expected: matches are limited to explicit compatibility aliases, migration code, and tests/specification text that asserts or documents those aliases. No normal UI, current documentation, or canonical code path uses the old names.

- [x] **Step 3: Run targeted package tests, typecheck, and full suite**

Run:

```bash
npm test -- --run packages/contracts/tests/contracts.test.ts packages/providers/tests/presets.test.ts packages/providers/tests/nvidia_adapter.test.ts packages/providers/tests/sse_usage.test.ts apps/cli/tests/config.test.ts apps/cli/tests/provider_connect.test.ts apps/cli/tests/moderado_oauth.test.ts apps/cli/tests/model_selection.test.ts apps/cli/tests/model_selector_cloud.test.ts apps/cli/tests/chat.test.ts apps/cli/tests/sessions.test.ts apps/cli/tests/chat_usage.test.ts
npm run typecheck
npm test
```

Expected: all focused tests pass and workspace typecheck exits successfully. The full suite currently has one independently verified baseline failure: `apps/cli/tests/package_metadata.test.ts` expects `apps/cli/package.json` version `0.4.30`, while that manifest is already `0.4.29` at base commit `4623c46`; the remaining 64 suites pass.

- [x] **Step 4: Check whitespace and final worktree diff**

Run: `git diff --check && git status --short --branch`

Expected: no whitespace errors; only intended rename changes and pre-existing user changes are present.

- [ ] **Step 5: Commit documentation and final cleanup**

Commit the documentation and any final narrow fixes with an appropriate subject; include the required Copilot co-author trailer. Do not squash implementation commits. The owner separately authorized rewording the published `v0.4.30+2610203` commit to `v0.4.29+2610202`.
