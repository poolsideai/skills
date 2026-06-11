We need to understand this multi-language repository before handing it off. Create
a structural map showing what the project is, which languages are used, where
execution starts, the important directories, and how to run tests.

Write the map to `.laguna/repo-map.json` (create the `.laguna/` directory if it
doesn't exist). The file must be a single JSON object with these fields:

- `schema_version`: the string `"repo-map.v1"`
- `summary`: what the repository is and does, maximum 500 characters
- `languages`: array of `{"name", "evidence"}` objects where name is a lowercase
  language name and evidence is the path of one source file in that language
- `frameworks`: array of `{"name", "evidence"}` objects where evidence is a
  dependency manifest or framework config file that names the framework
  (use an empty array if there are no frameworks)
- `entrypoints`: array of `{"path", "description"}` objects showing where
  execution starts
- `key_directories`: array of `{"path", "role"}` objects for directories
  someone needs to know about
- `test_commands`: array of commands that run the tests (empty array only if
  there are no tests)

Be precise: every path must exist in the repository, framework claims must be
backed by a manifest file that actually names the framework (not documentation),
and test commands must be supported by repo files.
