# Moderado

> **A lightweight, provider-independent CLI coding agent with dynamic NVIDIA NIM discovery, free-first AUTO routing, and an uncompromised human-in-the-loop approval boundary.**

[![Version](https://img.shields.io/badge/version-v0.3.10-blue.svg)](file:///d:/projects/moderado/VERSION)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](file:///d:/projects/moderado/LICENSE)
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

---

## Install Moderado

`moderado@0.3.10` is live on the public npm registry (`latest` → 0.3.10).
Chocolatey is deliberately out of scope; the full channel runbook lives in
[docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

### Linux

```bash
# One-line installer (x64): verifies SHA-256 against the .sha256 sidecar
# and manifest.json before installing to ~/.local/bin; pin with --version vX.Y.Z
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash -s -- --version v0.3.10

# npm (requires Node.js >= 20)
npm install -g moderado@0.3.10
```

### macOS

```bash
# Homebrew tap
brew tap marcuz-apl/moderado && brew install moderado

# curl installer (arm64), same checksum verification as Linux
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash -s -- --version v0.3.10

# npm (requires Node.js >= 20)
npm install -g moderado@0.3.10
```

### Windows

```powershell
# Scoop bucket
scoop bucket add moderado https://github.com/marcuz-apl/scoop-moderado
scoop install moderado

# winget submission #444475 has passed validation and is awaiting moderator
# approval. Until it merges, install the standalone Windows binary below.

# or simply take the standalone binary (no Node.js required):
#   https://github.com/marcuz-apl/moderado/releases/download/v0.3.10/moderado-win-x64.exe

# npm (requires Node.js >= 20)
npm install -g moderado@0.3.10
```

Windows binaries are unsigned — expect a SmartScreen prompt on first run.

Any npm-compatible runner works on every platform above (`bun add -g
moderado`, `pnpm add -g moderado`, `yarn global add moderado`), and you can
try Moderado without installing via `npx -y moderado@latest --help`.
Standalone binaries for all three platforms are attached to every
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


### Log in to Moderado Cloud

Run `/login` in the TUI and choose browser authorization or enter a Moderado
Cloud `mrd_` API key. The CLI manages the Gateway URL automatically. After
login, `/model` lists the available Cloud routes: `auto` follows the Cloud
admin's model pool, while selecting a route pins requests to that route. Existing
BYOK and local provider profiles remain independent.

Cloud OAuth credentials last 30 days and have no refresh token; authorize again
after expiry. On Windows, credentials are stored in Windows Credential Manager.
On other platforms, the current credential store is memory-only, so log in again
after starting a new CLI process.

For local Gateway development, set `MODERADO_CLOUD_ENV=development` before
starting the CLI. This targets `http://127.0.0.1:8787/v1`; without that setting,
the CLI uses the production Gateway at `https://api.mod.alfazen.org/v1`.

Run `moderado doctor` to inspect local setup without exposing secrets. Add
`--connectivity` only when you want an optional live model-catalog check.
`npm test` never performs live provider calls.
## Getting Started & Development

### Log in and select a model in the TUI

Run `moderado` to open the TUI immediately. A fresh installation does not require
an API key or a preselected model. The welcome card shows **No model connected —
use `/login`** until you add one.

Use `/login` for Moderado Cloud and `/model` to browse its available free routes.
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

## Windows credential storage

On Windows, `/login` stores Moderado Cloud credentials in Windows Credential
Manager and keeps only a credential reference in `~/.moderado/config.json`.
Non-Windows platforms use the current memory-only credential store, so log in
again for each new CLI process. Existing BYOK environment variables and saved
profiles remain independent.

## License

This project is licensed under the MIT License.
*NVIDIA NIM, NGC, and model weights/APIs are subject to their respective terms and licenses. Moderado is independent and not endorsed by NVIDIA.*
