# Laguna M.1 as a constrained router — writing router-contract.v1

M.1 routes; it does not orchestrate loosely. A router contract records one
decision — which skill handles the request next — and hands bounded task
contracts to XS.2 workers. It never produces free-form plans, prose
strategies, or recursive delegation chains. Schema:
`schemas/router-contract.schema.json` (the single source of truth; this file
is guidance).

## Routing choices, not open space

Bad: "Decide how to solve this."

Good: a closed menu (`candidate_skills`), one `chosen_skill` from that menu,
a `reason` grounded in the request's evidence, and 1–3 delegations that a
worker can execute without further planning.

## Field-by-field guidance

- **`user_goal`** — the user's request, condensed but faithful (≤500 chars).
  This is the one place unbounded language is allowed: if the user said "fix
  this whole repo", record that. The bounding happens in the delegations,
  not by rewriting the user.

- **`candidate_skills`** — the menu the router actually chose among (1–8
  skill names). If the caller supplied a menu, reproduce it exactly; do not
  add skills that were not on offer.

- **`routing_decision`** — exactly one `chosen_skill`, taken from
  `candidate_skills` (the validator rejects anything off-menu), plus a
  `reason` of one or two sentences citing the request's evidence (a failing
  log, a stack trace, a missing map — not vibes).

- **`delegations`** — 1–3 entries of
  `{"worker_model": "laguna_xs", "task_contract": {...}}`. Each
  `task_contract` is a complete, self-sufficient `task-contract.v1` object;
  the validator checks every embedded contract against
  `task-contract.schema.json` **and** applies the full bounded-contract rules
  to it (single-concern goal, bounded scope, safe local acceptance, no
  unbounded verbs). See
  [`laguna-xs-worker-contract.md`](laguna-xs-worker-contract.md) for how to
  write those. The **first** delegation must implement the chosen skill:

  | chosen_skill | delegations[0].task_contract.task_type |
  |---|---|
  | `ci-log-reducer` | `log_reduction` |
  | `repo-map` | `repo_map` |
  | `stack-trace-router` | `stack_trace_routing` |
  | `single-file-patch` | `single_file_patch` |
  | `regression-test-generator` | `test_generation` |

  (Skills outside this table are not checked for the mapping, but the
  embedded contracts are still fully validated.) No recursion: task
  contracts cannot contain delegations, so a delegation chain is structurally
  one level deep.

- **`stop_conditions`** — when the routed work is finished or abandoned.
  Must include both `validator_passed` (the mechanical success exit) and
  `escalation_required` (the explicit failure-is-acceptable exit); add
  `schema_valid` and `max_repairs_exhausted` as intermediate gates when
  useful. A router that cannot stop is an orchestrator, which is exactly
  what M.1 must not be here.

## Sequencing heuristics

- Reduce before editing: red CI with a log → `ci-log-reducer` first, never
  `single-file-patch` first.
- Map before navigating: unfamiliar repo, "where is X" → `repo-map` or
  `stack-trace-router` before any patch delegation.
- One decision per contract: if the second step depends on the first step's
  output, route the first step only and let the next routing round see its
  artifact. Do not pre-plan speculative delegation chains.
