# Integrated Terminal Support

## Goal

Add an IDE-grade integrated terminal surface to Poolside Studio: a toolbar
toggle opens a bottom terminal dock for the selected chat, users can create and
close terminal tabs, terminal input behaves like a real PTY-backed terminal,
and closing a terminal reliably stops its backing process.

## Context

Poolside Studio is moving toward a developer workbench where agents and humans
can build applications inside real local workspaces. A terminal is a core part
of that workbench: users need to run package managers, dev servers, test
commands, git commands, and one-off scripts without leaving the chat.

The desired interaction model is similar to the provided reference screenshot:

- a terminal icon in the chat header toggles a bottom terminal dock
- the dock has a tab strip, add button, and close controls
- each tab is a full terminal, not a textarea with command output
- closing a tab terminates the underlying process
- terminal state belongs to a chat, not to the whole app by default
- the sidebar should show when another chat has a running terminal process

Relevant repo constraints:

- Electron main owns local processes and OS integration.
- The renderer talks to Electron through the typed preload bridge in
  `electron/preload.ts` and `src/lib/desktop/host.ts`.
- App shell composition lives in `src/app/shell/`.
- Feature UI belongs under `src/features/`; shared contracts belong under
  `src/lib/`.
- IPC inputs must be validated at the boundary.
- New Electron runtime services should be explicit service classes wired from
  `electron/main.ts`.

## Research Notes

Checked on 2026-05-19:

- [`xterm.js`](https://xtermjs.org/docs/) is the right renderer-side terminal
  emulator. The current docs are for 6.0 and expose `Terminal.onData`,
  `onBinary`, `onResize`, `loadAddon`, `open`, `write`, `resize`, and
  `dispose`.
- [`@xterm/addon-fit`](https://xtermjs.org/docs/guides/using-addons/) is the
  standard resize integration. The docs show the intended pattern:
  instantiate `Terminal`, load `FitAddon`, open the terminal element, then call
  `fit()`.
- [`@xterm/addon-web-links`](https://xtermjs.org/docs/guides/link-handling/)
  can detect URL-looking output, but link activation should require a modifier
  key and route through the app's safe external-link handling.
- [`xterm.js` security guidance](https://xtermjs.org/docs/guides/security/)
  is explicit that terminal I/O is sensitive and any JavaScript near the
  terminal can observe or manipulate it. Keep terminal code local, avoid remote
  runtime-loaded JS, never use `innerHTML` with terminal data, and do not log
  terminal output.
- [`node-pty`](https://github.com/microsoft/node-pty) is the standard
  Electron/Node PTY layer. It is used for terminal emulators, supports macOS,
  Linux, and Windows ConPTY, exposes `spawn`, `onData`, `onExit`, `write`,
  `resize`, and `kill`, and warns that child processes run with the same
  privilege level as the parent process.
- Electron's
  [`contextBridge`](https://www.electronjs.org/docs/latest/api/context-bridge/)
  docs reinforce the existing repo pattern: expose a narrow safe API, not raw
  `ipcRenderer` or broad Node APIs.
- Electron's
  [native node module docs](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
  matter because `node-pty` is native. It must be rebuilt or prebuilt for the
  Electron ABI.
- Electron's
  [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process)
  is useful for isolating Node work, but it does not support stdin piping and is
  not required for v0. A main-process service is the simplest first slice.
- Current npm metadata: `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`,
  `@xterm/addon-web-links@0.12.0`, `@xterm/addon-search@0.16.0`,
  `@xterm/addon-clipboard@0.2.0`, `node-pty@1.1.0`. All report MIT licenses.

## Recommended Direction

Use `xterm.js` in the Svelte renderer and `node-pty` in Electron main.

Do not use plain `child_process.spawn` for the terminal. Many developer tools
change behavior when they are not attached to a pseudo-terminal: prompts,
colors, control sequences, raw mode, full-screen TUIs, and job control are all
PTY-sensitive. `node-pty` is the correct backing process primitive.

Make v0 per-chat by default. A terminal belongs to a chat scope and a workspace
path. Switching from chat A to chat B should make the terminal dock reflect chat
B's terminals. If chat B has none, the dock is closed or empty. Chat A's
terminals keep running in the background until the user closes the terminal,
removes the conversation, or quits the app. This is necessary for the sidebar
indicator requirement: the user can switch away, see that a terminal is still
active in chat A, then return to the same terminal.

Global terminals and "close terminals when switching chat" can be added later
as settings after the per-chat lifecycle is correct. Starting with both modes
would expand the lifecycle surface before we have the important invariants
tested.

## Execution Priority Checklist

Use this as the top-level progress tracker. **P0** items are required before a
V0 integrated terminal can ship. **P1** items belong in the first V1 hardening
slice after the terminal is usable. **P2** items are intentionally non-blocking
follow-ups to remember, not acceptance criteria for V0 or V1.

### P0: V0 Ship Gates

- [ ] Native PTY dependency works in development and packaged macOS builds:
      `node-pty` is rebuilt for Electron, externalized from the Electron bundle
      when needed, included in packaged contents, and unpacked from ASAR if
      required.
- [ ] Terminal process lifecycle is deterministic: closing a tab kills its PTY,
      closing a scope kills only matching PTYs, app quit/window teardown stops
      all PTYs, and no orphaned long-running test process survives the smoke
      checks.
- [ ] Terminal keyboard correctness is proven before user-visible shipment:
      terminal focus receives `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+R`, arrows,
      `Tab`, `Esc`, paste chords, mouse reporting, and ordinary printable input
      without app shortcuts or type-to-compose stealing the event.
- [ ] IPC/preload boundary is narrow and validated: renderer code gets only the
      typed terminal API, every handler input is parsed at the boundary, and no
      raw Node, process, `ipcRenderer`, PTY, or arbitrary command API is exposed.
- [ ] Workspace ownership is enforced in main: terminal creation is allowed only
      for a known chat/workspace scope and a verified workspace path, not for an
      arbitrary absolute path supplied by the renderer.
- [ ] Terminal output privacy is enforced: terminal chunks, command lines,
      replay buffers, and screen contents are not written to app logs, Sentry
      fields, debug snapshots, feedback archives, or feedback screenshots by
      default.
- [ ] Feature ownership keeps shell files small: terminal state, resize logic,
      tab model, and xterm wiring live under `src/features/terminals/` or
      `src/lib/terminals/`; `src/app/shell/*` files only compose the feature and
      do not cross the large-file ratchet.
- [ ] Basic PTY behavior is manually verified: shell startup, `pnpm test`,
      long-running command cancellation, `node`, `less`/`vim`/`top`, chat
      switch, dock reopen, tab close, and packaged app spawn/kill all work.
- [ ] Required verification passes for the touched slice: at minimum
      `pnpm lint`, plus `pnpm check`, `pnpm test`, `pnpm build`, or
      `pnpm package:mac` where the phase changes TypeScript/Svelte,
      Electron/preload/native packaging, or runtime behavior.

### P1: V1 Product Hardening

- [ ] Add output backpressure/coalescing so noisy commands cannot overwhelm IPC,
      renderer writes, or memory. Include a high-volume fake PTY test.
- [ ] Improve reattach fidelity beyond a naive raw byte ring, or document the
      chosen limitation explicitly. Candidate approaches: keep xterm instances
      mounted while hidden, use `@xterm/addon-serialize`, or maintain a headless
      xterm buffer in main.
- [ ] Ship sidebar terminal indicators with tested precedence against existing
      blocked/active/finished session state.
- [ ] Add conversation-removal and destructive-close prompts for scopes with
      running terminals, then kill only after explicit confirmation.
- [ ] Route terminal web links through safe external-link handling with a
      modifier-required activation model.
- [ ] Finalize shell startup behavior, especially macOS login shell vs
      non-login shell, based on observed PATH/profile behavior.
- [ ] Add the realistic command smoke matrix to automated or manual release
      checks: `pnpm dev`, `pnpm test`, `vim`, `less`, `top`, `node`, `Ctrl+C`,
      chat switch, tab close, app quit, and packaged spawn/kill.
- [ ] Polish dock focus and accessibility: ARIA tab semantics, keyboard resize,
      focus restoration after tab close/dock close, and screen-reader labels for
      terminal status.

### P2: Consider Next

- [ ] Global terminal mode.
- [ ] Full terminal settings UI.
- [ ] Terminal search UI.
- [ ] Split panes.
- [ ] Shell integration for exact command start/end and prompt detection.
- [ ] Persisted terminal transcripts with explicit opt-in.
- [ ] Agent-controlled terminal tools, gated separately from the human terminal
      UI.
- [ ] Dev-server URL detection.
- [ ] Copy/export terminal output.
- [ ] Remote terminal or SSH management.

## Scope Model

### Terminal Scope

Use the renderer conversation identity as the primary v0 scope key:

```typescript
type TerminalScope = {
  scopeKey: string; // acp.selectedConversationIdentity
  conversationRecordId: string | null;
  sessionId: string | null;
  workspacePath: string;
  title: string;
};
```

Reasons:

- `selectedConversationIdentity` exists before a remote ACP session or local DB
  conversation record exists.
- It is already used to protect deferred prompt dispatch and transcript scroll
  state from chat switches.
- The service can store `conversationRecordId` and `sessionId` as metadata for
  sidebar display, cleanup, and future persistence.

If implementation finds that `selectedConversationIdentity` can be replaced
during load/rekey flows, add an explicit `terminals:reassignScope` IPC call and
unit tests. Do not silently create a second terminal scope for the same visible
chat.

### Terminal Lifetime

Initial policy:

- Creating a terminal requires desktop mode and a non-empty `workspacePath`.
- Terminal processes are in-memory only for v0.
- Terminal output is not persisted to the database.
- Electron main keeps a bounded output ring buffer per terminal so the renderer
  can detach and reattach across chat switches without losing all recent
  output.
- App quit stops all PTYs.
- Closing a terminal tab kills that PTY.
- Removing a conversation kills PTYs scoped to that conversation.
- Switching chats does not kill PTYs from the previous chat.

Recommended output buffer: start with 256 KiB per terminal and a small default
terminal limit per chat, for example 4. Make both constants local and easy to
adjust after profiling.

## Architecture

### Main Process

Create a new Electron service:

- `electron/terminals/service.ts`
- `tests/electron/terminal-service.test.ts`

The service should own:

- PTY spawn and lifecycle
- terminal IDs
- terminal scope metadata
- title/process/status tracking
- bounded output replay buffers
- resize handling
- write handling
- close/kill/stop-all behavior
- per-scope summaries for sidebar indicators

Sketch:

```typescript
type TerminalStatus = "running" | "exited" | "failed";

type TerminalProcessState = {
  id: string;
  scopeKey: string;
  conversationRecordId: string | null;
  sessionId: string | null;
  workspacePath: string;
  shellPath: string;
  title: string;
  processName: string | null;
  pid: number | null;
  cols: number;
  rows: number;
  status: TerminalStatus;
  createdAt: string;
  lastActivityAt: string;
  exitedAt: string | null;
  exitCode: number | null;
};
```

Spawn defaults:

- macOS/Linux: `process.env.SHELL` if absolute, otherwise `/bin/zsh` on macOS
  and `/bin/bash` or `/bin/sh` on Linux.
- Windows: `process.env.ComSpec` or PowerShell.
- `cwd`: the selected chat workspace.
- `name`: `xterm-256color`.
- `env`: inherit `process.env`, set `TERM=xterm-256color`, set
  `COLORTERM=truecolor`, set `TERM_PROGRAM=poolside-studio`.

Open question for implementation: whether to start POSIX shells as login shells
(`-l`). This improves user PATH/profile behavior in GUI-launched apps, but it
can also make startup slower and invoke user profile side effects. The first
implementation should test `zsh -l` on macOS because the app is developer
focused and GUI app environments commonly miss shell PATH setup.

### IPC And Preload API

Add a typed API under `window.poolDesktop.terminals`:

```typescript
type TerminalApi = {
  create(input: TerminalCreateRequest): Promise<TerminalRecord>;
  list(scopeKey: string): Promise<TerminalRecord[]>;
  getSnapshot(terminalId: string): Promise<TerminalSnapshot>;
  write(terminalId: string, data: string): Promise<void>;
  writeBinary(terminalId: string, dataBase64: string): Promise<void>;
  resize(terminalId: string, cols: number, rows: number): Promise<void>;
  close(terminalId: string): Promise<void>;
  closeScope(scopeKey: string): Promise<void>;
  listSummaries(): Promise<TerminalScopeSummary[]>;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
};
```

Validate IPC payloads with Zod in `electron/ipc/register-handlers.ts` or a new
`electron/ipc/register-terminal-handlers.ts` if the handler set is large. Keep
event payloads serializable and small.

Event types:

```typescript
type TerminalEvent =
  | { type: "created"; terminal: TerminalRecord }
  | { type: "data"; terminalId: string; chunk: string }
  | { type: "exit"; terminalId: string; exitCode: number | null }
  | { type: "status"; terminal: TerminalRecord }
  | { type: "removed"; terminalId: string; scopeKey: string };
```

Do not expose arbitrary process APIs to the renderer. The renderer should only
be able to create, write to, resize, and close terminals that the main service
tracks.

### Renderer Feature

Create a terminal feature:

- `src/features/terminals/terminal-controller.svelte.ts`
- `src/features/terminals/components/terminal-dock.svelte`
- `src/features/terminals/components/terminal-tab-strip.svelte`
- `src/features/terminals/components/terminal-instance.svelte`

Shared contracts live under:

- `src/lib/terminals/types.ts`
- `src/lib/terminals/renderer-terminal-api.ts` if a small adapter helps tests

The controller should:

- derive the current `TerminalScope` from the active chat port
- list terminals for the selected scope
- subscribe once to `window.poolDesktop.terminals.onEvent`
- keep per-scope selected terminal tab
- open/close the dock per scope
- create a first terminal on demand when the dock opens and the scope has none
- keep status summaries for sidebar display
- provide testable methods independent of `xterm.js`

`terminal-instance.svelte` should own the `xterm.js` object and addons:

- `@xterm/xterm`
- `@xterm/addon-fit`
- `@xterm/addon-web-links`
- `@xterm/addon-search` in a later slice if search UI is included
- `@xterm/addon-clipboard` if native browser clipboard behavior is not enough

Use a `ResizeObserver` to call `fitAddon.fit()` and then send the resulting
`cols`/`rows` to Electron main. On mount, request a snapshot from main, write
the replay buffer into xterm, then stream new events.

### App Shell Integration

Edit:

- `src/app/shell/shell-composition.ts`
- `src/app/shell/shell.svelte`
- `src/app/shell/layout/chat-pane.svelte`
- `src/app/shell/layout/sidebar.svelte`
- `src/app/shell/keyboard.ts`
- `src/lib/keyboard/shortcuts.ts`

UI placement:

- Add a terminal icon button next to the artifact viewer toggle in the chat
  header.
- The button toggles the bottom dock for the selected chat.
- The terminal dock belongs in the chat column, below the transcript/composer
  stack, with a resizable top edge.
- Use the existing `Button`, `Tooltip`, and sidebar primitives.
- Use lucide's terminal icon.
- Keep the dock as a tool surface, not a nested card.
- Persist dock height locally per workspace or per conversation identity.

Suggested first layout behavior:

- Default height: 260 px.
- Minimum height: 160 px.
- Maximum height: 50 percent of the chat column.
- Double-click the resize handle to reset.
- `Esc` should close terminal search or terminal-local overlays first; it
  should not kill the PTY.

### Keyboard Handling

This is a correctness requirement, not polish.

When the xterm textarea is focused, app-level keyboard shortcuts must defer to
the terminal. The current app shell uses a capture-phase window keydown handler,
so terminal support must update shortcut routing before any terminal is shipped.

Plan:

- Mark terminal roots with a stable attribute, for example
  `data-terminal-key-owner`.
- Add `isTerminalTarget()` to `src/lib/keyboard/shortcuts.ts`.
- Make `handleAppShellKeydown` return early for terminal targets, except for an
  explicit global "toggle terminal" shortcut if we decide it should work while
  focused.
- Ensure type-to-compose ignores terminal targets.
- Do not intercept terminal-critical shortcuts such as `Ctrl+C`, `Ctrl+D`,
  `Ctrl+Z`, `Ctrl+R`, arrow keys, `Tab`, `Esc`, `Cmd+C`, and paste chords.
- Wire `Terminal.onData` to `terminals.write`.
- Wire `Terminal.onBinary` to `terminals.writeBinary` so mouse reports and
  non-UTF-8-compatible data are not dropped.

Add a shortcut only after this is in place. Recommended binding:
`toggle-terminal` as `Mod+Backquote`, shown in the terminal button tooltip.

### Sidebar Indicators

Extend `AppSidebar` with terminal summaries from the terminal controller.

Initial summary shape:

```typescript
type TerminalScopeSummary = {
  scopeKey: string;

[truncated for eval fixture]
