# Moderado for VS Code

The Moderado sidebar runs the same agent engine as the CLI, with provider-first
free model selection, streamed chat, sessions, and per-category approvals.

## What it does

- **Chat** in the Activity Bar sidebar, with Plan and Act modes, streamed answers,
  live token usage, and a stop action.
- **Verified free models only.** A model appears only when the provider's own
  pricing or its declared free policy substantiates it. A reported nonzero price
  always wins over a blanket declaration.
- **Five approval categories** — Read files, Edit files, Fetch web content start
  on; Execute commands and Use MCP servers start off. An off category asks for an
  explicit Approve or Deny with the exact diff, command, or payload. Auto-approved
  actions still appear in the activity timeline. Plan mode always asks before
  editing, whatever the checkboxes say.
- **Keys stay in VS Code SecretStorage** and are never sent back to the panel.

## Build

```bash
npm run build                              # workspace packages
npm run build --workspace apps/vscode      # bundle to apps/vscode/dist/extension.cjs
npm run verify:vsix                        # package and verify artifacts/vsix/*.vsix
```

Then press <kbd>F5</kbd> in VS Code to launch the Extension Development Host.

To install the built VSIX: **Extensions: Install from VSIX...**

## Testing

Unit tests are offline and use a fake provider; no API key is needed. The
extension-host smoke test loads the packaged bundle with a stubbed `vscode`
module, which covers activation and the webview handshake but is not a
substitute for running it in a real editor.

