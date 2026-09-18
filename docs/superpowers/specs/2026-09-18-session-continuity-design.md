# Moderado Session Continuity Design

**Status:** Approved for planning
**Milestone:** M2 — Persistent sessions, context, and actual usage
**Parent roadmap:** [CLI capability roadmap](../../CLI_CAPABILITY_ROADMAP.md)

## Goal

Make Moderado conversations durable across CLI restarts, honest about provider
usage and cost, and manageable as they grow without exposing credentials.

## Boundaries

- Use TypeScript, Node.js 20 or later, the standard library, and existing Zod.
- The persistent store belongs in apps/cli. packages/core remains
  filesystem-independent and provider-independent.
- Session records never contain API keys, authorization headers, environment
  values, or raw provider request bodies.
- Existing approval, workspace-jail, and non-interactive rules remain unchanged.
- Automated tests remain offline; local HTTP test servers are allowed.

## Data model and storage

Each workspace receives a lowercase hexadecimal SHA-256 identifier calculated
from its canonical absolute path. Sessions are written beneath:

~~~text
~/.moderado/sessions/<workspace-hash>/<session-id>.json
~~~

The random session ID is a UUID. A record contains a schema version, ID,
workspace path, ISO-8601 creation and update timestamps, optional provider ID
and display name, optional model ID, Plan or Execute mode, normalized chat
messages, and aggregate usage.

~~~ts
interface StoredSession {
  schemaVersion: 1;
  id: string;
  workspaceRoot: string;
  createdAt: string;
  updatedAt: string;
  providerId?: string;
  providerName?: string;
  modelId?: string;
  mode: 'Plan' | 'Execute';
  messages: ChatMessage[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd?: number;
    costKnown: boolean;
  };
}
~~~

Every record is parsed through Zod. Writes use a same-directory temporary file
and rename. The CLI requests directory and file modes of 0700 and 0600 where
the operating system honours them. Listing skips malformed, unsupported, or
unreadable records; an explicitly requested invalid record reports an
actionable error.

## Usage and cost

AgentRunResult gains an optional aggregate ChatUsage. The agent loop records
the latest valid usage chunk emitted by a provider stream and returns it; it
does not persist data or calculate prices.

The CLI accumulates provider-reported totals in the active session. It must not
estimate tokens from character counts. Before usage exists, it displays Usage
unavailable. Cost is calculated only where model pricing supplies non-negative
prompt and completion prices:

~~~text
cost = promptTokens × promptPrice + completionTokens × completionPrice
~~~

When either usage or pricing is absent, the status line shows Cost unknown.

## Lifecycle

At CLI startup, Moderado loads the latest valid session for the current
workspace and restores messages, selected model label, mode, and displayed
usage. Credentials always come from the active configured provider connection,
never from a session record.

After every completed, failed, cancelled, or step-limited agent run, Moderado
atomically saves the active session. It does not persist an unfinished terminal
prompt or terminal control data.

## Session command family

/session opens a dark-grey popup menu containing the following actions:

| Command | Behaviour |
|---|---|
| /session new | Create a fresh active session and clear in-memory history. The former session remains saved. |
| /session list | List valid sessions for the workspace, newest first, showing timestamp, provider/model label, and a compact preview. |
| /session resume | Open the same list and load the selected session. It never changes provider credentials or auto-switches providers. |
| /session export | After confirmation, write a redacted Markdown transcript to a selected path inside the workspace. It contains timestamps, provider/model labels, user and assistant messages, and tool-result summaries only. |
| /session compact | Preview and confirm deterministic reduction of older conversation history. |

The command forms use normal CLI spacing, not colon or hyphen separators.
/session list and /session resume reuse the same popup list. /clear continues to
clear the active history and saves that cleared state; it does not delete older
sessions.

## Compaction

Compaction is local and deterministic. It does not call a model or spend tokens.

When there are more than four conversational messages, Moderado replaces older
completed turns with one system summary that includes:

- number of messages removed;
- earlier user requests, truncated to 240 characters each;
- earlier assistant outcomes, truncated to 240 characters each;
- tool names and result statuses.

The summary excludes tool payloads, command output, and credentials. The latest
four conversational messages and immediately associated tool results remain
unchanged. With four or fewer conversational messages, compaction reports that
no reduction is needed.

Automatic context-window compaction is excluded until provider context limits
are reliably available.

## UI

Existing popup rendering is reused. Slash-command completion shows one concise
entry:

~~~text
/session  Create, list, resume, export, or compact sessions
~~~

The composer status uses actual provider totals when available:

~~~text
<model>  1,234 tokens / $0.0012
<model>  Usage unavailable / Cost unknown
~~~

## Acceptance criteria

1. A conversation resumes after restarting Moderado in the same workspace.
2. Session writes are atomic, schema-validated, and credential-free.
3. Users can create, list, resume, export, clear, and compact sessions through
   the session command popup.
4. Displayed token totals and cost are based only on provider usage and pricing.
5. Compaction preserves recent context and creates a deterministic redacted
   summary.
6. Existing routing and safety controls remain intact.
7. Offline tests cover persistence, malformed records, export redaction, usage,
   cost calculation, compaction, and command dispatch.

## Exclusions

- Cloud synchronization, sharing, and account login.
- OS keychain credentials, deferred to M5.
- Automatic context-window discovery and automatic compaction.
- Spending caps and budgets.
- Desktop implementation, MCP, and LSP integration.
