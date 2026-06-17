# ACP Slash Command Support

## Goal

Add slash-command discovery, caching, and composer insertion for ACP runtimes so users can type `/` and get relevant commands immediately when cached, then transparently refresh from live ACP session updates.

## Context

ACP slash commands are advertised by the agent through `session/update` notifications with `sessionUpdate: "available_commands_update"`. The client does not call a standard "list commands" method. Running a command is also not a separate ACP method: the client sends normal `session/prompt` text such as `/plan investigate failing tests`.

That has two product consequences:

- Commands can arrive after the composer is already usable.
- Brand-new conversations without a matching cache do not show command
  suggestions until the runtime advertises commands on a real session.

Observed during local ACP research:

- Pool `1.0.1` advertises `/share`, `/skills`, `/usage`, `/plan`.
- Goose `1.33.1` did not advertise ACP slash commands during the tested `session/new`; it only emitted `usage_update`. Goose CLI docs list slash commands, but this ACP server did not expose them through `available_commands_update`.
- Hermes `0.8.0` advertises `/help`, `/model`, `/tools`, `/context`, `/reset`, `/compact`, `/version`; `/model` includes an input hint.

Relevant local code:

- `src/lib/chat/transcript/transcript.ts` already sees and logs `available_commands_update`.
- `src/lib/acp/turn-materializer.ts` intentionally ignores `available_commands_update` for transcript materialization.
- `src/features/chat/components/chat-input.svelte` already has the `$` skill insert menu and can be extended for `/`.
- `src/features/chat/components/prompt-insert-menu.svelte` is reusable for command suggestions.

## Design Principles

- Trust ACP live data first. Do not hard-code command lists from runtime docs except in tests or fixtures.
- Treat cached commands as a UX acceleration layer, not source of truth.
- Do not create hidden ACP sessions for command discovery. ACP `session/new`
  can lock runtime session settings and can create visible empty threads in
  runtimes such as Goose.
- Keep command execution simple. Insert slash-command text into the composer and submit through the existing prompt path.
- Keep slash-command prompt payloads command-only. Runtime command parsers may
  treat any appended text prompt context as command arguments, so Studio should
  suppress injected memory, temporal, tool-provenance, web, widget, artifact,
  and skill-catalog blocks for slash-command turns.
- Make stale state visible enough for debugging, but not noisy for everyday users.

## Cache Model

Use a stale-while-refresh model with two layers.

1. Live session cache:
   - Stored on `SessionState`.
   - Updated whenever the agent sends `available_commands_update`.
   - Cleared when a session is reset, removed, or rebound to a different runtime/session.
   - Always wins over persisted cache for the selected session.

2. Persisted runtime cache:
   - Stores the most recent command list per runtime fingerprint.
   - Used to populate the composer immediately before live commands arrive.
   - Replaced when live ACP sends a new command list.
   - Marked as cached/stale in internal state so we can debug mismatches.

Suggested runtime cache key:

```text
runtimeKind + agentInfo.name + agentInfo.version + launchSelectionKey + profileStorageMode
```

Notes:

- `runtimeKind` separates Pool, Goose, Hermes, and future runtimes.
- `agentInfo` prevents a Pool or Hermes update from poisoning another version.
- `launchSelectionKey` accounts for Pool agent selection and native provider/model selections where they affect capabilities.
- `profileStorageMode` helps avoid mixing isolated dev profiles with native profiles.

If some of these fields are unavailable at first render, use the strongest available partial key and replace it once `initialize` returns agent info. The v1 implementation writes both the exact runtime fingerprint and a config-level fallback fingerprint with unknown agent info, then reads exact first and fallback second. This lets new chats show cached commands before ACP initialization finishes without opening a hidden ACP session. Cache entries should include `observedAt`, `runtimeKind`, `agentInfo`, `launchSelectionKey`, `commands`, and `schemaVersion`.

Persistence options:

- Preferred: store in the Electron settings database behind a narrow desktop API, because runtime metadata belongs to the app profile and should follow isolated dev profiles.
- Acceptable first slice: use renderer `localStorage` with a namespaced key if we want the first UI iteration to stay renderer-only. If this path is chosen, document the migration path to the settings database.
- Chosen v1 slice: use renderer `localStorage` with a namespaced key. This keeps the first implementation narrow and follows existing renderer-side ACP cache patterns. Migration to the Electron settings database remains the preferred follow-up if command cache ownership needs to move behind IPC.

Do not expire cache entries aggressively. Runtime command lists are small, and an outdated command being submitted should normally be handled by the runtime as unsupported text or a runtime-level error. Live updates should replace stale entries as soon as they arrive.

## Steps

- [x] Implementation status: complete as of 2026-05-22. Current slice:
      command state, normalization, live ACP updates, cache, composer UI,
      tests, and docs.

- [x] Step 1 — Add command state types.
  - Introduce a small app-owned command read model, for example `SlashCommandOption`, instead of passing raw SDK objects deep into UI code.
  - Preserve ACP fields: `name`, `description`, optional `input.hint`, and optional `_meta`.
  - Normalize display names by adding `/` only for UI rendering; store command names without the leading slash.

- [x] Step 2 — Store live commands on session state.
  - Add `availableCommands`, `availableCommandsUpdatedAt`, and `availableCommandsSource` to `SessionState`.
  - Add narrow replacement and clear helpers for command state mutations.
  - Clear command state in existing reset/rebind cleanup paths.

- [x] Step 3 — Handle `available_commands_update` in transcript/session orchestration.
  - In `SessionTranscriptService.handleSessionUpdate`, update the owning session state when `sanitizedUpdate.sessionUpdate === "available_commands_update"`.
  - Continue recording the notification in trajectory for debugging.
  - Sync selected state or prompt indicators after command updates, even though they are not transcript-bearing events.
  - Persist the live command list to the runtime cache after successful normalization.

- [x] Step 4 — Add persisted runtime command cache.
  - Define a small cache service with `read(runtimeFingerprint)`, `write(runtimeFingerprint, commands)`, and `clear(runtimeFingerprint?)`.
  - Load cached commands after runtime initialization or when runtime selection changes.
  - Mark cached commands as `source: "cache"` until replaced by `source: "live"`.
  - Never let cache writes block prompt submission or ACP update handling.

- [x] Step 5 — Expose commands in the chat read model.
  - Add `availableSlashCommands` to the selected visible session projection.
  - Expose it from `ACPSessionRepositoryWriter`.
  - In `chat-pane.svelte`, pass command options into `ChatInput` alongside `skillOptions`.

- [x] Step 6 — Extend the composer trigger system.
  - Replace the skill-specific menu state with a generic insert-menu state:
    - `kind: "skill"` for `$query`
    - `kind: "slash-command"` for `/query`
  - Trigger slash suggestions only when the whole draft prefix is `/query`.
    This matches runtime behavior where commands are intended as the first
    prompt token, and avoids suggestions after prose, whitespace, later
    paragraphs, or paths such as `src/foo/bar`.
  - Filter on command name, description, and input hint.
  - Reuse arrow, Enter, Tab, Escape, mouse, and outside-click behavior.

- [x] Step 7 — Insert command text.
  - Selecting `/plan` inserts plain text `/plan `.
  - If the command has an input hint, keep focus after the trailing space so the user can type the argument.
  - If the draft already contains following text in the same token range, replace only the `/query` token.
  - Do not create a command pill unless we later need richer metadata; ACP expects normal text.

- [x] Step 8 — Update composer help and empty states.
  - Change the help text from `$ to insert a skill` to `$ for skills, / for commands` only when commands are available or cached.
  - If no commands are available and no cache exists, typing `/` should either show nothing or show a quiet "No commands from this agent yet" empty state.
  - Avoid implying Goose supports ACP slash commands until it advertises them.

- [x] Step 9 — Add tests.
  - Unit test `available_commands_update` storage and projection.
  - Unit test cache read/write keying and stale-to-live replacement.
  - UI test slash menu filtering, keyboard selection, and insertion text.
  - Regression test that `$` skill insertion still works.
  - Test that no hard-coded Goose commands appear when the runtime has not advertised any commands.

- [x] Step 10 — Document runtime behavior.
  - Update `ACP.md` with how Studio handles `available_commands_update`.
  - Add the observed Pool, Goose, and Hermes command behavior as a dated note.
  - Mention that runtime docs may list commands that are not ACP-advertised.

- [x] Step 11 — Preserve command-only execution semantics.
  - Detect slash-command prompts in the turn service before prompt content
    assembly.
  - Send only the visible slash-command text in the ACP `session/prompt`
    payload.
  - Suppress Studio-injected memory, temporal, tool provenance, public web,
    React widget, artifact, and skill-catalog prompt blocks for slash-command
    turns.
  - Do not expand `$skill` references while normalizing a slash-command prompt,
    because command arguments should remain literal runtime command text.

## UX Flow

First conversation with no cache:

1. User opens Studio and selects a runtime.
2. Composer works immediately.
3. User types `/` as the first draft character.
4. If no matching cache exists yet, Studio shows no commands for that runtime.
5. User sends the first prompt.
6. Studio creates the real ACP session through the normal prompt path.
7. If the runtime advertises `available_commands_update`, Studio stores those
   commands live and persists them to the runtime cache.

Later conversation with cache:

1. User opens Studio.
2. Runtime cache loads from the last matching runtime fingerprint.
3. User types `/` and sees cached commands immediately.
4. After the live session advertises commands, the menu updates if the live list differs.

Runtime sends dynamic changes:

1. Agent sends a later `available_commands_update`.
2. Studio replaces live session commands.
3. Persisted cache is updated.
4. Open composer menu re-filters against the new list without losing focus.

## Risks And Mitigations

- Risk: cached command is no longer supported.
  - Mitigation: live ACP updates replace cache; command submission remains normal prompt text; optionally show cached entries with internal debug metadata.

- Risk: commands are workspace-specific, especially Goose custom recipe commands or future runtime skill commands.
  - Mitigation: include runtime profile and launch selection in the key; consider adding workspace root to the key only if live evidence shows workspace-specific ACP command lists.

- Risk: typing `/` conflicts with file paths or prose.
  - Mitigation: trigger only when the whole draft prefix is `/query`, so file paths and inline prose never open command suggestions.

- Risk: command updates arrive before the remote session is selected or while switching sessions.
  - Mitigation: route updates by `params.sessionId` through `ensureRemoteSessionState`, as existing transcript code does.

- Risk: Goose CLI docs list commands but ACP does not advertise them.
  - Mitigation: never synthesize Goose commands from docs. Show only live or cached ACP-advertised commands.

## Decision Log

**2026-05-22**: Use ACP `available_commands_update` as the source of truth because the standard protocol advertises commands through session notifications and runs commands through normal prompt requests. Alternatives considered: hard-code runtime command lists, call runtime-specific extension methods, or create speculative sessions only for discovery.

**2026-05-22**: Use stale-while-refresh caching because live command discovery can lag behind composer availability, and a cache gives users immediate suggestions on later launches without opening a hidden ACP session.

**2026-05-22**: Do not prewarm new-chat ACP sessions. Hidden `session/new`
calls can lock model/mode choices before the user sends and can create empty
threads in Goose.

**2026-05-22**: Write live command lists to both exact and config-level
fallback cache keys. This keeps cached slash commands available immediately on
new chats while ACP runtime metadata is still loading, without calling
`session/new`.

**2026-05-22**: Slash-command turns must be sent as command-only prompt
payloads. Goose parses commands from the concatenated text prompt; Studio's
injected context blocks caused `/skills` to become
`/skills\n\n<poolside-studio-context...`, so Goose treated the prompt as normal
model text instead of a builtin command.

## Verification

- [x] `pnpm exec vitest --run tests/acp/slash-commands.test.ts tests/acp/session-state-store.test.ts tests/acp/session/transcript-service.test.ts tests/ui/chat-input.test.ts`
      exits 0.
- [x] `pnpm exec vitest --run --environment jsdom tests/acp/session/repository.test.ts tests/acp/session/runtime-service.test.ts tests/acp/session/draft-service.test.ts tests/acp/session/loading-service.repository.test.ts tests/acp/session/pool-model-selection-service.repository.test.ts tests/acp/session/runtime-config-service.repository.test.ts tests/acp/session/turn-service.repository.test.ts tests/acp/session/workspace-service.repository.test.ts tests/acp/session/mode-service.test.ts tests/acp/slash-commands.test.ts tests/acp/session-state-store.test.ts tests/acp/session/transcript-service.test.ts tests/ui/chat-input.test.ts`
      exits 0.
- [x] `pnpm lint` exits 0.
- [x] `pnpm verify:quick` exits 0.
- [x] Targeted chat input tests cover both `$` skills and `/` commands.
- [x] ACP session tests cover `available_commands_update` state storage.
- [x] Repository tests cover cached command hydration without creating a remote
      ACP session.
- [x] Local ACP research confirmed Pool and Hermes commands arrive through live
      `available_commands_update` notifications.
- [x] Goose does not show hard-coded commands unless a future Goose ACP version
      advertises them.
- [x] Regression verification: slash-command prompt submission sends only the
      command text, with no injected Studio prompt context.
- [x] Step 11 targeted tests:
      `pnpm exec vitest --run --environment jsdom tests/acp/slash-commands.test.ts tests/acp/session/turn-service.repository.test.ts`
      exits 0.
- [x] Step 11 `pnpm lint`, `pnpm check`, and `git diff --check` exit 0.
- [ ] Step 11 `pnpm verify:quick` does not currently exit 0 in this checkout.
      It fails in `tests/electron/agent-loop-worktree-root.test.ts` because the
      test expects generated paths under `poolside-studio`, while this checkout
      path uses `pool-desktop`.

## Resolved Decisions

- Persisted command cache uses renderer `localStorage` for v1. Moving the cache
  behind a narrow Electron settings API remains the likely follow-up if profile
  ownership or cache inspection needs to become stricter.
- Cached-vs-live state stays internal for v1. The menu remains visually stable
  unless the live command list changes.
- No manual refresh action was added for v1. Reconnect or a new ACP session is
  enough until users need explicit command-cache controls.
