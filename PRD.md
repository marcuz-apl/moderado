# Moderado Product Requirements Document (PRD)

**Document Version:** `v0.1.0+2609161`  
**Status:** Approved Architecture Specification  
**Reference Design:** [Moderado-design.md](file:///d:/projects/moderado/Moderado-design.md)  
**Standard Adherence:** Alfazen Versioning (`versioning-alfazen`), Minimalist Engineering (`ponytail`), Test-Driven Development (`test-driven-development`)

---

## 1. Executive Summary & Vision

### 1.1 Objective
Moderado is an original, lightweight, terminal-first AI coding agent designed to provide transparent, high-performance, cost-aware software assistance. It combines a provider-independent execution engine with live discovery of NVIDIA NIM hosted and local models, intelligent free-first routing, bounded tool execution, and an uncompromised human-in-the-loop approval security boundary.

### 1.2 Core Differentiation & Principles
- **Clean-Room Implementation**: Completely original design and implementation in TypeScript/Node.js. Zero source code, snippets, or internal conventions copied from Cline, OpenCode, or existing wrappers.
- **Provider Independence**: Core agent logic, message hierarchies, tool dispatch, and routing policies are completely decoupled from any single API or SDK. Provider adapters (beginning with NVIDIA NIM) are injected via typed contracts.
- **Free-First AUTO Routing**: Dynamically discovers available models, filters for chat and tool capabilities, and prioritizes verified free/trial endpoints before any paid inference is considered. Paid models and unknown pricing require explicit user opt-in.
- **Strict Approval Boundary**: Interactive per-action approvals for all write operations and process executions. Non-interactive sessions fail closed by denying operations requiring approval.
- **Controlled Web Search**: M7 adds an approval-gated, bounded search tool with source URLs and no unrestricted network or shell access.
- **Minimalist Engineering (`ponytail`)**: Strict application of the Decision Ladder: YAGNI, standard library first (native Node.js `fetch`, `AbortController`, `child_process.spawn`), zero unnecessary dependencies, and runtime schema validation at all system boundaries.

---

## 2. Target Personas & Use Cases

### 2.1 Personas
1. **The Cost-Conscious Software Engineer**: Wants high-quality coding assistance leveraging free/trial tier access from NVIDIA NIM or local NIM instances without unexpected billing shocks or vendor lock-in.
2. **The Security-Minded Enterprise Developer**: Requires strict visibility and granular approval over what files an agent edits and what shell commands it executes, ensuring credentials and local environments remain untampered.
3. **The Systems Architect / Pair Programmer**: Demands predictable model selection, deterministic tool handling, and clear architectural boundaries that allow extending the CLI to desktop hosts without rewriting the core loop.

### 2.2 Core Workflows
- **Live Model Discovery**: Running `moderado models` to query the live `/v1/models` endpoint, inspecting capability classifications (tool support), access tiers (free/trial vs paid), and verification provenance.
- **Autonomous Guided Task Execution**: Running `moderado run "Add unit tests for auth service" --workspace ./backend`, letting the agent inspect the codebase, propose precise edits, run tests, and summarize results under bounded step limits.
- **Deterministic Model Pinning**: Explicitly running with `--model <model_id>` to enforce exact model usage without silent fallback or drift.
- **Read-Only Codebase Audit**: Running with `--read-only` to analyze code, trace bugs, and generate architectural reviews without granting write or command execution permissions.

---

## 3. Project Architecture & Workspace Layout

Moderado is organized as an npm workspace using TypeScript with strict type checking and modern Node.js runtime standards (Node.js >= 20 LTS).

```text
moderado/
├── package.json               # Root workspace manifest
├── tsconfig.base.json         # Base TypeScript configuration (strict, ESM)
├── VERSION                    # Stamped Alfazen version identifier
├── PRD.md                     # Product Requirements Document
├── AGENTS.md                  # Agent guidelines and operational manual
├── HANDOFF.md                 # State snapshot and resumption ledger
├── apps/
│   └── cli/                   # v0.1 Command-Line Application
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts       # CLI entrypoint and argument parsing
│           ├── commands/      # 'run', 'models', 'config' command handlers
│           └── ui/            # Terminal event renderers and interactive prompts
├── packages/
│   ├── contracts/             # Pure contracts, interfaces, Zod schemas, events
│   │   ├── package.json
│   │   └── src/
│   │       ├── models.ts      # Model metadata and access/capability types
│   │       ├── messages.ts    # Normalized message and tool call types
│   │       ├── provider.ts    # Provider adapter interfaces and error taxonomy
│   │       ├── tools.ts       # Tool definition contracts and parameter schemas
│   │       ├── events.ts      # Structured agent loop event definitions
│   │       └── approvals.ts   # Human-in-the-loop approval contracts
│   ├── core/                  # Agent loop, state machine, routing, policy
│   │   ├── package.json
│   │   └── src/
│   │       ├── agent.ts       # Core agent loop implementation
│   │       ├── router.ts      # Model discovery, ranking, and fallback logic
│   │       ├── policy.ts      # Step bounding, timeouts, and approval policies
│   │       └── state.ts       # Session state machine and cancellation
│   ├── providers/             # Concrete provider integrations
│   │   ├── package.json
│   │   └── src/
│   │       ├── nvidia/        # NVIDIA NIM HTTP adapter (hosted and local)
│   │       └── fake/          # Fake provider for offline testing
│   └── tools/                 # Workspace file and command execution engine
│       ├── package.json
│       └── src/
│           ├── registry.ts    # Tool registry and dispatcher
│           ├── filesystem.ts  # read_file, write_file, edit_file, list_files, search_files
│           ├── execution.ts   # run_command with child_process.spawn
│           └── git.ts         # git_diff execution
├── tests/                     # Integration tests and cross-package suites
│   ├── integration/
│   ├── fixtures/
│   └── mocks/
└── docs/
    ├── ARCHITECTURE.md        # System architecture and data flow
    ├── TOOLS.md               # Tool schemas, limits, and security rules
    ├── ROUTING.md             # Discovery and free-first routing policy
    └── SECURITY.md            # Security boundary and threat mitigation
```

---

## 4. Functional Requirements

### 4.1 CLI Command Suite

#### 4.1.1 `moderado models`
- **Purpose**: Query live endpoints, catalog model IDs, and output capability and access classifications with underlying evidence.
- **Options**:
  - `--profile <name>`: Target a configured profile (default: `hosted-nvidia`).
  - `--refresh`: Bypass any cached discovery data and query `/v1/models` live.
  - `--json`: Output raw structured JSON for scripting.
- **Output Requirements**:
  - Model ID and family.
  - Access Tier: `free_trial`, `paid`, `local`, `unknown`.
  - Tool Support: `supported`, `unsupported`, `unknown`.
  - Verification Evidence: Source of classification, probe timestamp, or heuristic provenance.

#### 4.1.2 `moderado run "<task>"`
- **Purpose**: Launch a bounded, autonomous coding session to accomplish a user prompt.
- **Required Arguments**:
  - `<task>`: Natural language prompt string.
- **Options**:
  - `--workspace <path>`: Absolute or relative path to target directory (default: current directory).
  - `--model <id>`: Pin a specific model. **Hard constraint**: Never silently substitute or fall back when `--model` is pinned.
  - `--profile <name>`: Profile containing endpoint URL and credential configuration.
  - `--max-steps <int>`: Upper bound on tool interaction cycles (default: 25).
  - `--timeout <seconds>`: Global session timeout (default: 600s).
  - `--read-only`: Enforce read-only mode, denying all writes, edits, and commands.
  - `--non-interactive`: Deny any action requiring user approval rather than prompting.
  - `--verbose`: Render full tool inputs, outputs, and model event streams.

### 4.2 Model Discovery & Free-First AUTO Routing

1. **Dynamic Querying**:
   - Query the configured `/v1/models` endpoint dynamically using native Node.js `fetch`.
   - Never rely on hardcoded static lists as the source of truth.
2. **Access & Capability Classification**:
   - Classifications are tracked separately:
     - **Access**: `free_trial`, `paid`, `local`, `unknown`.
     - **Tool Support**: `supported`, `unsupported`, `unknown`.
   - Every classification records its verification source (e.g., explicit probe, official API metadata, or user configuration override).
   - Stale or absent access metadata must **never** be assumed or advertised as confirmed free.
3. **AUTO Ranking Formula**:
   - **Step 1**: Filter candidates for chat completion suitability and verified tool call capability.
   - **Step 2**: Filter by allowed access tiers (default: `free_trial` and `local`; `paid` and `unknown` require explicit `--allow-paid` or `--allow-unknown` flags).
   - **Step 3**: Rank candidates:
     1. Verified free/trial endpoints with verified tool support.
     2. Local endpoints (if explicit profile selected).
     3. Explicitly permitted paid endpoints.
   - **Step 4**: If no eligible model remains, terminate with an actionable diagnostic message explaining how to configure credentials, opt into paid models, or manually pin an ID.
4. **Resilience & Fallbacks**:
   - Retry transient HTTP errors (429, 500, 502, 503, 504) with exponential backoff and jitter.
   - Parse and respect `Retry-After` headers up to a configurable ceiling (default: 30s).
   - In AUTO mode, switch to the next eligible ranked model if a model becomes unavailable or hits persistent rate limits.
   - Authentication (401/403) and malformed request (400) errors must fail immediately without silent fallback.
   - Model switches must emit visible `ModelChangeEvent` alerts to the user.

### 4.3 Workspace Tool Suite

Moderado implements exactly 7 bounded workspace tools in v0.1:

| Tool | Purpose | Default Approval Gate |
|---|---|---|
| `read_file` | Read contents of a workspace file with line offsets and length bounds | Auto-approved (Read) |
| `write_file` | Create a new file or completely overwrite an existing file atomically | **Requires Approval** (Write) |
| `edit_file` | Replace an exact, unique target string with replacement content | **Requires Approval** (Write) |
| `list_files` | List files and directories matching glob patterns or subpaths | Auto-approved (Read) |
| `search_files` | Search file contents using regex or literal patterns (capped matches) | Auto-approved (Read) |
| `run_command` | Execute an external command using an argument array with `shell: false` | **Requires Approval** (Command) |
| `git_diff` | Inspect uncommitted changes or diff against a reference | Auto-approved (Read) |

### 4.4 Approval Boundary & Security Controls

1. **Path Canonicalization & Workspace Jail**:
   - All filesystem paths must resolve against the workspace root using `fs.realpathSync`.
   - Strict rejection of directory traversal attempts (`../`), symlink escapes targeting outside the workspace, and parent-relative paths.
   - Absolute protection of sensitive directories and files:
     - `.git/` metadata (must only be accessed via bounded git commands).
     - Environment files (`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`).
     - Configuration secrets.
2. **Command Isolation**:
   - Commands must be executed via `child_process.spawn` with an argument array and `shell: false`.
   - Windows command interpreters (`cmd.exe`, `powershell.exe`) must not be implicitly invoked for `.bat` or `.cmd` scripts; any script requiring an interpreter must be explicitly requested and display full arguments.
   - Environment purging: Process execution environment must explicitly strip provider API keys (`NVIDIA_API_KEY`, etc.) and internal token variables.
   - Hard execution timeout (default: 60s) and stdout/stderr output buffer truncation (default: 64KB).
3. **Approval Integrity**:
   - Approvals are cryptographically or sequentially bound to a unique `requestId` and the exact payload (e.g., diff preview or command arguments).
   - Approval responses cannot be forged or recycled across steps.
   - In non-interactive mode (`--non-interactive`), any operation requiring approval is automatically denied.

---

## 5. Non-Functional Requirements

### 5.1 Performance & Footprint
- **Cold Start**: CLI startup time to render `moderado models` or prompt for the first step must be under 500ms.
- **Memory Footprint**: Agent idle memory consumption must not exceed 100MB RSS.
- **Output Streaming**: Token generation and tool progress events must stream to the terminal in real time with zero buffering lag.

### 5.2 Portability & Platforms
- First-class support for:
  - Windows 10/11 (PowerShell, Windows Terminal).
  - macOS (Apple Silicon and Intel).
  - Linux (Ubuntu, Debian, Fedora, Arch).
- Paths must be normalized across POSIX and Windows delimiters without breaking workspace jail guarantees.

### 5.3 Reliability & Idempotency
- Never duplicate tool execution during model retries. Once a tool has produced side effects, its result is committed to the conversation context; retry logic only resubmits inference.
- Atomic file operations: writes write to a temporary sibling file and rename atomically to prevent corruption.

---

## 6. Versioning, Milestones & Alfazen Standard

Moderado strictly adheres to **Alfazen Versioning (SemVer 2.0.0 + Connected UTC Build Prefix)**:
- Stored in root `VERSION`: `v0.1.0+2609161`.
- Commit format: `v<m.n.p>+<yymmddc> <type>(<scope>): <subject>`.
- Automated Git hooks under `.githooks/` (`versionlib.sh`, `pre-commit`, `prepare-commit-msg`).
- **Major (`m`) Increment Advisory Gate**: Automatic incrementing of `m` is strictly prohibited and requires explicit written confirmation from the project owner.

---

## 7. Acceptance Criteria & Verification Matrix

| Area | Verification Method | Acceptance Standard |
|---|---|---|
| **Build & Types** | `npm run build`, `tsc --noEmit` | Strict compilation without any errors or `any` escapes |
| **Contracts** | Vitest unit tests | Pure contracts package imports zero outside runtime dependencies |
| **Tool Jail** | Vitest security test suite | 100% rejection of `../`, symlinks to `/etc`, `.git` writes, `.env` access |
| **Command Engine** | Vitest execution test suite | `shell: false` validated; environment keys confirmed purged; timeouts enforced |
| **Model Discovery** | Vitest with mock HTTP server | `/v1/models` parsed; models classified; paid models excluded unless permitted |
| **Routing Resilience**| Vitest mock test suite | 429 backoff respected; fallback triggered without repeating side effects |
| **CLI User Interface** | Vitest CLI tests | Interactive prompt rendering; `--non-interactive` denial verified |
