A production incident report has been filed in `incident-report.md` with references to error logs and code files in the workspace. The report requests immediate action on multiple fronts.

You need to create a routing contract that decomposes this request for delegation to appropriate worker skills. Write the contract to `.laguna/router-contract.json` (create the `.laguna/` directory if needed).

The available skills are:
- `ci-log-reducer` - analyzes CI/test logs and produces structured failure summaries
- `code-quality-refactorer` - improves code quality through safe, localized refactoring

The contract file must be a single JSON object with these fields:
- `schema_version`: the string `"router-contract.v1"`
- `model_mode`: the string `"laguna_m_router"`
- `user_goal`: the user's request (at most 500 chars)
- `candidate_skills`: array of available skill names
- `routing_decision`: `{"chosen_skill": <one skill from candidates>, "reason": <justification, max 300 chars>}`
- `delegations`: array of 1-3 work orders, each `{"worker_model": "laguna_xs", "task_contract": {...}}`
- `stop_conditions`: array including when work is done or escalation needed

Each embedded `task_contract` must be a complete task-contract.v1 object with:
- `schema_version`: `"task-contract.v1"`
- `model_mode`: `"laguna_xs_worker"`
- `task_type`: one of `"single_file_patch"`, `"test_generation"`, `"log_reduction"`, `"stack_trace_routing"`, `"repo_map"`
- `goal`: one sentence, one concern (max 200 chars)
- `context_packet`: `{"files": [{"path": ..., "why": ...}, ...], "commands": [...], "logs": [...]}`
- `scope`: `{"paths": [...], "max_files_to_modify": <int>}`
- `constraints`: `{"output_format": "unified_diff"|"json", "must_not": [...]}` (plus `"artifact_path"` if JSON)
- `acceptance`: `{"checks": [{"type": ..., ...}, ...]}`
- `repair_policy`: `{"max_repairs": 0 or 1, "return_only_corrected_output": true|false}`
- `escalation`: `"stop_and_report"`, `"route_to_m1"`, or `"route_to_human"`

Read all referenced workspace files to understand the full context before routing.
