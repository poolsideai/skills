# Laguna Skills

Validator-backed skills for Poolside's Laguna models, plus a small eval harness that tests whether a skill helps on its own cases.

A skill in this repo is not just prompt text. A publishable skill has:

- `SKILL.md` with clear trigger and boundary instructions.
- A JSON output schema in `schemas/`.
- A validator in `scripts/validate_*.ts`.
- Eval cases under `skills/<name>/evals/<case-id>/`, including one adversarial case.

## Current status

Publish-ready skills:

- [`ci-log-reducer`](skills/ci-log-reducer/SKILL.md) reduces a failing CI or test log to `.laguna/ci-log-summary.json`.
- [`laguna-task-contract`](skills/laguna-task-contract/SKILL.md) turns a broad engineering request into a bounded worker or router contract.
- [`repo-map`](skills/repo-map/SKILL.md) writes `.laguna/repo-map.json`, an evidence-backed map of a repository.

Work in progress:

- [`workspace-inventory`](skills/workspace-inventory/SKILL.md) has a schema and validator, but no eval cases yet. Repo-wide `check_eval_cases.py` is expected to fail until it has at least three cases, including one adversarial case.

Plan of record: [`docs/plans/laguna-skills-v0-2026-06-10.md`](docs/plans/laguna-skills-v0-2026-06-10.md).

## Prerequisites

From the repo root, these commands should exist:

```bash
uv --version
bun --version
pool --version
```

Known-good versions used while writing these docs: Python 3.11+, `bun` 1.3.14, and `pool` 1.0.5. Older `pool` 0.2.172 notes in spike docs are historical.

`uv run ...` reads `pyproject.toml`; this repo is configured as a script-only project with `package = false`, so there is no package install step.

## Quick checks

Run the checks that should be green now:

```bash
uv run scripts/check_skill_structure.py
uv run scripts/check_schemas.py
uv run scripts/check_validator_robustness.py
```

Run eval-case validation when you are working on case coverage:

```bash
uv run scripts/check_eval_cases.py
```

Expected today: this fails only for `workspace-inventory`, which has no cases yet.

## What you can do here

This repo supports the full skill loop:

1. Author a validator-backed skill.
2. Build eval cases with gold artifacts.
3. Run the skill against Laguna models with and without the skill installed.
4. Inspect failures in the workbench and review app.
5. Use GEPA to propose better `SKILL.md` prose, then review and merge it manually.

The workbench provides a local UI for browsing skills, launching runs, and inspecting outputs. The CLI is better for agents and repeatable runs.

```bash
bun ui/server.ts          # http://127.0.0.1:4319/workflows.html
bun ui/bench.ts help      # JSON CLI over the same substrate
```

Common workbench CLI commands:

```bash
bun ui/bench.ts skills
bun ui/bench.ts eval-suites
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --arm xs_with_skill
bun ui/bench.ts eval-runs
bun ui/bench.ts optimize-skill --skill ci-log-reducer --smoke
bun ui/bench.ts optimize-runs
```

For Smithers workflow experiments, initialize the demo project first:

```bash
cd experiments/smithers-pool
bun install
bun run setup
mkdir -p .smithers
cd ../..
bun ui/server.ts
```

Then use the workbench to browse workflow runs, inspect nodes, grade nodes with skill validators, sync traces to review, and compare skill scorecards. Details: [`ui/README.md`](ui/README.md).

## Eval dry run

Dry run validates fixtures, materialization, manifest shape, and gold replay. It does not call `pool` or any model.

```bash
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
```

Live runs require an authenticated Poolside CLI path. The non-interactive path is `POOLSIDE_TOKEN`; otherwise the runner copies `~/.config/poolside/credentials.json` into the isolated HOME when it exists.

```bash
POOLSIDE_TOKEN=... uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --api-url https://api.poolsi.de
```

Useful flags are documented by:

```bash
uv run harness/runner/run_eval.py --help
```

Run outputs are written under:

```text
runs/<suite>/<case>/<arm>/
  prompt.md
  stdout.nljson
  stderr.txt
  trajectory.ndjson          # canonical when recovered
  trajectory.atif.json       # optional, only when pool supports ATIF export
  validator.json
  run-facts.json
  manifest.json
```

All v0 numbers are internal and directional. Do not publish lift claims from these runs; see [`docs/eval-methodology.md`](docs/eval-methodology.md).

## Skill optimization

The GEPA pilot rewrites only `SKILL.md` prose and grades candidates against frozen eval cases, schemas, and validators. It cannot change the grader. Gate failures score zero before any `pool` spend.

Start with the offline smoke check:

```bash
uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --smoke
```

Live optimization needs Poolside CLI auth plus a reflection-model API key such as `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`:

```bash
uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --max-metric-calls 60
```

Outputs land under `runs/optimize/<skill>/<stamp>/`, including `result.json`, `best/SKILL.md`, and `best.diff`. Promotion is manual: review the diff, turn it into a proposal if useful, then rerun the normal checks and eval suite.

```bash
bun ui/bench.ts optimize-skill --skill ci-log-reducer --baseline-only
bun ui/bench.ts optimize-propose --skill ci-log-reducer --run-dir runs/optimize/ci-log-reducer/<stamp>
```

These numbers are candidate-selection evidence only. Do not publish lift claims from optimization runs.

## Eval-case generation

Eval cases can be generated, but generated cases stay quarantined until a human reviews and promotes them. The generator runs the repo's mechanical gates, plus gold replay and a sensitivity probe that rejects cases whose validator passes on junk gold.

```bash
uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer --n 4
uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer --validate-only <case-dir>
uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer --promote runs/generate/ci-log-reducer/<stamp>/candidates/<case-id>
```

Promotion copies the reviewed case into `skills/<skill>/evals/`, appends it to the per-skill suite, reruns checks, and rolls back on failure. Review the resulting diff before committing.

## Review runs

The standalone review app flattens run directories into traces and serves a local annotation UI.

```bash
uv run harness/review/extract_traces.py
uv run harness/review/serve.py          # http://127.0.0.1:8765
```

For synthetic demo traces instead of real run output:

```bash
uv run harness/review/extract_traces.py --demo
uv run harness/review/serve.py          # http://127.0.0.1:8765
```

Optional LLM judging exists as a reading aid, not a metric. It requires `OPENROUTER_API_KEY` and is not a substitute for calibrated human labels.

```bash
uv run harness/review/judge.py
```

## Local workbench

The workbench is a localhost tool for browsing and operating the loop: skills, Smithers workflows, eval runs, node evals, playground runs, optimization runs, proposals, and review traces. It is separate from the static catalog prototype.

```bash
bun ui/server.ts          # http://127.0.0.1:4319/workflows.html
bun ui/bench.ts help
```

The web UI exposes the main browse/review/run flows. `bun ui/bench.ts` also exposes agent-friendly commands for detached eval runs, GEPA optimization, and proposal creation. The workbench auto-starts the review app on port `8901` by passing `--port 8901`; the standalone review app defaults to `8765`.

## Repo layout

```text
skills/                  # publishable skill sources
  <name>/                # SKILL.md, schemas/, scripts/, evals/<case-id>/
  _shared/               # shared validator-result helper for TypeScript validators
schemas/common/          # shared JSON schemas
evals/suites/            # suite definitions
harness/                 # Python eval runner and review tools
scripts/                 # repo checks and install helper
docs/                    # authoring guide, eval method, plans, and spike notes
ui/                      # local workbench
runs/                    # eval and review output, gitignored
```

## Authoring docs

- [`docs/authoring-guide.md`](docs/authoring-guide.md): binding skill authoring rules.
- [`evals/README.md`](evals/README.md): case folder format and gold replay.
- [`schemas/common/README.md`](schemas/common/README.md): shared schema contracts.
- [`docs/eval-methodology.md`](docs/eval-methodology.md): arm matrix, isolation, metrics, and reporting policy.

## Static catalog prototype

`index.html`, `skill.html`, `workflows.html`, and `styles.css` are prototype pages. `index.html` and `skill.html` are static catalog mockups; some cards and metrics are illustrative. `workflows.html` is the workbench shell and needs `bun ui/server.ts` for live data.
