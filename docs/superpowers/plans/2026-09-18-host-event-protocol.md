# Host Event Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Add a versioned host-event envelope for CLI and future desktop consumers.

**Architecture:** Contracts owns schemas; core owns sequencing and session identity; CLI adapts envelopes to its existing renderer. Existing raw event listeners remain compatible.

**Tech Stack:** TypeScript, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-host-event-protocol-design.md`

### Task 1: Contracts

- [ ] Add `HostEventEnvelopeSchema` with protocol version, session ID, sequence, timestamp, and `AgentEvent`.
- [ ] Write failing contracts tests for accepted envelopes and rejected zero sequence or unsupported version.
- [ ] Implement schemas and run the focused tests.

### Task 2: Core host stream

- [ ] Write failing tests for stable session ID and monotonic sequences.
- [ ] Implement `HostEventStream` in `packages/core` with `emit(event)`.
- [ ] Add optional host listener to `AgentRunOptions`, preserving raw event listener behavior.
- [ ] Run core focused tests.

### Task 3: CLI adapter

- [ ] Write a renderer test that forwards `envelope.event` unchanged.
- [ ] Adapt CLI chat composition to create one host stream per session.
- [ ] Run CLI focused tests.

### Task 4: Documentation and validation

- [ ] Document protocol version and desktop-host use in README and roadmap.
- [ ] Run `npm test; npm run build; git diff --check`.
- [ ] Commit with Alfazen versioning.