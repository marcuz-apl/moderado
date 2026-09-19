# Trustworthy Model Responses Design

**Milestone:** M1 — Trustworthy model responses

## Goal

Never present a provider call as successful when it yields no usable assistant
answer, and make model-routing failures understandable without tying messages to
one provider.

## Response validation

The core agent treats an empty final assistant message as a provider failure.
It emits a structured error event containing the active provider and model, then
allows the router to try another eligible AUTO candidate. A pinned model reports
the failure directly because selecting another model would violate the user's
explicit choice.

## Capability-aware requests

Provider model metadata records whether a model supports chat and tool calls.
The agent sends tool declarations only when the requested task needs tools and
the selected model supports them. Conversational requests may use compatible
chat-only models without tool declarations.

## AUTO fallback

AUTO routing retries only eligible alternatives after unavailable, rate-limited,
malformed, or empty responses. It preserves the free-first ranking and records
the fallback model in emitted events. Paid and unknown models remain excluded
unless the user enabled their existing routing options.

## User-facing diagnostics

Provider and model names appear in failures. Duration uses a monotonic start and
end measurement, displayed with sub-second precision where relevant. No raw
provider credentials, request headers, or response bodies are rendered.

## Acceptance criteria

- Empty completions fail visibly and cannot be reported as successful answers.
- Chat-only models receive ordinary questions without unnecessary tools.
- AUTO retry and fallback report the selected replacement model.
- Pinned models do not silently switch.
- Offline tests cover empty output, tool capability filtering, fallback, and
  provider-neutral error wording.

## Exclusions

This milestone does not add new providers, pricing rules, or persistence.
