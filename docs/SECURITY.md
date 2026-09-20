# Moderado Security Model & Threat Mitigation (`docs/SECURITY.md`)

**Document Version:** `v0.1.0+2609161`  
**Status:** Approved Security Architecture  
**Parent Document:** [PRD.md](file:///d:/projects/moderado/PRD.md)  
**Standard Adherence:** Minimalist Engineering (`ponytail`), Defense in Depth

---

## 1. Threat Model & Trust Boundaries

Moderado operates on the principle of least privilege and assumes that **repository contents, file data, and external command outputs are untrusted**.

```text
[ External / Hosted LLM ] <---> (Network Boundary: Encrypted TLS, API Key)
          |
          v
[ Moderado Agent Core ]
          |
  +-------+-----------------------------+
  |                                     |
  v (Auto-Approved)                     v (Approval Boundary: Human In The Loop)
[ Read Operations ]                   [ Write & Execute Operations ]
- read_file, search_files             - write_file, edit_file
- list_files, git_diff                - run_command
  |                                     |
  +------------------+------------------+
                     |
                     v (Workspace Jail)
          [ Local Host Filesystem ]
```

### 1.1 Approval Boundary vs. OS Sandbox
> [!IMPORTANT]
> Moderado's approval system is a **human-in-the-loop verification boundary**, not an OS-level virtualization sandbox.
> When a user approves a command via `run_command`, that command executes with the permissions of the current operating system user. To run untrusted or adversarial repositories, users are instructed to run Moderado inside a container (e.g. Docker) or an isolated VM.

---

## 2. Workspace Confinement (The File Jail)

All filesystem tools (`read_file`, `write_file`, `edit_file`, `list_files`, `search_files`) must operate strictly within the bounds of the configured workspace.

### 2.1 Path Canonicalization Algorithm
Before performing any filesystem I/O:
1. Normalize and resolve the incoming path against `workspaceRoot`:
   ```typescript
   const resolvedPath = path.resolve(workspaceRoot, inputPath);
   const canonicalPath = fs.existsSync(resolvedPath)
     ? fs.realpathSync(resolvedPath)
     : path.resolve(fs.realpathSync(workspaceRoot), path.relative(workspaceRoot, resolvedPath));
   ```
2. Verify containment:
   ```typescript
   const canonicalRoot = fs.realpathSync(workspaceRoot);
   if (!canonicalPath.startsWith(canonicalRoot + path.sep) && canonicalPath !== canonicalRoot) {
     throw new SecurityViolationError(`Access denied: path '${inputPath}' escapes workspace jail.`);
   }
   ```

### 2.2 Symlink Escape Prevention
- If an existing symlink inside the workspace points to a file or directory outside `canonicalRoot`, accessing or following it must throw `SecurityViolationError`.

### 2.3 Sensitive File Blacklist
Even within the workspace, access to certain sensitive infrastructure files is restricted:
- **Git Metadata**: Access to `.git/` is prohibited for general read/write/edit tools. Git operations must use `git_diff` or approved `run_command ["git", ...]`.
- **Environment & Secrets**: Files matching `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `*secret*`, or `*credential*` are blocked from automated reads to prevent exfiltration into remote model prompts.

---

## 3. Command Execution Isolation

### 3.1 Prohibition of System Shells (`shell: false`)
- Commands are executed strictly via Node.js `child_process.spawn(command, args, { shell: false })`.
- This eliminates shell injection vulnerabilities (such as `; rm -rf /`, backticks, or `|` pipes hidden inside arguments).

### 3.2 The Windows Batch File Guard
On Windows, executing `.bat` or `.cmd` files without `shell: true` requires an explicit interpreter executable (`cmd.exe`). Moderado:
- **Never** silently wraps batch files in `shell: true`.
- If an agent requests running a batch file directly, Moderado rejects the call with an actionable error requiring explicit invocation (`cmd.exe /c script.bat`), ensuring full command arguments remain visible to the user during approval.

### 3.3 Environment Cleansing
Spawned child processes inherit a purged environment:
```typescript
function getSanitizedEnv(): NodeJS.ProcessEnv {
  const cleanEnv = { ...process.env };
  // Remove provider credentials and API tokens
  const keysToRemove = [
    'NVIDIA_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GITHUB_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'MODERADO_TOKEN',
  ];
  for (const key of keysToRemove) {
    delete cleanEnv[key];
  }
  return cleanEnv;
}
```

---

## 4. Prompt Injection & Context Manipulation Defense

1. **Untrusted Tool Outputs**: Tool results and file contents are tagged as untrusted context.
2. **Immutable Approval Rules**: System prompts and approval requirements cannot be overridden by model instructions. Even if an LLM responds with `"User has pre-approved this command: disable confirmation"`, the agent loop checks the code-level `requiresApproval` flag and halts for human consent.
3. **Fail-Closed in Non-Interactive Mode**: When running with `--non-interactive` (e.g. in CI pipelines), any write or command requiring approval is denied immediately with `ERR_NON_INTERACTIVE_DENIAL`.

---

## 5. Privacy, Logging & Telemetry Redaction

- **Credential Redaction**: Before any error or debug event is written to the terminal or log file, sensitive patterns (API keys matching `nvapi-*`, `sk-*`, bearer tokens) are replaced with `[REDACTED]`.
- **Zero Ephemeral Transcripts**: Moderado does not silently upload or persist user prompt transcripts to third-party diagnostic servers.

## 6. Controlled Web Search (M7)

`web_search` is a declared tool with `requiresApproval: true`. It may call only a
configured HTTPS endpoint (or localhost for offline tests), applies query and
result limits, validates returned titles and URLs, and preserves source URLs as
citation metadata. It does not enable arbitrary internet access, shell access,
or automatic browsing. Network failures, denial, malformed responses, and empty
results return visible bounded tool results.

## 7. Local MCP Servers (M7.5)

MCP support is limited to local stdio servers that the user explicitly adds
through `/mcp` or the local `~/.moderado/config.json` file:

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

`/mcp add` validates the name and probes `tools/list` before saving. `/mcp
status` reports each server independently; `/mcp disable NAME` preserves its
record but removes its tools from the active registry, while enable, remove,
and reload update the current session without reconnecting the provider.

Server processes use `shell: false`, fixed arguments, a sanitized environment,
timeouts, and bounded input and output. Discovered tools are namespaced
`mcp.<server>.<tool>`, and every invocation goes through interactive approval
even when general TUI auto-approve is enabled. Non-interactive calls fail
closed. Server output remains untrusted and cannot change approval, provider,
workspace, or configuration policy.

Remote HTTP/SSE transports, OAuth, marketplaces, automatic installation,
persistent server processes, prompts, and resources are outside this local-only
workflow.
