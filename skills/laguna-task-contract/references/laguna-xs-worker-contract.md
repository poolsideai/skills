# Laguna XS.2 as a bounded worker — writing task-contract.v1

XS.2 is a narrow executor, not a general agent. It performs best when the
workflow supplies clean context, one job, few degrees of freedom, and a
mechanical way to know whether it succeeded. A task contract is that workflow
boundary made explicit. Schema: `schemas/task-contract.schema.json` (the
single source of truth; this file is guidance, not a second contract).

## The one-job rule

Bad worker prompt: "Investigate the repo, identify the bug, fix it, add
tests, and explain your reasoning."

Good worker contract: "Given this failing command, this test, and this file,
produce a unified diff modifying only `src/parser.ts`."

Every field below exists to enforce that narrowing.

## Field-by-field guidance

- **`task_type`** — pick the single closest type. It drives the modify cap
  the validator enforces:

  | task_type | max_files_to_modify | output_format |
  |---|---|---|
  | `single_file_patch` | exactly 1 | `unified_diff` |
  | `test_generation` | 1–2 (test file, optional fixture) | `unified_diff` |
  | `log_reduction` | 0 | `json` + `artifact_path` |
  | `stack_trace_routing` | 0 | `json` + `artifact_path` |
  | `repo_map` | 0 | `json` + `artifact_path` |

- **`goal`** — one sentence, one concern, ≤200 chars. Name the file or
  artifact. If you need "and", ", and", "then", or a second sentence, you
  have two tasks: write two contracts (or route via M.1).

- **`context_packet`** — the worker gets a packet, not the workspace. Even
  with 256K context, clean context beats long context. List only files the
  worker must read (each with a one-line `why`), the relevant commands
  verbatim (typically the failing command), and log paths. Use empty arrays
  to say "none needed" explicitly.

- **`scope`** — the blast radius. `paths` is an explicit list (≤8) of
  workspace-relative files, or globs bounded below a literal first segment:
  `src/parser/**/*.ts` is bounded; `*`, `**`, `**/*`, and top-level `*.ts`
  are not and will be rejected. For read-only tasks, `paths` lists what the
  worker reads. No absolute paths, no `..`.

- **`constraints.must_not`** — explicit prohibitions the worker tends to
  violate: "change unrelated behavior", "perform broad refactors", "invent
  unavailable files", "modify test files". At least one; be concrete.

- **`acceptance.checks`** — how success is decided mechanically, locally,
  offline:
  - `command` / `test_result`: a concrete command runnable verbatim — no
    placeholders (`...`, `<file>`, TODO), no network (installs, fetches,
    pushes), nothing destructive (`rm`, hard resets, `sudo`).
  - `schema`: `schema_path` to the JSON Schema the artifact must satisfy.
  - `patch_apply`: `target_path` of the file the diff must apply to.

- **`repair_policy`** — `max_repairs` is 0 or 1. One repair attempt, fed only
  validator feedback, returning only the corrected output. More retries hide
  failure modes instead of fixing them.

- **`escalation`** — the explicit "I cannot complete this safely" path:
  `stop_and_report` (default), `route_to_m1` (needs planning/routing), or
  `route_to_human`. Failure must be acceptable; a contract without a real
  exit invites the worker to flail.

## Worked example

A bounded single-file-patch contract (the gold artifact for the
`laguna-task-contract-xs-single-file-patch` eval case):

```json
{
  "schema_version": "task-contract.v1",
  "model_mode": "laguna_xs_worker",
  "task_type": "single_file_patch",
  "goal": "Fix the duplicate-separator bug in src/slugify.ts so that the collapse test in test/slugify.test.ts passes.",
  "context_packet": {
    "files": [
      { "path": "src/slugify.ts", "why": "contains the buggy one-for-one separator replacement" },
      { "path": "test/slugify.test.ts", "why": "failing test defining the expected slug format" }
    ],
    "commands": ["bun test test/slugify.test.ts"],
    "logs": []
  },
  "scope": { "paths": ["src/slugify.ts"], "max_files_to_modify": 1 },
  "constraints": {
    "output_format": "unified_diff",
    "must_not": ["modify test/slugify.test.ts", "change unrelated behavior", "perform broad refactors"]
  },
  "acceptance": {
    "checks": [
      { "type": "test_result", "command": "bun test test/slugify.test.ts" },
      { "type": "patch_apply", "target_path": "src/slugify.ts" }
    ]
  },
  "repair_policy": { "max_repairs": 1, "return_only_corrected_output": true },
  "escalation": "stop_and_report"
}
```
