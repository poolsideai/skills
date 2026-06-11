You are preparing work for the Laguna M.1 router model. The request from the
infra channel is in `request.md` and the failing CI log is saved at `ci.log`.

Produce a router contract that picks the next skill and delegates one bounded
task to a Laguna XS.2 worker. Choose from exactly these candidate skills:
`repo-map`, `ci-log-reducer`, `stack-trace-router`, `single-file-patch`,
`regression-test-generator`.

Write the contract to `.laguna/router-contract.json` (create the `.laguna/`
directory if needed). The file must be a single JSON object with exactly
these fields:

- `schema_version`: the string `"router-contract.v1"`
- `model_mode`: the string `"laguna_m_router"`
- `user_goal`: the user's request, condensed but faithful (at most 500 chars)
- `candidate_skills`: the candidate list above
- `routing_decision`: `{"chosen_skill": <one of the candidates>, "reason": <one or two sentences grounded in the request>}`
- `delegations`: 1–3 entries of `{"worker_model": "laguna_xs", "task_contract": {...}}`
  where each `task_contract` is a complete task-contract.v1 object:
  `schema_version` `"task-contract.v1"`, `model_mode` `"laguna_xs_worker"`,
  `task_type` (one of `"single_file_patch"`, `"test_generation"`,
  `"log_reduction"`, `"stack_trace_routing"`, `"repo_map"`), a one-sentence
  `goal` (at most 200 chars), `context_packet`
  `{"files": [{"path", "why"}], "commands": [...], "logs": [...]}`, `scope`
  `{"paths": [...], "max_files_to_modify": <int>}`, `constraints`
  `{"output_format": "unified_diff"|"json", "must_not": [...]}` (plus
  `"artifact_path"` for JSON output), `acceptance`
  `{"checks": [{"type": "command"|"schema"|"patch_apply"|"test_result", ...}]}`,
  `repair_policy` `{"max_repairs": 0 or 1, "return_only_corrected_output": true|false}`,
  and `escalation` (`"stop_and_report"`, `"route_to_m1"`, or `"route_to_human"`)
- `stop_conditions`: a subset of `"schema_valid"`, `"validator_passed"`,
  `"max_repairs_exhausted"`, `"escalation_required"` — include both the
  mechanical success exit and the escalation exit

The first delegation must implement the chosen skill. Keep every delegation
bounded: single-concern goals, explicit scope paths, read-only tasks cap
`max_files_to_modify` at 0, and acceptance checks must be local and safe.
Route the work — do not do the delegated work yourself.
