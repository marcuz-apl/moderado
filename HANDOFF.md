# Project Handoff

Updated: 2026-09-20
Branch: master
Commit: 46d3ecb (v0.2.36+260920l) — in sync with origin/master
Status: Roadmap rewrite approved and pushed; M7.7 is the next implementation item.

## Summary

Web search now answers current-information questions by searching hosted provider sites before model inference, instead of spending a long turn and then telling the user to look the data up manually. The CLI composer also keeps the cursor inside the input line when moving the caret or browsing history.

## Completed

- Roadmap rewritten and pushed (`46d3ecb`): CLI-only `v0.3.0` scope with
  M7.7 `/connect` free-model hub, M7.8 composer context (`/init`, `@`
  mentions, images), M7.9 `/session undo | redo | share`, M7.10 core
  subagents + shell aliases, M7.11 Windows/WSL hardening, and M7.3 as the
  final publish gate.
- `web_search` keeps model-facing `query`, `objective`, and `maxResults`, makes `endpoint` optional, and stays automatic without a per-search approval prompt.
- Search-site cascade: configured custom endpoint first when present, then Exa, then Parallel, with `MODERADO_WEB_SEARCH_PROVIDER`/`webSearchProvider` pinning a site while the rest stay as fallback.
- Bounded 20-second timeout per attempt, Zod-validated direct-JSON and SSE payloads, 8 KB context cap, and `Title:`/`URL:` source metadata kept out of the user-facing answer.
- CLI lane searches before inference and answers in a single model turn; that turn is instructed to return the facts only — one context line plus 3–6 value bullets, with no URLs, page titles, or search narration. Without a connected provider the CLI prints a readable excerpt with block metadata and bare URLs stripped.
- Core system prompt routes time-sensitive questions to `web_search` instead of `run_command` or a manual suggestion.
- Documentation updates in `docs/TOOLS.md`, `docs/ROUTING.md`, `docs/SECURITY.md`, the roadmap, and the M7.6 plan and design spec.
- Answer attribution fix: the injected live-evidence turn is written to the provider but never persisted — `replaceEvidenceTurn` swaps it back for the question the user actually typed before the transcript is saved, so an earlier question can no longer be answered again on a later turn and session exports, compaction, and up-arrow question recall stay readable.
- The evidence turn now ends with an explicit scope rule: answer only the question in that prompt and never restate or answer an earlier question.
- `web_search`'s optional model-facing `endpoint` override accepts any string and is rejected at execution unless it is HTTPS or localhost, so a hallucinated `"endpoint": "web"` returns a readable tool error instead of an argument-validation failure that burns a model step (observed in session `c4d8db69`).
- Composer caret fix (`apps/cli/src/ui/welcome.ts`): `positionCursorOnInput()` uses absolute `\x1b[row;colH` addressing via the shared `getComposerAnchor()` instead of relative move-up, so Left/Right while browsing history can no longer walk the cursor out of the edit box. Anchor column corrected to the first text cell (fixes click-to-place math); forward Delete does a full repaint so no ghost characters remain. Help popup documents Left/Right + mouse click.

## In progress

- No implementation work is in progress.

## Checks

- `npm run test` - PASS (43 files, 235 tests).
- `npm run typecheck` - PASS.
- `npm run build` - PASS.
- Manual live probe of the compiled default path - Exa returned current weather context in 1.19 s with 3 citations.
- Manual live probe of the answer shape - Exa returned current weather for Berlin and Calgary; the fast-lane instruction and the no-provider excerpt both produce a context line plus value bullets with no URLs.
- `git diff --check` - PASS.

## Decisions and context

- Exa is the default search site because a live probe returned current weather context in about one second without a credential; Parallel is the fallback.
- Contacting hosted search services is an owner-requested relaxation of the earlier "no built-in third-party search service" stance. `docs/SECURITY.md` records the boundary and states that search output is untrusted reference data.
- Search sites are ordered statically rather than measured per query so behaviour stays predictable and offline testable.
- Root `VERSION` is `v0.2.36+260920l`; the versioning hook bumps it on commit.
- The live-evidence prompt is an internal turn, not user input: it reaches the provider but is replaced with the bare question before persistence, which is what keeps the session JSON and the question recall honest.
- Single commit for both workstreams (M7.6 + composer caret fix), per owner request ("Git push all").

## Blockers

- None.

## Next action

1. Implement M7.7: spike OpenCode Zen / Agnes for a machine-callable
   free-model discovery endpoint (auth, ToS, offline-test seams); then
   `/connect` free-model hub: NIM (done) + OpenRouter-free + generic
   OpenAI-compatible paid path.
2. Manual live check of attribution: ask a weather question, then immediately ask an unrelated question such as `who are you?`, and confirm each answer matches its own question and that the saved session shows the bare questions.
3. Manual terminal check of the composer: browse history with Up, move with Left/Right past both ends, click the input line, and confirm the cursor never leaves the edit box.

## Resume notes

- Automated tests never contact a live search site; tool tests inject `fetchImpl` and clear the search environment variables.
- A live probe is a manual step: `node -e "import('./packages/tools/dist/tools/web_search.js')..."` after `npm run build`.
