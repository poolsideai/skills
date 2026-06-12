A Go test failure report has been saved to `test-failure.md` in the workspace. The report describes a race condition and panic in the cache package, with test output and a race detector log.

Produce a work order that will fix the reported race condition. Write a JSON contract to `.laguna/task-contract.json` (create the `.laguna/` directory if needed). The contract must be a single JSON object with these fields:

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

Read the workspace files to understand the failure context and the code that needs fixing.
