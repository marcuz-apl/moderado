# Moderado v0.1 design proposal

Status: updated to the agreed TypeScript direction; implementation has not started.

## Objective
Build an original lightweight CLI coding agent with a provider-independent core, NVIDIA-hosted model discovery, explicit model selection, free-first AUTO routing, bounded tool execution, tests, and setup documentation. No Cline or OpenCode source will be copied.

## Implementation choice
Use TypeScript with strict type checking and a Node.js runtime. Organize the project as an npm workspace separating applications from reusable packages. Use native fetch and AbortController for HTTP and cancellation, TypeScript interfaces for provider contracts, runtime schema validation for external data and tool arguments, and Vitest for automated tests. Select and pin supported dependency versions during implementation. Keep runtime dependencies focused and publish the CLI with compiled JavaScript and a command entry point; users will initially need Node.js. A standalone executable is a later packaging option, not a v0.1 requirement.

This choice supports sharing the agent core, provider integrations, tool definitions, and configuration between the CLI and a future desktop application. Follow common separation-of-concerns patterns without copying Cline or OpenCode code. Rust is not required for v0.1; consider it later only for a concrete native component or a Tauri desktop host.

## Proposed folder structure
```text
moderado/
  package.json
  package-lock.json
  tsconfig.base.json
  apps/
    cli/                 # v0.1 command-line application
  packages/
    contracts/           # shared types, runtime schemas, events, approvals
    core/                # agent loop, routing, configuration policy
    providers/           # NVIDIA adapter and future provider adapters
    tools/               # workspace operations and command execution
  tests/                 # cross-package and CLI integration tests
  docs/
  README.md
  LICENSE
```

Each application and package has its own package.json and src directory. Unit tests live beside their package code. Add apps/desktop when desktop development begins; it is not part of the initial CLI deliverable.

## Modules and flow
CLI -> agent loop -> router -> provider interface -> NVIDIA HTTP adapter.
The agent loop dispatches structured tool calls through a separate workspace tool registry and approval policy. Provider types describe models, messages, tool calls, responses, capabilities, and typed errors without NVIDIA dependencies. Configuration owns endpoint profiles and model policy; project files cannot grant permissions or replace provider credentials.

The contracts package has no application dependencies. Core depends on contracts and receives provider, tool, approval, and event interfaces through dependency injection; it does not import concrete adapters or UI code. Providers and tools implement those contracts. The CLI composes these pieces and renders events rather than embedding agent logic. The core exposes structured progress, model-change, tool-result, approval-request, and completion events, plus cancellation, so future interfaces can reuse the same behavior.

## Desktop expansion
Add a TypeScript web interface later and choose Electron or Tauri at that stage. Electron can host the Node.js agent process directly. Tauri would require a Rust host and packaging a compatible agent sidecar/runtime; a TypeScript core does not automatically remove that integration work. Desktop packaging must be evaluated on supported operating systems before choosing a framework.

Keep the desktop renderer separate from the agent process. Credentials, workspace access, command execution, routing policy, and approval enforcement stay in the agent process. Use a narrow, validated IPC protocol based on contracts; do not expose a generic shell or filesystem bridge. Bind approval responses to a pending request ID and exact action, deny on cancellation or disconnect, and revalidate before execution. The renderer displays requests and sends user decisions but cannot disable enforcement. The CLI uses the same approval contracts through terminal prompts. Implement the in-process contracts in v0.1; defer the desktop UI and IPC transport until desktop work begins.

## CLI
- moderado models: discover live model IDs, show capability and access classifications and their evidence.
- moderado run "task" --workspace PATH: execute a bounded coding session, default model AUTO.
- --model ID: pin a model; never silently substitute a different model.
- --profile NAME: select a configured hosted or local endpoint.
- --max-steps and command timeout/output limits: bound resource use.
Read operations work without interactive approval. Writes and commands require per-action approval by default. Noninteractive sessions deny operations that require approval. A read-only mode denies all mutations and commands.

## Discovery and free-first policy
Query the configured /v1/models endpoint dynamically; do not maintain a static model list as the source of truth. Treat inventory separately from capability and access metadata. Discovery alone does not establish tool support, coding suitability, entitlement, or price. Store explicit classifications: free/trial, paid, local, unknown; tool support: supported, unsupported, unknown. Metadata records its source and verification date and can be refreshed or overridden in user configuration. Stale or absent access metadata must not be advertised as confirmed free.

AUTO filters for suitable chat/tool models and permitted access classes, then ranks free/trial candidates ahead of explicitly enabled paid endpoints. Unknown pricing and paid usage require user opt-in. Local endpoints are an explicit profile choice and are not labeled costless. Model-name heuristics may suggest candidates but cannot certify price or tool support. If no eligible model remains, explain how to configure or explicitly select a candidate; do not guess silently. Tool-capability probes must be explicit because they consume requests.

Retry transient errors with bounded backoff; respect capped Retry-After. AUTO may move to another eligible model on unavailable models, rate limits, and transient provider failures. Authentication and malformed-request errors should surface directly. Keep model changes visible. Never repeat executed tool calls merely because inference retries. Reject malformed tool responses before side effects.

## Tools and security boundary
Implement read_file, write_file, edit_file, list_files, search_files, run_command, git_diff. Validate argument schemas and reject unknown tools. Resolve all file paths against the workspace; reject traversal, symlink escapes, protected metadata directories, and common credential files. Apply file, search, traversal, and output limits. Edits use an exact unique match and show the proposed change for approval; writes are atomic where supported and check for changed content before replacing it.

Commands use Node.js child_process.spawn with argument arrays and shell: false, a fixed workspace cwd, a reduced environment without provider keys, and timeout/output limits. Do not silently enable a shell for Windows batch files; unsupported command forms must return an actionable error. Every command requires approval displaying exact arguments and cwd. Arbitrary approved programs can access the host, spawn processes, and use the network: this is an approval boundary, not an OS sandbox. Document using a container or isolated checkout for untrusted projects. Git diff uses a fixed command disabling external diff/text conversion and does not accept model-supplied git flags.

Treat repository contents and tool output as untrusted model context. Never let model instructions modify approval policy. Do not automatically upload the repository; only requested tool results enter the conversation. Explain that file contents sent to a hosted model leave the machine. Redact credentials from diagnostics and avoid persistent full transcripts by default.

Web search follows the same boundary: the `web_search` tool requires approval,
uses a configured HTTPS endpoint, validates and bounds results, and returns
source URLs for citations. Provider adapters remain injected behind the common
provider contract, including OpenAI-compatible services.

## Tests and acceptance
Require strict TypeScript type checking, a successful workspace build, and passing Vitest unit and integration tests. Check CLI behavior on Windows, macOS, and Linux in CI. Test the core through injected interfaces without terminal or desktop dependencies, including structured events, cancellation, and approval request binding.

Use fake providers and a local HTTP test server, without NVIDIA credentials or billed inference. Cover discovery parsing, request/auth formatting, invalid responses, ranking, unknown/paid exclusion, explicit model pinning, retry/fallback, multi-step tool loops, duplicate call protection, step limits, traversal/symlink escapes, protected files, approval denial, write/edit conflicts, command timeouts, output caps, and CLI exit codes. Include an optional manual live smoke test with a user-provided API key; distinguish it from automated coverage.

## Documentation and license
Provide README installation and PowerShell/POSIX setup instructions for NVIDIA_API_KEY, configuration examples, CLI examples, architecture extension guide, security limits, and troubleshooting. Recommend MIT for original Moderado code. NVIDIA services, model weights, and model outputs remain subject to their own terms; no model weights are bundled. Free/trial access is account-dependent and can change, and does not imply unlimited or production-licensed use. Moderado is independent and not endorsed by NVIDIA.

## Official references checked
- Hosted API quickstart: https://docs.api.nvidia.com/nim/docs/api-quickstart
- Hosted LLM APIs: https://docs.api.nvidia.com/nim/re/reference/llm-apis
- Local NIM API reference: https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html
- Deployment/access overview: https://docs.api.nvidia.com/nim/docs/run-anywhere
- API trial terms: https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf

Local NIM documentation does not establish parity across every hosted model. Implementation must verify the actual hosted responses and keep capabilities explicit.

