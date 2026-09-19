# Moderado Tool Specifications & Security Boundaries (`docs/TOOLS.md`)

**Document Version:** `v0.1.0+2609161`  
**Status:** Approved Specification  
**Parent Document:** [PRD.md](file:///d:/projects/moderado/PRD.md)  
**Standard Adherence:** Minimalist Engineering (`ponytail`), Strict Validation

---

## 1. Overview & General Constraints

Moderado equips the agent with bounded workspace tools plus the approval-gated `web_search` tool. Every tool call:
- Receives a strongly-typed argument payload validated via runtime schemas.
- Executes within the canonical workspace jail.
- Is subjected to per-action approval policies before execution.

`web_search` only calls a user-configured HTTPS endpoint (or localhost in development), limits results, validates titles and URLs, and returns source links. It does not grant general internet access or execute commands.
- Returns a normalized `ToolResult` containing output text, metadata, or structured errors.

```typescript
export interface ToolResult {
  toolName: string;
  status: 'success' | 'error' | 'denied';
  output: string;
  truncated?: boolean;
  metadata?: Record<string, unknown>;
}
```

---

## 2. Tool Specifications

### 2.1 `read_file`
Reads the content of a file within the workspace.

- **Approval Gate**: Auto-approved (Read).
- **Parameters Schema**:
  ```typescript
  export const ReadFileParamsSchema = z.object({
    path: z.string().min(1, "File path cannot be empty"),
    offset: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(2000).default(500),
  });
  ```
- **Validation & Safety Rules**:
  - Path resolves to canonical absolute path via `fs.realpathSync`. Must reside strictly within `workspaceRoot`.
  - Protected file blacklist check (`.git`, `.env*`, `*.pem`, `*.key`, `id_rsa*`).
  - Binary file detection: Checks the first 512 bytes for null characters (`\0`). Rejects binary files with an actionable error.
  - Truncation: Files exceeding `limit` lines are truncated; output indicates total lines and how to paginate using `offset`.
- **Output Format**:
  Numbered line format for exact referencing:
  ```text
  12: function authenticateUser(token: string) {
  13:   if (!token) throw new Error("Missing token");
  ```

---

### 2.2 `write_file`
Creates a new file or completely replaces an existing file atomically.

- **Approval Gate**: **Requires Interactive Approval** (Write).
- **Parameters Schema**:
  ```typescript
  export const WriteFileParamsSchema = z.object({
    path: z.string().min(1, "File path cannot be empty"),
    content: z.string(),
  });
  ```
- **Approval Payload**:
  Displays target file path, whether it is a creation or full overwrite, and content size / line count.
- **Validation & Safety Rules**:
  - Path validated against workspace jail.
  - Protected file blacklist check.
  - Atomic Write: Content is written to a temporary sibling file (`.tmp.moderado.<uuid>`) and renamed atomically (`fs.renameSync`) to guarantee that partial writes never corrupt existing files.
  - Creates parent directories recursively if they do not exist.

---

### 2.3 `edit_file`
Applies surgical modifications by replacing an exact, unique snippet of text with new content.

- **Approval Gate**: **Requires Interactive Approval** (Write).
- **Parameters Schema**:
  ```typescript
  export const EditFileParamsSchema = z.object({
    path: z.string().min(1, "File path cannot be empty"),
    targetContent: z.string().min(1, "Target content must not be empty"),
    replacementContent: z.string(),
  });
  ```
- **Approval Payload**:
  Generates and displays a unified git-style diff preview showing additions (`+`) and deletions (`-`) before asking for approval.
- **Validation & Safety Rules**:
  - Path validated against workspace jail.
  - Strict Unique Match: The file content is read and checked for `targetContent`.
    - If `targetContent` occurs **0 times**: Fails immediately with `TargetNotFoundError` (shows line context to help agent correct).
    - If `targetContent` occurs **> 1 times**: Fails immediately with `AmbiguousTargetError` instructing the agent to include more surrounding lines for unique context.
  - Atomic Write: Upon approval, modified file is written via temporary file rename.

---

### 2.4 `list_files`
Lists directory contents matching search patterns or recursive listings.

- **Approval Gate**: Auto-approved (Read).
- **Parameters Schema**:
  ```typescript
  export const ListFilesParamsSchema = z.object({
    subpath: z.string().default("."),
    recursive: z.boolean().default(false),
    maxDepth: z.number().int().min(1).max(10).default(3),
    limit: z.number().int().min(1).max(500).default(200),
  });
  ```
- **Validation & Safety Rules**:
  - Resolves `subpath` within workspace jail.
  - Automatic filtering: Ignores `node_modules/`, `.git/`, `dist/`, `.turbo/`, and hidden OS metadata by default.
  - Limits output to `limit` entries with clear truncation indicator.

---

### 2.5 `search_files`
Searches file contents within the workspace using literal strings or regex patterns.

- **Approval Gate**: Auto-approved (Read).
- **Parameters Schema**:
  ```typescript
  export const SearchFilesParamsSchema = z.object({
    query: z.string().min(1, "Search query cannot be empty"),
    isRegex: z.boolean().default(false),
    caseSensitive: z.boolean().default(true),
    includes: z.array(z.string()).optional(),
    maxResults: z.number().int().min(1).max(100).default(50),
  });
  ```
- **Validation & Safety Rules**:
  - Executes search natively in Node.js or via bounded searcher.
  - Rejects searches across protected or ignored directories (`.git`, `node_modules`).
  - Output formats matched file paths, line numbers, and line snippets.

---

### 2.6 `run_command`
Executes external processes within the workspace directory.

- **Approval Gate**: **Requires Interactive Approval** (Command).
- **Parameters Schema**:
  ```typescript
  export const RunCommandParamsSchema = z.object({
    command: z.string().min(1, "Command cannot be empty"),
    args: z.array(z.string()).default([]),
    timeoutSeconds: z.number().int().min(1).max(300).default(60),
  });
  ```
- **Approval Payload**:
  Displays the exact binary to execute, full argument array, working directory, and timeout limit.
- **Validation & Safety Rules**:
  - **No Shell Expansion**: Spawns via `child_process.spawn(command, args, { shell: false, cwd: workspaceRoot })`.
  - Windows Interpreter Guard: Windows command interpreters (`cmd.exe`, `powershell.exe`) must not be automatically wrapped around batch files (`.bat`, `.cmd`). Unsupported command forms return an actionable error requiring explicit configuration.
  - **Environment Sanitization**: The spawned process receives a sanitized clone of `process.env`. All provider API keys (e.g., `NVIDIA_API_KEY`), secret tokens, and internal variables are stripped.
  - **Buffer Bounds**: Stdout and stderr streams are capped at 64KB each to prevent terminal buffer exhaustion or context memory blowouts.
  - **Process Termination**: If `timeoutSeconds` expires or the session is aborted, sends `SIGTERM`, followed by `SIGKILL` after 2 seconds if the process remains alive.

---

### 2.7 `git_diff`
Inspects uncommitted changes or compares against git references.

- **Approval Gate**: Auto-approved (Read).
- **Parameters Schema**:
  ```typescript
  export const GitDiffParamsSchema = z.object({
    staged: z.boolean().default(false),
    targetRef: z.string().regex(/^[a-zA-Z0-9_\-\.\/]+$/).optional(),
    filePaths: z.array(z.string()).optional(),
  });
  ```
- **Validation & Safety Rules**:
  - Invokes `git diff` with hardcoded arguments: `--no-ext-diff --no-color --no-textconv`.
  - Does **never** accept model-supplied raw flag strings.
  - Output is capped at 100KB to prevent context bloat.

---

## 3. Standardized Error Taxonomy

| Error Code | Error Class | Description |
|---|---|---|
| `ERR_PATH_OUT_OF_BOUNDS` | `SecurityViolationError` | Attempted path traversal or symlink escape outside workspace |
| `ERR_PROTECTED_FILE` | `SecurityViolationError` | Attempted access or write to `.git`, `.env`, or credential files |
| `ERR_TARGET_NOT_FOUND` | `ToolExecutionError` | `edit_file` could not locate exact target text |
| `ERR_AMBIGUOUS_TARGET` | `ToolExecutionError` | `edit_file` found multiple matching instances |
| `ERR_COMMAND_TIMEOUT` | `ExecutionTimeoutError` | Spawned process exceeded `timeoutSeconds` |
| `ERR_APPROVAL_DENIED` | `ApprovalDeniedError` | User explicitly denied write or command execution |
| `ERR_NON_INTERACTIVE_DENIAL` | `ApprovalDeniedError` | Mutation/command attempted in `--non-interactive` mode |
