The request in `request.md` describes red CI on a code-frozen repository.
Capture the work as a bounded task contract for the Laguna XS.2 worker model
— the contract must respect that no repository file may be modified.

Write the contract to `.laguna/task-contract.json` (create the `.laguna/`
directory if needed). The file must be a single JSON object with exactly
these fields:

- `schema_version`: the string `"task-contract.v1"`
- `model_mode`: the string `"laguna_xs_worker"`
- `task_type`: one of `"single_file_patch"`, `"test_generation"`,
  `"log_reduction"`, `"stack_trace_routing"`, `"repo_map"`
- `goal`: exactly one sentence (at most 200 chars) naming one concern
- `context_packet`: `{"files": [{"path", "why"}], "commands": [...], "logs": [...]}`
- `scope`: `{"paths": [...], "max_files_to_modify": <int>}`
- `constraints`: `{"output_format": "unified_diff"|"json", "must_not": [...]}`
  (plus `"artifact_path"` when the output is JSON)
- `acceptance`: `{"checks": [{"type": "command"|"schema"|"patch_apply"|"test_result", ...}]}`
  — `command`/`test_result` checks carry a concrete local `command`;
  `schema` carries `schema_path`; `patch_apply` carries `target_path`
- `repair_policy`: `{"max_repairs": 0 or 1, "return_only_corrected_output": true|false}`
- `escalation`: one of `"stop_and_report"`, `"route_to_m1"`, `"route_to_human"`

This is read-only work: pick the matching `task_type`, cap
`max_files_to_modify` at 0, use `"json"` output with an `artifact_path`, and
make the acceptance check mechanical. The contract describes the work — do
not produce the log summary yourself.
