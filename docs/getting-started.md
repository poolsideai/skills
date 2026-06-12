# Getting Started

A first-session walkthrough of the skill loop. Unfamiliar terms (Laguna, arms, gold replay,
GEPA, …) are defined in [`concepts.md`](concepts.md); this page sequences commands and links
out rather than restating rules.

## Prerequisites

`uv`, `bun`, and `pool` on PATH — versions and notes in the root [`README.md`](../README.md)
(Prerequisites). Everything in the next section runs with **zero credentials**; the credentials
matrix in [`concepts.md`](concepts.md) says exactly what each later step needs.

## The loop, offline first

Run these from the repo root, in order. None of them call a model or the network.

1. **Repo checks** — structure, schemas, validator robustness:

   ```bash
   uv run scripts/check_skill_structure.py
   uv run scripts/check_schemas.py
   uv run scripts/check_validator_robustness.py
   uv run scripts/check_eval_cases.py   # expected to fail only for WIP skills with no cases
   ```

2. **Eval dry run** — materializes every case into a temp workspace, prints the exact `pool`
   commands a live run would use, and gold-replays each validator against its case's `expected/`
   gold:

   ```bash
   uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
   ```

3. **Optimizer smoke** — verifies the GEPA wiring without pool or API keys:

   ```bash
   uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --smoke
   ```

4. **Review app on demo traces** — see what trace annotation looks like:

   ```bash
   uv run harness/review/extract_traces.py --demo
   uv run harness/review/serve.py          # http://127.0.0.1:8765
   ```

If all four work, your checkout is healthy and you understand the shape of the loop.

## Read one real skill end to end

The abstract rules in [`authoring-guide.md`](authoring-guide.md) map onto a concrete example:
read [`skills/ci-log-reducer/`](../skills/ci-log-reducer/) in authoring order —
`schemas/*.schema.json` first, then `scripts/validate_*.ts`, then one case folder under
`evals/` (note the adversarial one), then `SKILL.md`. That order is Gate 1 of the two hard
gates. For a skill that uses progressive-disclosure `references/`, see
[`skills/laguna-task-contract/`](../skills/laguna-task-contract/).

## Going live

Live steps need credentials — see the matrix in [`concepts.md`](concepts.md).

- **Live eval run** (`pool` auth): the root README's "Eval dry run" section covers
  `POOLSIDE_TOKEN` and `--api-url`; results land under `runs/`.
- **Workbench** (`pool` auth for runs): `bun ui/server.ts` →
  `http://127.0.0.1:4319/workflows.html`, or `bun ui/bench.ts help` for the agent CLI.
  See [`../ui/README.md`](../ui/README.md).
- **GEPA optimization** (`pool` auth + reflection LM key) and **eval-case generation**
  (LM key): commands in the root README; method in
  [`plans/skill-optimization-gepa-2026-06-11.md`](plans/skill-optimization-gepa-2026-06-11.md).
  All resulting numbers are internal/directional only
  ([`eval-methodology.md`](eval-methodology.md) §7).

## Where next

Pick your path in the [documentation index](README.md): authoring a skill starts at
[`authoring-guide.md`](authoring-guide.md) (binding), eval cases at
[`../evals/README.md`](../evals/README.md), methodology at
[`eval-methodology.md`](eval-methodology.md).
