# Beads Fixture: File Beads Exact Match

This fixture tests selection precision for file-specific Bead queries.

## Graph

- `bd-305`: Exact file match for `src/api/handlers/user.ts`, ready and unblocked.
- `bd-301`: Parent directory match, blocked and higher PageRank.
- `bd-303`: Description reference, unrelated file path.

## Expected Selection

The correct Bead is `bd-305` because it is the only exact file match and ready.
