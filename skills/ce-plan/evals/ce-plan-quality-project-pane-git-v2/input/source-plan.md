# Project Pane Git Support V2

## Goal

Extend the V1 Project pane from read-only Git review into a lightweight Git
workflow for agent-assisted development: stage, commit, inspect branch history,
push, and prepare pull requests without leaving Poolside Studio.

## Context

V1 makes code changes visible. V2 should make routine Git work possible while
preserving safety. Users should be able to review what an agent changed, split
changes into sensible commits, and move toward a pull request from the same app
surface.

This plan depends on the V1 Project pane and read-only Git APIs described in:

- `docs/plans/project-pane-git-v1.md`
- `research/git-workflow-viewer-brainstorm-2026-05-21.md`

Relevant existing systems:

- Local app-bridge Git/GitHub CLI tools:
  - `electron/mcp/domains/git.ts`
  - `electron/mcp/domains/observability.ts`
  - `electron/lib/gh-cli.ts`
- Agent-loop and PR workflow docs:
  - `docs/workflows/agent-dev-loop.md`
  - `docs/app-bridge-mcp.md`

## Product Scope

V2 turns Project > Changes into a controlled Git workflow surface.

V2 should support:

- Stage and unstage files.
- Stage and unstage hunks.
- Commit staged changes.
- Show branch and upstream relationship.
- Show local commits on the current branch.
- Push the current branch when safe.
- Hand off toward PR creation when GitHub CLI or connector auth is available.

V2 should still avoid advanced Git workflows unless there is a clear safety and
UX model:

- Rebases.
- Interactive rebase.
- Cherry-pick.
- Reset.
- Force push.
- Complex merge conflict resolution.
- Multi-repository staging.

V2 is not one release-sized change. It should land as small vertical slices
that each preserve a coherent Git state after every action.

## Readiness Criteria From V1

Do not start V2 mutations until V1 has:

- Typed Git status and diff APIs with fixture coverage.
- A stable Project pane mode controller.
- Clear handling for non-git, clean, dirty, binary, large-diff, renamed, and
  deleted states.
- A parsed diff display model that can identify selected files and hunks.
- Refresh behavior that does not lose the user's selected file unexpectedly.
- A decision on whether commit composition can fit in the right pane.

## UX Contract

### Changes Mode Evolves Into A Git Workflow

The Project pane remains the surface. Changes mode gains action zones:

1. Working tree
   - Unstaged changes.
   - Staged changes.
   - Untracked files.
2. Diff preview
   - Same unified diff base from V1.
   - Adds stage/unstage controls at file and hunk level.
3. Commit panel
   - Commit summary input.
   - Optional description input.
   - Commit staged button.
   - AI-assisted message generation as a later V2 sub-slice if local agent
     context and staged diff are available.
4. Branch panel
   - Current branch.
   - Upstream.
   - Ahead/behind.
   - Local commits since upstream or base.
   - Push readiness.
5. PR affordance
   - After push, offer to create/open PR if GitHub support is configured.

### Safety Model

Mutating actions should be explicit, scoped, and recoverable.

- Stage/unstage file: no confirmation, because it does not lose content.
- Stage/unstage hunk: no confirmation, but show immediate visible result.
- Commit: requires non-empty commit summary and staged changes.
- Revert/discard: not required for first V2 slice. When added, always confirm
  with affected files/hunks listed.
- Branch switch: blocked or strongly warned when the worktree is dirty.
- Push: confirm when upstream is missing, branch name differs from upstream, or
  remote divergence exists.
- Force push/reset/rebase: out of scope.

Safety rules:

- Every mutation refreshes Git status before and after the command when cheap.
- If pre-command status differs from the UI's expected status, pause and ask the
  user to refresh rather than applying a stale action.
- Destructive actions need an explicit confirmation surface with affected paths.
- Do not silently discard user work to make branch switching, pull, or push
  succeed.
- Do not bypass Git hooks for commits.
- Do not hide command failures. Convert common failures into product states, but
  keep stderr available in a disclosure when useful.

### Commit Flow

Suggested workflow:

1. User reviews unstaged changes.
2. User stages selected files/hunks.
3. Staged group updates immediately.
4. Commit panel becomes enabled.
5. User writes summary or asks for a generated draft.
6. User commits.
7. The pane refreshes:
   - Working tree may be clean or still dirty.
   - Local commits list includes the new commit.
   - Push affordance updates if branch is ahead.

Commit panel placement options:

- Inline in right pane: fastest workflow, but pane width may make message
  composition cramped.
- Bottom drawer inside Project pane: preserves context and gives the message
  more room.
- Modal/sheet: best for longer descriptions, but interrupts chat/diff context.

Mocks should test these before implementation.

### Branch/History Flow

- Show current branch in the Project pane header or Changes toolbar.
- Show upstream and ahead/behind when available.
- Show local commits not yet pushed.
- Let users inspect commit diff in read-only mode.
- Do not implement branch switching until stage/commit/push behavior is stable.

Branch history should distinguish:

- uncommitted working tree changes
- staged changes
- committed local changes not yet pushed
- remote changes not yet integrated

Those are four different states and should not be collapsed into one "changed"
badge.

## Technical Plan

### 1. Promote Git API From Read-Only To Read/Write

Build on V1's typed Git API.

Add mutations with narrow inputs:

```ts
type DesktopGitMutationResult =
  | { status: "ok"; statusAfter: DesktopGitStatusResult }
  | { status: "conflict"; message: string; statusAfter: DesktopGitStatusResult }
  | { status: "error"; message: string };

type DesktopGitCommitResult =
  | {
      status: "ok";
      commit: { sha: string; subject: string };
      statusAfter: DesktopGitStatusResult;
    }
  | { status: "nothing-staged"; statusAfter: DesktopGitStatusResult }
  | { status: "error"; message: string };
```

Candidate operations:

- `stageFiles(workspaceRoot, paths)`
- `unstageFiles(workspaceRoot, paths)`
- `stagePatch(workspaceRoot, patch)`
- `unstagePatch(workspaceRoot, patch)`
- `commit(workspaceRoot, summary, description?)`
- `getBranchSummary(workspaceRoot, base?)`
- `getLocalCommits(workspaceRoot, upstreamOrBase?)`
- `push(workspaceRoot, options)`

All operations must:

- Use `execFile`, not shell interpolation.
- Validate paths stay inside the selected workspace.
- Validate inputs with typed guards or Zod at IPC boundaries.
- Return structured states rather than raw command stderr when possible.
- Refresh status after mutation.
- Include an expected-status token or generation where stale UI actions can be
  dangerous.
- Be designed for future command audit logging without logging patch contents.

Mutation state should be represented explicitly in the controller:

```ts
type GitMutationState =
  | { status: "idle" }
  | { status: "running"; operation: string; paths: string[] }
  | { status: "success"; operation: string; message: string }
  | { status: "blocked"; operation: string; message: string }
  | { status: "failed"; operation: string; message: string };
```

### 2. Stage/Unstage Files

Commands:

- Stage tracked/untracked paths: `git add -- <paths>`
- Unstage paths: `git restore --staged -- <paths>`

Considerations:

- `git add` on deleted tracked files should stage deletion.
- For ignored untracked files, show a clear error if Git refuses.
- For paths under nested repos, block or route to nested repo only after explicit
  support exists.
- File rows should expose one primary action based on group:
  - unstaged/untracked: Stage file
  - staged: Unstage file
- Multi-select staging can wait until single-file staging is reliable.

### 3. Hunk Staging

Prefer patch application over interactive `git add -p`.

Commands:

- Stage hunk: generate a minimal patch and run `git apply --cached --unidiff-zero`
  or safer equivalent after validation.
- Unstage hunk: apply reverse/working-index patch carefully, or defer hunk
  unstaging until file-level staging is stable.

Risks:

- Patch context can go stale after file edits.
- Overlapping staged/unstaged changes in the same file are tricky.
- Whitespace and CRLF handling can surprise users.

Recommendation:

- V2.1: file-level stage/unstage.
- V2.2: hunk-level stage.
- V2.3: hunk-level unstage only after fixtures cover partial-index states.

Additional hunk requirements:

- Hunk actions must be disabled when the file has changed since the diff was
  loaded.
- Hunk actions need fixtures for CRLF files, whitespace-only changes, adjacent
  hunks, and overlapping staged/unstaged hunks.
- If hunk staging fails because context is stale, refresh and keep the user's
  file selected.

### 4. Commit

Commands:

- `git commit -m <summary>` plus optional `-m <description>`.

Rules:

- Refuse empty summary.
- Refuse when no staged changes exist.
- Surface Git hook failures in a readable error state.
- After commit, refresh status and branch summary.
- Do not bypass hooks.

Potential AI assist:

- Generate commit message from staged diff.
- Use current chat context only as supplemental context; staged diff is source
  of truth.
- User must explicitly accept/edit generated message before commit.

Commit result states:

- `nothing-staged`: staged group is empty.
- `hook-failed`: Git hook rejected the commit.
- `identity-missing`: Git author identity is not configured.
- `conflict`: repository is in a merge/rebase/cherry-pick state that should not
  be handled by the simple commit flow.
- `ok`: commit created and status refreshed.

### 5. Branch Summary And Local Commits

Commands:

- `git branch --show-current`
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}`
- `git rev-list --left-right --count @{u}...HEAD`
- `git log --oneline --no-decorate @{u}..HEAD`
- Fallback to base branch when upstream does not exist.

Show:

- current branch
- upstream or "no upstream"
- ahead/behind
- local commits to push
- dirty/clean state
- detached HEAD and unborn branch states
- current operation state if Git reports merge/rebase/cherry-pick in progress

Branch summary should be read-only at first. Branch switching/creation can be a
separate V2 slice because it interacts with dirty worktrees and worktree
identity.

### 6. Push

Commands:

- Existing upstream: `git push`
- Missing upstream: `git push -u origin <branch>` after explicit confirmation.

Rules:

- Do not force push in V2.
- If branch is behind upstream, block and explain that pull/rebase/merge is
  needed outside this flow.
- If no remote exists, show no-push-remote state.
- If auth fails, surface Git stderr and suggest terminal/GitHub setup.
- If pre-push hooks or remote rejects fail, keep local commits intact and show a
  retryable error.
- If the branch has no upstream, show exactly which remote/branch will be used
  before running `git push -u`.

### 7. PR Handoff

Options:

- Use local `gh` CLI via existing `electron/lib/gh-cli.ts` patterns.
- Use the hosted GitHub connector for remote PR operations if product direction
  prefers connector auth.

Recommendation:

- First PR slice should be "Open/create PR via local GitHub CLI" only when
  `gh` is installed/authenticated.
- Keep this separate from GitHub remote connector auth until the product decides
  whether user-facing GitHub actions should share connector auth or local CLI
  auth.

PR handoff states:

- `not-github-remote`: no GitHub remote detected.
- `gh-missing`: local GitHub CLI not installed.
- `gh-unauthenticated`: local GitHub CLI installed but not authenticated.
- `ready`: branch pushed and PR can be created/opened.
- `existing-pr`: open existing PR instead of creating a duplicate.

### 8. Last Turn / Agent Edits Lens

After Git workflow basics are stable, add a separate lens:

- Last turn: files changed between prompt start and prompt finish.
- Agent edits: files touched by write/edit tool calls across the session.

Rules:

- Do not confuse these with Git changes.
- Label them as activity/history, not source-control truth.
- Store enough metadata during turns to survive session reload if this becomes
  product-critical.

Potential data sources:

- Prompt lifecycle snapshots from `src/lib/chat/turns/turn.ts`.
- Tool-call events with file paths and edit/write operations.
- Git diff before/after a turn for Git-backed projects.

The lens should answer "what did the agent touch?" while Changes answers "what
does Git see now?"

### 9. Destructive Actions

Destructive actions should be late V2, not part of initial mutation work.

Possible actions:

- Discard unstaged file changes.
- Discard selected hunk.
- Remove untracked file.

Rules:

- Always confirm.
- Show affected paths/hunks.
- Prefer moving recoverable content to Trash where feasible for untracked files.
- For tracked changes, explain that Git will restore the previous version and
  local edits may be lost.
- Never combine discard with stage/commit in a single ambiguous action.

### 10. Conflict And In-Progress Operation Awareness

V2 does not need a merge conflict editor, but it must recognize states that make
simple Git operations unsafe:

- merge in progress
- rebase in progress
- cherry-pick/revert in progress
- conflicted index entries

The pane should show a blocked state and let users inspect files, but advanced
resolution can remain out of scope.

## Suggested V2 Slices

- [ ] V2.1 — File-level staging.
  - Stage/unstage whole files.
  - Refresh staged/unstaged groups.
  - Unit tests for tracked, untracked, deleted, and ignored files.
  - Block stale file actions when status generation changed.
- [ ] V2.2 — Commit staged changes.
  - Commit panel.
  - Hook failure handling.
  - Local commit list refresh.
  - Identity-missing and conflict-state errors.
- [ ] V2.3 — Branch summary and push readiness.
  - Upstream, ahead/behind, local commits.
  - Push only for straightforward ahead-only branches.
  - No-upstream confirmation.
- [ ] V2.4 — PR handoff.
  - GitHub CLI readiness.
  - Create/open PR affordance after push.
  - Existing PR detection.
- [ ] V2.5 — Hunk-level staging.
  - Stage hunks.
  - Then unstage hunks after partial-index fixtures are strong.
  - Stale patch refresh behavior.
- [ ] V2.6 — Destructive actions.
  - Revert file/hunk with confirmation and clear recovery messaging.
- [ ] V2.7 — Branch creation/switching.
  - Create branch.
  - Switch branch only with clean worktree or explicit dirty-worktree handling.
- [ ] V2.8 — Agent activity lens.
  - Last turn.
  - Agent edits.

## Decision Log

**2026-05-21**: V2 is planned separately from V1 because Git mutations require
a stricter safety model and much broader test coverage than read-only review.

**2026-05-21**: V2 should start with file-level staging before hunk-level
staging because partial index behavior is easy to get wrong and can confuse
users when staged and unstaged edits overlap in one file.

**2026-05-21**: Commit creation should use staged diff as source of truth. Chat
context and AI-generated summaries can help draft messages, but the user must
accept the final commit message explicitly.

## Verification

- [ ] `pnpm lint` exits 0.
- [ ] `pnpm verify:quick` exits 0.
- [ ] Git mutation API tests run against fixture repos and cover:
  - file stage/unstage
  - untracked file stage
  - deleted file stage
  - no staged changes commit refusal
  - successful commit
  - hook failure
  - upstream ahead/behind
  - no upstream push path
  - push rejection when behind
  - stale status generation
  - detached HEAD
  - unborn branch
  - merge/rebase in-progress blocked states
  - missing Git identity
  - paths with spaces/unicode
- [ ] UI tests cover:
  - staged/unstaged group movement after file actions
  - disabled commit button with no staged changes
  - commit success and failure states
  - push readiness states
  - confirmation dialogs for any destructive action added
  - stale action blocked state
  - local commits list after successful commit
- [ ] Manual desktop smoke:
  - Stage file.
  - Unstage file.
  - Commit staged changes.
  - Push a branch with upstream.
  - Create/open PR only when configured.

## Non-Goals

- Force push.
- Rebase.
- Reset.
- Interactive rebase.
- Cherry-pick.
- Full merge conflict editor.
- Multi-root Git aggregation.
- Replacing external IDEs for complex source-control workflows.

## Open Questions

- Should commit and push live in the right Project pane, or should the pane open
  a larger modal/sheet for commit composition?
- Should PR creation use local `gh`, hosted GitHub connector auth, or both?
- How much AI assistance belongs in V2: commit message only, review summary, or
  suggested staging groups?
- Should branch switching ever be in the Project pane, or should it live in a
  separate project/worktree control?
- How should V2 communicate recovery for destructive actions on macOS, Windows,
  and Linux?
