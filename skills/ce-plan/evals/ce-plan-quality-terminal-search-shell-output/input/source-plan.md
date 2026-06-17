# Terminal Search and Shell Output Plan

Date: 2026-05-28
Status: Milestones 1-3 implemented; Studio-side shell output aggregation and
notification intake added; active-shell UI is live-notification-only; live
runtime tailing remains capability-gated
Source research:
[`docs/research/forge-ui-borrowable-capabilities-2026-05-27.md`](../research/forge-ui-borrowable-capabilities-2026-05-27.md)

## Goal

Make long terminal and shell command output searchable and easy to inspect
without bloating the chat transcript.

The plan has two related tracks:

1. Add find/search to Studio's existing interactive terminal dock.
2. Add a dedicated read-only shell output surface for agent command output.

## Implementation Status

Implemented in this change:

- `@xterm/addon-search` is installed and loaded in Studio's interactive
  terminal tabs.
- Active terminal tabs support Cmd/Ctrl+F, Enter, Shift+Enter, and Escape for
  xterm search.
- Completed shell tool calls can expose an "Open output" action in the expanded
  transcript block.
- "Open output" opens an ephemeral read-only xterm viewer with searchable
  stdout/stderr text from existing ACP tool-call data.
- Background shell sessions are aggregated by `shell_id`, so later
  `shell_tail` output is available from the original shell row.
- Studio accepts Forge-style Pool shell session notifications and stores live
  tail chunks when a Pool runtime emits them.
- The active-shell strip renders only from live Pool shell session
  notifications, not from persisted transcript history.
- The terminal find bar is shared between the interactive terminal and shell
  output viewer.

Deferred:

- Starting and cancelling Forge-style live tail sessions remains gated on
  runtime/protocol support. The current bundled `pool acp` does not advertise a
  shell-tail extension method equivalent to Forge helper's
  `poolside/shellTailSession` / `poolside/shellCancelTailSession`.
- Deriving "active" shell state from historical transcript tool calls is
  intentionally unsupported because persisted output can show only what was true
  when the tool call was recorded.

## Context

Forge treats shell command output as a first-class product surface, not only as
terminal text. It has:

- Inline chat shell blocks with collapsed output, copy, and "View in tab".
- A read-only xterm output tab for shell output.
- Cmd/Ctrl+F search inside the output xterm.
- Live tailing from helper-managed shell sessions.
- Active shell session state for tail, kill, and output routing.

Studio already has an interactive terminal dock backed by xterm, and chat tool
calls already preserve shell command output in `ToolCallEvent.rawOutput` and
content blocks. Studio does not currently have Forge's live shell tail protocol
or output-only terminal records.

## Forge Reference

Forge's most relevant implementation pieces:

- Output xterm setup with `SearchAddon`:
  `/Users/evgeny.nikiforov/go/src/github.com/poolsideai/forge/ui/packages/output/src/output/store.ts`
- Output find bar and shortcuts:
  `/Users/evgeny.nikiforov/go/src/github.com/poolsideai/forge/ui/packages/output/src/App.svelte`
- VS Code shell output panel lifecycle:
  `/Users/evgeny.nikiforov/go/src/github.com/poolsideai/forge/ui/apps/vscode-assistant/src/extension/views/output.ts`
- "View output" handler:
  `/Users/evgeny.nikiforov/go/src/github.com/poolsideai/forge/ui/apps/vscode-assistant/src/extension/rpc/handlers/showShellOutput.ts`
- Shell tail update routing:
  `/Users/evgeny.nikiforov/go/src/github.com/poolsideai/forge/ui/apps/vscode-assistant/src/extension/lsp/handlers/shellTailSessionDidUpdate.ts`
- Inline shell block:
  `/Users/evgeny.nikiforov/go/src/github.com/poolsideai/forge/ui/packages/assistant/src/lib/blocks/tool/ShellBlock.svelte`
- Inline shell output block:
  `/Users/evgeny.nikiforov/go/src/github.com/poolsideai/forge/ui/packages/assistant/src/lib/blocks/tool/shell/ShellOutput.svelte`
- Active shell store:
  `/Users/evgeny.nikiforov/go/src/github.com/poolsideai/forge/ui/packages/assistant/src/lib/shells/store.ts`
- Helper tail implementation:
  `/Users/evgeny.nikiforov/go/src/github.com/poolsideai/forge/pkg/poolside-helper/internal/handler/shell_tail_session.go`

## Studio Current State

Relevant Studio files:

- Interactive terminal xterm:
  [`src/features/terminals/components/terminal-instance.svelte`](../../src/features/terminals/components/terminal-instance.svelte)
- Terminal dock:
  [`src/features/terminals/components/terminal-dock.svelte`](../../src/features/terminals/components/terminal-dock.svelte)
- Terminal records and API:
  [`src/lib/terminals/types.ts`](../../src/lib/terminals/types.ts)
- Shell tool call presentation:
  [`src/lib/acp/tool-call-presentation-shell.ts`](../../src/lib/acp/tool-call-presentation-shell.ts)
- Tool payload output extraction:
  [`src/lib/acp/tool-payload-sections.ts`](../../src/lib/acp/tool-payload-sections.ts)
- Chat tool-call rendering:
  [`src/features/chat/components/tool-call-block.svelte`](../../src/features/chat/components/tool-call-block.svelte)
- Pool extension notifications:
  [`src/lib/chat/runtime/pool-extension-service.ts`](../../src/lib/chat/runtime/pool-extension-service.ts)
- ACP client extension notification allowlist:
  [`src/lib/acp/client.ts`](../../src/lib/acp/client.ts)

Studio currently has:

- PTY-backed interactive terminal tabs.
- xterm fit and web-link addons.
- Terminal replay buffers for active terminal records.
- Shell command summaries in the transcript.
- Tool output rendering from `rawOutput.stdout`, `rawOutput.stderr`,
  `rawOutput.output`, `rawOutput.observation`, and content blocks.

Studio currently lacks:

- `@xterm/addon-search`.
- A terminal find bar.
- Read-only output-only terminal tabs.
- A "View output in tab" action for shell tool-call output.
- Forge-style `shellSessionsDidChange` and `shellTailSessionDidUpdate` handling.
- A Pool-specific shell tail request path from the renderer to the runtime.

## Priority Matrix

| Priority | Work                                                         | User Value  | Complexity  | Notes                                                                                              |
| -------- | ------------------------------------------------------------ | ----------- | ----------- | -------------------------------------------------------------------------------------------------- |
| 1        | Add search to existing terminal tabs                         | High        | Low-medium  | Improves user-created PTYs immediately.                                                            |
| 2        | Add read-only output viewer for completed shell tool outputs | Very high   | Medium      | Solves the bigger "agent command output is hard to inspect" problem without runtime protocol work. |
| 3        | Add "Open output" action on shell tool calls                 | High        | Medium      | Should feed the output viewer from existing transcript data.                                       |
| 4        | Add Forge-style live tailing for Pool shell sessions         | High        | High        | Requires runtime/protocol support that Studio does not currently expose.                           |
| 5        | Add active shell list and kill/tail controls                 | Medium-high | Medium-high | Only valuable after live shell session state exists.                                               |
| 6        | Durable historical output search across chats                | Medium      | High        | Defer until the output surface proves useful.                                                      |

## Recommended Milestones

### Milestone 1: Terminal Search

Add search to Studio's existing interactive terminal dock.

Implementation steps:

- Add `@xterm/addon-search` to `package.json` and lockfile.
- Load `SearchAddon` in
  `src/features/terminals/components/terminal-instance.svelte`.
- Add a compact find bar inside the terminal surface.
- Support Cmd/Ctrl+F to open search.
- Support Enter for next match and Shift+Enter for previous match.
- Support Escape to close search and clear decorations.
- Preserve existing terminal input, fit, replay, resize, theme, and web-link
  behavior.

Design notes:

- The search UI should be local to the active xterm instance.
- App shell shortcuts already defer to terminal-owned targets, so the terminal
  component should own Cmd/Ctrl+F when focused.
- Search should not interfere with terminal stdin except while the find input is
  focused.

### Milestone 2: Static Shell Output Viewer

Add an ephemeral read-only xterm viewer for completed agent shell command output.

Implementation steps:

- Extract a reusable output text helper from
  `src/lib/acp/tool-payload-sections.ts`, or add a shell-output-specific helper
  that reads the same sources.
- Create a read-only xterm component with:
  - `disableStdin: true`
  - `convertEol: true`
  - `SearchAddon`
  - bounded scrollback
- Feed completed shell output into that xterm from existing transcript data.
- Add an "Open output" action to expanded shell tool calls when output text
  exists.
- Title the output view from shell description first, command summary second.
- Keep output tabs ephemeral at first. Do not persist them until the interaction
  model is validated.

Why static first:

- It works for Pool, Goose, Hermes, Pi, and MCP-style shell tools as long as the
  output is present in ACP tool-call data.
- It avoids assuming Forge's helper protocol exists in Studio.
- It gives users searchable command output quickly.

### Milestone 3: Inline Output Polish

Improve inline output readability without replacing the output viewer.

Implementation steps:

- Keep inline output collapsed by default for large payloads.
- Add copy and open-output actions in a compact action row.
- Consider a lightweight ANSI control sanitizer for plain `<pre>` output, based
  on Forge's `applyAnsiControl`, so progress-style output is less noisy inline.
- Keep full ANSI rendering in the xterm output viewer.

### Milestone 4: Live Pool Shell Tailing

Add Forge-style live shell tailing as a Pool-specific capability.

Implementation steps:

- Confirm the Pool runtime exposes shell session IDs, output files, and tail
  operations through ACP extension methods or notifications.
- Extend `ACPClient.extNotification` and `PoolExtensionService` to accept
  shell-session notifications only for Pool runtime.
- Add typed parsing for:
  - `shell_id` / `shellId`
  - `output_file`
  - shell status
  - `shellTailSessionId`
  - stdout/stderr chunks
- Add a renderer-side shell output manager that can:
  - open a tail session
  - route chunks to the inline output stream or output tab
  - cancel the tail session on unmount/dispose
  - avoid duplicate output when both inline and tab views exist
- Gate every live-tail affordance behind detected runtime support.

Risks:

- Studio's ACP client currently allowlists only `_poolside/compaction_update`
  and `_poolside/show_message` extension notifications.
- Existing shell tool calls may include `shell_id`, but that is not enough by
  itself to tail live output.
- Non-Pool runtimes should continue to use the static output viewer.

### Milestone 5: Active Shell List

Add a compact active shell list after live shell session state exists.

Implementation steps:

- Track active and exited shell sessions per conversation.
- Show running shells with command/title, status, and open-output action.
- Add kill action only when the runtime exposes a supported kill operation.
- Scope shell sessions to the current conversation/workspace.
- Do not backfill active shells from trajectory or transcript history; use the
  runtime shell registry as the source of truth.

## Non-goals

- Do not put shell output in the project/file viewer.
- Do not build durable cross-chat output search in the first pass.
- Do not persist output-only tabs until the product shape is proven.
- Do not assume Forge's helper methods exist for all Studio runtimes.
- Do not replace the interactive terminal dock with a separate output system in
  the first milestone.

## Decision Log

**2026-05-28**: Split the plan into terminal search and shell output viewer
tracks because terminal search alone does not solve agent shell command output.
Forge's UX is built around command output as a separate surface.

**2026-05-28**: Recommend static shell output viewer before live tailing because
Studio already has completed output in ACP tool-call data, while Forge-style
live tailing requires runtime/protocol support that is not currently wired in

**2026-05-28**: Keep the "Active shells" strip tied to live Pool
`shellSessionsDidChange` notifications only. Transcript-derived shell records
remain useful for searchable historical output, but they are not a reliable live
process registry, and command output text must not override explicit shell
status lines.
Studio.

**2026-05-28**: Keep live tailing Pool-specific and capability-gated because
Studio supports multiple runtime families and should not assume Pool helper
methods exist everywhere.

## Verification

Milestone 1:

- [ ] `pnpm lint` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] Terminal search opens with Cmd/Ctrl+F while a terminal is focused.
- [ ] Enter and Shift+Enter navigate matches.
- [ ] Escape closes search and returns focus to the terminal.
- [ ] Existing terminal input, paste, resize, replay, and web links still work.

Milestone 2:

- [ ] `pnpm lint` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] Shell tool calls with completed output show an "Open output" affordance.
- [ ] The output viewer renders stdout/stderr text in a read-only xterm.
- [ ] Search works in the output viewer.
- [ ] Closing an output viewer does not mutate transcript state.
- [ ] Large output is bounded enough to avoid UI stalls.

Milestone 4:

- [ ] Live tailing is enabled only when runtime support is detected.
- [ ] Closing the output view cancels the tail session.
- [ ] Inline and tab output do not duplicate chunks.
- [ ] Non-Pool runtimes still use the static output viewer.
