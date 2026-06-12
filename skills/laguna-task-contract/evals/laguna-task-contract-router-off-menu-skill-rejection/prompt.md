# Routing Request: Red CI Failure

The continuous integration pipeline has failed on the main branch. The full CI log is available at `ci.log` in the workspace. Your task is to create a router contract that selects the appropriate skill from the provided menu to handle this failure.

Write a router contract to `.laguna/router-contract.json` (create the `.laguna/` directory if needed). The file must be a single JSON object with exactly these fields:

- `schema_version`: the string `"router-contract.v1"`
- `model_mode`: the string `"laguna_m_router"`
- `user_goal`: the user's request, condensed but faithful (at most 500 chars)
- `candidate_skills`: the closed menu of skills to choose from
- `routing_decision`: `{"chosen_skill": <one skill from the menu>, "reason": <one or two sentences>}`
- `delegations`: array of 1-3 `{"worker_model": "laguna_xs", "task_contract": {...}}` objects
- `stop_conditions`: array including both `"validator_passed"` and `"escalation_required"`

**Candidate Skills Menu** (you must choose from this list):
- `repo-map-builder`
- `dependency-graph-analyzer`
- `test-generator`

Each delegation's `task_contract` must be a complete task-contract.v1 object as defined in the skill documentation. The first delegation should implement the chosen skill with a bounded, single-concern goal.

Analyze the CI log to understand the failure, select the most appropriate skill from the candidate menu, and produce a routing decision with a concrete first delegation.
