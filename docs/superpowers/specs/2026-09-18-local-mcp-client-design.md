# Local MCP Client Design

**Date:** 2026-09-18
**Milestone:** M4.3 — Approval-safe local MCP tools

## Goal

Allow Moderado to use tools supplied by explicitly configured local MCP servers while preserving its existing human approval and workspace safety rules.

## Scope

M4.3 supports stdio MCP servers only. Users configure a named server with an executable and fixed argument list. Moderado never installs a server, downloads one, accepts server configuration from model output, or opens a network connection for MCP.

A request starts one configured server, initializes it, lists its tools, invokes one selected tool, returns bounded text content, and stops the process. Server tools are named `mcp.<server>.<tool>`.

## Trust boundary

Every MCP call requires interactive approval. The approval payload shows the server name, namespaced tool name, exact JSON arguments, and workspace root. Non-interactive mode fails closed. MCP responses are untrusted text and may not change policy, configure providers, or bypass built-in workspace jail checks.

A server cannot declare tools under built-in names. Moderado rejects invalid tool names, malformed input schemas, unknown configured servers, oversized frames, and responses larger than 64 KB.

## Architecture

`packages/contracts` defines MCP server configuration and constrained tool declarations. `packages/tools` owns a bounded JSON-RPC stdio transport and adapter that maps discovered MCP tools to `IToolDefinition` instances. The adapter uses a Zod-safe object schema for opaque tool arguments; MCP server schemas are retained as metadata for display but do not become executable code.

`packages/core` remains unaware of MCP transport details: it receives registered tool definitions and runs the same validation and approval sequence it uses for built-in tools. `apps/cli` loads configured servers and creates adapters at session composition time.

## Testing

Offline tests use a fake stdio server process to verify initialize/list/call ordering, namespacing, malformed frames, tool-name rejection, output capping, and approval-required registration. No test connects to a live server.

## Exclusions

M4.3 excludes HTTP/SSE MCP transports, persistent connections, OAuth, marketplace discovery, automatic installation, resources/prompts, and desktop-host process management.