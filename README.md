# Moderado

> **A lightweight, provider-independent CLI coding agent with dynamic NVIDIA NIM discovery, free-first AUTO routing, and an uncompromised human-in-the-loop approval boundary.**

[![Version](https://img.shields.io/badge/version-v0.2.0%2B2609196-blue.svg)](file:///d:/projects/moderado/VERSION)
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
| [**docs/TOOLS.md**](file:///d:/projects/moderado/docs/TOOLS.md) | **Tool Specifications**: Schemas, limits, atomic writes, and validation rules for the 7 tools |
| [**docs/ROUTING.md**](file:///d:/projects/moderado/docs/ROUTING.md) | **Discovery & Routing**: Classification taxonomy, AUTO selection algorithm, and retry/fallback cascades |
| [**docs/SECURITY.md**](file:///d:/projects/moderado/docs/SECURITY.md) | **Security Model**: Workspace jail, `shell: false` isolation, environment cleansing, and injection defense |
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

## Getting Started & Development

### Connect a provider in the TUI

Run `moderado` to open the TUI immediately. A fresh installation does not require
an API key or a preselected model. The welcome card shows **No model connected —
use `/connect`** until you add one.

Use `/connect` to add NVIDIA NIM. NVIDIA NIM starts with `AUTO` free-first
routing, so choosing a model is optional; use `/model` later to pin one. Obtain
an NVIDIA key from [build.nvidia.com](https://build.nvidia.com), or set it as
`NVIDIA_API_KEY` before launching Moderado.

### Sessions and usage

Moderado stores sessions per workspace in `~/.moderado/sessions/`. Use
`/session` to create, resume, export, or compact a local conversation. Session
exports redact recognized API-key prefixes. The status line uses only
provider-reported token usage. It shows the calculated cost when the selected
model exposes prompt and completion prices, and **Cost unknown** otherwise.

`/connect` also accepts an OpenAI-compatible base URL, API key, and explicit
model ID for providers such as OpenRouter, Z.AI, DeepSeek, Moonshot, and
Mistral. Compatibility depends on each provider supporting `/v1/models` and
streaming `/v1/chat/completions` with tool calls. Provider credentials are saved
in `~/.moderado/config.json`; protect that file and never commit it.

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

Ask Moderado to run diagnostics, typecheck, lint, or tests in a TypeScript or JavaScript workspace. It may run only the direct `typecheck`, `lint`, or `test` script defined in that workspace�s `package.json`, and every run requires approval. A non-zero exit returns parsed TypeScript errors as repair evidence; it does not bypass the safety boundary.
