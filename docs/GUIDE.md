# Moderado Guide

Feature highlights, repository documentation map, workspace layout, and the
in-depth TUI capability guides. This content previously lived in the root
README and was moved here to keep the README focused on installation and
quick start. Everything below applies to Moderado v0.3.0+.

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
| [**PRD.md**](./PRD.md) | **Product Requirements Document**: Personas, requirements, CLI specs, and acceptance criteria |
| [**AGENTS.md**](./AGENTS.md) | **Agent Operational Manual**: Rules of engagement, Ponytail Decision Ladder, and subagent patterns |
| [**docs/ARCHITECTURE.md**](./docs/ARCHITECTURE.md) | **System Architecture**: Workspaces, Dependency Injection, state machines, and event streams |
| [**docs/TOOLS.md**](./docs/TOOLS.md) | **Tool Specifications**: Schemas, limits, atomic writes, and validation rules for the 7 tools |
| [**docs/ROUTING.md**](./docs/ROUTING.md) | **Discovery & Routing**: Classification taxonomy, AUTO selection algorithm, and retry/fallback cascades |
| [**docs/SECURITY.md**](./docs/SECURITY.md) | **Security Model**: Workspace jail, `shell: false` isolation, environment cleansing, and injection defense |
| [**HANDOFF.md**](./HANDOFF.md) | **Project Handoff Snapshot**: Real-time status, decisions, blockers, and next implementation milestones |

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

### Practical coding workflow

Use `/workflow` from the TUI to work through a change safely:

- **Git status** shows the current branch and changed files without using a shell.
- **Review diff** shows the bounded working-tree diff.
- In **Plan** mode, Moderado asks the model for a concise checklist and cannot make workspace changes. Choose **Build plan** and confirm to send that checklist to Execute mode.
- File writes, exact edits, and multi-file patches show their change preview and still require approval. Moderado records a byte-preserving checkpoint immediately before an approved file mutation.
- **Undo latest agent change** requires its own approval. It restores the latest completed checkpoint from `~/.moderado/checkpoints/` only when every affected file still has the expected post-change digest. If a file changed externally, it reports the conflict and restores nothing.

### Diagnostics evidence

Ask Moderado to run diagnostics, typecheck, lint, or tests in a TypeScript or JavaScript workspace. It may run only the direct `typecheck`, `lint`, or `test` script defined in that workspace�s `package.json`, and every run requires approval. A non-zero exit returns parsed TypeScript errors as repair evidence; it does not bypass the safety boundary.

### TypeScript language intelligence

Install `typescript-language-server` yourself, then set `typescriptLanguageServer` in `~/.moderado/config.json` to its executable path. Moderado can then use read-only definition and reference lookup for TypeScript/JavaScript files. When the executable is unavailable, it reports how to configure it and leaves normal tools available.

### Local MCP tools

Use `/mcp` in the interactive TUI to manage trusted local stdio servers. The
popup can show fresh status, add and probe a server, enable or disable it,
remove it after confirmation, or reload its tools in the current chat session.
The direct commands are `/mcp status`, `/mcp add`, `/mcp enable NAME`,
`/mcp disable NAME`, `/mcp remove NAME`, and `/mcp reload`.

Servers are stored locally in `~/.moderado/config.json` with this shape:

```json
{
  "mcpServers": {
    "docs": {
      "executable": "node",
      "args": ["/absolute/path/to/server.mjs", "--stdio"],
      "enabled": true
    }
  }
}
```

An older record without `enabled` is treated as enabled. Disabling a server
keeps its configuration and status entry but removes its tools from the active
registry; enabling, removing, and reloading also take effect without restarting
the provider session. Tools are namespaced as `mcp.<server>.<tool>`. Every MCP
call requires its own interactive approval even when general auto-approve is
enabled, and non-interactive sessions deny the call.

M7.5 supports only explicitly configured local stdio processes with a fixed
executable and argument list. It does not install servers or support remote
HTTP/SSE transports, OAuth, marketplaces, persistent processes, prompts, or
resources.

### Host event protocol

Moderado exposes a versioned host-event envelope with session identity and monotonic sequence numbers. The CLI continues to render the contained agent event, while a future desktop host can consume the same protocol without importing CLI code.

### Doctor command

Run `moderado doctor` to check the local Node runtime, workspace, Moderado home directory, provider/key presence, Git, and npm without exposing credentials. Run `moderado doctor --connectivity` only when you want an explicit live provider catalog check.
