# Diagnostics Evidence Design

**Date:** 2026-09-18
**Milestone:** M4.1 — TypeScript and JavaScript diagnostics

## Goal

Give Moderado reliable compiler, lint, and test-failure evidence for TypeScript and JavaScript projects without granting background command execution or weakening the existing approval boundary.

## Scope

M4.1 supports explicit diagnostic runs in workspaces containing a `package.json`. It discovers conventional package scripts named `typecheck`, `lint`, and `test`; the user-selected or model-requested operation runs through a new approval-required `run_diagnostics` tool. The tool never invokes a shell, accepts only discovered script names, uses the existing command runner limits and scrubbed environment, and returns bounded output.

The first parser recognizes TypeScript diagnostic locations in `path(line,column): error TS1234: message` and `path:line:column - error TS1234: message` forms. Other output remains useful as bounded plain text rather than being guessed into structured locations.

## Architecture

`packages/contracts` will define `Diagnostic`, `DiagnosticSeverity`, and a `diagnostic_result` agent event. `packages/tools` will own script discovery, fixed `npm run <script>` invocation, output caps, and TypeScript diagnostic parsing. It validates `package.json` content before exposing a script and resolves the manifest through the workspace jail.

`packages/core` will continue to know only contracts and tool declarations. It will emit the structured event when the diagnostic tool returns metadata, alongside the ordinary tool-result event. `apps/cli` will compose the registry and render a compact diagnostic summary in the chat stream: severity, workspace-relative location where known, and message. Full command output remains available as the existing tool result.

## User flow

1. The user asks Moderado to check diagnostics, run tests, or fix a reported TypeScript error.
2. The model may request `run_diagnostics` with one discovered script.
3. Moderado shows the exact script name, fixed `npm run` command, working directory, and bounded summary in the existing approval display.
4. After approval, it runs the command. A non-zero exit means diagnostics were found; it is not a tool transport failure.
5. The CLI displays a compact list, and the agent receives the structured records as tool output to plan a repair.

No diagnostic command runs automatically when a workspace opens, a file changes, or a model selects a plan.

## Safety and limits

- Only `typecheck`, `lint`, and `test` keys directly present in the workspace `package.json` are eligible.
- The tool uses `spawn('npm', ['run', script], { shell: false })` through the existing safe process execution path.
- It inherits existing timeout, output-cap, workspace-jail, environment-redaction, and non-interactive fail-closed rules.
- It always requires human approval, including when the normal session auto-approve setting is enabled.
- A malformed manifest, unsupported script, or parser failure returns an actionable error or unstructured output; it never runs a fallback command.

## Interfaces

```ts
type DiagnosticSeverity = 'error' | 'warning' | 'info';
interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}
```

`run_diagnostics` receives `{ script: 'typecheck' | 'lint' | 'test' }`. Its successful result contains `metadata.diagnostics: Diagnostic[]`, `metadata.exitCode`, and capped raw output. Exit codes other than zero are represented as successful tool execution with parsed diagnostic evidence.

## Testing

All tests remain offline. Tool tests use temporary workspaces and a test seam for process output to verify script allowlisting, command arguments, parser forms, output caps, non-zero diagnostic exits, and malformed manifests. Core tests verify event emission. CLI tests verify compact rendering without terminal interaction.

## Exclusions

M4.1 does not start language servers, implement symbol/reference navigation, connect MCP servers, discover arbitrary package scripts, or run web searches. Those are later M4 increments.