A performance regression has been reported in the database query layer. The issue is documented in `perf-regression.md` in the workspace.

Before any code changes are made, profiling data must be collected to identify the bottleneck. Write a task contract to `.laguna/task-contract.json` (create the `.laguna/` directory if needed) that will guide collection and analysis of Node.js profiling data.

The contract must be a single JSON object with these required fields:

- `schema_version`: the string `"task-contract.v1"`
- `model_mode`: the string `"laguna_xs_worker"`
- `task_type`: one of `"single_file_patch"`, `"test_generation"`, `"log_reduction"`, `"stack_trace_routing"`, `"repo_map"`
- `goal`: exactly one sentence naming one concern (at most 200 chars)
- `context_packet`: `{"files": [{"path": <workspace-relative>, "why": <reason>}, ...], "commands": [...], "logs": []}`
- `scope`: `{"paths": [<explicit files or bounded globs>], "max_files_to_modify": <int>}`
- `constraints`: `{"output_format": "unified_diff"|"json", "must_not": [...]}` (plus `"artifact_path"` if output_format is json)
- `acceptance`: `{"checks": [{"type": "command"|"schema"|"patch_apply"|"test_result", ...}, ...]}`
- `repair_policy`: `{"max_repairs": 0 or 1, "return_only_corrected_output": true|false}`
- `escalation`: `"stop_and_report"`, `"route_to_m1"`, or `"route_to_human"`

Read the referenced workspace files to understand what profiling needs to be done. No code modifications should be made during this diagnostic phase.
