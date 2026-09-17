# Project Handoff

Updated: 2026-09-17 14:55 UTC  
Branch: master  
Version: v0.1.2+2609171  
Status: complete  

## Summary

Delivered critical usability and agent behavioral fixes:
- **Intercepted Unsolicited README Writes**: Fixed prompt phrasing in `DEFAULT_SYSTEM_PROMPT` to remove negative priming on README.md, and added an active guard in `AgentLoop` to intercept and reject unrequested documentation/README creation before triggering the human approval boundary.
- **OpenCode-Style Interactive Model Selection**: Introduced `selectModelInteractive` allowing users to seamlessly browse and switch between **Free Models** and **Paid Models** discovered live from NVIDIA NIM, defaulting to top-capacity reasoning models (`nvidia/llama-3.1-nemotron-70b-instruct`, `meta/llama-3.3-70b-instruct`).
- **Main Menu Integration & Persistence**: Added a top-level `Select Model (Free or Paid)` option to `moderado` interactive menu, displaying the currently configured model and saving choices to `~/.moderado/config.json`.
- **Expanded Model Classifications**: Added verified catalog items (`nemotron-70b`, `llama-3.3-70b`, `mistral-large-2`, `deepseek-coder`, `codestral`, `codegemma`, `granite`) with capacity ranking in `Router`.
- **100% Offline Test Coverage**: 91 unit and integration tests passing offline across 18 test suites in ~1.8s.

## Completed

- `packages/core/src/agent.ts`: Eliminated negative README priming from system prompt; added unsolicited README guard in loop.
- `packages/core/src/router.ts`: Updated builtin classifications and capacity scoring preference for 70B models.
- `apps/cli/src/ui/model_selector.ts`: Created OpenCode-style categorized model selection component (Free Trial vs Paid).
- `apps/cli/src/commands/interactive_menu.ts`: Added direct model selection menu option with active model display.
- `apps/cli/src/commands/run.ts`: Integrated model selector to seamlessly prompt and configure model and paid access.
- `apps/cli/src/commands/models.ts`: Added interactive model selection prompt after catalog display.
- `packages/core/tests/agent.test.ts`: Added tests verifying unprompted README write interception and explicit README creation.
- `apps/cli/tests/model_selection.test.ts`: Added unit tests for model selection and config persistence.

## Checks

- `npm run build` (`tsc -b`): Clean compilation across all workspaces.
- `npm test` (`vitest run`): 91 tests passed across 18 test suites offline in 1.83s.

## Decisions and context

- Ponytail engineering: Zero new runtime dependencies; built on standard library and existing `@moderado/*` contracts.
- Safety: Explicit user requests for README files still pass through to the approval boundary; only unprompted writes are intercepted.

## Blockers

- None.

## Next action

1. Commit and push the changes: `git add . && git commit -m "v0.1.2+2609171 feat: add OpenCode-style model selection and intercept unsolicited README writes"`.

