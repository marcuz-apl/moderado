# Moderado

> **A lightweight, provider-independent CLI coding agent with dynamic NVIDIA NIM discovery, free-first AUTO routing, and an uncompromised human-in-the-loop approval boundary.**

[![Version](https://img.shields.io/badge/version-v0.3.1-blue.svg)](file:///d:/projects/moderado/VERSION)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](file:///d:/projects/moderado/LICENSE)
[![Standards: Alfazen](https://img.shields.io/badge/standard-alfazen--coding-green.svg)](https://github.com/marcuz-apl/alfazen-skills)

---

> Feature highlights, documentation map, workspace layout, and in-depth TUI
> capability guides moved to [docs/GUIDE.md](docs/GUIDE.md).

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

## VS Code Extension (Alpha)

Moderado provides an official VS Code extension for supervised agentic coding directly from the Activity Bar:
- **Interactive Review**: Review proposed file edits as colorized unified diffs before granting permission.
- **Strict Human-in-the-Loop**: File modifications and command executions require explicit approval (`Approve` / `Reject`).
- **Fail-Closed Security**: Disconnection or cancellation automatically aborts pending operations.
- **Zero Autonomous Writes**: The agent never mutates files without your explicit consent.

See [apps/vscode/README.md](apps/vscode/README.md) for local VSIX build and installation instructions.

---

## Install Moderado

`moderado@0.3.0` is live on the public npm registry (`latest` → 0.3.0).
Chocolatey is deliberately out of scope; the full channel runbook lives in
[docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

### Linux

```bash
# One-line installer (x64): verifies SHA-256 against the .sha256 sidecar
# and manifest.json before installing to ~/.local/bin; pin with --version vX.Y.Z
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash

# npm (requires Node.js >= 20)
npm install -g moderado

# AUR: build `moderado-bin` from the PKGBUILD attached to the GitHub
# Release (maintainer upload pending)
```

### macOS

```bash
# Homebrew tap
brew tap marcuz-apl/moderado && brew install moderado

# curl installer (arm64), same checksum verification as Linux
curl -fsSL https://raw.githubusercontent.com/marcuz-apl/moderado/master/scripts/install.sh | bash

# npm (requires Node.js >= 20)
npm install -g moderado
```

### Windows

```powershell
# Scoop bucket
scoop bucket add moderado https://github.com/marcuz-apl/scoop-moderado
scoop install moderado

# winget: submission winget-pkgs#439175 is awaiting merge; until then use
# the Moderado.yaml attached to the GitHub Release:
#   winget install --manifest <path\to\Moderado.yaml>
winget install MarcuzApl.Moderado

# npm (requires Node.js >= 20)
npm install -g moderado
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

The `/connect` choices can be customized in `~/.moderado/config.json`. Omit
`enabled` to show every built-in provider, or list the built-in IDs you want to
show. Custom entries add named OpenAI-compatible endpoints; credentials are
still requested when connecting:

```json
{
  "connectProviders": {
    "enabled": ["nvidia-nim", "openrouter", "ollama"],
    "custom": [
      {
        "id": "company-gateway",
        "name": "Company Gateway",
        "baseUrl": "https://llm.example.com/v1",
        "defaultModel": "coder-small"
      }
    ]
  }
}
```

Custom endpoints must use HTTPS, except local HTTP endpoints on localhost.

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

On Windows, /connect saves provider API keys in Windows Credential Manager and stores only a provider credential reference in ~/.moderado/config.json. Existing plaintext keys remain usable for compatibility. Migrate them explicitly with moderado doctor --migrate-credentials; a failed migration leaves the existing configuration unchanged. On other platforms, set the provider environment variable (for example, NVIDIA_API_KEY or OPENROUTER_API_KEY).

## License

This project is licensed under the MIT License.
*NVIDIA NIM, NGC, and model weights/APIs are subject to their respective terms and licenses. Moderado is independent and not endorsed by NVIDIA.*
