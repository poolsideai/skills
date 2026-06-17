# Google Drive MCP File Operations Plan

Status: P1/P2 implemented; `pnpm verify:quick` blocked by an unrelated
agent-loop test failure.

Progress:

- 2026-05-23: Started P1 listing/search contract implementation.
- 2026-05-23: Implemented P1/P2 tool surface and focused Google Workspace
  tests; full verification still pending.
- 2026-05-23: `pnpm check`, `pnpm lint`, and targeted Google Workspace tests
  pass. `pnpm verify:quick` is blocked by unrelated
  `tests/electron/agent-loop-worktree-root.test.ts` path expectation failures
  (`poolside-studio` expected, `pool-desktop` actual).
- 2026-05-23: Structural architecture test passes after extracting the Google
  Workspace CLI process runner.
- 2026-05-23: Follow-up from trajectories
  `019e53bc-7ec6-7d65-8bb3-4ca62525` and
  `019e53bc-c3b2-7017-b12e-906d92a323af`: default Drive listing pages should
  return at least 50 items, and summaries must explicitly say when
  `nextPageToken` means more results are available. `incompleteSearch: false`
  is not a pagination completion signal.
- 2026-05-23: Follow-up on model confusion risk: Drive list/search tool payloads
  now expose `pagination.hasMore` as the paging source of truth and move
  `incompleteSearch` under `searchCoverage` with an explicit note that it is not
  a pagination signal.
- 2026-05-23: Targeted Google Workspace and structural tests pass after the
  `pagination.hasMore` follow-up; `pnpm check` and `pnpm lint` also pass.
- 2026-05-23: Re-ran `pnpm verify:quick`; it still fails only in the unrelated
  `tests/electron/agent-loop-worktree-root.test.ts` path expectation cases.
- 2026-05-23: Follow-up from trajectories
  `019e53ca-0e96-7207-9837-9a03b647bfcc` and
  `019e53c9-e73f-7d75-8b0f-02fb2f70ea75`: agents saw `hasMore` but treated
  the first page as user-answerable. Updated summaries to say items are
  "shown on this page", raised Drive-backed helper page size default/cap to
  100, and added `pageToken` to Docs/Sheets search helpers.
- 2026-05-23: Targeted Google Workspace and structural tests pass after the
  page-size/messaging follow-up; `pnpm check` and `pnpm lint` pass.
  `pnpm verify:quick` remains blocked only by the unrelated
  `tests/electron/agent-loop-worktree-root.test.ts` path expectation cases.
- 2026-05-23: Re-ran `pnpm verify:quick` after the pagination follow-up. It
  remains blocked only by the unrelated
  `tests/electron/agent-loop-worktree-root.test.ts` path expectation failures
  (`poolside-studio` expected, `pool-desktop` actual).
- 2026-05-23: Follow-up from upload trajectory
  `019e53d2-b847-7353-8676-53cd`: bundled `gws` rejects `--upload` paths
  outside its process current directory. Fixed the MCP CLI wrapper to run
  upload commands from the upload file's parent directory so absolute
  `localPath`, `content`, and `base64Content` uploads do not require model-side
  cwd workarounds.
- 2026-05-23: Targeted Google Workspace and structural tests pass after the
  upload cwd fix; `pnpm check` and `pnpm lint` pass. `pnpm verify:quick`
  remains blocked only by the unrelated
  `tests/electron/agent-loop-worktree-root.test.ts` path expectation cases.
- 2026-05-23: Follow-up from download trajectory
  `019e53dd-875b-7766-905e-d51c`: bundled `gws` applies the same current
  directory validation to `--output`. Fixed binary download and Google-native
  export to run from the output file's parent directory, and confirmed the only
  path-sensitive `gws` flags in the wrapper are now covered: `--upload` and
  `--output`.
- 2026-05-23: Targeted Google Workspace and structural tests pass after the
  output cwd fix; `pnpm check` and `pnpm lint` pass. `pnpm verify:quick`
  remains blocked only by the unrelated
  `tests/electron/agent-loop-worktree-root.test.ts` path expectation cases.

## Goal

Make Google Drive MCP reliable for common file workflows by adding generic
listing, upload, update, download, and export operations that agents can use
without raw Drive query syntax or direct shell access to the bundled `gws` CLI.

## Context

Recent trajectories showed two avoidable failures:

- The model called `google_drive_search_files` with `query: "*"`, which is not
  valid Google Drive query syntax. It recovered only after retrying with
  `query: "trashed = false"`.
- The model correctly noticed that no MCP upload tool exists, then tried to
  fall back to shell `gws`. That fallback is not valid for real users because
  Studio injects connector OAuth tokens only into the MCP-owned `gws`
  invocation, not into arbitrary shell commands.

Relevant local evidence:

- `.poolside-studio/dev-profiles/vite-1420/trajectories/list-google-drive-files-dir-i-have-an-access-to-019e538a-91ae-7318-a5fa-511f49f6.json`
- `electron/connectors/google-workspace/google-workspace-helper-tools.ts`
- `electron/connectors/google-workspace/google-workspace-cli.ts`
- `electron/connectors/google-workspace/google-workspace-generated-tool-registry.ts`
- `scripts/generate-google-workspace-tool-registry.mjs`

Current Drive MCP coverage includes search, metadata get/update, copy, delete,
comments, permissions, and revisions. It does not include a usable generic
`files.create` upload helper, `files.export`, or a binary download helper.
`google_drive_get_file_metadata` documents `alt=media`, but the current CLI
runtime path expects JSON output, so it should not be treated as a content
download method.

## Design Principles

- Prefer generic file operations over content-type-specific tools.
- Keep raw Drive query syntax available for advanced searches, but avoid making
  it the default path for common listing.
- Use MCP tools for Google Workspace operations. Do not instruct agents to call
  `gws` directly from shell.
- Keep connector OAuth and Google Workspace CLI execution encapsulated in
  Electron main.
- Allow agents to upload any readable local file path through the MCP tool. This
  is intentional: the tool represents a user-authorized local connector action,
  not a workspace-sandboxed file picker.
- Pass workspace context where practical for relative path convenience, but do
  not treat the workspace as a security boundary for Drive upload.
- Return local file paths and compact metadata for binary operations; do not
  embed large binary data in MCP text output.
- Include Shared drives by default for Drive file operations, while still
  allowing explicit opt-out when the API supports it.

## Proposed Tool Surface

### `google_drive_list_files`

Safe common listing tool. This should be the first tool the model reaches for
when the user asks to list files or folders.

Inputs:

```ts
{
  pageSize?: number;
  pageToken?: string;
  folderId?: string;
  nameContains?: string;
  mimeType?: string;
  includeSharedDrives?: boolean; // default true
}
```

Behavior:

- Builds valid Drive query syntax internally.
- Defaults `pageSize` to 100 and caps explicit `pageSize` at 100 for compact
  MCP responses.
- Omits raw `query` entirely from this safe tool.
- Uses `folderId` to list direct children via `'<folderId>' in parents`.
- Uses `mimeType` as a separate exact filter.
- Returns `pagination.hasMore`, `pagination.nextPageToken`, and enough metadata
  for follow-up calls. If `pagination.hasMore` is true, more results are
  available. `searchCoverage.incompleteSearch` is Google Drive search coverage,
  not pagination completeness.

Recommended returned fields:

- `id`
- `name`
- `mimeType`
- `webViewLink`
- `modifiedTime`
- `parents`
- `driveId`
- `owners`

### Improve `google_drive_search_files`

Keep this as the advanced raw-query tool.

Changes:

- Keep `includeSharedDrives` defaulting to `true`.
- Default page size to 100.
- Add `pageToken`.
- Treat omitted `query` as “list accessible non-trash files.”
- Normalize `query: "*"` as an omitted query so common listing succeeds instead
  of surfacing Google Drive's `Invalid Value` error.
- Strengthen tool description and `describe_tool` help:
  `query` uses Google Drive query syntax, not shell globs or natural language.
  Prefer `google_drive_list_files` for normal listing.

### `google_drive_create_file`

Generic create/upload operation.

Inputs:

```ts
{
  localPath?: string;
  content?: string;
  base64Content?: string;
  name?: string;
  parentFolderId?: string;
  mimeType?: string;
  uploadContentType?: string;
  description?: string;
  fields?: string;
  includeSharedDrives?: boolean; // default true
}
```

Rules:

- `localPath` is the primary upload path and should accept any local file the
  app process can read.
- If `localPath` is present and `name` is omitted, derive `name` from the local
  file basename.
- `content` is for generated text, Markdown, JSON, or other small text payloads.
- `base64Content` is for arbitrary bytes when the model does not already have a
  local file path.
- Folder creation uses `mimeType: "application/vnd.google-apps.folder"` with no
  content inputs.
- Exactly one content source is allowed: `localPath`, `content`,
  `base64Content`, or folder mode.
- `parentFolderId` maps to `body.parents = [parentFolderId]`.
- The MCP implementation may create a temporary file for `content` or
  `base64Content`, then call `gws drive files create --upload <path>` internally.

Output:

- Created file metadata.
- `webViewLink` when available.
- The effective `name`, `mimeType`, parent, and content source kind.

### `google_drive_update_file_content`

Generic content replacement/update operation for an existing Drive file.

Inputs:

```ts
{
  fileId: string;
  localPath?: string;
  content?: string;
  base64Content?: string;
  name?: string;
  mimeType?: string;
  uploadContentType?: string;
  fields?: string;
  includeSharedDrives?: boolean; // default true
}
```

Rules:

- Same content-source validation as `google_drive_create_file`, excluding folder
  creation mode.
- Uses `gws drive files update --upload <path>` internally when content is
  present.
- Requires a content source and creates/replaces file content as a new Drive
  revision. Metadata-only patching stays with the existing
  `google_drive_update_file_metadata` tool.

### `google_drive_download_file`

Generic download/export operation.

Inputs:

```ts
{
  fileId: string;
  outputPath?: string;
  outputDirectory?: string;
  exportMimeType?: string;
  includeSharedDrives?: boolean; // default true
}
```

Behavior:

- For binary Drive files, call `files.get` with `alt=media` and `--output`.
- For Google Docs, Sheets, Slides, and other Google-native files, call
  `files.export` and infer a default `exportMimeType` for Docs, Sheets, and
  Slides unless the caller provides one.
- If `outputPath` is omitted, derive a safe filename under `outputDirectory` or
  the session workspace.
- Return the local output path, Drive file metadata, export MIME type if used,
  byte count when available, and whether the operation was a download or export.

Do not return binary bytes in the MCP response.

## Implementation Notes

### CLI Runtime

Extend `GoogleWorkspaceCliLike` and `GoogleWorkspaceCli` with methods for:

- listing files with `pageToken`
- creating files with optional upload path/content via the existing bundled
  `gws --upload` flag
- updating file content via the existing bundled `gws --upload` flag
- downloading/exporting file content to disk via the existing bundled
  `gws --output` flag

The existing private `runJsonCommand()` assumes JSON stdout. Add a sibling
runner for file-output commands that:

- resolves the bundled `gws` executable exactly like `runJsonCommand()`
- injects the same OAuth env
- supports `--output <path>`
- runs upload commands from the upload file's parent directory and output
  commands from the output file's parent directory because bundled `gws`
  validates that `--upload`/`--output` resolve under the process current
  directory
- preserves the current diagnostic/error style
- does not parse stdout as JSON when the output path contains the payload

### Local Path Policy

Validate local file paths before passing them to `gws`:

- `localPath` must exist and be a file.
- Parent directory for `outputPath` must exist or be created intentionally by
  the helper.
- Absolute `localPath` values may point anywhere the Electron main process can
  read.
- Relative `localPath`, `outputPath`, and `outputDirectory` values should resolve
  from the chat workspace when connector MCP calls have workspace context.
  Without workspace context, require absolute paths for file inputs and use an
  app-owned download directory for derived outputs.
- Workspace context is for path ergonomics and predictable output placement. It
  is not an upload permission boundary.

### Temporary Files

For `content` and `base64Content` uploads:

- write a temporary file under an app-owned temp directory
- set mode/permissions conservatively
- delete the temp file in `finally`
- avoid logging content

### Tool Guidance

Add clear guidance in Google Workspace tool descriptions and `describe_tool`
responses:

- Use Google Workspace MCP tools for Drive operations.
- Do not call the bundled `gws` binary from shell.
- The `gws` binary and `GOOGLE_WORKSPACE_CLI_TOKEN` are internal MCP
  implementation details.
- Real user shells do not receive connector OAuth tokens.

### Existing Connector Users

No OAuth reconnect, connector reinstall, or connector migration should be
required. Existing enabled Google Drive & Docs connector records should expose
the new tools after app update.

Treat active already-open chats as best-effort. Some runtimes cache the tool
inventory at session start, so a new chat/session may still be required for a
model to see newly added tool names.

## Priority Split

### P1: Safer Listing And Tool Contract

- [x] Add `pageToken` support to `GoogleWorkspaceCli.searchDriveFiles`.
- [x] Default Drive list/search helper page size to 100.
- [x] Add `google_drive_list_files`.
- [x] Normalize `query: "*"` as an omitted query.
- [x] Add a shared Drive query builder for list/search helpers with escaping for
      folder IDs, `nameContains`, MIME types, apostrophes, and backslashes.
- [x] Update manual tool help for `google_drive_search_files`.
- [x] Add clear “do not call `gws` directly” guidance to tool descriptions and
      `describe_tool`.
- [x] Pass workspace context into Google Workspace connector MCP sessions if the
      connector handoff can do so cleanly; otherwise document that v1 requires
      absolute upload paths and derives downloads under an app-owned directory.
- [x] Add tests for omitted query, `query: "*"`, folder listing, page token, and
      Shared drives default.
- [x] Add tests that a returned `nextPageToken` is explained as "more results
      are available" in the text summary.
- [x] Add schema compatibility tests for the new manual tools.

### P2: Generic File Operations

- [x] Add `GoogleWorkspaceCli` wrappers around existing `gws --upload`,
      `--upload-content-type`, and `--output` support.
- [x] Add `google_drive_create_file`.
- [x] Support `localPath`, `content`, `base64Content`, and folder creation.
- [x] Add local-path and temp-file cleanup tests.
- [x] Add MCP integration tests that verify normalized `gws` arguments without
      invoking real Google APIs.
- [x] Add `google_drive_update_file_content`.
- [x] Require a content source for `google_drive_update_file_content`; keep
      metadata-only changes on `google_drive_update_file_metadata`.
- [x] Add `google_drive_download_file`.
- [x] Support binary download with `alt=media`.
- [x] Support Google-native export with `files.export`.
- [x] Add default export MIME choices for Docs, Sheets, and Slides, with
      explicit caller override.
- [x] Keep overwrite-by-name out of scope. Agents should search/list first, then
      update by explicit `fileId` when replacing an existing Drive file.
- [x] Add output path safety and byte-count tests.
- [x] Update tests that inspect tool help.

### P3: Deferred

Not needed for the current implementation pass:

- [ ] Best-effort MCP tool-list-changed notifications for active sessions.
- [ ] Tool-list cache invalidation keyed by tool registry/version, if current
      connector cache behavior proves stale after app update.
- [ ] Inline small-text download responses with strict size limits.
- [ ] Additional guidance for duplicate Drive names, shared-drive narrowing, and
      export format tradeoffs beyond the basic tool help.

## Verification

Required checks:

- [x] `pnpm lint`
- [x] `pnpm test -- tests/electron/connector-service-google-workspace.test.ts tests/electron/google-workspace-cli.test.ts`
- [x] `pnpm check`
- [ ] `pnpm verify:quick` before handoff, unless blocked by an unrelated known
      suite failure called out in the handoff. Attempted on 2026-05-23; blocked
      only by `tests/electron/agent-loop-worktree-root.test.ts`, which expects
      generated worktrees under `poolside-studio` while this checkout produces
      `pool-desktop`.

Targeted behavior checks:

- [x] A model can list files without providing a raw `query`.
- [x] `query: "*"` succeeds as a safe listing instead of returning a Google
      `Invalid Value` error.
- [x] Default Drive listing/search pages return 100 items unless the caller sets
      a smaller `pageSize`.
- [x] Tool summaries explicitly say that `pagination.hasMore`/`nextPageToken`
      mean more pages are available, and that
      `searchCoverage.incompleteSearch` is not a pagination signal.
- [x] A local file path can be uploaded to Drive through MCP.
- [x] Inline text/base64 content can be uploaded through MCP without shell
      `gws`.
- [x] A binary Drive file can be downloaded to a local path.
- [x] A Google Doc/Sheet/Slide can be exported to a local path.
- [x] Tool help explicitly discourages direct shell `gws` use.

## Open Questions

- Resolved: connector MCP calls do not receive workspace-relative path context
  cleanly in this pass. v1 rejects relative upload/output inputs and derives
  omitted downloads under an app-owned Google Workspace downloads directory.

[truncated for eval fixture]
