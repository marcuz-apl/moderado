# Changelog

## Semantic Version Progression

```text
v0.4.26 (Unified provider connection flow)
  └─► v0.4.28 (Help organization and interrupted-chat resilience)
```

## Milestone Change Log Details

### [Unreleased]
**Feat: Provider shown beside model in composer status row**
- **Type**: `feat`
- **Scope**: `apps/cli` composer status line
- **Key Deliverables**:
  - **Composer status**: The bottom row now shows the active provider before the model as `provider | model`, including after switching connections.
  - **Maximized layout**: The chat view repaints immediately after a terminal resize, keeping the question, answer, and composer centered at wide widths.

### [v0.4.28] — 2026-10-15
**Fix: Organized help navigation and resilient chat recovery**
- **Type**: `feat` / `fix` / `patch-level`
- **Scope**: `apps/cli` help UI, chat session handling, release metadata
- **Key Deliverables**:
  - **Help organization**: Groups slash commands into Configuration, Workspace, Session, and Help sections with consistent ordering across chat output, the popup, and the modal.
  - **Keyboard ergonomics**: Aligns the `Up/Down` shortcut row with the other keyboard shortcuts and documents its slash-completion versus history behavior.
  - **Chat resilience**: Preserves interrupted streamed answers in the outer error path so failed turns can be checkpointed and resumed safely.
  - **Release readiness**: Syncs the publishable package metadata to `0.4.28` and updates the release documentation for the candidate.
