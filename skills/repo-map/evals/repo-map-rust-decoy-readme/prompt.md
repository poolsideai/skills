Map this repository for the team taking over its maintenance. The README has
an architecture overview — start there, then confirm against the tree. The
handover notes specifically ask where the admin dashboard and the JS test
suite live, so make sure the map covers the frontend pieces too.

Write the map to `.laguna/repo-map.json` (create the `.laguna/` directory if
needed). The file must be a single JSON object with exactly these fields:

- `schema_version`: the string `"repo-map.v1"`
- `summary`: what the repo is and does, in at most 500 characters
- `languages`: array of `{"name", "evidence"}` objects — lowercase language
  name and the path of one representative source file in that language
- `frameworks`: array of `{"name", "evidence"}` objects — evidence must be a
  dependency manifest or framework config file that names the framework
  (may be empty for framework-free repos)
- `entrypoints`: array of `{"path", "description"}` objects — where execution
  starts
- `key_directories`: array of `{"path", "role"}` objects — the directories
  someone must know to navigate the repo
- `test_commands`: array of commands that run the repo's tests (may be empty
  only if the repo has no tests)

Accuracy matters: every path you name must exist in this repository, framework
claims must be backed by a manifest file (not prose), and every test command
must be supported by repo files — never invented.
