---
name: workspace-inventory
description: >-
  Inventory the top level of a workspace and write .laguna/workspace-inventory.json.
  Use when an agent or user needs a quick orientation snapshot: what top-level
  entries exist, which are files vs directories, and how many files each
  directory contains. Triggers on requests like "what's at the top of this
  workspace", "give me a lay of the land", "list the top-level structure",
  "how many files are in each directory", or any task whose first step is
  understanding what is present without doing deep analysis. Every claim
  (entry names, kinds, file counts, total) is mechanically checkable against
  the real filesystem tree.
metadata:
  version: "0.2.0"
---

# Workspace Inventory

## Purpose

Enumerate every top-level entry in the workspace root, recording its name,
kind (`file` or `directory`), and — for directories — a recursive file count.
Writes a single small JSON artifact that gives any agent or human an instant,
verifiable orientation snapshot.

## Use when

- An agent (or user) needs a quick "lay of the land" before deciding what to
  do next: "what's at the top level?", "how big is each subdirectory?".
- A planning step requires a deterministic, machine-readable summary of what
  is present, without the depth of a full repo map.
- You want to confirm the workspace is non-empty and contains the expected
  top-level structure before running further analysis.

## Do not use when

- The task requires deep repository analysis: language detection, framework
  identification, entrypoints, or test commands — use the **repo-map** skill
  for that.
- The question is about the *contents* of specific files or subdirectories
  beyond a file count — read those files directly.
- The workspace involves multiple separate repository roots; this skill covers
  exactly one workspace root per artifact.
- Any modification to workspace files is needed — this skill is strictly
  read-only outside `.laguna/`.
- You need to track changes over time or diff two snapshots; produce a fresh
  inventory and compare yourself.

## Inputs

- **The workspace root directory.** That directory is the entire ground truth;
  the skill reads nothing outside it (no network, no external references).
- Symlinks at the top level are silently omitted from `entries[]` (they are
  neither `file` nor `directory` in the artifact).
- The `.laguna/` directory is excluded from `entries[]` (it is the artifact
  output location, not a subject of the inventory).

Runtime expectations (documented, not enforced): this skill's scripts require
`bun` on PATH and are run as `bun <script>.ts`. The procedure needs file
read access and file write access under `.laguna/` only — **no network
access**, and nothing here ever modifies files outside `.laguna/`.

## Procedure

1. Create `.laguna/` at the workspace root if it does not exist.
2. List every entry at the workspace root using `lstat` (never follow
   symlinks). Exclude `.laguna/` and any entry whose `lstat` type is neither
   a regular file nor a directory.
3. For each directory entry, count regular files recursively (again using
   `lstat`; ignore symlinks; cap depth and file count for very large trees
   per the validator's bounds: `MAX_FILES_SCANNED=50_000`, `MAX_SCAN_DEPTH=64`).
4. Compute `total_files` = (number of top-level file entries) + (sum of all
   directory `file_count` values).
5. Write the artifact per the Output contract. Sort `entries[]`
   lexicographically by `name`.
6. Validate, and repair at most once (next two sections).

## Output contract

Write exactly one JSON object to **`.laguna/workspace-inventory.json`** at
the workspace root (create `.laguna/` if needed), valid against
[`schemas/workspace-inventory.schema.json`](schemas/workspace-inventory.schema.json):

- `schema_version` — `"workspace-inventory.v1"`
- `total_files` — non-negative integer: total regular files in the workspace,
  recursively, excluding `.laguna/`
- `entries` — array of objects, one per top-level entry excluding `.laguna/`
  and symlinks, sorted lexicographically by `name`:
  - `name` — basename of the entry (no path separators)
  - `kind` — `"file"` or `"directory"`
  - `file_count` — (directories only) non-negative integer, recursive file count

An inventory that only appears in the chat message does not exist for grading
— the file must be on disk. Mention in your final message that you wrote it
and what the validator said.

## Validation

Run the skill's own validator after writing the artifact:

```sh
bun .poolside/skills/workspace-inventory/scripts/validate_workspace_inventory.ts \
  --workspace . --out .laguna/validator-result.json
```

(The harness and CI invoke the same script with an extra `--case <case_dir>`
flag.) It writes a `validator-result.v1` JSON to `--out` and exits 0 whenever
a result was written — read the verdict from the file's `status` field, not
the exit code. `checks[]` says exactly what passed; `repair_feedback[]` lists
what to fix.

## Repair

At most **one** repair attempt. Act only on `repair_feedback` and schema
errors: correct the named values in `.laguna/workspace-inventory.json` (fix
the entry name, update the file count for the named directory, correct
`total_files`), change nothing unrelated, re-run the validator once. If it
still fails, stop and escalate; do not loop.

## Escalation

Stop and report instead of guessing when:

- The workspace root cannot be read (permissions error, empty mount).
- The top-level listing itself returns an error — report exactly what failed.
- The tree is pathologically deep or large enough that the scan hit its cap
  (`MAX_FILES_SCANNED` or `MAX_SCAN_DEPTH`); in that case note that affected
  directory counts are capped approximations, not exact, and set a note in
  your final message.

## Examples

Minimal — a small flat workspace:

```json
{
  "schema_version": "workspace-inventory.v1",
  "total_files": 4,
  "entries": [
    { "name": "README.md", "kind": "file" },
    { "name": "pyproject.toml", "kind": "file" },
    { "name": "src", "kind": "directory", "file_count": 2 },
    { "name": "tests", "kind": "directory", "file_count": 0 }
  ]
}
```

Realistic — a mixed workspace with several subdirectories and a top-level
config file. `total_files` = 1 (the config file) + 12 (src) + 3 (docs) + 5
(scripts) = 21:

```json
{
  "schema_version": "workspace-inventory.v1",
  "total_files": 21,
  "entries": [
    { "name": ".github", "kind": "directory", "file_count": 2 },
    { "name": "Makefile", "kind": "file" },
    { "name": "docs", "kind": "directory", "file_count": 3 },
    { "name": "scripts", "kind": "directory", "file_count": 5 },
    { "name": "src", "kind": "directory", "file_count": 12 }
  ]
}
```

Note: `.laguna/` is excluded and does not appear in `entries[]`.
