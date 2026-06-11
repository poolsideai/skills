The backend-tests CI job failed with several test failures at once. The full
log is at `ci.log` in the workspace root. Summarize every distinct failure —
do not stop at the first one.

Reduce the log to a structured failure summary and write it to
`.laguna/ci-log-summary.json` (create the `.laguna/` directory if needed). The
file must be a single JSON object with exactly these fields:

- `schema_version`: the string `"ci-log-summary.v1"`
- `log_file`: workspace-relative path of the log you analyzed
- `failing_command`: the command that actually failed
- `failure_kind`: one of `"test_failure"`, `"build_error"`, `"lint_error"`,
  `"infra_error"`, `"other"`
- `summary`: what failed and why, in at most 600 characters, covering all
  distinct failures
- `error_lines`: array of `{"line", "text"}` objects — 1-based line numbers in
  the log and the verbatim text of the decisive error lines for each failure
- `suggested_next_commands`: 1–5 safe, local commands a developer should run
  next (no network access, nothing destructive)

Accuracy matters: every cited line number must exist in the log, `text` must
match that line exactly, and `failing_command` must be supported by the log —
never invented.
