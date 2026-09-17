# Moderado

> **A lightweight, provider-independent CLI coding agent with dynamic NVIDIA NIM discovery, free-first AUTO routing, and an uncompromised human-in-the-loop approval boundary.**

[![Version](https://img.shields.io/badge/version-v0.1.0%2B2609161-blue.svg)](file:///d:/projects/moderado/VERSION)
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

## License

This project is licensed under the MIT License.
*NVIDIA NIM, NGC, and model weights/APIs are subject to their respective terms and licenses. Moderado is independent and not endorsed by NVIDIA.*
