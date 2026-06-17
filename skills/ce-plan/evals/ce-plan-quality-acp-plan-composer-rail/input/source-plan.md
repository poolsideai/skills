# ACP Plan Composer Rail

## Goal

Move ACP todo/plan visibility out of the scrollable transcript and into a
fixed composer-adjacent rail so users can see plan progress while the
conversation scrolls.

## Context

`pool acp` emits `session/update` notifications with `sessionUpdate: "plan"`.
The current app already materializes these updates as `acp.plan`, persists them
with the transcript, and passes them into the chat UI. The problem is only the
rendering location: `ChatTranscript` renders the plan at the top of the
scrollable transcript, above the user prompt and message history, so it
disappears as soon as transcript content scrolls.

Relevant current files:

- `src/lib/acp/turn-materializer.ts` stores the latest ACP plan as a complete
  replacement on every plan update.
- `src/lib/acp/session/repository.svelte.ts` exposes the visible plan as
  `acp.plan`.
- `src/app/components/app-chat-pane.svelte` already receives `acp.plan` and
  already hosts the queued-prompt strip directly above `ChatInput`.
- `src/features/chat/components/chat-transcript.svelte` currently renders
  `Current Plan` inside the transcript scroller.
- `src/features/chat/components/queued-prompts-list.svelte` is the closest
  existing visual and placement pattern for a composer rail list.

ACP plan entries currently have these statuses:

- `pending`
- `in_progress`
- `completed`

The example trajectory
`.poolside-studio/dev-profiles/vite-1420/trajectories/create-simple-shell-file-then-edit-it-then-read-it-then-call-it-exe-019df7ab-fd9.json`
shows a typical plan lifecycle: four pending items, one item marked
`in_progress`, completed items accumulating, then all items completed.

## Target Behavior

- Show active ACP plans at the bottom of the chat pane, directly above the
  prompt composer.
- Keep the component collapsed by default.
- In collapsed state, show a compact summary such as `Plan: 3 of 4 complete`.
- If any item is `in_progress`, visually indicate active work in the summary
  row, using the existing quiet UI language and a small spinner or equivalent
  status marker.
- Expand/collapse should be local UI state only. Keep it in memory, keyed by
  conversation identity if that remains simple; do not persist it.
- Hide plans once every item is `completed`.
- If straightforward, show a brief completion state before hiding, for example
  `Plan complete` for about 1.5-2 seconds after an active incomplete plan
  transitions to all completed.
- Do not show historical all-completed plans when loading a conversation.
- If queued prompts and a plan are both present, keep both in the bottom rail.
  The plan summary should appear above queued prompts so plan progress remains
  closest to the transcript.

## Steps

- [ ] Add a focused plan rail component.
  - Suggested file:
    `src/features/chat/components/chat-plan-rail.svelte`.
  - Inputs:
    `plan`, `conversationIdentity`, and optionally `isPrompting` if needed for
    active-state affordance.
  - Derived state:
    total count, completed count, pending count, in-progress count,
    all-completed flag, summary label, and visible entries.
  - Internal state:
    collapsed/expanded state, defaulting to collapsed; optional in-memory map
    by conversation identity.

- [ ] Mount the plan rail in `AppChatPane`.
  - Import the new component in `src/app/components/app-chat-pane.svelte`.
  - Place it inside the existing composer rail container above
    `QueuedPromptsList` and `ChatInput`.
  - Use the same max width and inset spacing as the queued prompt strip.
  - Keep queued prompts unchanged except for vertical ordering and spacing.

- [ ] Remove transcript-owned plan rendering.
  - Delete the visible `Current Plan` section from
    `src/features/chat/components/chat-transcript.svelte`.
  - Keep transcript scroll behavior focused on transcript events, permissions,
    and loading states.
  - If needed to avoid an empty-state flash when a restored active plan has no
    events, replace the raw `plan` prop with a boolean such as
    `hasExternalPlanContent` rather than rendering plan content in the
    transcript.

- [ ] Implement completion hiding.
  - Hide plans with zero entries.
  - Hide plans whose entries are all `completed`.
  - For the brief completion state, only flash when a currently visible
    incomplete plan transitions to all completed in the same mounted component.
    Do not flash on initial render of an already completed restored plan.
  - Clear any completion timer on component destroy or conversation switch.

- [ ] Match the existing visual system.
  - Reuse shared `Button` and lucide icons where useful.
  - Use restrained borders, neutral surfaces, compact type, and low-contrast
    status markers consistent with queued prompts and the app shell.
  - Avoid adding explanatory copy beyond the compact summary and item labels.

- [ ] Update tests.
  - Add `tests/ui/chat-plan-rail.test.ts` for:
    collapsed default,
    summary counts,
    in-progress marker,
    expand/collapse,
    hide initial all-completed plans,
    optional completion flash after an incomplete-to-complete transition.
  - Update `tests/ui/app-chat-pane.test.ts` to assert the plan rail is mounted
    in the composer rail above queued prompts.
  - Update `tests/ui/chat-transcript.test.ts` expectations so the transcript no
    longer renders `Current Plan`.
  - Keep existing ACP persistence and replay tests unchanged unless a type
    surface changes.

## Decision Log

**2026-05-05**: Place the plan at the bottom above the prompt composer because
the queue strip already proves this area is fixed relative to the composer and
does not participate in transcript scrolling. Alternatives considered: sticky
top of transcript, fixed top of chat pane, or keeping the existing transcript
rendering.

**2026-05-05**: Default the plan to collapsed because progress visibility is the
primary requirement and full plan details should not permanently compete with
the composer.

**2026-05-05**: Hide fully completed plans, with an optional brief completion
flash, because completed todo lists stop being useful once the user has visible
conversation output.

**2026-05-05**: Keep expand/collapse state local and in-memory for the first
implementation because persisted UI preference is not needed for this behavior.

## Verification

- [ ] `pnpm lint` exits 0.
- [ ] `pnpm test -- tests/ui/chat-plan-rail.test.ts tests/ui/app-chat-pane.test.ts tests/ui/chat-transcript.test.ts`
      exits 0.
- [ ] `pnpm verify:quick` exits 0 before handoff if implementing the code
      change in the same branch.
- [ ] Manual smoke in `pnpm dev:agent` or an existing Pool chat:
  - Start a Pool ACP turn that emits a plan.
  - Confirm the summary appears above the prompt composer.
  - Scroll the transcript and confirm the summary remains visible.
  - Expand and collapse the plan.
  - Confirm `in_progress` is visually indicated.
  - Confirm the plan hides after all entries complete, with the brief completion
    state if implemented.

## Out Of Scope

- Changing ACP protocol handling or plan persistence.
- Adding user settings for plan visibility.
- Persisting expand/collapse state across app restarts.
- Rendering multiple historical plans in the transcript.
