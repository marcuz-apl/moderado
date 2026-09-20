# Moderado CLI Capability Roadmap

**Status:** Approved roadmap
**Scope:** CLI-only `v0.3.0` product maturity. Desktop application and IDE
extensions are explicitly deferred past `v0.3.0` and are not release blockers.
**Parent documents:** [PRD.md](../PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md)

## Purpose

Moderado already has a clean provider-independent core, a safe coding-tool boundary,
and an interactive terminal interface. This roadmap records the capability areas needed to make Moderado dependable for real coding work and ready for public distribution.

The milestones are deliberately sequential. Each must be complete, tested, and
usable before work begins on the next one.

## Product direction

Moderado will differentiate itself through:

- free-first, provider-neutral model routing with a `/connect` free-model hub
  (NVIDIA NIM, OpenRouter free tier, plus further free sources only after a
  machine-callable discovery endpoint is verified) alongside a single generic
  OpenAI-compatible path for paid models (OpenAI GPT, Claude, Gemini, Meta,
  Mistral, Z-ai/GLM, DeepSeek, Moonshot, and equivalents);
- transparent model capability, usage, and cost information;
- approval-first workspace actions; and
- a core that can later be hosted by a desktop application without rewriting the
  agent loop.

The product should learn from OpenCode and Cline's workflows without copying
their code or attempting to reproduce every feature. `v0.3.0` is CLI-only and
does not imply parity with OpenCode extras such as themes, keybinds,
formatters, IDE extensions, plugins, or SDK surfaces.

## Milestone 1 — Trustworthy model responses ✅

**Goal:** A request must never appear to succeed when it produced no usable
answer.

### Scope

- Detect an empty assistant response and emit a visible, actionable error.
- Keep provider error messages neutral: identify the active provider and model
  instead of referring generically to NVIDIA NIM.
- Record model capabilities needed for requests, beginning with tool calling.
- Do not send tool declarations to models known not to support them, or for
  simple chat where tools are unnecessary.
- For `AUTO` routing, retry or fall back to another suitable model when the
  selected endpoint is unavailable, rate-limited, malformed, or returns an
  empty response.
- Show accurate response duration, including sub-second responses.

### Done when

- A provider cannot yield a blank successful chat result.
- A model that cannot use tools can still answer ordinary questions when its
  chat endpoint is otherwise compatible.
- The user can see why a request failed or which model received a fallback.
- Offline tests cover empty output, unsupported tools, retry, fallback, and
  provider-neutral diagnostics.

## Milestone 2 — Persistent sessions, context, and actual usage ✅

**Goal:** A coding conversation survives process restarts and remains useful as
it grows.

### Scope

- Store sessions locally per workspace using atomic writes and redacted data.
- Add the `/session` command family for new, list, resume, export, and compact.
- Restore conversation history and the selected provider/model when resuming.
- Consume actual usage information returned by providers when available.
- Compute displayed cost from recorded provider pricing metadata when known;
  otherwise show that cost is unavailable rather than `$0.00`.
- Provide safe, deterministic manual compaction; automatic compaction awaits
  reliable provider context-limit metadata.

### Done when

- A user can close Moderado, reopen it, and continue a named or recent session.
- Exported sessions contain no credentials.
- The status line presents actual token use when the provider supplies it.
- Long conversations can be compacted without losing the user task and relevant
  tool results.
- Offline tests cover persistence, corruption recovery, export redaction, and
  compaction.

## Milestone 3 — Practical coding workflow ✅

**Goal:** Moderado helps users inspect, plan, apply, and recover code changes.

### Scope

- Add a first-class Plan workflow that presents a short implementation checklist
  before execution.
- Add Git status, branch, changed-file summary, and an improved diff view.
- Show a patch or exact change preview before file modifications.
- Create a reversible workspace checkpoint before approved write operations.
- Add an explicit undo or restore action for the latest agent change when safe.
- Improve multi-file editing using reviewed patches rather than relying solely
  on full-file writes and exact-string replacement.

### Done when

- Users can review the intended plan before execution.
- Users can see what files changed and inspect a diff without issuing shell
  commands manually.
- An approved edit can be reverted through Moderado when no conflicting user
  edit has occurred.
- All write and command actions continue to obey the existing approval boundary.
- Offline tests cover patch application, checkpoints, undo conflicts, and
  approvals.

## Milestone 4 — Code intelligence and controlled extensibility ✅

**Goal:** Give the agent better evidence from the codebase while preserving the
security model.

### Scope

- Surface language-server diagnostics for initially supported languages.
- Present test failures and compiler errors in a compact, useful format.
- Add symbol and reference lookup where language-server support permits it.
- Add a minimal MCP client for approved, explicitly configured servers.
- Route MCP tools through the same declaration, validation, and human-approval
  boundary as built-in tools.
- Define a stable host event interface so the CLI and a future desktop client can
  consume the same agent events.

### Done when

- The agent can use diagnostics as evidence when planning or fixing code.
- A configured MCP server cannot bypass workspace or approval policies.
- The core remains independent of concrete UI and provider implementations.
- A future desktop host can render existing agent events without core changes.
- Offline tests use fake language-server and MCP transports.

## Milestone 5 — Distribution, security, and operational polish ✅

**Goal:** Make Moderado straightforward and safe to install, configure, diagnose,
and update.

### Scope

- Move provider credentials to OS-backed secure storage where available, with a
  documented environment-variable fallback.
- Add `moderado doctor` to verify Node version, workspace access, provider
  configuration, model connectivity, and safe command prerequisites.
- Establish package metadata, installation instructions, release artifacts, and
  update guidance.
- Add structured local diagnostic logs with secret redaction.
- Refresh documentation, version references, and provider-specific setup notes.
- Add optional live smoke checks that are never part of the offline test suite.

### Done when

- A new user can install, connect a provider, select a model, and diagnose a
  failed setup without reading source code.
- Credentials and diagnostic logs do not expose secrets.
- `npm test` remains entirely offline and deterministic.
- Release documentation reflects the current `VERSION` identifier and supported
  providers.

## Milestone 6 — Public distribution and release trust

**Goal:** Turn the CLI into an installable, reproducible public product without
exposing publishing credentials or implying that an unpublished artifact is
already a release.

### M6.1 — Standalone npm installation and release gate ✅

- Build a self-contained npm package and verify it in an empty temporary directory.
- Add a guarded npm and GitHub Release publication workflow using trusted publishing.

### M6.2 — Standalone binaries and checksums ✅

- Build Windows x64, macOS ARM64, and Linux x64 executables with `@yao-pkg/pkg`.
- Generate SHA-256 checksums and a versioned artifact manifest.
- Verify the manifest and host-compatible executable offline.

### M6.3 — Package-manager manifests ✅

- Generate reviewable Homebrew, Scoop, winget, and AUR manifests from verified
  release artifacts and checksums.
- Keep npm as the canonical channel for npm and Bun users.
- Generation is deliberately separate from external package-manager submission.

### M6.4 — Release execution and channel publication

- Run the guarded publication workflow only after the owner selects a release version.
- Validate the uploaded npm package and every platform artifact from the GitHub Release.
- Submit the reviewed M6.3 manifests to the chosen third-party package-manager channels.
- Record signing status accurately; unsigned binaries remain clearly labelled.

### Done when

- `npm install -g` produces a working CLI without a source checkout or private
  workspace packages from the npm registry.
- Every public artifact can be traced to a verified source revision and its
  `VERSION` identifier.
- Publishing remains an explicit maintainer action and never occurs from a
  normal development commit.

## Delivery discipline

For each milestone:

1. Confirm the exact acceptance criteria before implementation.
2. Write offline tests before implementation changes.
3. Keep the change within the existing workspace boundaries.
4. Run the focused tests, full test suite, and TypeScript build.
5. Review the user-facing CLI flow manually.
6. Commit using the repository's Alfazen versioning hook only after verification.

Milestones 1 through 5 are complete. M6 establishes distribution foundations;
M6.4 begins only for an explicitly chosen public release.

## Milestone 7 — Controlled internet access and release completion

**Goal:** Ship CLI `v0.3.0` as a dependable free-first coding assistant: current
public information on demand, a `/connect` free-model hub, composer context
(`init`, `@`, images), reversible sessions, core subagents, and hardened
Windows/WSL paths — while preserving approval-first security, bounded
context, and source traceability. M7.3 runs last and certifies the release.

### M7.1 — Approved web search foundation ✅

- Add the approval-gated `web_search` tool with a configured HTTPS endpoint.
- Bound query length and result count, validate response shape, and return source URLs.
- Keep automated tests local and offline; no implicit shell or unrestricted network access.

### M7.2 — Web-aware answer evidence ✅

- Preserve source URLs as tool metadata so a client can render citations.
- Keep result size and context injection bounded.
- Surface search availability and endpoint configuration in the release gate before claiming user-facing web search support.

### M7.3 — Guarded public-release workflow [planned]

- Add deliberate maintainer workflows for npm and GitHub Release publication.
- Require verified artifacts and explicit release approval before any publish action.
- Keep credentials out of development commits.

### M7.4 — Provider expansion foundation ✅

- Added a shared OpenAI-compatible adapter through provider-independent contracts.
- Preserved free-first AUTO routing and explicit opt-in for paid or unknown-cost
  models.

### M7.5 — MCP CLI management and release gate ✅

- Add `/mcp` discovery, server status, add, disable, enable, and remove controls.
- Keep local stdio MCP servers explicit, approval-gated, and unable to bypass core policy.
- Validate configuration, lifecycle errors, and fake-server interaction end-to-end.
- Update help, security, and release documentation before the `v0.3.0` decision.

#### M7.5 completion criteria

- `/mcp` can show status, add and probe, enable, disable, remove with
  confirmation, and reload local stdio servers in the active session.
- Disabled or failing servers contribute no tools and do not remove built-in
  tools or tools from healthy peers.
- Every `mcp.<server>.<tool>` call requires interactive approval even when
  general auto-approve is enabled; non-interactive calls fail closed.
- Focused MCP/TUI tests, the full offline suite, the TypeScript build, the
  manual popup flow, and `git diff --check` all pass.

### M7.6 — Real-time web answers ✅

- Search hosted provider sites (Exa first, then Parallel) with no credential
  requirement, while keeping a configured custom endpoint as the first choice.
- Bound every search attempt with a timeout, validate MCP JSON and SSE payloads,
  cap the injected context, and keep `Title:`/`URL:` citations as tool metadata.
- Detect current-information questions and search before provider inference so the
  answer costs one inference round trip; without a connected provider, print the
  bounded search result instead of a capability apology.
- Keep `web_search` automatic without a per-search approval while `run_command`
  network access stays approval-gated.

#### M7.6 completion criteria

- Offline tests cover search-site ordering, fallback, timeout, payload parsing,
  citation extraction, context bounding, and question detection through injected
  fetch implementations; no automated test contacts a live search site.
- The full offline suite, the TypeScript build, and `git diff --check` pass.
- `docs/TOOLS.md`, `docs/ROUTING.md`, and `docs/SECURITY.md` describe the search
  sites, configuration keys, and the untrusted-context trust boundary.

### M7.7 — `/connect` free-model hub [planned]

- Keep `/connect` as the single entry point for model provisioning: first-class
  free sources plus one generic OpenAI-compatible path for paid models (OpenAI
  GPT, Claude, Gemini, Meta, Mistral, Z-ai/GLM, DeepSeek, Moonshot, equivalents).
- Reuse the NVIDIA NIM discovery pattern; add OpenRouter free-tier discovery
  with free filtering through its machine-callable `/models` endpoint.
- Add a further free source (OpenCode Zen, Agnes, or equivalent) only after a
  spike verifies a machine-callable free-model discovery endpoint, auth flow,
  key-reuse terms, and offline-testable seams — no screen scraping.
- Preserve free-first AUTO routing and explicit opt-in for paid or
  unknown-cost models; keep provider additions behind the
  provider-independent contracts.

### M7.8 — Composer context: `/init`, `@` mentions, images [planned]

- Add `/init` to scaffold `AGENTS.md` from a workspace scan through the
  workspace jail with `write_file` approval.
- Add an `@` file-mention picker as an extension of the existing composer
  autocomplete, backed by `list_files`/`search_files` reads (auto-approved).
- Attach images by path as model context through existing read tooling; no
  terminal-dependent drag-and-drop promise for Windows/WSL.

### M7.9 — `/session undo | redo | share` [planned]

- Add `undo`, `redo`, and `share` as `/session` subcommands, not new
  top-level slash commands.
- Wire `undo`/`redo` to the existing snapshot/restore infrastructure in
  `packages/tools/src/checkpoints.ts` plus the session store.
- Implement `share` on top of the existing session export with an explicit
  output path; no hosted link service for CLI `v0.3.0`.

### M7.10 — Core subagents and shell aliases [planned]

- Add subagent delegation inside `packages/core` via dependency injection: a
  child agent loop reuses the same tool registry and approval handler, and
  cannot bypass core policy. No new package. No LSP work.
- Do not add new `bash`/`grep` tool contracts: `run_command`
  (`shell: false`, allowlist) already covers shell execution and
  `search_files` already covers regex search. Ship them as UX aliases and
  grep-flavored output, reusing existing schemas and approval surfaces.

### M7.11 — Hardened Windows/WSL paths [planned]

- Canonicalize `\\wsl$\<distro>\...`, `/mnt/c/...`, and `C:\...` forms to the
  same jail root in `packages/tools/src/jail.ts`, with tests.
- Cover Windows edge cases with jail tests: drive-letter case, UNC,
  symlink escape, and `.git`/`.env` denial. Code-light, test-heavy.

### M7 acceptance criteria (gate for CLI `v0.3.0`)

- M7.7–M7.11 are complete, tested offline, and usable in order.
- M7.3 runs last: npm publish dry-run plus GitHub Release workflow,
  `verify:package` and `verify:binaries` green, explicit owner approval.
- Internet access is available only through declared, approval-gated tools.
- Search responses are bounded, validated, and attributable to source URLs.
- Offline tests never contact external services.
- Provider additions remain isolated behind the provider-independent contracts.
