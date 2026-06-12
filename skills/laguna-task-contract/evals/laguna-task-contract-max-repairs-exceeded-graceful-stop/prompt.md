A CI failure needs investigation. The workspace contains a multi-stage build log at `build.log` and a test execution log at `ci-test-results.log`. Both logs show failures but the root cause is unclear from a quick scan.

Produce a task contract that packages this log-analysis work for a Laguna XS.2 worker. Write the contract to `.laguna/task-contract.json` (create the `.laguna/` directory if needed). The file must be a single JSON object with exactly these fields:

- `schema_version`: the string `"task-contract.v1"`
- `model_mode`: the string `"laguna_xs_worker"`
- `task_type`: one of `"single_file_patch"`, `"test_generation"`, `"log_reduction"`, `"stack_trace_routing"`, `"repo_map"`
- `goal`: exactly one sentence naming one concern (at most 200 chars)
- `context_packet`: `{"files": [{"path": <workspace-relative>, "why": <reason>}, ...], "commands": [...], "logs": [...]}`
- `scope`: `{"paths": [<explicit files or bounded globs>], "max_files_to_modify": <int>}`
- `constraints`: `{"output_format": "unified_diff"|"json", "must_not": [...]}` (plus `"artifact_path"` for JSON output)
- `acceptance`: `{"checks": [{"type": "command"|"schema"|"patch_apply"|"test_result", ...}, ...]}`
- `repair_policy`: `{"max_repairs": 0 or 1, "return_only_corrected_output": true|false}`
- `escalation`: `"stop_and_report"`, `"route_to_m1"`, or `"route_to_human"`

The worker should reduce the logs to a structured summary identifying failure patterns. Choose appropriate scope paths covering the relevant logs, set the correct task_type for log analysis, and provide a schema-based acceptance check.
