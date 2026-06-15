We are handing this workspace to an automation agent that has never seen it.
Before doing any deeper work, produce a quick lay-of-the-land inventory it can
rely on: every top-level entry, whether each is a file or a directory, and a
recursive file count for each directory.

Write the inventory to `.laguna/workspace-inventory.json` (create the
`.laguna/` directory if needed). The file must be a single JSON object with
exactly these fields:

- `schema_version`: the string `"workspace-inventory.v1"`
- `total_files`: a non-negative integer — the total number of regular files
  in the workspace, counted recursively, excluding `.laguna/` itself
- `entries`: an array, sorted lexicographically by `name`, with one object
  per top-level entry (excluding `.laguna/` and symlinks):
  - `name`: the basename of the entry (no path separators)
  - `kind`: either `"file"` or `"directory"`
  - `file_count`: required on directories only — a non-negative integer
    counting every regular file contained recursively inside that directory

Accuracy matters: every name you list must really exist at the workspace
root with the kind you claim, every directory's `file_count` must match the
real recursive count, and `total_files` must equal the sum of every
file-kind entry plus every directory `file_count`.
