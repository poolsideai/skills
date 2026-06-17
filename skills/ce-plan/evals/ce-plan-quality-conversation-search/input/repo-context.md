# Poolside Studio repo context for ce-plan evaluation

This is a synthetic local context summary for the eval case. Use these repo-relative
path families when proposing implementation units and tests; do not invent absolute
paths.

Relevant path hints:
- `src/features/search/` for search-related implementation
- `src/features/conversation/` for conversation-related implementation
- `src/features/chat/` for chat-related implementation
- `src/features/store/` for store-related implementation

General conventions:
- UI implementation lives under `src/` and feature-specific subdirectories.
- Tests should be repo-relative and may use `src/**/*.test.ts`, `tests/**/*.test.ts`, or Playwright-style UI tests when appropriate.
- Plans should separate implementation, tests, rollout, and risks.
- The grading artifact must cite `input/source-plan.md` and `input/repo-context.md` in `evidence_sources`.
