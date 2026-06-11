We are handing this repository to an automation agent that has never seen it.
Produce a repository map it can rely on: what the project is, the languages in
the tree, where execution starts, which directories matter, and how to run the
tests. Note that not everything in the tree is application code — map what is
actually there.

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
