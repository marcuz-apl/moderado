# Moderado

> **A lightweight, provider-independent CLI coding agent with dynamic NVIDIA NIM discovery, free-first AUTO routing, and an uncompromised human-in-the-loop approval boundary.**

[![Latest release](https://img.shields.io/github/v/release/marcuz-apl/moderado)](https://github.com/marcuz-apl/moderado/releases/latest)
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

### Release versions

| Version | Status | How it works |
|---|---|---|
| **0.4.8** | Latest release | Gateway-integrated CLI. `/login` uses the Moderado Gateway for its route catalog and inference. `/connect` remains available for direct provider connections. |
| **0.3.10** | Previous release | Self-contained CLI. It can connect directly to providers and does not require the Moderado Gateway. |

Both versions use the command name `moderado`. Install the latest release with `npm install -g moderado`. To keep using the self-contained 0.3.10 CLI, pin it with `npm install -g moderado@0.3.10`.

Chocolatey is deliberately out of scope; the full channel runbook lives in
[docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

### Linux

```bash
# One-line installer (x64): verifies SHA-256 against the .sha256 sidecar
# and manifest.json before installing to ~/.local/bin; pin with --version vX.Y.Z
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash -s -- --version v0.4.8

# npm (requires Node.js >= 20)
npm install -g moderado
```

### macOS

```bash
# Homebrew tap
brew tap marcuz-apl/moderado && brew install moderado

# curl installer (arm64), same checksum verification as Linux
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash -s -- --version v0.4.8

# npm (requires Node.js >= 20)
npm install -g moderado
```

### Windows

```powershell
# Scoop bucket
scoop bucket add moderado https://github.com/marcuz-apl/scoop-moderado
scoop install moderado

# npm (requires Node.js >= 20)
npm install -g moderado
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

Run `/login` in the TUI and sign in with the browser or enter a Moderado Cloud
`mrd_` website API key to use free Gateway routes. The public Gateway option
lists all routes and can use paid routes without a key. `/model` lists configured
Gateway routes: `auto` follows Gateway routing and may select a free or paid
route, while selecting a route pins requests to it. Existing BYOK and local
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
first login, define `MODERADO_CLOUD_BASE_URL`. Later `/login` attempts keep the
saved Gateway URL unless an environment override is set. The login prompt shows
the resolved Base URL before connecting. To force an environment for the current
PowerShell session, set `MODERADO_CLOUD_ENV` before starting the CLI:

```powershell
$env:MODERADO_CLOUD_ENV = "development"
npm run moderado
```

Development uses `http://127.0.0.1:4788/v1`. To force production, set the value
to `production` instead. To return to the saved Gateway URL, clear the override
with `Remove-Item Env:MODERADO_CLOUD_ENV`; also clear
`MODERADO_CLOUD_BASE_URL` if you set that variable. These environment settings
apply to `npm run moderado` launched from the same PowerShell window. You can
also set `MODERADO_CLOUD_BASE_URL` to a specific Gateway URL before first login.

Run `moderado doctor` to inspect local setup without exposing secrets. Add
`--connectivity` only when you want an optional live model-catalog check.
`npm test` never performs live provider calls.
## Getting Started & Development

### Log in and select a model in the TUI

Run `moderado` to open the TUI immediately. A fresh installation does not require
an API key or a preselected model. The welcome card shows **No model connected —
use `/login`** until you add one.

Use `/login` for the Moderado Gateway and `/model` to browse configured routes.
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
