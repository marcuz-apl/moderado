# Moderado

> **A lightweight, provider-independent CLI coding agent with dynamic NVIDIA NIM discovery, free-first AUTO routing, and an uncompromised human-in-the-loop approval boundary.**

[![Version](https://img.shields.io/badge/version-v0.3.0%2B2609221-blue.svg)](file:///d:/projects/moderado/VERSION)
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

`moderado@0.3.0` is live on the public npm registry (`latest` → `0.3.0`).
The same command works with any npm-compatible installer:

```bash
bun add -g moderado        # Bun
pnpm add -g moderado       # pnpm
yarn global add moderado   # Yarn Classic
npx -y moderado@latest --help   # try without installing
```

Prefer a dependency-free binary? Download the prebuilt executable for your
platform from the
[GitHub Release v0.3.0](https://github.com/marcuz-apl/moderado/releases/tag/v0.3.0)
(`moderado-win-x64.exe`, `moderado-macos-arm64`, `moderado-linux-x64`),
verify it against the attached `.sha256` checksum and `manifest.json`, then
run it directly — no Node.js required.

> Install channels at a glance: npm (npm/bun/pnpm/yarn/npx), the curl
> installer, Homebrew and Scoop taps are live; winget and AUR submissions are
> pending (see the table below and [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)).
> Chocolatey is deliberately out of scope.

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
[docs/RELEASING.md](docs/RELEASING.md) for the review procedure.

### Other install channels

| Channel | Command / location | Notes |
|---|---|---|
| Prebuilt binary | [GitHub Release v0.3.0](https://github.com/marcuz-apl/moderado/releases/tag/v0.3.0) (`moderado-win-x64.exe`, `moderado-macos-arm64`, `moderado-linux-x64`) | Verify against the attached `.sha256` + `manifest.json`; no Node.js needed |
| curl installer (Linux x64, macOS arm64) | `curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh \| bash` | Verifies SHA-256 against `.sha256` and `manifest.json` before installing to `~/.local/bin`; `--version vX.Y.Z` pins a release |
| Homebrew | `brew tap marcuz-apl/moderado && brew install moderado` | Tap: [homebrew-moderado](https://github.com/marcuz-apl/homebrew-moderado) |
| Scoop | `scoop bucket add moderado https://github.com/marcuz-apl/scoop-moderado && scoop install moderado` | Bucket: [scoop-moderado](https://github.com/marcuz-apl/scoop-moderado) |
| winget | `winget install MarcuzApl.Moderado` | Submission [winget-pkgs#439175](https://github.com/microsoft/winget-pkgs/pull/439175) is open, awaiting merge; until then use the `Moderado.yaml` attached to the GitHub Release with `winget install --manifest` |
| AUR | Build `moderado-bin` from the `PKGBUILD` attached to the GitHub Release | Awaiting an AUR maintainer upload; Chocolatey is deliberately out of scope |

Windows binaries are unsigned — expect a SmartScreen prompt on first run.

### Connect a provider

Open Moderado and use `/connect`. NVIDIA NIM is the default free-first provider;
OpenRouter, Agnes AI, and compatible OpenAI-style endpoints are also supported.
On Windows, newly saved provider keys go to Windows Credential Manager and
`~/.moderado/config.json` retains only a credential reference. On other
platforms, use an environment variable such as `NVIDIA_API_KEY` or
`OPENROUTER_API_KEY`.

Run `moderado doctor` to inspect local setup without exposing secrets. Add
`--connectivity` only when you want an optional live model-catalog check.
`npm test` never performs live provider calls.
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

## Windows credential storage

On Windows, /connect saves provider API keys in Windows Credential Manager and stores only a provider credential reference in ~/.moderado/config.json. Existing plaintext keys remain usable for compatibility. Migrate them explicitly with moderado doctor --migrate-credentials; a failed migration leaves the existing configuration unchanged. On other platforms, set the provider environment variable (for example, NVIDIA_API_KEY or OPENROUTER_API_KEY).

## License

This project is licensed under the MIT License.
*NVIDIA NIM, NGC, and model weights/APIs are subject to their respective terms and licenses. Moderado is independent and not endorsed by NVIDIA.*
