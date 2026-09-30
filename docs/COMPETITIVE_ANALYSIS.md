# Competitive Analysis — Cline CLI and OpenCode CLI

**Status:** Research reference, verified 2026-09-30
**Purpose:** Fact-check the Moderado CLI feature surface against the two
closest open-source terminal coding agents, and decide what to adopt.
**Sources:** vendor documentation only. No code was copied or vendored.

This document records *what the competitors actually ship* today, the *verified
state of Moderado*, and the *gaps worth closing*. Feature parity is not the
goal — see the Ponytail Decision Ladder in
[AGENTS.md](../AGENTS.md) and the "Deliberate non-goals" section at the end.

---

## 1. Competitor capability baseline

### 1.1 Cline CLI (Apache 2.0)

Source: <https://docs.cline.bot/cli/cli-reference>. Installed with
`npm install -g cline`.

**Top-level commands:** `auth`, `config`, `connect`, `mcp`, `dev`, `doctor`,
`history`/`h`, `hook`, `plugin`, `schedule`, `hub`, `update`, `version`,
`kanban`. A bare `cline` argument is the prompt.

**Global flags:** `--plan`, `--json`, `--auto-approve <bool>`, `--timeout`,
`--model`, `--provider`, `--verbose`, `--cwd`, `--config`, `--data-dir`,
`--thinking <none|low|medium|high|xhigh>`, `--retries <count>`, `--hooks-dir`,
`--acp`, `--tui`, `--id <session-id>`, `--key`, `--system`, `--zen`.

**State model:** Plan and Act modes toggled with `Tab`; auto-approve toggled
with `Shift+Tab`. Auto-approve is **on by default** in act mode.

**Notable subsystems:**
- **Checkpoints** — a *shadow Git repository*; a commit after every tool use;
  three-way restore (Restore Files / Restore Task Only / Restore Files & Task);
  per-checkpoint diff comparison.
- **Subagents** — `use_subagents` launches read-only research agents in
  *parallel*, each with its own context window. Explicitly **cannot** write
  files, browse, reach MCP, or nest. Costs tracked per subagent.
- **Permissions** — `CLINE_COMMAND_PERMISSIONS` env var: `{ allow: [], deny: [] }`
  with glob patterns, deny wins, shell redirects blocked unless
  `allowRedirects`.
- **Hooks / plugins / schedule / hub** — a lifecycle-hook runtime, a plugin
  manager installable from npm/git/URL, scheduled background agents, and a
  local hub daemon (default `127.0.0.1:25463`).

### 1.2 OpenCode CLI

Source: <https://opencode.ai/docs/cli/> (docs last updated 2026-09-29).

**Top-level commands:** `tui`, `agent`, `attach`, `auth`, `github`, `mcp`,
`models`, `run`, `serve`, `session`, `stats`, `export`, `import`, `web`, `acp`,
`plugin`, `pr`, `db`, `debug`, `uninstall`, `upgrade`.

**Global flags:** `--continue`/`-c`, `--session`/`-s`, `--fork`, `--prompt`,
`--model`/`-m`, `--agent`, `--auto`, `--port`, `--hostname`, `--mdns`,
`--cors`, `--help`, `--version`, `--print-logs`, `--log-level`, `--pure`.

**Agent model — the most sophisticated in the category:**
- Two agent *types*: `primary` (Tab-cycled, drives the conversation) and
  `subagent` (invoked by primary agents or `@`-mentioned).
- Two built-in primary agents: `build` (all tools) and `plan` (file edits and
  bash default to `ask`).
- Three built-in subagents: `general`, `explore` (read-only), `scout`.
  Also `compaction`, `title`, `summary`.
- Agents are Markdown files with frontmatter: `description`, `mode`,
  `temperature`, `max steps`, `disable`, `prompt`, `model`, `permission`,
  `color`, `top_p`. Unknown keys pass straight through to the provider.
- `opencode agent create` generates one interactively or fully
  non-interactively with `--path --description --mode --permissions`.

**Permissions — the reference implementation:**
- Keys: `read`, `edit`, `glob`, `grep`, `bash`, `task`, `skill`, `lsp`,
  `question`, `webfetch`, `websearch`, `external_directory`, `doom_loop`.
- Each resolves to `allow` | `ask` | `deny`.
- Object syntax matches on tool *input*: `{ "bash": { "*": "ask", "git *":
  "allow", "rm *": "deny" } }`.
- Wildcards `*` and `?`; **last matching rule wins**; `~`/`$HOME` expansion.
- `doom_loop` guards against the same tool call repeating 3× identically.
- `--auto` auto-approves anything that would `ask`; explicit `deny` still
  blocks.
- Per-agent permission overrides merge over global config.

**Also shipped:** custom commands as Markdown in `.opencode/commands/` with
`$ARGUMENTS`/`$1` substitution, `` !`shell` `` output injection, `@file`
references, and `agent`/`subtask`/`model` frontmatter; server mode
(`serve`/`web`/`attach`); LSP servers; themes; keybinds; formatters; plugins;
`/share`; ACP; auto-compaction.

---

## 2. Verified Moderado baseline

Confirmed by reading the source, not the docs. Tool count from
`createDefaultToolRegistry` in `packages/tools/src/registry.ts`.

**Tools — 12 registered, plus 2 core-owned:**

`read_file`, `write_file`, `edit_file`, `list_files`, `search_files`,
`run_command`, `git_diff`, `apply_patch`, `run_diagnostics`, `get_definition`,

**Security posture (differentiator):**
- `run_command` uses `spawn` with an argument array and `shell: false`; no
  shell expansion, no redirect support by construction.
- Provider keys and internal tokens are stripped from the child environment.
- Path resolution is `realpathSync`-canonicalized against the workspace root;
  `.git`, `.env`, and credential files are denied; Windows/WSL/junction forms
  are canonicalized to one jail root.
- `--non-interactive` fails closed on every mutation and command.
- Output caps: 64KB per stream, 100KB for `git_diff`, 2,000 rows for reads.

**Already ahead of both competitors:**

| Capability | Moderado | Cline CLI | OpenCode |
|---|---|---|---|
| `shell: false` mandatory | Yes, non-negotiable | Yes | Yes |
| Provider-key stripping from child env | Yes, enforced | Not documented | Not documented |
| Non-interactive fails closed | Yes | Not documented | Not documented |
| Free-first AUTO routing | Yes (NVIDIA NIM free-tier) | Opt-in promo models | No |
| Provider-independent core via DI | Yes (`packages/contracts`) | SDK-coupled | Monolith |
| Runtime dependencies | `zod` only | Many | Many |

---

## 3. Gap analysis — what to bring to Moderado

Ranked by value against the Decision Ladder. "Cost" is relative engineering
effort.

### Tier 1 — high value, low cost

**1. Granular pattern-based approval policies.** *This is the single biggest
gap.* OpenCode's `ask`/`allow`/`deny` keyed on tool input is a strict
improvement over Moderado's current binary read/approve split, and it is a
natural extension of the existing `PolicyManager` in `packages/core`. A
`~/.moderado/policy.json` with `{ "*": "ask", "bash": { "*": "ask", "git *":
"allow", "rm *": "deny" } }` semantics would let a user run unattended on a
trusted repo *without* weakening the default. Note this is more secure than
Cline's approach: deny rules still win over `--auto`.

**2. Named `--plan` mode on the CLI surface.** Moderado already has a Plan
mode in the TUI that cannot mutate the workspace. It has **no** headless
equivalent, so the scripting story is weaker than both rivals. Exposing
`moderado run --plan "..."` reuses existing machinery; `read-only` already
covers the strict case.

**3. Custom slash commands from Markdown.** OpenCode's `.opencode/commands/`
with frontmatter plus `$1`/`$ARGUMENTS` substitution would let a repository
ship its own `/review-diff`, `/release-notes`. Moderado already parses
`SKILL.md` frontmatter, so the parser is largely reusable. Keep it prompt-only:
no `` !`shell` `` injection, because that would bypass the approval boundary.

**4. Session resume and fork for `run`.** `moderado --continue` and
`--session <id>` to match `-c`/`-s`, plus `--fork`. Session persistence and
listing already exist in the TUI; this is exposing them to the shell.

**5. Structured JSON output hardening.** `--json` exists on `run`. Verify it
emits newline-delimited events compatible with piping; Cline's
`{ type, text, ts, say }` envelope is a reasonable target shape.

### Tier 2 — valuable, moderate cost

**6. Per-subagent parallelism with strict read-only isolation.** Cline's

### Tier 3 — large surface, low ROI for a CLI

Themes, keybind customization, formatters, a web UI, a server/attach mode, a
kanban app, a hub daemon, and a scheduling daemon. These are the exact extras
`docs/CLI_CAPABILITY_ROADMAP.md` already declared out of scope for `v0.3.0`.
**Recommendation: keep them out.** They are presentation and orchestration
infrastructure, not agent capability, and each is a large surface with its own
security and support burden.

---

## 4. Deliberate non-goals

Moderado should **not** adopt, and should say so out loud:

- **Auto-approve by default** (Cline's choice). Moderado's approval-first
  default is the product's identity, not an oversight.
- **Shell redirects and command chaining.** Cline gates redirects with a
  permission flag; Moderado omits them by construction because `shell: false`
  makes them unrepresentable.
- **A plugin/hook runtime with arbitrary code execution.** A hook that runs
  user code is an unreviewable path around the approval boundary.
- **Editor and IDE extensions.** The `codex/vscode-extension` branch was
  removed from `master` on 2026-09-30; the tip is retained only as the tag
  `backup/codex-vscode-extension` and is not part of the product.
- **Parity for its own sake.** Every item in Tier 1 and Tier 2 above closes a
  concrete usability or safety gap. Anything that only closes a feature-
  checklist gap fails YAGNI at rung 1.

---

## 5. Source list

- <https://docs.cline.bot/cli/cli-reference>
- <https://docs.cline.bot/features/subagents>
- <https://docs.cline.bot/features/checkpoints>
- <https://cline.ghost.io/introducing-cline-cli-2-0/>
- <https://opencode.ai/docs/cli/>
- <https://opencode.ai/docs/agents/>
- <https://opencode.ai/docs/permissions/>
- <https://opencode.ai/docs/commands/>

subagents are *read-only by design* — they cannot write, browse, reach MCP, or
nest, and each gets its own context window. Moderado's `SubagentDelegator`
inherits the parent's *full* registry and approval handler, capped at 5 steps.
Two improvements: (a) a read-only subagent registry variant so a research
pass cannot mutate anything, and (b) `Promise.all` fan-out so N focused
research questions run concurrently and keep the parent context clean.

**7. Reasoning-effort control.** Cline exposes `--thinking
none|low|medium|high|xhigh`; OpenCode passes arbitrary provider options
through agent frontmatter. Moderado has `DEFAULT_MAX_OUTPUT_TOKENS` but no
user-facing reasoning knob. A single pass-through parameter is cheap and
becomes valuable as models diverge.

**8. `doom_loop` guard.** Reject an identical tool call repeated N times.
Small, self-contained, and prevents the worst failure mode of a cheap free
model on an endless loop.

**9. Checkpoint timeline with per-step diff and "restore files only".**
Moderado's checkpoint store is digest-verified and *safer* than Cline's shadow
git repo (it refuses to restore when a file changed externally, instead of
clobbering it). The missing piece is the UX: browse checkpoints, diff any
one, and choose files-only vs. files+conversation. Cline's three restore modes
are a good spec to match.

`find_references`, `web_search`, plus core-owned `load_skill` and `subagent`
declared by `packages/core/src/agent.ts`. MCP tools are added dynamically as
`mcp.<server>.<tool>`.

- **MCP**, **rules**, **skills**, **Kanban**, **ACP**, **`.clineignore`**.
- **Sessions** — SQLite database under `~/.cline/data/sessions`.
