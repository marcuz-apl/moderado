# Moderado VS Code Extension Rebuild Plan

**Baseline:** CLI `v0.3.8` on `master`. The former VS Code extension branch is not an implementation base.

**Goal:** A Cline-inspired Moderado sidebar in VS Code that runs the existing Moderado agent, selects a provider from the built-in list, and lists only models with verified free status for that provider.

## Product shape

- **Chat view:** welcome/empty state, recent sessions, conversation, streaming response, usage and token rate, a task composer, Plan/Act control, and a compact approval summary. Follow the screenshot's information hierarchy while using Moderado branding and original artwork.
- **Settings view:** use the screenshot's sidebar navigation, with **API Configuration** as the first functional page. Follow CLI `0.3.8`: choose a built-in or configured custom provider, enter its required credential or local endpoint, connect, then select from that provider's verified **Free Models**. Show the active connection/model, free-status evidence, connection errors, and a clear empty state. Do not copy Cline billing or reasoning-effort controls unless Moderado supports them. **Features**, **Terminal**, and **General** are later milestones; do not ship dead tabs. **About** is a standard page with extension version, short description, license, documentation, repository, and issue-report links.
- **Approvals view:** five independent checkboxes: **Read files**, **Edit files**, and **Fetch web content** start on; **Execute commands** and **Use MCP servers** start off. Show the active choices in a compact bar above the composer. An off category requires an explicit Approve or Deny decision for each action, with its exact diff, command, or MCP call preview. An on category proceeds automatically but still appears in the activity timeline.

## Architecture

Add `apps/vscode` as an npm workspace. Its extension-host code composes `packages/core`, `packages/providers`, and `packages/tools`; a VS Code webview renders the interface and sends typed intents to the extension host. The webview must never hold provider keys, call provider APIs, or execute workspace tools. The extension host uses VS Code SecretStorage for credentials and the existing workspace jail for file/tool access.

`HostEventEnvelope` already covers agent events, but it does not carry commands or approval decisions back to the host. Add a small, versioned command/response contract in `packages/contracts` and an extension-host adapter around `AgentLoop`; do not import `apps/cli` or run the terminal UI inside the webview. Move only genuinely shared provider/model-selection logic out of CLI presentation files when the extension needs it.

## Milestones

### 1. Engine bridge and security boundary

**Files:** `packages/contracts/src/host_protocol.ts` (new), `packages/contracts/src/index.ts`, `apps/vscode/src/extension.ts`, `apps/vscode/src/agent_host.ts`, `apps/vscode/src/approval_handler.ts`, `apps/vscode/package.json` (new), root workspace/build configuration as needed.

- Define validated intents for start/cancel turn, list/select provider, list/select model, resolve approval, and list/resume session. Include request IDs and protocol version; reject malformed, stale, or cross-session messages.
- Forward existing `HostEventEnvelope` events to the webview. Cancel active runs and deny pending approvals when the view closes or the workspace changes.
- Keep workspace path canonicalization, tool execution, key storage, and approval decisions in the extension host. Validate checkbox updates at the host boundary and save each workspace's choices in VS Code workspace state; a new workspace starts with the stated defaults. Unknown tools and malformed approval requests always require explicit approval.
- **Acceptance:** fake-provider offline tests can start, stream, cancel, and resolve a turn; default Read/Edit/Web Fetch calls proceed, default command/MCP calls pause, and turning either checkbox on permits only its matching category. Malformed messages and disconnected approvals fail closed. CLI tests still pass.

### 2. API Configuration and About

**Files:** `apps/vscode/src/provider_service.ts`, `apps/vscode/src/webview/settings.*`, `apps/vscode/src/webview/about.*`; extract shared catalog/filter helpers from `apps/cli/src/config.ts`, `apps/cli/src/model_pricing.ts`, and `apps/cli/src/ui/model_selector.ts` only where duplication would otherwise occur.

- Reuse current presets: NVIDIA NIM, OpenRouter, Agnes AI, OrcaRouter, Ollama, LM Studio, and OpenAI-compatible, plus custom connections already supported by CLI configuration. Choosing a provider refreshes its catalog; show only models that the existing free policy can substantiate. Keep CLI `0.3.8` free-first behavior; paid and unknown-price models do not appear in the default Free list.
- Persist the selected connection/model through existing configuration semantics; save secrets only in SecretStorage. Handle missing credentials, unreachable endpoints, zero proven-free models, and model removal. Display a connection test result before model selection.
- Build About from extension metadata and repository links so the displayed version matches the installed VSIX.
- **Acceptance:** offline catalog fixtures prove no paid/unknown model appears in the Free list and provider switching cannot keep an incompatible model selected; About links and version match packaged metadata. API Configuration and About work without Features, Terminal, or General.

### 3. Cline-inspired sidebar and chat

**Files:** `apps/vscode/src/webview/chat.*`, `apps/vscode/src/webview/state.*`, `apps/vscode/media/*`, extension view registration.

- Build the empty state, recent sessions, message timeline, composer, Plan/Act switch, model indicator, live usage/token rate, and stop action. Use VS Code theme variables, keyboard navigation, and responsive narrow-sidebar layout.
- Render Markdown safely; use a strict Content Security Policy and a nonce. Webview messages are data, not instructions.
- **Acceptance:** start a task, see streamed answer/usage, stop it, reopen the view, and resume a session without duplicate events or lost approval state.

### 4. Approval panel and editor integration

**Files:** `apps/vscode/src/webview/approvals.*`, `apps/vscode/src/approval_handler.ts`, editor integration module.

- Display each pending action with its exact target, command arguments, or diff preview. Provide Approve and Deny; tie the response to its request ID and active session.
- Apply the five category choices in the extension-host approval handler, not in webview code. A change to one checkbox must not alter another category. Show auto-approved edits and web fetches in the activity timeline so the user can inspect what happened.
- Offer editor navigation for referenced files and VS Code diff previews for proposed edits. Respect multi-root workspace selection and the existing file jail.
- **Acceptance:** denial prevents execution; view disposal denies pending requests; tests cover defaults, toggles, persistence per workspace, path escapes, stale decisions, and concurrent requests.

### 5. Packaging and release gate

**Files:** `apps/vscode/package.json`, `apps/vscode/README.md`, `.github/workflows/*`, root docs.

- Add extension build, offline tests, VSIX packaging, and a VS Code extension-host smoke test. Verify a fresh install in a clean VS Code profile on Windows and Linux.
- Release the extension separately from the npm CLI. Keep CLI `v0.3.8` behavior stable while the extension matures.

### Later settings pages

Add **Features**, **Terminal**, and **General** only as their actual controls are defined and tested. Each can be released independently; their absence does not block the initial extension.

## Implementation order and checkpoints

Implement one milestone at a time with failing tests first, a focused code review, and a clean build/test cycle before the next milestone. The first reviewable deliverable is a working extension view driven by a fake provider and the real agent loop; visual polish follows verified behavior.

**Owner decision recorded:** for the VS Code extension, default auto-approval applies to Read files, Edit files, and Fetch web content. Execute commands and Use MCP servers remain off until the user checks them on. This explicit instruction supersedes the older blanket write-approval rule in `AGENTS.md` for this extension; the plan does not change CLI approval behavior.
