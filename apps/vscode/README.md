# Moderado VS Code Extension (Alpha)

A task-oriented VS Code interface for Moderado, providing supervised agentic coding with human-in-the-loop approvals, diff previews, and session continuity.

---

## Prerequisites

Before installing the extension, ensure your system meets the following requirements:

1. **VS Code**: Version `1.85.0` or later.
2. **Node.js**: Version `>= 20.0.0` LTS. (VS Code ships its own runtime; this applies only when running the CLI directly.)
3. **Moderado CLI**: *Optional.* The extension bundles its own sidecar, so no separate CLI install is required. Set `moderado.executablePath` to force a specific external CLI instead.
4. **Provider Configuration**: Connect a provider from the panel's ⚙️ button, or with `moderado selectProvider`. API keys are stored by the host (Windows Credential Manager on Windows) and are never sent to the webview.

---

## Local Installation Workflow

This alpha release is distributed as a locally packageable VSIX for developer testing.

### 1. Build and Package

From the repository root:

```bash
# 1. Compile all packages and the VS Code extension
npm run build

# 2. Package the VSIX artifact
npm run package:vscode
```

This creates `apps/vscode/moderado-vscode-0.4.0.vsix`.

### 2. Install the VSIX in VS Code

You can install the package using the command line:

```bash
code --install-extension apps/vscode/moderado-vscode-0.4.0.vsix
```

Alternatively, inside VS Code:
1. Open the **Extensions** view (`Ctrl+Shift+X` on Windows/Linux, `Cmd+Shift+X` on macOS).
2. Click the `...` menu in the top-right corner of the Extensions panel.
3. Select **Install from VSIX...**.
4. Choose the `moderado-vscode-0.4.0.vsix` file.

---

## Branding assets

| Asset | Role |
|---|---|
| `media/icon.png` | 128x128 RGBA brand icon declared as `icon` in `package.json`; shown in the Extensions view and required by the Marketplace. |
| `media/icon.svg` | Monochrome Activity Bar glyph. VS Code requires `currentColor` with no hard-coded colors, masks, or filters. |

Both assets carry the same shield-and-code mark, so the panel glyph and the extension tile read as one product while staying visually distinct from VS Code's own branding (the raster icon uses Moderado's indigo/violet palette, not VS Code blue).

Regenerate and verify the raster icon after changing its geometry or palette:

```bash
cd apps/vscode
npm run icons                           # writes media/icon.png
node scripts/generate_icon.mjs --check  # fails when media/icon.png is out of date
```

`npm run build` and `npm run package` regenerate the icon automatically, and VSIX packaging fails closed when the declared icon is missing or is not a PNG.

---

## Configuration

| Setting | Type | Default | Description |
|---|---|---|---|
| `moderado.executablePath` | `string` | `""` | Absolute path to an external `moderado` executable. If empty, the extension uses its bundled sidecar, then a globally installed CLI, then `PATH`. |
| `moderado.provider` | `string` | `""` | Provider connection id (e.g. `nvidia-nim`, `openrouter`, `agnes-ai`). Normally set by the panel's provider picker. |
| `moderado.model` | `string` | `""` | Model id to pin. If empty, free-first auto-routing is used. |

---

## Features & Capabilities

- **Activity Bar Chat View**: A dedicated sidebar view container for conversation and task management.
- **Reviewable Unified Diffs**: File modifications are presented as colorized unified diff review cards.
- **Strict Approval Boundary**: File modifications and command executions strictly require explicit human approval (`Approve` / `Reject`).
- **Fail-Closed Security**: Disconnection, process cancellation, or closing the view automatically aborts any pending approvals. No implicit approvals are ever granted.
- **Editor Context Attachment**: Attach the active editor file and highlighted lines into the conversation context with one click.
- **Session Resumption**: Resume previous coding sessions within the workspace seamlessly.
