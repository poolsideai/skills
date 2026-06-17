# Implementation Plan: Chat Startup Performance

## Goal

Cut perceived chat-switch latency without destabilizing ACP runtime behavior. The
first pass should make existing history visible immediately, remove obvious
blocking work from the hot path, and eliminate replay-time CPU churn before we
attempt higher-risk runtime lifecycle changes.

## Context

This plan translates the findings in
`.notes/investigations/chat-startup-performance-2026-04-08.md` into an ordered
execution plan.

The investigation correctly identified a slow `loadSession()` waterfall, but the
final priority order is intentionally different:

1. **Fix the blank-screen UX first** by showing the persisted transcript during
   session switches.
2. **Remove replay-time transcript snapshot churn** because it is the clearest
   avoidable CPU cost in long conversations.
3. **Move nonessential refresh work off the blocking path** so reconnects do not
   wait on sidebar and workspace-artifact updates.
4. **Only then revisit runtime restart behavior** with instrumentation and a
   feature flag, because that change carries the highest correctness risk.

Phases 1B and 1C are both small enough to land in the same wave, but if they
must be sequenced, replay snapshot churn should be treated as the preferred
second landing because it removes the most obvious replay-path waste.

The investigation note remains the evidence log. This document is the
implementation guide.

## Success Criteria

- Switching to a chat with persisted transcript history renders visible content
  immediately instead of a full-screen "Loading conversation…" placeholder.
- `connect()` and `loadSession()` no longer block on sidebar refreshes or
  workspace artifact scans that are not required to paint the selected chat.
- Replay no longer serializes the full transcript snapshot on every update.
- Long or tool-heavy chats show lower CPU cost when switching back to them.
- Runtime restart behavior remains correct for launch-selection changes, and any
  cwd-based restart change is gated by explicit measurement and validation.

## Non-Goals

- Re-architecting the entire ACP runtime model in the first pass.
- Shipping transcript virtualization unless the earlier phases still leave the
  UX outside the target budget.
- Changing Pool/Goose/Hermes launch semantics without dedicated validation.

## Ordered Plan

### Phase 1 — Safe hot-path wins

Goal: improve perceived latency and remove obvious blocking work without changing
runtime ownership semantics.

#### 1A. Keep the persisted transcript visible during session switches

**Why first:** This is the highest-leverage, lowest-risk UX improvement. Users
care most about seeing their conversation immediately, even if replay is still
catching up in the background.

**Files:**

- `src/lib/acp/session-repository.svelte.ts`
- `src/features/chat/components/chat-transcript.svelte`
- `src/app/app-shell.svelte` (only if loading affordances need shell-level copy
  or state changes)
- `tests/acp/session-repository.test.ts`
- `tests/ui/chat-transcript.test.ts`

**Changes:**

- Update `prepareForLoadedSession()` so it restores `loadedTranscriptSnapshot`
  into the materializer when available instead of resetting to an empty
  transcript.
- Preserve `hasProvisionalRestoredHistory = true` until replay-bearing ACP
  events arrive, then let the existing replay-reset path replace provisional
  history with authoritative events.
- Update `chat-transcript.svelte` so the full-screen loading placeholder only
  appears when `isSwitchingSession && events.length === 0`.
- Replace the full blank state with a lighter inline sync affordance when
  provisional history is already on screen.

**Trade-offs:**

- Users may briefly see slightly stale persisted history before replay catches
  up.
- That is acceptable because it is materially better than a blank screen.
- We must keep the provisional-to-authoritative handoff crisp so replay does not
  duplicate or flicker content.

#### 1B. Stop replay-time transcript snapshot churn

**Why now:** The current replay path does full visible-event rebuilding and full
JSON serialization on every update. That is the clearest avoidable CPU cost.

**Files:**

- `src/lib/acp/session-repository.svelte.ts`
- `src/lib/acp/conversation-persistence.ts`
- `tests/acp/session-repository.test.ts`
- `tests/acp/conversation-persistence.test.ts`

**Changes:**

- Suppress transcript snapshot writes during historical replay instead of
  persisting on every replay-bearing update.
- Flush once at session-load completion, and keep explicit immediate flushes at
  stable lifecycle boundaries such as prompt completion and cancellation.
- If a timer-based debounce is still needed for live (non-historical) updates,
  keep it narrowly scoped and document why it is safe.
- Add a cheap transcript fingerprint or shape check in
  `recordTranscriptSnapshot()` so unchanged snapshots do not pay a full
  `JSON.stringify(previous) === JSON.stringify(next)` cost on every call.
- Log replay update counts and snapshot flush counts at debug level so we can
  confirm the churn is actually reduced.

**Trade-offs:**

- Persisted transcript metadata can be slightly behind the very latest replay
  event while replay is still in flight.
- Explicit flushes at stable boundaries keep recovery correctness intact while
  still removing the worst hot-path churn.

#### 1C. Move nonessential refresh work off the blocking path

**Why now:** These calls are clearly not required to paint the selected chat,
so the latency savings are low-risk and immediate.

**Files:**

- `src/lib/acp/session-repository.svelte.ts`
- `src/lib/acp/workspace-service.ts`
- `tests/acp/session-repository.test.ts`
- `tests/acp/workspace-service.test.ts`

**Changes:**

- Change `connect()` so it schedules `refreshSessions()` in the background
  rather than awaiting it.
- Change `loadSession()` so `refreshWorkspaceArtifacts()` runs in the background
  rather than blocking the selected chat.
- Make stale-result protection mandatory: background refreshes must carry a
  generation/session ownership guard so late A→B→A completions cannot overwrite
  newer sidebar or artifact state.
- Add single-flight or coalescing protection so repeated switches do not queue
  duplicate sidebar or artifact refresh work.
- If artifact scanning remains expensive even after backgrounding it, prune
  hidden directories earlier in the traversal path rather than filtering only
  after `listFiles()` returns.

**Trade-offs:**

- Sidebar timestamps/titles and artifact panes can lag slightly behind the main
  transcript paint.
- Background refreshes need both deduping and stale-result guards so rapid chat
  switches do not create extra work or apply out-of-date results.

#### 1D. Remove obvious duplicate load-path work

**Why now:** The investigation surfaced likely duplicate persistence and
app-bridge sync work in the same hot path.

**Files:**

- `src/lib/acp/session-repository.svelte.ts`
- `tests/acp/session-repository.test.ts`

**Changes:**

- Verify whether the early `persistWorkspaceMetadata()` write is redundant with
  the later conversation save path; remove it only if the later save still
  preserves workspace-recency behavior when `loadSession()` fails mid-flight.
- Verify whether `persistLoadedConversationMetadata()` already performs the
  necessary app-bridge sync; if so, remove the immediate follow-up
  `syncAppBridgeSession()` call.
- Preserve ordering only where a later step truly depends on the earlier side
  effect.

**Trade-offs:**

- These removals are small, but they can expose hidden ordering dependencies.
- Keep them in the same phase as the other safe wins, but verify behavior with
  targeted repository tests before treating them as free cleanup.

#### 1E. Add enough instrumentation to judge later phases

**Why in Phase 1:** We do not need to block the first safe wins on a big perf
framework, but we do need enough data to decide whether runtime restart work is
still justified afterward.

**Files:**

- `src/lib/acp/session-repository.svelte.ts`
- optionally `src/lib/acp/connection-lifecycle.ts` if reconnect reason logging
  needs to be more explicit

**Changes:**

- Extend existing load-path timing logs to break out: persisted-state restore,
  skill sync, connect/reconnect, session/load replay, metadata persistence,
  app-bridge sync, workspace artifact refresh scheduling, and sidebar refresh
  scheduling.
- Log reconnect reasons separately for launch-selection drift vs cwd drift.
- Keep this instrumentation at debug/info levels already consistent with the
  repo's structured logging rules.

**Trade-offs:**

- More logs can add noise, so keep the fields structured and avoid chatty
  per-event logging outside the replay counters we explicitly need.

### Phase 2 — Renderer and projection cleanup

Goal: reduce the cost of rendering long or tool-heavy transcripts after the
worst blocking-path issues are fixed.

#### 2A. Cache markdown rendering

**Files:**

- `src/lib/utils/markdown.ts`
- `tests/ui/markdown.test.ts`
- optionally `tests/ui/chat-message.test.ts` if rendered output needs extra
  coverage

**Changes:**

- Add a bounded LRU cache keyed by raw markdown input.
- Reuse cached sanitized HTML for repeated transcript content.
- Keep the cache small and deterministic so memory does not grow without bound.

**Trade-offs:**

- This adds cache invalidation complexity and bounded memory overhead.
- The trade is worth it because many transcript switches revisit identical
  content.

#### 2B. Lazy-mount collapsed work and tool details

**Files:**

- `src/features/chat/components/chat-work-summary.svelte`
- `src/features/chat/components/tool-call-block.svelte`
- `tests/ui/tool-call-display.test.ts`
- optionally `tests/ui/chat-transcript.test.ts`

**Changes:**

- Only render the body of collapsed `<details>` sections when they are opened.
- Keep summary labels and counts cheap to render while deferring nested
  `ChatMessage` and tool output blocks.

**Trade-offs:**

- Expanding a collapsed block becomes slightly more expensive at interaction
  time.
- That is acceptable because the current problem is first paint during session
  switching, not details expansion.

#### 2C. Reduce repeated transcript scans and cloning

**Files:**

- `src/features/chat/components/chat-transcript.svelte`
- `src/features/chat/transcript-items.ts`
- `src/lib/acp/session-repository.svelte.ts`
- `src/lib/acp/session-state-store.ts`
- `tests/ui/transcript-items.test.ts`
- `tests/ui/chat-transcript.test.ts`

**Changes:**

- Avoid repeated O(n) scans in `shouldShowMessageHeader()` and
  `isStreamingThought()` when rendering each transcript item.
- Add cached visible-event or transcript-item projections keyed by a materializer
  version / attachment-metadata fingerprint so idle rerenders do not repeatedly
  clone the full event list.
- Keep the invalidation rules explicit so we do not trade speed for stale UI.

**Trade-offs:**

- Projection caching is more subtle than markdown caching because invalidation
  depends on both event history and attachment remapping.
- This phase should follow the simpler hot-path wins so we can tell whether it
  is still needed.

### Phase 3 — Re-measure and then test runtime restart changes

Goal: only touch runtime lifecycle behavior if the safer changes still leave the
app outside the target budget.

#### 3A. Re-measure after Phases 1-2

**Scenarios to measure:**

- same-workspace chat switch
- different-workspace chat switch
- long transcript with many replay updates
- tool-heavy transcript with multiple collapsed work sections

**What to capture:**

- time to first visible transcript paint
- total `loadSession()` duration
- replay update count
- transcript snapshot flush count
- reconnect reason and duration

#### 3B. Feature-flag a cwd-drift restart experiment

**Files:**

- `src/lib/acp/session-repository.svelte.ts`
- `src/lib/acp/connection-lifecycle.ts`
- potentially `electron/acp/runtime-manager.ts` if status/reporting changes are
  needed
- `tests/acp/session-repository.test.ts`
- `tests/acp/runtime.test.ts`

**Changes:**

- Test whether `conn.loadSession({ sessionId, cwd })` can safely switch
  workspaces without tearing down the runtime when the launch-selection key is
  otherwise unchanged.
- Keep launch-selection-key restarts in place unless proven independently safe;
  they represent a different class of configuration drift.
- Put cwd-restart suppression behind a feature flag or guarded code path until
  we have confidence that file callbacks, MCP server lists, app-bridge session
  state, and permission flows all remain correct.

**Trade-offs:**

- This could remove the biggest remaining actual latency source.
- It also carries the biggest correctness risk: stale cwd assumptions,
  cross-workspace tool access, mismatched MCP/app-bridge session state, or
  subtle reconnect bugs.
- That is why it is deliberately not Phase 1.

#### 3C. Decide whether a runtime-pool follow-up is necessary

If cwd-restart suppression is unsafe or insufficient, decide whether the right
follow-up is a keyed runtime pool / per-chat runtime architecture rather than
further tweaking the current single-runtime model.

**Related doc:** `docs/plans/per-chat-runtime-isolation.md`

**Trade-offs:**

- A runtime pool can eliminate repeated stop/spawn churn.
- It is a substantially larger lifecycle and resource-management change, so it
  should only happen with clear evidence that the cheaper fixes are not enough.

### Phase 4 — Only-if-needed structural work

These are valid options, but they should stay out of the first pass unless the
previous phases still leave the transcript experience outside the target budget.

#### 4A. Transcript virtualization

- Useful if transcript length, not switch orchestration, remains the dominant
  cost after earlier fixes.
- Higher implementation and correctness complexity than the earlier renderer
  wins.

#### 4B. Full runtime-pool or per-chat runtime architecture

- Useful if different-workspace switches remain dominated by runtime lifecycle
  work after experimentation.
- Should reuse the design thinking already captured in
  `docs/plans/per-chat-runtime-isolation.md` instead of inventing a new
  architecture ad hoc.

## File-by-File Responsibility Map

| File                                                    | Responsibility in this plan                                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/acp/session-repository.svelte.ts`              | Main hot path: load sequencing, provisional transcript restore, replay snapshot scheduling, background refreshes, duplicate-work cleanup, instrumentation, and any later restart experiment |
| `src/features/chat/components/chat-transcript.svelte`   | Stop blanking the transcript when provisional history is available; reduce repeated render-time scans                                                                                       |
| `src/lib/acp/conversation-persistence.ts`               | Cheaper transcript snapshot change detection and persistence semantics                                                                                                                      |
| `src/lib/acp/workspace-service.ts`                      | Background artifact refresh and optional early hidden-directory pruning                                                                                                                     |
| `src/lib/utils/markdown.ts`                             | Bounded markdown render cache                                                                                                                                                               |
| `src/features/chat/components/chat-work-summary.svelte` | Lazy-mount collapsed work details                                                                                                                                                           |
| `src/features/chat/components/tool-call-block.svelte`   | Lazy-mount tool detail bodies                                                                                                                                                               |
| `src/features/chat/transcript-items.ts`                 | Transcript projection / collapse behavior cleanup                                                                                                                                           |
| `src/lib/acp/session-state-store.ts`                    | Optional projection caching hooks and visible-state invalidation                                                                                                                            |
| `src/lib/acp/connection-lifecycle.ts`                   | Reconnect reason instrumentation and later cwd-restart experiment support                                                                                                                   |
| `electron/acp/runtime-manager.ts`                       | Only touched if Phase 3 needs runtime-status or restart instrumentation changes                                                                                                             |

## Verification

### Automated

- [ ] `pnpm lint`
- [ ] `pnpm test -- tests/acp/session-repository.test.ts tests/acp/conversation-persistence.test.ts tests/acp/workspace-service.test.ts tests/ui/chat-transcript.test.ts tests/ui/markdown.test.ts tests/ui/transcript-items.test.ts tests/ui/tool-call-display.test.ts`
- [ ] `pnpm verify:quick`

### Manual


[truncated for eval fixture]
