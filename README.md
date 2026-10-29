# Moderado

> **A lightweight, provider-independent CLI coding agent with dynamic NVIDIA NIM discovery, free-first AUTO routing, and an explicit human-in-the-loop approval boundary.**

[![Latest release](https://img.shields.io/github/v/release/marcuz-apl/moderado)](https://github.com/marcuz-apl/moderado/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Standards: Alfazen](https://img.shields.io/badge/standard-alfazen--coding-green.svg)](https://github.com/marcuz-apl/alfazen-skills)

---

> Feature highlights, documentation map, workspace layout, and in-depth TUI
> capability guides moved to [docs/GUIDE.md](docs/GUIDE.md). A verified survey
> of Cline CLI and OpenCode CLI, with the ranked gap list for Moderado, lives in
> [docs/COMPETITIVE_ANALYSIS.md](docs/COMPETITIVE_ANALYSIS.md).

## Tech Stack

- **Language**: TypeScript (strict, ESM) on Node.js >= 20 LTS
- **Runtime dependency**: Zod — schema validation at every system boundary
- **Testing**: Vitest — fully offline suites, mock providers, zero API keys
- **Packaging**: npm workspaces; `@yao-pkg/pkg` for standalone binaries
- **CI/CD**: GitHub Actions — read-only artifact verification, then a
  guarded OIDC publish with provenance to npm and GitHub Releases
- **Versioning**: Alfazen `v<m.n.p>+<yymmddc>` (tracked in `VERSION`)

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

## Approval and auto-approve

- Reads (`read_file`, `list_files`, `search_files`, `git_diff`) never prompt.
- Interactive chat starts with **auto-approve enabled**; the composer status row
  shows `Auto-approve enabled (Shift+Tab)`. Press `Shift+Tab` to require approval
  for every write, edit, patch, and command.
- `moderado run` prompts for each mutation unless you pass `-y`/`--auto-approve`.
  A run without a terminal denies the request instead of waiting on stdin.
- MCP tools and `save_to_documents` always prompt, even when auto-approve is on:
  one is third-party code, the other writes outside the workspace.
- `--non-interactive` and `--read-only` deny mutating calls before any prompt.

---

## Install Moderado

### Release versions

| Version | Status | How it works |
|---|---|---|
| **0.4.54** | Current release | Adds `/detail` to switch answers between concise (the default) and expanded, ticks a `Searching the web · Ns` row while a slow web search is outstanding, stops any tool that goes silent for two minutes instead of waiting forever, and keeps **Change server** reachable from the saved-key connection menu. Not published yet — the install channels below still serve 0.4.51. |
| **0.4.53** | Merged into 0.4.54 | Saves user-requested deliverables (notes, reports, exports) into your Documents folder with the new `save_to_documents` tool and renders a sent question as a padded `#1a3838` band at the input card's height. Never tagged; it ships with 0.4.54. |
| **0.4.52** | Merged into 0.4.53 | A fresh install runs on the Gateway's account-free default models and reports `$0.00`; `/connect` gains a **Change server** row so Production or Development is chosen once and saved instead of probed on every connect. Never tagged; it ships with 0.4.53. |
| **0.4.51** | Previous release | Scrollable chronological chat history with a workspace scrollbar, clearer turn styling, synchronized redraws, and Windows Terminal key-record input support. |
| **0.4.50** | Previous release | Adds `/about` slash command showing version and copyright info in a centered popup; removes version from `/help`; positions the MODERADO wordmark one row higher on first render; wires up XTMODKEYS Shift+Enter decoding so Shift+Enter reliably inserts a line feed instead of submitting. |
| **0.4.46** | Previous release | Responsive chat workspace with a scrollable activity and answer transcript, improved local model selection, popups that adapt to terminal resizing, and colorized inline charts. Also includes safer approvals, clearer turn reports, and a more direct Moderado Gateway connection flow. |
| **0.4.34** | Previous release | Frozen-CLI fix: Ctrl+C always has a way out — popups cancel on the first press, a stalled turn escapes on the second press, and hard exits drain undici safely so Node 24 never hits the libuv `UV_HANDLE_CLOSING` assertion. |
| **0.4.33** | Previous release | Restores the approval boundary in `moderado run` (prompts unless `-y`), fixes `@file` mention replacement, aligns boxes and wrapped text for CJK/emoji, and makes the full offline suite deterministic on Windows. Also ships the `modr` command alias, Gateway authorization recovery with key re-entry, a live progress row, and the canonical `moderado` provider identity. |
| **0.4.28** | Previous release | Organized `/help` command groups, interrupted-chat resume, and consistent help and shortcut layout. |
| **0.3.10** | Previous release | Self-contained CLI. It can connect directly to providers and does not require the Moderado Gateway. |

This release installs both the `moderado` command and the short `modr` alias.
Install the latest release with `npm install -g moderado`. To keep using the
self-contained 0.3.10 CLI, pin it with `npm install -g moderado@0.3.10`.

Chocolatey is deliberately out of scope; the full channel runbook lives in
[docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

### Any OS (npm)

Requires Node.js >= 20 and works on Windows, macOS, and Linux:

```bash
npm install -g moderado
```

### Linux

```bash
# One-line installer (x64): verifies SHA-256 against the .sha256 sidecar
# and manifest.json before installing to ~/.local/bin; pin with --version vX.Y.Z
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash -s -- --version v0.4.54

```

### macOS

```bash
# Homebrew tap
brew tap marcuz-apl/moderado && brew install moderado

# curl installer (arm64), same checksum verification as Linux
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash -s -- --version v0.4.54

```

### Windows

```powershell
# Scoop bucket
scoop bucket add moderado https://github.com/marcuz-apl/scoop-moderado
scoop install moderado

```

### Uninstall Moderado

Use the command that matches how Moderado was installed:

```bash
# npm (Windows, macOS, or Linux)
npm uninstall -g moderado

# Other npm-compatible runners
bun remove -g moderado
pnpm remove -g moderado
yarn global remove moderado

# Homebrew (macOS)
brew uninstall moderado

# curl installer (Linux or macOS)
rm ~/.local/bin/moderado
```

```powershell
# Scoop (Windows)
scoop uninstall moderado
```

Any npm-compatible runner works on every platform above (`bun add -g
moderado`, `pnpm add -g moderado`, `yarn global add moderado`), and you can
try Moderado without installing via `npx -y moderado@latest --help`.
Standalone binaries for Linux and macOS are attached to every
[GitHub Release](https://github.com/marcuz-apl/moderado/releases) with
`.sha256` checksums and `manifest.json` — no Node.js required.

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


### Connect to the Moderado Gateway

A fresh install needs no key: the CLI starts on the Gateway's two account-free
default models automatically. Run `/connect` and choose Moderado to use those
same free defaults explicitly, or to sign in with the browser or an `mrd_`
website key for account routes. For a keyless profile, `/model` lists the two
pinned defaults so you can select one; a keyed profile lists the configured
Gateway routes, where `auto` follows Gateway routing and selecting a route pins
requests to it.
Existing BYOK and local provider profiles remain independent.

The same `/connect` menu offers OpenRouter, NVIDIA NIM, Ollama
Local, LM Studio, and custom OpenAI-compatible providers. Earlier releases used
`/login` for the Gateway; `/connect` replaced it.

Moderado OAuth credentials last 30 days and have no refresh token; authorize again
after expiry. On Windows, credentials are stored in Windows Credential Manager.
On other platforms, the current credential store is memory-only, so log in again
after starting a new CLI process.

Moderado connections use their configured Gateway URL. Loopback URLs such as
`http://127.0.0.1:4788/v1` are treated as local development; HTTPS URLs for a
NAS, VPS, or other remote host are used as configured. To set the URL before
first connection, define `MODERADO_BASE_URL`. Production defaults to
`https://modr.alfazen.org/v1`. Later Gateway connections keep the saved URL
unless an environment override is set. When no Gateway URL is configured yet,
the CLI probes the development server first and falls back to production. To
force an environment for the current PowerShell session, set `MODERADO_ENV`
before starting the CLI:

```powershell
$env:MODERADO_ENV = "development"
npm run moderado
```

Development uses `http://127.0.0.1:4788/v1`. To force production, set the value
to `production` instead. To return to the saved Gateway URL, clear the override
with `Remove-Item Env:MODERADO_ENV`; also clear `MODERADO_BASE_URL` if you set
that variable. These environment settings apply to `npm run moderado` launched
from the same PowerShell window. You can also set `MODERADO_BASE_URL` to a
specific Gateway URL. For a NAS Gateway, use its HTTPS `/v1` URL and leave
`MODERADO_ENV` unset; `production` selects the built-in public URL. The legacy
`MODERADO_CLOUD_ENV` and `MODERADO_CLOUD_BASE_URL` names remain fallbacks when
their corresponding canonical variables are unset. For an environment-provided
Moderado key, use `MODERADO_API_KEY`; `MODERADO_CLOUD_API_KEY` remains its
fallback when the canonical variable is unset.

Run `moderado doctor` to inspect local setup without exposing secrets. Add
`--connectivity` only when you want an optional live model-catalog check.
`npm test` never performs live provider calls.

## Getting Started & Development

### Log in and select a model in the TUI

Run `moderado` to open the TUI immediately. A fresh installation does not require
an API key or a preselected model: it connects to the Gateway's account-free
default models on start. Use `/connect` to choose the Moderado Gateway
explicitly, sign in, or add another provider. `/model` can change the route
later; a keyless profile lists the Gateway's two pinned defaults for selection.

### Sessions and usage

Moderado stores sessions per workspace in `~/.moderado/sessions/`. Use
`/session` to create, resume, export, or compact a local conversation. Session
exports redact recognized API-key prefixes. The status line uses only
provider-reported token usage. It shows `$0.00` for the account-free Gateway
defaults, calculates cost when the selected model exposes prompt and completion
prices, and shows **Cost unknown** otherwise.

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

## Windows credential storage

On Windows, Gateway sign-in through `/connect` stores credentials in Windows Credential
Manager and keeps only a credential reference in `~/.moderado/config.json`.
Non-Windows platforms use the current memory-only credential store, so log in
again for each new CLI process. Existing BYOK environment variables and saved
profiles remain independent.

## License

This project is licensed under the MIT License.
*NVIDIA NIM, NGC, and model weights/APIs are subject to their respective terms and licenses. Moderado is independent and not endorsed by NVIDIA.*
