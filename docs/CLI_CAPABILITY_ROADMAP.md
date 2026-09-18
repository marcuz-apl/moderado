# Moderado CLI Capability Roadmap

**Status:** Approved roadmap  
**Scope:** CLI product maturity before desktop expansion  
**Parent documents:** [PRD.md](../PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md)

## Purpose

Moderado already has a clean provider-independent core, a safe coding-tool boundary,
and an interactive terminal interface. This roadmap identifies the next five
capability areas needed to make it dependable for real coding work.

The milestones are deliberately sequential. Each must be complete, tested, and
usable before work begins on the next one.

## Product direction

Moderado will differentiate itself through:

- free-first, provider-neutral model routing;
- transparent model capability, usage, and cost information;
- approval-first workspace actions; and
- a core that can later be hosted by a desktop application without rewriting the
  agent loop.

The product should learn from OpenCode and Cline's workflows without copying
their code or attempting to reproduce every feature.

## Milestone 1 — Trustworthy model responses

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

## Milestone 2 — Persistent sessions, context, and actual usage

**Goal:** A coding conversation survives process restarts and remains useful as
it grows.

### Scope

- Store sessions locally per workspace using atomic writes and redacted data.
- Add `/new`, `/sessions`, `/resume`, `/export`, and `/compact`.
- Restore conversation history and the selected provider/model when resuming.
- Consume actual usage information returned by providers when available.
- Compute displayed cost from recorded provider pricing metadata when known;
  otherwise show that cost is unavailable rather than `$0.00`.
- Track context usage and compact safely before a model limit is exceeded.

### Done when

- A user can close Moderado, reopen it, and continue a named or recent session.
- Exported sessions contain no credentials.
- The status line presents actual token use when the provider supplies it.
- Long conversations can be compacted without losing the user task and relevant
  tool results.
- Offline tests cover persistence, corruption recovery, export redaction, and
  compaction.

## Milestone 3 — Practical coding workflow

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

## Milestone 4 — Code intelligence and controlled extensibility

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

## Milestone 5 — Distribution, security, and operational polish

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

## Delivery discipline

For each milestone:

1. Confirm the exact acceptance criteria before implementation.
2. Write offline tests before implementation changes.
3. Keep the change within the existing workspace boundaries.
4. Run the focused tests, full test suite, and TypeScript build.
5. Review the user-facing CLI flow manually.
6. Commit using the repository's Alfazen versioning hook only after verification.

The current recommended implementation target is **Milestone 1**. It addresses
the blank-response failure observed with an OpenRouter free model and is a
prerequisite for trusting every later workflow.
