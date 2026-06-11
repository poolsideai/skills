---
name: laguna-task-contract
description: >-
  Turn an open-ended engineering request into a compact, schema-validated
  Laguna task contract: a bounded worker contract for Laguna XS.2 written to
  .laguna/task-contract.json, or a constrained router contract for Laguna M.1
  written to .laguna/router-contract.json. Use when asked to create or write
  a task contract, scope or bound a request for a worker model, prepare or
  package work for Laguna XS.2 or M.1, decompose a goal into skill
  delegations, or route a request across candidate skills. Produces JSON with
  a single-concern goal, explicit file scope, safe local acceptance checks, a
  bounded repair policy, and an explicit escalation path. Do not use to
  execute the task itself — no code edits, no log analysis, no running of the
  delegated work.
metadata:
  version: "0.1.0"
---

# Laguna Task Contract

## Purpose

Turn an open-ended request into a machine-checkable contract: a bounded work
order for Laguna XS.2 (the narrow worker) or a constrained routing decision
for Laguna M.1 (the router). The contract — not the prose around it — is what
gets graded, so bounding beats transcribing.

## Use when

- A request must be packaged for a Laguna worker or router model before any
  work starts: "write a task contract for this", "prep this for XS.2",
  "bound this bug report", "scope this for the worker".
- An orchestrator needs a routing decision recorded: "which skill handles
  this?", "decompose this into delegations", "route this across these
  skills".
- A sprawling ask needs to be confronted with its own size: turning it into
  a contract makes the unboundedness mechanical and visible.

## Do not use when

- The task is to **do** the work — fix the bug, reduce the log, map the
  repo. This skill only writes the contract; execution is a separate task
  (often by a different model) that consumes it.
- The request is conversational or exploratory ("what do you think about
  this design?") — there is no work order to bound.
- You need multi-round orchestration with feedback between steps. A router
  contract records one routing decision with at most three one-level
  delegations; it is not a workflow engine, and recursive delegation is
  structurally impossible here.
- The caller wants prose plans, tickets, or specs. The only outputs are the
  two JSON artifacts below.

## Inputs

- **The request**: a bug report, issue, channel message, or instruction —
  in a workspace file (commonly `request.md` or `bug-report.md`) or in the
  prompt itself.
- **The referenced workspace files** (source files, tests, logs): read what
  the request names so scope paths and context packets cite real files;
  never invent paths.
- **For router contracts**: the candidate-skill menu. If the caller supplied
  one, reproduce it exactly; never route off-menu.

Runtime expectations (documented, not enforced): this skill's validator
requires `bun` on PATH and is run as `bun scripts/validate_contract.ts …`.
The procedure needs file read/write only — **no network access**, and it
never modifies repository files (it only adds files under `.laguna/`).

## Procedure

1. Decide the contract kind. Worker request (one concrete piece of work) →
   task contract. Routing request (choose among skills, delegate to workers)
   → router contract. Write **exactly one** artifact, never both.
2. For a task contract: pick the single closest `task_type`, then build the
   fields per
   [`references/laguna-xs-worker-contract.md`](references/laguna-xs-worker-contract.md)
   (read it for the field-by-field rules and the task_type → modify-cap /
   output-format table). The essentials: one-sentence single-concern goal; a
   curated context packet, not the whole workspace; explicit scope paths
   (bounded globs only); acceptance checks that run locally and verbatim;
   `max_repairs` ≤ 1; a real escalation value.
3. For a router contract: follow
   [`references/laguna-m-router-contract.md`](references/laguna-m-router-contract.md)
   (read it for the chosen-skill → task_type mapping and stop-condition
   rules). Choose one skill from the menu, ground the reason in the
   request's evidence, and make the first delegation a complete, bounded
   task contract implementing that skill. Include both `validator_passed`
   and `escalation_required` in `stop_conditions`.
4. If the request is unbounded ("fix this whole repo") and the requester
   insists on one contract, **do not launder it** into a fake-bounded
   contract and do not silently narrow it. Write the faithful contract,
   validate it, and report the rejection — see
   [`references/anti-patterns.md`](references/anti-patterns.md) (read it
   whenever a request smells too big, and for the exact deny lists the
   validator applies).
5. Write the artifact to its deterministic path (Output contract below).
6. Validate, and repair at most once (next two sections).

## Output contract

Write exactly one JSON object to one of these workspace-root paths (create
`.laguna/` if needed):

- **`.laguna/task-contract.json`** — valid against
  [`schemas/task-contract.schema.json`](schemas/task-contract.schema.json):
  `schema_version` `"task-contract.v1"`, `model_mode` `"laguna_xs_worker"`,
  `task_type`, one-sentence `goal` (≤200 chars), `context_packet`
  `{files[{path,why}], commands[], logs[]}`, `scope`
  `{paths[], max_files_to_modify}`, `constraints`
  `{output_format, must_not[], artifact_path?}`, `acceptance.checks[]`,
  `repair_policy` `{max_repairs, return_only_corrected_output}`,
  `escalation`.
- **`.laguna/router-contract.json`** — valid against
  [`schemas/router-contract.schema.json`](schemas/router-contract.schema.json):
  `schema_version` `"router-contract.v1"`, `model_mode` `"laguna_m_router"`,
  `user_goal`, `candidate_skills[]`, `routing_decision`
  `{chosen_skill, reason}`, `delegations[]` (each embedding a complete
  task-contract.v1 object), `stop_conditions[]`.

A contract that only appears in the chat message does not exist for grading —
the file must be on disk. Mention in your final message which artifact you
wrote and what the validator said.

## Validation

Run the skill's own validator after writing the artifact:

```sh
bun .poolside/skills/laguna-task-contract/scripts/validate_contract.ts \
  --workspace . --out .laguna/validator-result.json
```

(Harness and CI invoke the same script with an extra `--case <case_dir>`
flag.) It writes a `validator-result.v1` JSON to `--out` and exits 0 whenever
a result was written — read the verdict from the file's `status` field, not
the exit code. Beyond schema validity it enforces the bounded-contract rules:
single-concern goals, bounded scope paths, task_type-consistent modify caps,
concrete safe local acceptance checks, no unbounded verbs, on-menu routing,
first-delegation/skill agreement, and sound stop conditions. `checks[]` says
exactly what passed; `repair_feedback[]` lists what to fix.

## Repair

At most **one** repair attempt. Act only on `repair_feedback` and schema
errors: correct the named fields, change nothing unrelated, re-run the
validator once. Exception: if the feedback shows the *request* is unbounded
(unbounded verbs, whole-repo scope) rather than the contract sloppy, do not
"repair" by quietly shrinking the request — that is laundering. Keep the
faithful contract, report the failed validation, and move to Escalation.

## Escalation

Stop and report instead of guessing when:

- the request cannot be expressed as a valid bounded contract: report the
  validator's named reasons and propose a decomposition (2–4 bounded
  contracts, or one router contract with bounded delegations) for the
  requester to choose from;
- the request references files, commands, or logs that do not exist in the
  workspace: ask for them; never fabricate context-packet entries;
- a routing request offers no candidate skills and none are discoverable:
  return the question, not an invented menu.

Route to a human (or M.1, for decomposition help) with the contract you
wrote and the validator result.

## Examples

Minimal — read-only worker contract for a frozen repo (full version in
`evals/laguna-task-contract-readonly-log-reduction/expected/`):

```json
{
  "schema_version": "task-contract.v1",
  "model_mode": "laguna_xs_worker",
  "task_type": "log_reduction",
  "goal": "Reduce ci.log to a structured failure summary at .laguna/ci-log-summary.json without modifying any repository file.",
  "context_packet": {
    "files": [{ "path": "ci.log", "why": "full log of the failing go-checks run" }],
    "commands": ["go test ./..."],
    "logs": ["ci.log"]
  },
  "scope": { "paths": ["ci.log"], "max_files_to_modify": 0 },
  "constraints": {
    "output_format": "json",
    "artifact_path": ".laguna/ci-log-summary.json",
    "must_not": ["modify repository files", "invent log lines or commands"]
  },
  "acceptance": {
    "checks": [{ "type": "schema", "schema_path": ".poolside/skills/ci-log-reducer/schemas/ci-log-summary.schema.json" }]
  },
  "repair_policy": { "max_repairs": 1, "return_only_corrected_output": true },
  "escalation": "stop_and_report"
}
```

Realistic — a red-CI request routed through M.1: one `ci-log-reducer`
routing decision whose first delegation is the bounded `log_reduction`
contract above, with `stop_conditions` `["schema_valid", "validator_passed",
"escalation_required"]`. See
`evals/laguna-task-contract-m-router-ci-failure/expected/.laguna/router-contract.json`
for the full artifact.
