# Cross-client shared config coordination

## Status

Proposed design for user review. The CLI's earlier unknown-field preservation
change is present in the worktree, but the concurrency protocol is not
implemented.

## Goal

Let Moderado CLI, IDE, and Desktop safely read and update one per-user
`~/.moderado/config.json` profile, including when writes happen close together.
Independent updates must not erase one another. A stale edit to the same field
must be reported as a conflict instead of silently replacing the newer value.

## Current state

- CLI reads `~/.moderado/config.json`, but its save path does not take a lock.
  It merges from a read that happens before the write, so concurrent updates can
  be lost. Its loader also returns an empty config for malformed JSON.
- IDE reads and writes the same file. Its `config.json.moderado-lock` protocol
  serializes IDE writes, rereads under lock, detects conflicts for fields being
  edited, preserves other fields, and atomically replaces the file.
- Desktop currently stores global provider defaults in its application config
  directory as `provider.json`; session-specific settings are also stored with
  sessions. Provider secrets are held in the OS keychain.

The IDE lock protects only writers that honor it. CLI and Desktop must adopt the
same lock file and compatible ownership/recovery rules for a cross-client
guarantee.

## Design

### Shared write protocol

Use the IDE's existing lock path and semantics as the protocol authority:

1. Acquire `config.json.moderado-lock` exclusively and record the writer PID and
   an unguessable ownership token. Use the existing 5-second wait and the
   separate `.reap` claim for stale-lock recovery.
2. While holding the lock, reread and validate the latest config object. Refuse
   to write if the file is malformed or unreadable.
3. Compare the fields being changed with the values the caller originally
   observed. Return a conflict if any of those fields changed in the meantime.
   Otherwise merge only the caller's patch onto the latest document, retaining
   all unrelated and unknown fields.
4. Write a private temporary sibling file and rename it over `config.json`.
5. Release the lock only if its PID and ownership token still match. Recover a
   stale lock only after verifying the owner process is gone and holding the
   existing exclusive recovery claim; lock age alone is insufficient.

Use the existing bounded lock wait. On timeout or uncertain lock ownership,
fail without writing and give the user a recovery or retry message. Atomic
rename prevents partial JSON; the lock and reread/merge prevent lost updates.

### Client responsibilities

- **CLI:** route every config mutation, including credential migration, through
  the shared protocol. Preserve unknown fields and pass expected values for
  fields edited from a previously loaded view.
- **IDE:** retain its existing coordinated writer and keep its lock record,
  conflict comparison, recovery claim, and atomic replacement compatible with
  the protocol above.
- **Desktop:** use the same shared profile path for global defaults and the same
  lock protocol. Store Desktop's Plan/Act defaults in a `desktop` namespace so
  they do not replace CLI/IDE connection settings. Keep session-specific
  settings with their sessions and secrets in the OS keychain. Read the existing
  `provider.json` as a migration fallback; do not delete it automatically.

### Conflict behavior

Concurrent edits to different fields serialize and merge, preserving both
changes. If two clients edit the same field from stale views, the later save
returns a conflict and leaves the file unchanged; the client can reload and ask
the user to retry. Writers must not silently convert invalid config into an
empty object and overwrite it.

## Boundaries

- The guarantee covers CLI, IDE, and Desktop versions that implement this
  protocol. Other writers that ignore the lock can still race.
- Sharing the profile does not make credentials portable between OS credential
  stores, and does not merge per-session history or settings.
- Existing CLI and IDE connection fields remain compatible. Desktop-specific
  global defaults live in a namespaced field and preserve unrelated fields.

## Review points

- Confirm the Desktop `desktop` namespace is acceptable for its global Plan/Act
  defaults while session-specific settings remain session-scoped.
- Confirm conflict-on-same-field is preferable to last-writer-wins.
- Confirm `provider.json` should remain as a fallback after migration rather
  than being deleted.

## Implementation verification

Add offline coverage for lock contention and cleanup, stale owner recovery,
malformed-config refusal, atomic replacement, unknown-field preservation,
unrelated concurrent patches, same-field conflict reporting, credential
migration, and Desktop legacy-settings fallback. Exercise at least two separate
processes against one temporary profile. Do not use the developer's real
`~/.moderado` profile.
