# Host Event Protocol Design

**Date:** 2026-09-18
**Milestone:** M4.4 — Stable host-event interface

## Goal

Provide a versioned event protocol that lets the CLI and a future desktop host consume the same agent lifecycle without importing each other.

## Design

`packages/contracts` defines `HostEventEnvelopeSchema` with `protocolVersion: 1`, a UUID-like `sessionId`, monotonic positive `sequence`, timestamp, and existing `AgentEvent` payload. Existing event schemas remain unchanged.

`packages/core` adds a small `HostEventStream` that creates a session ID once and exposes `emit(event)`. It increments the sequence before passing a validated envelope to a host listener. `AgentLoop` may use this wrapper when a host listener is supplied; its current event listener remains supported for compatibility.

`apps/cli` adapts envelopes with `renderer.handleEvent(envelope.event)`. It gains no desktop dependency and keeps its current terminal behavior.

## Guarantees

- Protocol version is explicit and validated at the contracts boundary.
- Sequence values start at one and increase once per event within a session.
- A host receives immutable structured events and does not influence tool execution or approvals.
- The core remains independent of concrete desktop or CLI implementations.

## Testing

Offline tests cover envelope validation, stable session identity, monotonic ordering, and CLI adapter forwarding. No desktop runtime is required.

## Exclusions

M4.4 does not add IPC, persistence, event replay storage, WebSockets, a desktop process, or a public plugin API.