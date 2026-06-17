# Conversation Search Implementation Plan

## Goal

Add fast, native-feeling search for the conversation list. The first version
should search user prompts across all projects for the currently selected agent
runtime, show the project context for each hit, and open the matched
conversation from a lightweight popup dialog.

## Product Shape

- Add a sidebar Search action, preferably in the footer above Settings so it is
  available from every chat state without competing with New chat.
- Open search in an overlay dialog, not a route or page.
- Also support `Cmd/Ctrl+K` as the global shortcut. `Escape` closes the dialog.
- Search across every project and no-project workspace for the current runtime
  selection. Do not restrict results to the selected project scope.
- Default search scope is user-authored prompts only.
- Results should show project context naturally:
  - first line: project label, or `No project` for app-managed workspaces
  - second line: conversation title and/or matching prompt snippet
  - quiet metadata: relative activity time, optional runtime/agent label when it
    disambiguates
- Selecting a result closes the dialog and loads the conversation.

## Current Codebase Facts

- Conversation metadata is persisted in SQLite through `electron/db/database.ts`.
- The main table is `conversations`; it has:
  - `pool_session_id`
  - `workspace_id`
  - `runtime_kind`
  - `title`
  - `initial_prompt`
  - `agent_name`
  - `model_id`
  - `last_activity_at`
  - `metadata_json`
- Workspaces live in `workspaces`; `conversations.workspace_id` joins to
  `workspaces.id`.
- The sidebar list is built by `SessionCatalogService.refreshSessions()` and
  filtered in `src/features/projects/project-scope.ts`.
- The current sidebar project filter is intentionally not the right behavior for
  search: `filterSessionsByScope()` limits the sidebar to the selected project
  or no-project scope, while search should ignore that project selection.
- Runtime metadata already exists:
  - Pool conversations use `runtime_kind = "pool"` and may have `agent_name`.
  - Goose/Hermes conversations use `runtime_kind = "goose"` or `"hermes"` and
    normally use `model_id`.
- Existing hidden/non-chat filtering lives in
  `isVisibleConversationRecord()` in `src/lib/acp/session/shared.ts`:
  archived, task-origin, and scheduled-origin conversations are hidden.
- User and agent transcript snapshots are stored in
  `metadata_json.transcript.events` through `conversation-persistence.ts`.
  Attachment payloads are scrubbed, but text content is preserved for current
  snapshots.
- Legacy databases that passed through the v3 to v4 migration may have transcript
  content stripped from `metadata_json`; for those records, only
  `initial_prompt` can be reliably indexed.
- There used to be a `conversation_search` table/triggers in a version-1 schema;
  current migrations explicitly drop them. Do not reuse that old table name
  without checking for compatibility.

## Important SQLite Constraint

Do not assume FTS5 exists everywhere.

Observed locally:

- Node 23.11.0 `node:sqlite`: SQLite 3.49.1, `ENABLE_FTS5 = 0`, FTS virtual
  tables fail.
- Electron 41.1.0 with `ELECTRON_RUN_AS_NODE=1`: Node 24.14.0, SQLite 3.51.2,
  `ENABLE_FTS5 = 1`, FTS5 works.

Most `AppDatabase` tests run under Node, not Electron. A migration that blindly
creates `USING fts5` will break the test/runtime surface outside Electron.

The implementation should use a normal canonical table plus an optional FTS5
mirror:

- Always create/search the canonical table.
- Create and use the FTS5 mirror only when the active SQLite runtime supports
  it.
- Fall back to indexed normalized `LIKE` matching when FTS5 is unavailable.

## Data Model

Add schema at database user version 11.

Canonical table:

```sql
CREATE TABLE IF NOT EXISTS conversation_search_entries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  body TEXT NOT NULL,
  normalized_body TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(conversation_id, message_id, source_kind)
);

CREATE INDEX IF NOT EXISTS idx_conversation_search_entries_conversation
  ON conversation_search_entries(conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_search_entries_source
  ON conversation_search_entries(source_kind);

CREATE INDEX IF NOT EXISTS idx_conversation_search_entries_normalized
  ON conversation_search_entries(normalized_body);
```

Optional FTS5 mirror:

```sql
CREATE VIRTUAL TABLE conversation_search_entries_fts USING fts5(
  entry_id UNINDEXED,
  body,
  tokenize = 'unicode61'
);
```

Recommended `source_kind` values:

- `initial_prompt`
- `title`
- `user_message`
- `agent_message` reserved for a later toggle

Use a stable synthetic `message_id` such as `initial_prompt` for the
`initial_prompt` source. Do not rely on a nullable `message_id` for uniqueness;
SQLite allows multiple `NULL` values in a unique constraint.

MVP indexing:

- Index `initial_prompt` as a fallback.
- Index `title` as a legacy fallback only when no user-authored prompt text can
  be recovered from `initial_prompt` or `metadata_json`.
- Index visible transcript `user_message` text blocks.
- Do not index `agent_message` by default, but keep the schema/API ready for it.
- Do not index `agent_thought`, tool call content, injected skill context,
  memory prelude text, or attachment binary/blob/resource payloads.

## Indexing Strategy

Create a small indexing module with no renderer dependencies. Suggested path:

- `src/lib/db/conversation-search.ts` for shared types and pure extraction
  helpers, or
- `electron/db/conversation-search.ts` if the parser only needs Electron DB
  access.

Avoid importing `src/lib/acp/conversation-persistence.ts` directly into
`electron/db/database.ts`; that module currently carries renderer logging
dependencies. Keep the parser boundary explicit and validated.

Extraction rules:

1. Parse `metadata_json` as unknown.
2. Validate only the small shape needed for search:
   `transcript.events[]`, `eventKind`, `messageId`, `content[]`, text blocks.
3. Extract text from user-message content blocks where `type === "text"` and
   `text` is a non-empty string.
4. Join multiple text blocks for the same message with blank lines.
5. Fall back to `initial_prompt` when no equivalent first user-message entry is
   present.
6. Fall back to `title` only when neither transcript user text nor
   `initial_prompt` is available.
7. Normalize for fallback search with lowercasing and whitespace collapse.
8. Delete and rebuild all search entries for a conversation whenever its
   `title`, `initial_prompt`, or `metadata_json` changes.

Hook the index update in `AppDatabase.saveConversation()` after insert/update
returns the persisted row. Keep it centralized there so every save path,
including prompt completion, load replay, scheduled-run conversations, and
imports, stays indexed.

Backfill:

- During the v11 migration, create the canonical schema, create FTS if supported,
  then rebuild entries for all existing conversations.
- On startup/constructor, call an idempotent
  `ensureConversationSearchSchema()` after migrations. If FTS is newly available
  and the FTS table is absent or empty, create/rebuild it from the canonical
  entries. This covers the Node-test/no-FTS to Electron/FTS transition.

## Search API

Extend `src/lib/db/types.ts`:

```ts
export type ConversationSearchSourceKind =
  | "initial_prompt"
  | "title"
  | "user_message"
  | "agent_message";

export type SearchConversationsInput = {
  query: string;
  runtimeKind?: RuntimeKind | null;
  agentName?: string | null;
  sourceKinds?: ConversationSearchSourceKind[] | null;
  limit?: number | null;
  sort?: "date" | "relevance" | null;
};

export type ConversationSearchResult = {
  conversationId: string;
  poolSessionId: string;
  workspacePath: string;
  workspaceLabel: string | null;
  workspaceKind: WorkspaceKind;
  projectPath: string | null;
  projectLabel: string | null;
  runtimeKind: RuntimeKind | null;
  agentName: string | null;
  modelId: string | null;
  title: string | null;
  updatedAt: string;
  messageId: string | null;
  sourceKind: ConversationSearchSourceKind;
  snippet: string;
  rank: number;
};
```

Add `searchConversations(input)` to:

- `DbApi`
- `ConversationMetadataStore` only if the renderer session layer should call it
  through that abstraction
- `createDesktopConversationMetadataStore()`
- `DesktopHost.db`
- `electron/preload.ts`
- `electron/ipc/register-handlers.ts`

IPC boundary validation:

- Add Zod validation for the new search input in `register-handlers.ts`.
- Consider adding Zod validation for existing DB handlers separately; do not
  broaden this PR unless the implementation is already touching those handlers.

Search behavior:

- Trim query; return `[]` for empty or one-character queries.
- Default `sourceKinds` to `["initial_prompt", "user_message"]`.
- Default `limit` to 30 or 40.
- Require `pool_session_id IS NOT NULL` so results can be opened as chats.
- Exclude hidden records:
  - `conversations.status = 'archived'`
  - `conversations.origin IN ('task', 'scheduled')`
- Filter by exact `runtime_kind` when the caller provides one.
- For Pool, the dialog searches the current runtime by default rather than the
  exact current Pool agent name, because legacy databases can contain renamed
  agents or missing agent names. The DB API still supports exact `agent_name`
  filtering for callers that explicitly need it.
- For Goose/Hermes, use exact `runtime_kind` for MVP. Do not reuse the sidebar's
  broad `model` family filter unless product decides Hermes and Goose should be
  searched together.
- Default the dialog to date sorting using `last_activity_at`/`updated_at`, with
  a compact relevance toggle available in the search dialog. Fallback relevance
  ranking can use token hit count plus recency.

## FTS Query Notes

Use a safe FTS query builder; do not pass raw user query grammar directly to
`MATCH`.

Practical MVP:

- Split the query into terms on whitespace.
- Drop empty terms.
- Quote terms or escape embedded quote characters.
- Use prefix matching for terms with length >= 2, e.g. `"deploy"*`.
- Combine with `AND` semantics so `foo bar` means both terms should appear.

Fallback `LIKE` search:

- Normalize the query the same way as `normalized_body`.
- For multiple terms, require every term to be present in `normalized_body`.
- This is slower than FTS but keeps Node tests and non-Electron tooling working.

## Renderer State and UI

Suggested files:

- `src/features/chat/conversation-search-controller.svelte.ts`
- `src/features/chat/components/conversation-search-dialog.svelte`
- `src/app/components/app-sidebar.svelte`
- `src/app/app-shell-controller.svelte.ts`
- `src/app/app-shell.svelte`

Controller responsibilities:

- `isOpen`
- `query`
- `isSearching`
- `results`
- `error`
- `selectedIndex`
- debounced `search()`
- `open()`, `close()`, `selectNext()`, `selectPrevious()`
- `openResult(result)` callback wired to the shell

Dialog behavior:

- Overlay similar to `connector-manager-dialog.svelte`, but narrower
  (`max-w-2xl` or `max-w-3xl`) and optimized for keyboard use.
- Use existing primitives: `Button`, `Input`, `ScrollArea`, `Badge` if needed.
- Use lucide `Search` for the sidebar and input icon.
- Autofocus input when opened.
- Arrow keys move the active result.
- `Enter` opens the active result.
- `Escape` closes.
- Result rows must have stable height and no layout shift while loading.
- Avoid explanatory filler copy. Empty states can be simple:
  - no query: `Search conversations`
  - no results: `No conversations found`

Sidebar:

- Add Search button near Settings in the footer, or just above the footer
  divider.
- Disable in non-desktop preview mode.
- `data-testid="open-conversation-search"` for tests.

Opening a result:

- Construct a `SessionInfo`-compatible object:
  - `sessionId: result.poolSessionId`
  - `cwd: result.workspacePath`
  - `title: result.title`
  - `updatedAt: result.updatedAt`
- Call `shell.openChatSession(session)`.
- Close the dialog after a successful open request is started.

## Runtime Filter Construction

Build the filter from current app state, not selected project state.

Recommended renderer input:

```ts
{
  runtimeKind: acp.configStatus?.runtimeKind ?? null,
  agentName:
    acp.configStatus?.runtimeKind === "pool"
      ? acp.effectivePromptAgentName ?? acp.selectedAgentName ?? acp.configStatus?.agentName ?? null
      : null,
}
```

This matches the user's request that Poolside-agent searches should not return
Goose-agent conversations and vice versa. The exact Pool `agent_name` filter is
best-effort because older imported/persisted conversations may not have
`agent_name`.

## Tests

Database tests:

- `tests/electron/database.test.ts`
  - creates search schema without FTS under Node
  - indexes `initial_prompt`
  - indexes transcript user messages from `metadata_json`
  - excludes archived/task/scheduled conversations
  - filters by runtime kind
  - filters Pool by `agent_name` when supplied
  - searches across multiple workspace/project paths
  - returns project labels and no-project labels correctly
  - backfills existing conversations during migration
  - rebuilds entries after a conversation metadata update

Pure parser tests:

- Add tests for the extraction helper:
  - multiple user messages
  - multi-block text message
  - ignored agent/tool/thought entries for MVP
  - malformed JSON or malformed events
  - attachment/resource blocks are ignored

Renderer tests:

- `tests/ui/app-sidebar.test.ts`
  - renders the Search action
  - invokes the shell/controller open callback
- Add `tests/ui/conversation-search-dialog.test.ts`
  - focuses input
  - calls `searchConversations` with runtime filter, not project filter
  - renders project label and snippet
  - keyboard navigation opens the selected result
  - Escape closes
  - shows empty/error states

Session/shell tests:

- Add or extend shell controller tests to verify `openResult()` calls
  `openChatSession()` with `poolSessionId`, workspace path, title, and updated
  timestamp.

Verification:

- Targeted while implementing:
  - `pnpm exec vitest --run tests/electron/database.test.ts`
  - `pnpm exec vitest --run tests/ui/app-sidebar.test.ts`
  - `pnpm exec vitest --run tests/ui/conversation-search-dialog.test.ts`
- Before handoff:
  - `pnpm lint`
  - `pnpm verify:quick`

## Implementation Order

1. Add shared search types and a pure transcript/initial-prompt extraction
   helper.
2. Add database schema, FTS capability detection, canonical index sync, optional
   FTS mirror sync, and migration/backfill.
3. Add `AppDatabase.searchConversations()` with FTS and fallback branches.
4. Add IPC/preload/desktop host plumbing and renderer store access.
5. Add search controller and dialog.
6. Add sidebar button and global shortcut.
7. Add tests in the same order: parser, database, API plumbing, UI.
8. Run targeted tests, then `pnpm lint` and `pnpm verify:quick`.

## Non-Goals for MVP

- Searching assistant replies by default.
- Searching tool calls, file contents, or generated artifacts.
- Searching across all runtimes at once.
- Remote/server-side search.
- Semantic/vector search.
- Highlighting every matched token in rich text. A plain snippet is enough.
- Reworking the existing sidebar project filtering behavior.

## Open Product Questions

1. Should Pool search filter by exact `agent_name`, or is `runtime_kind = "pool"`
   enough when older conversations lack agent metadata?
2. Should Hermes be searched with Goose as one "model-agent" family, or should
   it be exact-runtime only?
3. Should we add an explicit toggle for assistant replies in the first release,
   or keep the schema ready and ship user prompts only?
4. Should an empty search dialog show recent conversations across all projects,
   or stay blank until the user types?

Recommended MVP answers:

- Exact `runtime_kind`; exact Pool `agent_name` only when known.
- Exact Goose vs Hermes.
- User prompts only.
- Blank/recent-free initial state to keep scope small.
