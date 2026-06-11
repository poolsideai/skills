A bug report has arrived in the workspace at `bug-report.md`. The issue is vague but critical, and there's a partial stack trace at `trace-fragment.txt`. Two utility files are referenced in the repository — you can read them to understand the scope.

Produce a task contract that bounds the fix work for a Laguna XS.2 worker. Write the contract to `.laguna/task-contract.json` (create the `.laguna/` directory if needed). The file must be a single JSON object with exactly these fields:

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

Be explicit about scope: choose ONE concrete file to modify, even if the request is ambiguous. Document your reasoning in the context_packet 'why' field. Configure escalation appropriately if the chosen file might be wrong. Keep the contract bounded: a single-concern goal, explicit paths, and safe local acceptance checks.
