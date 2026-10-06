# Moderado

> **A lightweight, provider-independent CLI coding agent with dynamic NVIDIA NIM discovery, free-first AUTO routing, and an uncompromised human-in-the-loop approval boundary.**

[![Source version](https://img.shields.io/badge/source-v0.4.8--upcoming-orange.svg)](file:///d:/projects/moderado/VERSION)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](file:///d:/projects/moderado/LICENSE)
[![Standards: Alfazen](https://img.shields.io/badge/standard-alfazen--coding-green.svg)](https://github.com/marcuz-apl/alfazen-skills)

---

## Highlights

- **Clean-Room & Original**: Built from scratch in TypeScript on Node.js (>= 20 LTS). No code copied from Cline, OpenCode, or legacy wrappers.
- **Provider-Independent Core**: Core agent loops, tool dispatching, and routing depend on pure contracts (`packages/contracts`) using Dependency Injection.
- **Dynamic NVIDIA Discovery**: Queries live `/v1/models` from NVIDIA NIM hosted catalog or local NIM instances; never relies on stale static lists.
- **Free-First AUTO Routing**: Intelligently ranks and selects verified free/trial tool-capable models before any paid endpoints. Paid models and unverified pricing require explicit user opt-in.
- **Strict Approval Boundary**: Auto-approved reads; interactive human approval for file writes, edits, and command executions. Non-interactive sessions fail closed.
- **Minimalist & Bloat-Free (`ponytail`)**: Follows the Decision Ladder: YAGNI, standard library first (native Node `fetch`, `AbortController`, `child_process.spawn`), and zero unnecessary dependencies.
- **Alfazen Versioning (`versioning-alfazen`)**: SemVer 2.0.0 with high-traceability connected UTC build prefixes (`v<m.n.p>+<yymmddc>`) and mandatory owner advisory gates for major releases.

---

## Documentation Index

| Document | Purpose |
|---|---|
| [**PRD.md**](file:///d:/projects/moderado/PRD.md) | **Product Requirements Document**: Personas, requirements, CLI specs, and acceptance criteria |
| [**AGENTS.md**](file:///d:/projects/moderado/AGENTS.md) | **Agent Operational Manual**: Rules of engagement, Ponytail Decision Ladder, and subagent patterns |
| [**docs/ARCHITECTURE.md**](file:///d:/projects/moderado/docs/ARCHITECTURE.md) | **System Architecture**: Workspaces, Dependency Injection, state machines, and event streams |
| [**docs/TOOLS.md**](file:///d:/projects/moderado/docs/TOOLS.md) | **Tool Specifications**: Schemas, limits, atomic writes, and validation rules for the workspace tools |
| [**docs/ROUTING.md**](file:///d:/projects/moderado/docs/ROUTING.md) | **Discovery & Routing**: Classification taxonomy, AUTO selection algorithm, and retry/fallback cascades |
| [**docs/SECURITY.md**](file:///d:/projects/moderado/docs/SECURITY.md) | **Security Model**: Workspace jail, `shell: false` isolation, environment cleansing, and injection defense |
| [**docs/COMPETITIVE_ANALYSIS.md**](../../docs/COMPETITIVE_ANALYSIS.md) | **Competitive Analysis**: Verified Cline CLI and OpenCode CLI feature survey, gap analysis, and deliberate non-goals |
| [**HANDOFF.md**](file:///d:/projects/moderado/HANDOFF.md) | **Project Handoff Snapshot**: Real-time status, decisions, blockers, and next implementation milestones |

---

## Workspace Layout

Moderado is organized as an npm workspace:

```text
moderado/
├── apps/
│   └── cli/                 # v0.1 CLI application and terminal event rendering
├── packages/
│   ├── contracts/           # Pure TypeScript interfaces, Zod schemas, events
│   ├── core/                # Agent loop, routing policy, session state machine
│   ├── providers/           # NVIDIA NIM HTTP adapter and mock/fake providers
│   └── tools/               # Workspace file jail and process execution engine
├── tests/                   # Cross-package and CLI integration tests
├── docs/                    # Architectural and subsystem specifications
├── VERSION                  # Alfazen connected version identifier
├── PRD.md                   # Product requirements document
├── AGENTS.md                # Agent operational guide
└── HANDOFF.md               # Resumption and state ledger
```

---

## CLI Command Quick Reference

```bash
# Discover live models and display access/capability classifications
moderado models

# Run a bounded coding task in the current workspace (default AUTO routing)
moderado run "Add unit tests for user authentication"

# Pin a specific model (disables fallback)
moderado run "Refactor database client" --model meta/llama-3.3-70b-instruct

# Run against a local NIM container
moderado run "Audit codebase" --profile local-nim

# Run in read-only audit mode (denies all writes and commands)
moderado run "Analyze security boundaries" --read-only
```

---

## Install Moderado

Moderado requires **Node.js 20 or newer**.

```bash
npm install -g moderado
moderado --help
```

The latest published npm release is 0.3.10. It is self-contained and works
without the Moderado Gateway. The upcoming 0.4.8 release integrates `/login`
with the Gateway, which is required for its route catalog and inference;
`/connect` remains available for direct providers. Both releases use the
`moderado` command name.
Version 0.4.8 is not published yet. After release, npm `latest` and the Scoop
bucket will be updated to it. For now, pin 0.3.10 to retain the self-contained
CLI: `npm install -g moderado@0.3.10`.

Any npm-compatible installer works (bun add -g moderado,
pnpm add -g moderado, npx -y moderado@latest --help). Prebuilt binaries and the
curl installer are documented in the root README. Windows installation options
are npm and Scoop. See `docs/DISTRIBUTION.md` in the repository.
To build from source instead:

```bash
git clone https://github.com/marcuz-apl/moderado.git
cd moderado
npm install
npm run build
node apps/cli/dist/index.js
```

Maintainers can install a verified release artifact directly with
`npm install -g ./moderado-<version>.tgz`. See
[docs/RELEASING.md](../../docs/RELEASING.md) for the review procedure.

### Connect to the Moderado Gateway

Run `/login` in the TUI and choose the public Gateway for keyless inference.
Browser authorization or a Moderado Cloud `mrd_` API key is optional for account
features. `/model` lists configured Gateway routes: `auto` follows Gateway
routing, while selecting a route pins requests to it. Existing BYOK and local
provider profiles remain independent.

Use `/connect` to connect directly to OpenRouter, NVIDIA NIM, Agnes AI,
OrcaRouter, Ollama, LM Studio, or a custom OpenAI-compatible provider. `/login`
selects the Moderado Gateway; `/connect` selects a direct provider.

Cloud OAuth credentials last 30 days and have no refresh token; authorize again
after expiry. On Windows, credentials are stored in Windows Credential Manager.
On other platforms, the current credential store is memory-only, so log in again
after starting a new CLI process.

Cloud connections use their configured Gateway URL. Loopback URLs such as
`http://127.0.0.1:4788/v1` are treated as local development; HTTPS URLs for a
NAS, VPS, or other remote host are used as configured. To set the URL before
first login, define `MODERADO_CLOUD_BASE_URL`. `MODERADO_CLOUD_ENV=development`
and `MODERADO_CLOUD_ENV=production` remain available as explicit overrides.

Run `moderado doctor` to inspect local setup without exposing secrets. Add
`--connectivity` only when you want an optional live model-catalog check.
`npm test` never performs live provider calls.
## Getting Started & Development

### Log in and select a model in the TUI

Run `moderado` to open the TUI immediately. A fresh installation does not require
an API key or a preselected model. The welcome card shows **No model connected —
use `/login`** until you add one.

Use `/login` for the public Moderado Gateway and `/model` to browse configured routes.
Cloud `auto` follows the Gateway's configured pool; choosing a route in `/model`
pins it for subsequent requests. Existing direct BYOK and local profiles remain
available separately.

### Sessions and usage

Moderado stores sessions per workspace in `~/.moderado/sessions/`. Use
`/session` to create, resume, export, or compact a local conversation. Session
exports redact recognized API-key prefixes. The status line uses only
provider-reported token usage. It shows the calculated cost when the selected
model exposes prompt and completion prices, and **Cost unknown** otherwise.

Saved OpenAI-compatible profiles continue to support providers such as
OpenRouter, Z.AI, DeepSeek, Moonshot, and Mistral. Compatibility depends on each
provider supporting `/v1/models` and streaming `/v1/chat/completions` with tool
calls. Cloud keys are never written in plaintext to `~/.moderado/config.json`.

### 1. Build & Test
```bash
# Install workspace dependencies
npm install

# Build all packages via TypeScript project references
npm run build

# Run full automated test suite (100% offline, zero API keys required)
npm test
```

### 2. Manual Live Smoke Test (Optional)
To test live model discovery and chat against NVIDIA NIM with real credentials:
```bash
# PowerShell
$env:NVIDIA_API_KEY="nvapi-..."
node scripts/smoke_test.js

# POSIX (bash/zsh)
export NVIDIA_API_KEY="nvapi-..."
node scripts/smoke_test.js
```

---

## License

This project is licensed under the MIT License.
*NVIDIA NIM, NGC, and model weights/APIs are subject to their respective terms and licenses. Moderado is independent and not endorsed by NVIDIA.*

### Practical coding workflow

Use `/workflow` from the TUI to work through a change safely:

- **Git status** shows the current branch and changed files without using a shell.
- **Review diff** shows the bounded working-tree diff.
- In **Plan** mode, Moderado asks the model for a concise checklist and cannot make workspace changes. Choose **Build plan** and confirm to send that checklist to Execute mode.
- File writes, exact edits, and multi-file patches show their change preview and still require approval. Moderado records a byte-preserving checkpoint immediately before an approved file mutation.
- **Undo latest agent change** requires its own approval. It restores the latest completed checkpoint from `~/.moderado/checkpoints/` only when every affected file still has the expected post-change digest. If a file changed externally, it reports the conflict and restores nothing.

### Diagnostics evidence

Ask Moderado to run diagnostics, typecheck, lint, or tests in a TypeScript or JavaScript workspace. It may run only the direct `typecheck`, `lint`, or `test` script defined in that workspace’s `package.json`, and every run requires approval. A non-zero exit returns parsed TypeScript errors as repair evidence; it does not bypass the safety boundary.

### TypeScript language intelligence

Install `typescript-language-server` yourself, then set `typescriptLanguageServer` in `~/.moderado/config.json` to its executable path. Moderado can then use read-only definition and reference lookup for TypeScript/JavaScript files. When the executable is unavailable, it reports how to configure it and leaves normal tools available.

### Local MCP tools

Configure trusted local stdio MCP servers under `mcpServers` in `~/.moderado/config.json`, with an executable and fixed `args` list. Moderado discovers server tools at session startup, namespaces them as `mcp.<server>.<tool>`, and requires approval for every call. MCP network transports and automatic server installation are not supported.

### Host event protocol

Moderado exposes a versioned host-event envelope with session identity and monotonic sequence numbers. The CLI continues to render the contained agent event, while a future desktop host can consume the same protocol without importing CLI code.

### Doctor command

Run `moderado doctor` to check the local Node runtime, workspace, Moderado home directory, provider/key presence, Git, and npm without exposing credentials. Run `moderado doctor --connectivity` only when you want an explicit live provider catalog check.

## Windows credential storage

On Windows, `/login` stores Moderado Cloud credentials in Windows Credential
Manager and keeps only a credential reference in `~/.moderado/config.json`.
Non-Windows platforms use the current memory-only credential store, so log in
again for each new CLI process. Existing BYOK environment variables and saved
profiles remain independent.
