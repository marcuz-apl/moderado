# Moderado Guide

Feature highlights, repository documentation map, workspace layout, and the
in-depth TUI capability guides. This content previously lived in the root
README and was moved here to keep the README focused on installation and
quick start. This guide reflects the current release. Its `/connect` flow handles
the Gateway and direct provider connections; earlier releases used `/login` for
the Gateway. The earlier v0.3.10 release
is self-contained and does not require the Gateway. Every release from 0.4.32
installs the `moderado` command with `modr` as a short alias.

---

## Highlights

- **Clean-Room & Original**: Built from scratch in TypeScript on Node.js (>= 20 LTS). No code copied from Cline, OpenCode, or legacy wrappers. The two competitors are surveyed in [docs/COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md), which records what they ship, what Moderado deliberately does not adopt, and why.
- **Provider-Independent Core**: Core agent loops, tool dispatching, and routing depend on pure contracts (`packages/contracts`) using Dependency Injection.
- **Dynamic NVIDIA Discovery**: Queries live `/v1/models` from NVIDIA NIM hosted catalog or local NIM instances; never relies on stale static lists.
- **Free-First AUTO Routing**: Intelligently ranks and selects verified free/trial tool-capable models before any paid endpoints. Paid models and unverified pricing require explicit user opt-in.
- **Approval Boundary**: Reads never prompt. Interactive chat starts with auto-approve on and toggles with `Shift+Tab`; `moderado run` prompts for every mutation unless you pass `-y`. Network commands and MCP tools always prompt, and non-interactive sessions fail closed.
- **Minimalist & Bloat-Free (`ponytail`)**: Follows the Decision Ladder: YAGNI, standard library first (native Node `fetch`, `AbortController`, `child_process.spawn`), and zero unnecessary dependencies.
- **Alfazen Versioning (`versioning-alfazen`)**: SemVer 2.0.0 with high-traceability connected UTC build prefixes (`v<m.n.p>+<yymmddc>`) and mandatory owner advisory gates for major releases.

---

## Approval and auto-approve

- **Reads never prompt.** `read_file`, `list_files`, `search_files`, and `git_diff` are auto-approved.
- **Interactive chat starts with auto-approve enabled.** The composer status row
  reads `Auto-approve enabled (Shift+Tab)`; press `Shift+Tab` to require approval
  for each write, edit, patch, and command. The choice is per session.
- **`moderado run` prompts by default.** Pass `-y`/`--auto-approve` for an
  unattended task. Without a terminal, a mutation is denied with an actionable
  message instead of waiting on stdin.
- **Network commands always prompt.** `run_command` invocations containing
  `curl`, `wget`, or an `http(s)://` URL ask for approval even when auto-approve
  is on.
- **MCP tools always prompt.** Every `mcp.<server>.<tool>` call needs its own
  approval.
- **Non-interactive and read-only fail closed.** `--non-interactive` denies any
  call that would need approval, and `--read-only` blocks every mutation and
  command before the prompt.

---

## Documentation Index

| Document | Purpose |
|---|---|
| [**PRD.md**](../PRD.md) | **Product Requirements Document**: Personas, requirements, CLI specs, and acceptance criteria |
| [**AGENTS.md**](../AGENTS.md) | **Agent Operational Manual**: Rules of engagement, Ponytail Decision Ladder, and subagent patterns |
| [**docs/ARCHITECTURE.md**](./ARCHITECTURE.md) | **System Architecture**: Workspaces, Dependency Injection, state machines, and event streams |
| [**docs/TOOLS.md**](./TOOLS.md) | **Tool Specifications**: Schemas, limits, atomic writes, and validation rules for the workspace tools |
| [**docs/ROUTING.md**](./ROUTING.md) | **Discovery & Routing**: Classification taxonomy, AUTO selection algorithm, and retry/fallback cascades |
| [**docs/SECURITY.md**](./SECURITY.md) | **Security Model**: Workspace jail, `shell: false` isolation, environment cleansing, and injection defense |
| [**docs/COMPETITIVE_ANALYSIS.md**](./COMPETITIVE_ANALYSIS.md) | **Competitive Analysis**: Verified Cline CLI and OpenCode CLI feature survey, gap analysis, and deliberate non-goals |
| [**HANDOFF.md**](../HANDOFF.md) | **Project Handoff Snapshot**: Real-time status, decisions, blockers, and next implementation milestones |

---

## Workspace Layout

Moderado is organized as an npm workspace:

```text
moderado/
├── apps/
│   └── cli/                 # CLI application and terminal event rendering
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
- File writes, exact edits, and multi-file patches show their change preview and still require approval while auto-approve is off. Moderado records a byte-preserving checkpoint immediately before an approved file mutation.
- **Undo latest agent change** requires its own approval. It restores the latest completed checkpoint from `~/.moderado/checkpoints/` only when every affected file still has the expected post-change digest. If a file changed externally, it reports the conflict and restores nothing.

### Diagnostics evidence

Ask Moderado to run diagnostics, typecheck, lint, or tests in a TypeScript or JavaScript workspace. It may run only the direct `typecheck`, `lint`, or `test` script defined in that workspace’s `package.json`, and every run requires approval. A non-zero exit returns parsed TypeScript errors as repair evidence; it does not bypass the safety boundary.

### TypeScript language intelligence

Install `typescript-language-server` yourself, then set `typescriptLanguageServer` in `~/.moderado/config.json` to its executable path. Moderado can then use read-only definition and reference lookup for TypeScript/JavaScript files. When the executable is unavailable, it reports how to configure it and leaves normal tools available.

### Turn summary

Every turn that changed files or ran commands ends with a report built from
the agent's own event stream, not from model prose:

- **Done** lists the files the turn added and updated, plus the commands it ran.
- **Checked** lists the verification commands (test, typecheck, lint, build) and their result.
- **Left over** lists denied actions, failed commands, and edits that no verification command followed.
- **Run it** appears when the change belongs to a web app: the exact start command and the URL to open. Moderado does not hold a server in the foreground, so it prints the command instead of leaving a dev server attached to your terminal. When the agent already started one, the live URL is reported.

The same report is printed by `moderado run` and shown in the chat answer, so
a finished coding task always states what changed and what is still open.

### Chat answer area

The chat window reserves a fixed transcript area between the status row and the
composer. Press Page Up/Page Down or use the mouse wheel to browse earlier
questions and answers in the session. When the transcript is longer than the
chat area, a scroll track appears at its right edge; click near the top to jump
to earlier exchanges. The newest lines stay visible by default;
`… +N earlier lines hidden` shows when more is above the viewport. The current
question and input stay in place while you scroll. The full text is also
available through `/session export`.

Each exchange in the transcript shows its question above the answer. A horizontal
line marks the end of a completed answer, so the next exchange stays distinct.

The composer is measured before the frame is laid out, so anything that makes
the card taller — a queued-commands box from `/queue`, an `@` mention list, the
slash-command suggestions — takes its rows from the answer area instead of
pushing the card off the bottom of the terminal. The frame always ends one row
above the viewport bottom, which is what keeps the input, mode, and workspace
rows stable while a turn streams.

### Inline charts

Ask for a bar chart to compare categories or a line chart for ordered values.
Moderado renders a validated `chart` block inline. Line charts transition from
blue through cyan, green, yellow, and orange to red along the data points; bar
colors reflect value magnitude. Color is shown in an interactive terminal and
is automatically disabled for redirected output or when `NO_COLOR` is set.

For example, ask for a line chart of `y = x² + 5x + 12` from `x = -5` to `5`.
The model supplies the sample points; Moderado renders them and does not
evaluate arbitrary expressions itself.

### Session usage and cost

The footer tracks token usage and estimated session cost. Cost is shown as
unknown when a turn has estimated token counts or the provider does not report
exact prompt and completion prices for the model. A session that includes an
unpriced turn keeps its total unknown rather than presenting a partial amount
as the full cost. Free models with known zero pricing show `$0.00`.

### Composer completion

- Type `@` to filter workspace files. The list opens under the card,
  `Up`/`Down` moves the selection, and `Tab` inserts the highlighted path as
  `@path`. It closes as soon as the token ends, for example on a space.
- Type `/` for slash commands; `Up`/`Down` browses them and `Tab` completes the
  highlighted command.
- `/about` shows version and copyright info in a centered popup; press
  `Esc`/`Enter`/`q` to close.
- `Tab` with neither list open toggles Plan/Execute.

### Provider presets and custom providers

`/connect` offers built-in provider presets. Omit `connectProviders` in
`~/.moderado/config.json` to show all of them; an empty `enabled` list hides
every built-in, and `custom` adds your own OpenAI-compatible endpoints:

```json
{
  "connectProviders": {
    "enabled": ["nvidia-nim", "openrouter", "orcarouter"],
    "custom": [
      { "id": "gateway", "name": "Gateway", "baseUrl": "https://gateway.example/v1", "defaultModel": "model-id" }
    ]
  }
}
```

Built-in preset ids: `nvidia-nim`, `openrouter`, `agnes-ai`, `orcarouter`,
`ollama`, `lm-studio`, `openai-compatible`. Presets carry their access tier, so
a genuinely free source stays distinguishable from one that only offers trial
credits. Custom providers are validated: `id` must be unique and must not
collide with a built-in preset, and `baseUrl` must be HTTPS (or loopback) with
no embedded credentials. Invalid entries are dropped rather than failing the
whole config.

### Connecting to Moderado

`/connect` → **Moderado** asks only what it cannot already know:

1. **Deployment** — only when no Gateway URL is configured. `MODERADO_BASE_URL`
   (or a saved connection) is reused as-is, so the Prod/Dev choice appears once.
2. **Credential** — a saved `mrd_…` key is reused silently. Otherwise choose
   **Sign in with browser** (loopback OAuth, returns automatically) or
   **Paste an API key** for headless machines.
3. **Model** — the live Gateway catalog.

The base URL is never typed by hand: it comes from the environment, the saved
connection, or the one-time deployment choice. Set `MODERADO_ENV=development`
to target the local Gateway without any prompt.

### Coding skills

Moderado includes four compact skills: `code-review`, `implementation-planning`, `systematic-debugging`, and `test-driven-development`. They are available in both interactive chat and `moderado run`. Moderado also discovers user skills at `~/.moderado/skills/<skill-name>/SKILL.md`. User skills are disabled by default; enabling one with the same name replaces the built-in. Each user skill uses simple frontmatter:

```markdown
---
name: typescript-review
description: Review TypeScript changes for type-safety and runtime issues
---
Review TypeScript changes carefully.
```

The model sees short descriptions of enabled skills and can call the read-only `load_skill` tool for full instructions when relevant. You can explicitly request one in a task with `skill:code-review`. This avoids sending every skill body on every turn. Skills remain advisory: they cannot change approval policy, bypass the workspace jail, run commands automatically, or access secrets.

Use `/skills` in the TUI or `moderado skills` in the shell to list built-in and installed user skills, their on/off status, and the user skill directory. Use `/skills on NAME` or `moderado skills on NAME` to enable a user skill; use `off` to disable it without deleting its files. Use `*` to select all installed user skills (`/skills on *`) or a name pattern (`/skills off versioning-*`). Quote patterns in a shell, for example `moderado skills on '*'`. A pattern with no matches changes nothing. `/skills NAME` and `moderado skills NAME` show its description and source path. Malformed files, oversized files, and symlinked `SKILL.md` files are ignored.

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
