You have received a feature request from the product team. The request is in `feature-request.md` and the relevant source files are in this workspace.

Write a task contract to `.laguna/task-contract.json` (create the `.laguna/` directory if needed). The contract must be a single JSON object with exactly these fields:

- `schema_version`: the string `"task-contract.v1"`
- `model_mode`: the string `"laguna_xs_worker"`
- `task_type`: one of `"single_file_patch"`, `"test_generation"`, `"log_reduction"`, `"stack_trace_routing"`, `"repo_map"`
- `goal`: one sentence describing the work (at most 200 characters)
- `context_packet`: `{"files": [{"path": "...", "why": "..."}], "commands": [...], "logs": [...]}`
- `scope`: `{"paths": [...], "max_files_to_modify": <integer 0-2>}`
- `constraints`: `{"output_format": "unified_diff" or "json", "must_not": [...]}` (include `"artifact_path"` if output_format is `"json"`)
- `acceptance`: `{"checks": [{"type": "command"|"schema"|"patch_apply"|"test_result", ...}]}`
- `repair_policy`: `{"max_repairs": 0 or 1, "return_only_corrected_output": true or false}`
- `escalation`: `"stop_and_report"`, `"route_to_m1"`, or `"route_to_human"`

The goal must be a single sentence naming exactly one concern. Scope paths must be explicit files or bounded globs (like `src/**/*.ts`, never `*` or `**` at the top level). Read-only task types require `max_files_to_modify: 0`; `single_file_patch` requires exactly 1; `test_generation` allows 1-2. Acceptance checks must be concrete commands that can run locally without network access.

After writing the contract, validate it and report the result.
