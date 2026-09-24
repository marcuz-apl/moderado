# VS Code Extension and Sidecar Design

**Date:** 2026-09-24  
**Milestone:** VS Code host, local VSIX alpha; target product version `0.4.0`

## Goal

Provide a VS Code coding-assistant experience that reuses Moderado's existing core, provider, contracts, session, and workspace-tool packages. The extension runs the agent through a local Moderado sidecar and keeps workspace operations, provider credentials, and approval enforcement outside the webview.

Cline is a product reference for an AI coding agent that lives in the editor and makes its actions reviewable. Moderado will use its own code, contracts, terminology, and approval behavior. See the [Cline overview](https://docs.cline.bot/cline-overview), [Cline VS Code extension manifest](https://github.com/cline/cline/blob/main/apps/vscode/package.json), and [VS Code extension guide](https://code.visualstudio.com/api/extension-guides/webview).

## Product scope

The alpha is distributed as a locally installable VSIX for developer testing. It supports a single opened workspace folder, one active task at a time, workspace and selected-code context, streamed assistant output, tool/progress status, per-action approval, cancellation, and resuming an existing Moderado session. It can display tool failures and reconnect guidance.

The extension contributes a Moderado Activity Bar entry with a task-oriented chat view, following the familiar Cline pattern of keeping the conversation and active task in the editor sidebar. It has a task transcript, composer with current selection/file context, new-task and resume-task actions, and visible progress/tool activity grouped with the assistant response that caused it. File edit activity appears as a review card with a readable unified diff and explicit Approve/Reject actions; command activity shows the exact argument vector and working directory before approval. Completed or failed tasks remain readable in the transcript, and users can start another task without losing a resumable session.

Use VS Code theme tokens, standard Markdown/code rendering, keyboard navigation, and accessible labels. Prefer VS Code-native affordances for editor context and diff colors. This takes inspiration from Cline's in-editor task flow and permission prompts, while preserving Moderado's one-action-at-a-time approval contract and avoiding copied assets or source code.

The alpha excludes Marketplace publication, multi-root workspaces, autonomous editor writes, automatic approval modes, remote sidecars, extension marketplace features, arbitrary `@` resource search, and broad configuration screens. The composer can attach only the active editor selection/file in the first milestone. Users configure providers through existing Moderado config/CLI flows. The extension does not install or download the sidecar automatically.

## Architecture

The workspace adds `apps/vscode` for the VS Code extension. The extension host launches the configured Moderado executable as a child process with `spawn(executable, args, { shell: false })`; the default executable is `moderado` resolved from PATH and `moderado.executablePath` may override it. The extension passes arguments as an array and selects the current workspace as the working directory. It never interpolates workspace paths into a shell command.

The child process runs a new headless `moderado host --workspace <path> --protocol 1` mode. Host mode composes the existing provider/config/session/core/tools packages without starting the terminal UI. The extension communicates over the child's stdin/stdout using UTF-8 newline-delimited JSON. Stdout is reserved for protocol messages; diagnostics go to stderr. The extension webview communicates only with the extension host through VS Code's webview messaging API; it never receives credentials or direct filesystem/process capabilities.

```text
VS Code Webview <-> Extension Host <-> Moderado host sidecar
                                      | config/credentials, core, sessions, tools
                                      | workspace jail and approval handler
```

Contracts for host requests, responses, and notifications live in `packages/contracts` and validate every line with Zod. The current `HostEventEnvelope` remains the payload for agent events. The sidecar owns a session-level event stream so `sessionId` remains stable and `sequence` increases across turns, rather than restarting for each `AgentLoop` execution.

## Wire protocol payloads

Each JSON value occupies one line, terminated by `\n`. The receiver buffers at most 1 MiB per line; exceeding the cap emits a bounded protocol error when possible and terminates the child session. Invalid JSON also terminates the session because it has no trustworthy request ID. A schema-invalid request with a readable ID gets an `INVALID_REQUEST` response; unsupported protocol versions get an `UNSUPPORTED_VERSION` response and close the session; duplicate in-flight request IDs get a `BUSY` response. Protocol version is `1`.

Extension-to-sidecar request:

```json
{
  "type": "request",
  "id": "req-17",
  "method": "initialize",
  "params": { "protocolVersion": 1 }
}
```

The extension sets the child process cwd to the selected workspace and passes that same root through `--workspace` as a separate argument. The sidecar canonicalizes and validates it using existing workspace boundary code before exposing it to tools. `initialize` returns `{ "type": "response", "id": "req-17", "ok": true, "result": { "protocolVersion": 1, "sessionId": "...", "workspaceName": "project", "resumableSessions": [{ "sessionId": "...", "title": "Fix parser", "updatedAt": 1790270000000 }] } }`.

A user turn uses `chat.send`:

```json
{
  "type": "request",
  "id": "req-18",
  "method": "chat.send",
  "params": {
    "text": "Explain this function and suggest a safer implementation.",
    "context": {
      "selection": { "relativePath": "src/parser.ts", "startLine": 12, "endLine": 18, "text": "function parse(input) { ... }" }
    }
  }
}
```

`text` is nonempty and capped at 100,000 characters. Selection text is optional and capped at 20,000 characters; paths must be workspace-relative, normalized, and pass the existing jail checks. Selection data is untrusted user context, not an instruction that changes policy. The sidecar bounds line numbers and rejects traversal, absolute paths, and out-of-workspace references. A successful request response acknowledges acceptance; streamed agent events report progress and completion.

Sidecar-to-extension agent notification:

```json
{
  "type": "event",
  "envelope": {
    "protocolVersion": 1,
    "sessionId": "session-uuid",
    "sequence": 42,
    "timestamp": 1790270000000,
    "event": { "type": "assistant_delta", "delta": "The parser ", "timestamp": 1790270000000 }
  }
}
```

Each envelope is validated against `HostEventEnvelopeSchema`. The extension ignores duplicate/old sequence numbers, reports a gap as a reconnect/session error, and renders supported event variants: assistant delta, progress, model change, tool call, approval request/resolution, tool result, diagnostic, completion, error, and cancellation. Reasoning events are not rendered in the alpha.

The supported request methods and parameters are:

| Method | Parameters | Result |
|---|---|---|
| `initialize` | `{ protocolVersion: 1 }` | `{ protocolVersion, sessionId, workspaceName, resumableSessions }` |
| `chat.send` | `{ sessionId, text, context? }` | `{ accepted: true }`; completion and output arrive as events |
| `chat.cancel` | `{ sessionId, targetRequestId }` | `{ cancelled: true }`; targets the `id` of the active `chat.send` request |
| `approval.respond` | `{ sessionId, requestId, status: "approved" | "denied" | "aborted" }` | `{ resolved: true }` |
| `session.new` | `{ sessionId }` | `{ sessionId }` for the newly persisted session |
| `session.resume` | `{ sessionId, targetSessionId }` | `{ sessionId: targetSessionId }` when it belongs to this workspace |

`approval.respond` requires the exact outstanding `requestId` and one of the existing statuses:

```json
{
  "type": "request",
  "id": "req-19",
  "method": "approval.respond",
  "params": { "sessionId": "session-uuid", "requestId": "approval-uuid", "status": "approved" }
}
```

The response is rejected if the approval is unknown, stale, or already resolved. The extension receives approval details in the existing `approval_request` event. It presents the exact target, bounded diff/content preview or exact command arguments and cwd, and explicit Approve and Reject actions. Closing the panel, cancelling the task, protocol loss, or sidecar exit resolves a pending approval as `aborted` or denies it; it never approves implicitly. No broad auto-approve control is added.

`chat.cancel` aborts the matching generation's `AbortController`. `session.new` creates a persisted session in the current workspace; `session.resume` accepts a session ID returned by `initialize`. Invalid session/workspace pairing is rejected. Responses use `{ "type": "response", "id": "...", "ok": false, "error": { "code": "...", "message": "..." } }`. Error codes are `INVALID_REQUEST`, `UNSUPPORTED_VERSION`, `WORKSPACE_DENIED`, `SESSION_NOT_FOUND`, `APPROVAL_STALE`, `BUSY`, and `INTERNAL_ERROR`. Messages must not contain API keys or raw credential values.

## Runtime and error behavior

The extension checks that the executable starts, reports a useful install/configure message when it does not, and does not silently fall back to a terminal UI. A clean sidecar exit closes the host session and marks pending approvals aborted. Malformed stdout, unsupported protocol versions, or a protocol gap stop the active turn and show a recoverable error; stderr is captured in bounded, redacted form for diagnostics. Restarting the sidecar requires explicit user action; no action is automatically replayed after process loss.

Only one sidecar and active generation run per extension workspace in the alpha. Extension deactivation cancels generation, aborts outstanding approvals, closes stdin, and terminates the child with a bounded graceful-shutdown period before force termination. Secrets stay in Moderado's existing credential mechanisms and are not copied into extension settings, webview messages, logs, or protocol payloads.

## Packaging and compatibility

`apps/vscode` owns `package.json`, activation/command contributions, extension-host source, webview assets, tests, and VSIX packaging configuration. The extension is packaged as a VSIX for Windows, macOS, and Linux developer testing. It does not bundle Node or Moderado; prerequisites are VS Code, Node.js >=20 where needed by the installed CLI, and a discoverable/configured Moderado executable. Package the smallest supported VSIX and document these prerequisites.

The root remains an npm workspace. `apps/vscode` depends on published/built contracts only where runtime validation is shared; do not import CLI presentation modules. Core, providers, tools, and session logic remain in their existing packages or are extracted only where needed for host composition. No new runtime dependency is introduced without justification; VS Code's API and Node built-ins are preferred.

## Verification

- Contract tests validate all request, response, event, approval, size, and path boundaries, including malformed lines and protocol version mismatch.
- Sidecar tests use fake providers, an isolated temporary workspace, and an in-memory line transport; they cover streaming across multiple turns, session resume, approval allow/deny/abort, cancellation, sequence continuity, and child shutdown.
- Extension-host tests use the VS Code extension test runner or a narrow injected VS Code API adapter; they cover sidecar spawn argument safety, executable-not-found UX, webview message validation, event rendering, approval-card unified diff rendering, and lifecycle cleanup.
- `npm test`, root typecheck/build, extension package tests, and VSIX inspection must pass offline. No live provider keys or network calls are required.

## Version milestone

Development work retains the current `0.3.x` product version. When the first usable VS Code extension milestone satisfies this spec, update the root `VERSION` SemVer to `0.4.0` and align package metadata and release documentation that represent the product version. Connected build metadata follows the repository's Alfazen version convention. Do not publish the Marketplace extension as part of this milestone; the VSIX remains a local test artifact.

## Acceptance criteria

1. A developer can install the local VSIX, configure or expose the Moderado executable, open a single-folder workspace, connect through existing Moderado configuration, and send a prompt from the chat view.
2. Assistant text and agent lifecycle events stream into the chat view across turns in one session, and a persisted session can be resumed.
3. File changes and commands are shown with reviewable exact payloads and require explicit per-action approval; disconnect and cancellation fail closed.
4. Workspace and selection context cannot escape the workspace boundary or alter the approval policy.
5. The extension is isolated from the sidecar transport by validated versioned contracts, and offline tests cover the protocol and lifecycle.
6. The completed milestone uses product version `0.4.0` and produces a locally installable VSIX without Marketplace publication.
