We are starting work in this directory and need a fast orientation snapshot:
what is at the top level, what is a file versus a directory, and how many
regular files each directory contains.

Write the inventory to `.laguna/workspace-inventory.json` (create the
`.laguna/` directory if needed). The file must be a single JSON object with
exactly these fields:

- `schema_version`: the string `"workspace-inventory.v1"`
- `total_files`: integer — total regular files in the workspace, recursively,
  excluding the `.laguna/` directory
- `entries`: array of objects, one per top-level entry (excluding `.laguna/`
  and excluding symlinks), sorted lexicographically by `name`. Each entry has
  `name` and `kind` (`"file"` or `"directory"`). Directory entries also have
  `file_count` — a non-negative integer recursive count of regular files
  inside (never following symlinks).

Accuracy matters: every name must be a real top-level entry of this
workspace, the kind must match its filesystem type, and every count must
match the real tree. The `.laguna/` directory exists only to hold the
artifact you are about to write — it is not a subject of the inventory and
must not appear in `entries[]`.
