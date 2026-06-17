## Worktree-Only UI-Mutation Safety Warnings

### Summary

Tighten Poolside Studio’s agent-control guidance so UI-mutating CDP/Playwright actions are treated as safe **only** on isolated worktree instances. This pass does **not** hard-block anything; it updates agent-facing docs/prompts and adds explicit warnings in launcher/runtime/health output so another Codex session does not infer that “raw shell CDP clicks” are an acceptable default on shared or repo-root instances.

### Key Changes

#### 1. Lock the policy in agent-facing guidance

- Update `AGENTS.md`, `README.md`, `docs/agent-control.md`, and `.agents/skills/agent-control/SKILL.md` to state:
  - `pnpm robot` session/runtime tooling is read-only and safe to retry.
  - CDP/Playwright actions that click/type are UI-mutating.
  - UI mutation is allowed by default only on a **worktree** instance launched for that task.
  - Repo-root `pnpm dev:agent` remains valid for inspection, smoke checks, and read-side debugging, but is read-only by default for UI mutation.
- Replace wording that currently advertises generic “live clicks” with wording that ties clicks to isolated worktree launches.
- Add an explicit “do not synthesize shell-level CDP click scripts against discovered/shared instances” warning in the agent-control skill and the bug-repro workflow.

#### 2. Add runtime/health warnings that make the policy actionable

- Extend `get_runtime_status` so its structured payload includes a new `uiMutationSafety` object:
  - `policy: "worktree_only"`
  - `mode: "allowed" | "read_only"`
  - `reason: string`
  - `guidance: string`
- Derive `mode` as:
  - `allowed` only when `instanceKind === "worktree"` and the resolved/requesting workspace matches `instanceRoot`
  - `read_only` for repo instances, missing workspace context, or workspace mismatch
- Change the human-readable `get_runtime_status` summary text so `pnpm robot runtime` immediately says whether UI mutation is allowed or read-only and why.
- Thread the same `uiMutationSafety` object into `get_turn_health_summary.runtime`, and add an `infoItems` warning when the mode is `read_only`. Keep this as info, not attention, so overall health semantics stay about build/test/runtime failure.

#### 3. Add a launch-time warning where the agent actually starts work

- Update `scripts/dev-agent.mjs` startup output:
  - For repo-root launches, print a clear warning that under the worktree-only policy this instance is read-only for UI-mutating automation and recommend `pnpm dev:worktree -- <worktree-path>` or running `pnpm dev:agent` inside a git worktree.
  - For worktree launches, print a short positive confirmation that this is the intended isolated surface for UI-mutating automation.
- Do not add prompts, interactivity, or blocking behavior in this pass.

#### 4. Keep the public tool inventory in sync

- Update `docs/app-bridge-mcp.md` and `electron/mcp/tool-catalog.ts` so `get_runtime_status` / `get_turn_health_summary` describe the new UI-mutation safety guidance instead of only generic runtime metadata.

### Public API / Interface Changes

- `get_runtime_status` gains `uiMutationSafety`.
- `get_turn_health_summary.runtime` gains the same `uiMutationSafety`.
- No new robot commands, no new MCP tools, and no hard enforcement/permission prompt in this pass.

### Test Plan

- Add/extend MCP tests for `get_runtime_status`:
  - worktree instance + matching requester workspace => `uiMutationSafety.mode === "allowed"`
  - repo instance => `uiMutationSafety.mode === "read_only"` with worktree guidance
  - worktree instance + requester/workspace mismatch => `uiMutationSafety.mode === "read_only"`
- Extend `get_turn_health_summary` tests:
  - allowed worktree case includes no safety warning
  - repo/mismatch case includes the new read-only guidance in `infoItems`
- Verify launcher messaging manually:
  - `pnpm dev:agent` from repo root prints the read-only warning
  - `pnpm dev:agent` inside a worktree prints the isolated/safe message
- Verify the updated docs/skill consistently state the same worktree-only rule.

### Assumptions

- “Safe by default” means `instanceKind === "worktree"` **and** the runtime instance matches the requested workspace.
- Repo-root `pnpm dev:agent` is still supported, but the repo will document and warn that it is read-only by default for UI mutation.
- Explicit operator-approved exceptions remain manual; this pass does not try to model or detect them automatically.
