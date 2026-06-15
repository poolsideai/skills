Before any deeper exploration of this Go workspace, produce a quick
lay-of-the-land inventory: every top-level entry, whether it is a file or a
directory, and a recursive file count for each directory.

The workspace is a small Go monorepo where the interesting code lives two
levels deep — for example, files under `cmd/` are inside per-binary
subdirectories rather than directly in `cmd/`. A directory's `file_count`
must include every regular file underneath it, however deep, not just
files in the immediate child.

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
file-kind entry plus every directory `file_count`. If you cannot produce a
faithful inventory, say so in your final message rather than guessing.
