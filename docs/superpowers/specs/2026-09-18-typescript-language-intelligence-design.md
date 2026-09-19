# TypeScript Language Intelligence Design

**Date:** 2026-09-18
**Milestone:** M4.2 — Read-only TypeScript language intelligence

## Goal

Give Moderado precise definition and reference evidence in TypeScript and JavaScript workspaces without automatically installing software, changing files, or weakening workspace safeguards.

## Scope

M4.2 adds an optional connection to a user-installed `typescript-language-server`. Moderado starts the server only when an agent invokes a read-only intelligence tool. It supports `get_definition` and `find_references` with a workspace-relative path, one-based line, and one-based column.

The server executable is configured by the user through Moderado configuration. No npm package installation, download, or PATH modification is attempted. When the executable is unavailable, fails initialization, or returns an invalid response, the tool reports a concise remediation message and all other Moderado functions remain available.

## Architecture

`packages/contracts` defines position and location schemas shared by both tools. `packages/tools` owns a small JSON-RPC/LSP transport using Node child processes with `shell: false`, workspace-jail validation, message-size bounds, and an explicit lifecycle. The transport sends initialize, initialized, and didOpen messages for requested files, then sends `textDocument/definition` or `textDocument/references`.

Tool wrappers remain read-only and have no approval requirement. They validate caller positions, translate filesystem paths to file URIs, and return workspace-relative locations with bounded source context. `packages/core` treats results as normal tool output. The CLI needs no special lifecycle; it continues to render tool calls and tool results.

## Safety

- The server starts only on an explicit tool request.
- `spawn` uses an executable and fixed argument array with `shell: false` and a scrubbed environment.
- Requested files resolve through the existing workspace jail; locations outside the workspace are discarded.
- The protocol reader caps individual JSON-RPC messages and rejects malformed framing.
- A server process is terminated after each request in M4.2. Persistent sessions are deferred until desktop-host lifecycle work.
- The tools are read-only; they never request approval and never expose server methods other than definition and references.

## Interfaces

```ts
interface SourcePosition { path: string; line: number; column: number }
interface SourceLocation extends SourcePosition { endLine?: number; endColumn?: number; preview?: string }
```

`get_definition` accepts `SourcePosition` and returns zero or more `SourceLocation` entries. `find_references` accepts `SourcePosition` and returns bounded locations. Both return a clear error when no configured language server is available.

## Testing

Offline tests use a fake JSON-RPC child-process transport. They verify framing, initialize order, request parameters, path-jail filtering, missing-server errors, malformed response rejection, and bounded references. No test runs a real language server.

## Exclusions

M4.2 does not install `typescript-language-server`, retain server sessions, support other languages, offer rename/code actions, or add MCP connectivity.