We need a structural map of this repository for an automation agent that has never
seen it before. Produce a JSON map that documents what the project is, which
languages are present, where execution starts, the important directories, and how
to run the tests.

Write the map to `.laguna/repo-map.json` at the workspace root (create the
`.laguna/` directory if needed). The file must be a single JSON object with these
fields:

- `schema_version`: the string `"repo-map.v1"`
- `summary`: what the repo is and does, maximum 500 characters
- `languages`: array of `{"name", "evidence"}` objects where name is a lowercase
  language name and evidence is the path to one representative source file
- `frameworks`: array of `{"name", "evidence"}` objects where evidence is a
  dependency manifest or config file that names the framework (use an empty array
  if there are no frameworks)
- `entrypoints`: array of `{"path", "description"}` objects showing where
  execution begins
- `key_directories`: array of `{"path", "role"}` objects for directories someone
  must know to navigate the repo
- `test_commands`: array of commands that run the tests (may be empty only if the
  repo has no tests)

Be accurate: every path must exist in this workspace, framework claims must cite
an actual manifest file (not documentation), and test commands must be supported
by files in the repository.
