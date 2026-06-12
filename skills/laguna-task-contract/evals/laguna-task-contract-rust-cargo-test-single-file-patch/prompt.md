A Rust project test is failing with a panic. The full test output is in `test-output.txt`, and the source file is at `src/parser.rs`. The project manifest is `Cargo.toml`.

Produce a task contract that bounds the fix work for a worker model. Write the contract to `.laguna/task-contract.json` (create the `.laguna/` directory if needed). The file must be a single JSON object with exactly these fields:

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

The contract must be bounded: a single-concern goal, explicit file paths, and safe local acceptance checks that can run in the workspace.
