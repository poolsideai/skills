You need to prepare work for a Laguna XS.2 worker model. The engineering request is in `bug-report.md`, and the workspace contains a Python project with a failing test.

Produce a task contract that scopes this work for the worker. Write the contract to `.laguna/task-contract.json` (create the `.laguna/` directory if needed). The file must be a single JSON object with exactly these fields:

- `schema_version`: the string `"task-contract.v1"`
- `model_mode`: the string `"laguna_xs_worker"`
- `task_type`: one of `"single_file_patch"`, `"test_generation"`, `"log_reduction"`, `"stack_trace_routing"`, `"repo_map"`
- `goal`: exactly one sentence naming one concern (at most 200 chars)
- `context_packet`: `{"files": [{"path": <workspace-relative>, "why": <reason>}, ...], "commands": [...], "logs": [...]}`
- `scope`: `{"paths": [<explicit files or bounded globs>], "max_files_to_modify": <integer>}`
- `constraints`: `{"output_format": "unified_diff"|"json", "must_not": [...]}` (add `"artifact_path"` if output_format is `"json"`)
- `acceptance`: `{"checks": [{"type": "command"|"schema"|"patch_apply"|"test_result", ...}, ...]}`
- `repair_policy`: `{"max_repairs": 0 or 1, "return_only_corrected_output": true|false}`
- `escalation`: `"stop_and_report"`, `"route_to_m1"`, or `"route_to_human"`

Keep the contract bounded: one concern, explicit scope, safe local acceptance checks (no network or destructive operations), and max_files_to_modify must fit the task_type. Prepare the work order — do not execute the task yourself.
