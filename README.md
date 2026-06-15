# Laguna Skills

A validator-first skill library and external eval harness for Poolside's Laguna models. This repo is the place to bring a directory of skills, make each skill gradeable, measure it with `pool`, and optimize the instructions with GEPA without changing the grader.

In this repo, a skill is a contract: `SKILL.md` prose, a deterministic output
schema, an executable validator, eval cases including an adversarial case, and
run evidence. Prompt-pack-only skills do not merge. The newcomer path is three
commands in this order:

```bash
uv run scripts/check_skill_structure.py
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --smoke
```

That is the short form of the full loop: **check -> eval -> optimize**. Once credentials are available, replace the smoke and dry-run commands with the live per-skill suite and GEPA run, then review the proposal before accepting anything.

The worked example is [`ci-log-reducer`](skills/ci-log-reducer/SKILL.md): its validation score moved from 0.694 to 0.837 to 0.939 across two GEPA rounds. Those numbers are internal and directional only, not publishable lift claims; see [`docs/eval-methodology.md`](docs/eval-methodology.md) section 7.

New here? [`docs/getting-started.md`](docs/getting-started.md) walks the full loop, and [`docs/concepts.md`](docs/concepts.md) defines the vocabulary, including Laguna, arms, gold replay, and GEPA.

## What this gives you

- **A skill library** for reusable Laguna behaviors, including CI log reduction, task scoping, and repo mapping.
- **An eval harness** that compares model runs with and without a skill, using deterministic workspace artifacts rather than subjective judgment.
- **GEPA-based skill optimization** that rewrites `SKILL.md` candidates and scores them against frozen validators.
- **Eval-case generation** for growing the test corpus, with generated cases quarantined until human review.
- **A local workbench** for the skills catalog, workflow catalog, eval runs, node-level grades, optimization runs, proposals, and trace review.
- **Smithers workflow experiments** where Pool executes workflow nodes and skills can be installed per node.

## What counts as publishable

A publishable skill has:

- `SKILL.md` with clear trigger and boundary instructions.
- A JSON output schema in `schemas/`.
- A validator in `scripts/validate_*.ts`.
- Eval cases under `skills/<name>/evals/<case-id>/`, including one adversarial case.

`skill-generate` can draft a structure-valid skill, but generated drafts are not publishable until they pass the eval-case gates.

## Current status

Publish-ready skills:

- [`ci-log-reducer`](skills/ci-log-reducer/SKILL.md) reduces a failing CI or test log to `.laguna/ci-log-summary.json`.
- [`laguna-task-contract`](skills/laguna-task-contract/SKILL.md) turns a broad engineering request into a bounded worker or router contract.
- [`repo-map`](skills/repo-map/SKILL.md) writes `.laguna/repo-map.json`, an evidence-backed map of a repository.

Skills with rough evals:

- [`bead-selector`](skills/bead-selector/SKILL.md) writes `.laguna/bead-selection.json`, the validator-graded record of which local Bead to pick next from `bv`/`br` robot-mode output. The dedicated suite at [`evals/suites/skill-bead-selector.json`](evals/suites/skill-bead-selector.json) covers multiple cases including adversarial ones; treat the resulting numbers as internal/directional.
- [`workspace-inventory`](skills/workspace-inventory/SKILL.md) writes `.laguna/workspace-inventory.json`. The dedicated suite at [`evals/suites/skill-workspace-inventory.json`](evals/suites/skill-workspace-inventory.json) covers six cases: flat workspaces, nested Python and Rust workspaces, and two adversarial "good-failure" cases (`.laguna` listed in entries, shallow-only counts on a Go monorepo). The validator enforces schema, entries-match-tree, lexicographic sorting of `entries[]`, recursive directory file counts, and `total_files`. Eval numbers are internal/directional.

Plan of record: [`docs/plans/laguna-skills-v0-2026-06-10.md`](docs/plans/laguna-skills-v0-2026-06-10.md).

## Task tracking and Beads

This repo does not initialize a Beads tracker in the checkout. There is no
`.beads/` directory here, and stabilization work does not run `br init` or copy
`.beads` from another checkout. Beads shows up in two distinct, deliberate ways:

- **Repo-local grading**: [`skills/bead-selector`](skills/bead-selector/SKILL.md)
  is the authoritative repo truth for "what Bead should I pick next?" behavior.
  Its eval suite synthesizes Beads graphs inside fixture workspaces and grades
  the model's selection artifact; it does not depend on a live `.beads/` here.
- **External source skills used by onboarding**: the workbench onboarding page
  ([`ui/views/onboard.js`](ui/views/onboard.js)) starts readiness checks
  against external Beads source skills under `~/.codex/skills/beads-bv` and
  `~/.codex/skills/beads-workflow`. Those paths live outside this checkout. If
  they are missing on a given machine, the onboarding run records the failure
  rather than implying repo-local Beads state.

If owning Beads inside this repo ever becomes the right choice, that is a
separate, approval-gated decision made before any `.beads/` initialization or
restore. It is not part of this stabilization pass.

## Prerequisites

From the repo root, these commands should exist:

```bash
uv --version
bun --version
pool --version
```

Known-good versions used while checking these docs: Python 3.11+, `uv` 0.11.21,
`bun` 1.3.14, and `pool` 1.0.5. Older `pool` 0.2.172 notes in spike docs are historical.

`uv run ...` reads `pyproject.toml`; this repo is configured as a script-only project with `package = false`, so there is no package install step.

## Start here

Start with the repo and CLI contract:

```bash
bun ui/bench.ts doctor
bun ui/bench.ts capabilities
bun ui/bench.ts help eval-run
```

`doctor` reports tool availability plus basic skill-contract, eval-suite, and WIP
coverage checks. It does not require the web server.

`bench.ts` writes JSON to stdout on success and JSON to stderr on errors. Exit codes are
`0` for success, `1` for runtime, validation, or command errors, and `2` for unknown
commands. Use `bun ui/bench.ts help <command>` or `bun ui/bench.ts <command> --help` for
command-specific JSON help; `capabilities` and `commands` list repeatable flags and known
CLI↔HTTP mirrors.

Run the local workbench when you want the browser UI:

```bash
bun ui/server.ts          # http://127.0.0.1:4319/workflows.html
bun ui/bench.ts help      # JSON help for the agent CLI
```

Use the workbench to browse skills, inspect workflows, launch evals, see GEPA optimization runs, review proposals, and sync traces into the review app. Details: [`ui/README.md`](ui/README.md).

Useful workbench CLI commands:

```bash
bun ui/bench.ts commands
bun ui/bench.ts skills
bun ui/bench.ts eval-suites
bun ui/bench.ts eval-case-generate --skill ci-log-reducer --n 4
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --arm xs_with_skill
bun ui/bench.ts eval-runs
bun ui/bench.ts optimize-skill --skill ci-log-reducer --smoke
bun ui/bench.ts optimize-runs
```

Smithers is installed for this repo as a root workflow pack under `.smithers/`.
Agents should use it for durable multi-step, long-running, approval-gated, or
parallel work:

```bash
bunx smithers-orchestrator workflow doctor --format md
bunx smithers-orchestrator workflow list --format md
bunx smithers-orchestrator starters --format md
```

The project-scoped Smithers command skills live under `.agents/skills/`, with
detected-agent symlink mirrors under `.claude/skills/`, `.goose/skills/`, and
`.openhands/skills/`. The MCP registration is `.mcp.json`. Details and the
PoolAgent experiment path are in [`docs/smithers.md`](docs/smithers.md).

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

Current state: `check_eval_cases.py` is expected to pass for the v0 bundle:
`ci-log-reducer`, `laguna-task-contract`, `repo-map`, `bead-selector`, and
`workspace-inventory` all carry the required minimum cases (including
adversarial cases). It will fail for any future WIP skill that lacks coverage.

Repo check scripts exit `0` when checks pass, `1` for check violations, and `2` for argument
or usage errors. Use `--json` when another tool needs a `repo-check-result.v1` payload on
stdout. The payload includes `schema_version`, `tool`, `status`, `counts`,
`violation_count`, and `violations[]` entries with `path`, `check`, and `message`.

## Zero to one: onboard and optimize an existing skill for Laguna

Use onboarding when the source skill is outside this repo or needs a quarantined
review bundle before promotion:

```bash
bun ui/bench.ts onboard --source <dir>
bun ui/bench.ts onboard-prepare --source <dir> --skill <name> --import-source
bun ui/bench.ts onboard-review --run-dir runs/onboard/<name>/<stamp>
```

Onboarding writes reports, imported baselines, generated drafts, and agent
reviews under `runs/onboard/`; it does not promote files automatically. For a
fully manual path, use this workflow:

1. **Create a skill folder.** Copy the existing skill into `skills/<name>/SKILL.md`. Keep the name lowercase and kebab-case.
2. **Make the output gradeable.** Add an output schema in `skills/<name>/schemas/` and a validator in `skills/<name>/scripts/validate_*.ts`. If the skill cannot name a deterministic artifact or diff target, it is not ready for optimization here.
3. **Add eval cases.** Create at least three cases under `skills/<name>/evals/<case-id>/`, including one adversarial case. Each case needs `prompt.md`, `input/`, `expected/`, and `metadata.json`.
4. **Add a suite.** Create `evals/suites/skill-<name>.json` listing those case directories.
5. **Run the gates.**

```bash
uv run scripts/check_skill_structure.py
uv run scripts/check_eval_cases.py
uv run harness/runner/run_eval.py --suite evals/suites/skill-<name>.json --dry-run --replay
```

6. **Run GEPA.** Start with the smoke check, then run a baseline or live optimization when Poolside auth and a reflection-model key are available.

```bash
uv run harness/optimize/gepa_skill.py --skill <name> --smoke
uv run harness/optimize/gepa_skill.py --skill <name> --baseline-only
uv run harness/optimize/gepa_skill.py --skill <name> --max-metric-calls 60
```

7. **Promote manually.** Review `runs/optimize/<name>/<stamp>/best.diff`, then use the proposal flow or patch `SKILL.md` directly and rerun the checks.

```bash
bun ui/bench.ts optimize-propose --skill <name> --run-dir runs/optimize/<name>/<stamp>
```

If the existing skill has `references/` or helper scripts, copy them into
`skills/<name>/` too. GEPA can now work with multi-file skill components, but
manual review and repo checks are still required before promotion.

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
bun ui/bench.ts eval-case-generate --skill ci-log-reducer --n 4
bun ui/bench.ts eval-case-generate --skill ci-log-reducer --validate-only <case-dir>
bun ui/bench.ts eval-case-generate --skill ci-log-reducer --promote runs/generate/ci-log-reducer/<stamp>/candidates/<case-id>
```

`eval-case-generate` is the agent-facing bench wrapper around
`uv run harness/generate/gen_eval_cases.py`. It preserves the generator's
mechanical gates and human-review quarantine, while normalizing stdout/stderr
to the bench JSON contract. The raw Python invocation remains supported for
direct debugging.

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
docs/                    # docs index, getting started, authoring guide, eval method, plans, spikes
ui/                      # local workbench
plans/                   # workbench redesign implementation plans (done; see plans/README.md)
experiments/             # spikes with their own setup, e.g. smithers-pool
.resources/              # design handoff, investigations, and decision-register source material
runs/                    # eval and review output, gitignored
```

## Authoring docs

- [`docs/README.md`](docs/README.md): documentation index, organized by audience.
- [`docs/getting-started.md`](docs/getting-started.md): first-session walkthrough, offline steps first.
- [`docs/concepts.md`](docs/concepts.md): glossary and the offline-vs-credentials command matrix.
- [`docs/authoring-guide.md`](docs/authoring-guide.md): binding skill authoring rules.
- [`evals/README.md`](evals/README.md): case folder format and gold replay.
- [`schemas/common/README.md`](schemas/common/README.md): shared schema contracts.
- [`docs/eval-methodology.md`](docs/eval-methodology.md): arm matrix, isolation, metrics, and reporting policy.

## Static catalog prototype

`index.html`, `skill.html`, `workflows.html`, and `styles.css` are prototype pages. `index.html` and `skill.html` are static catalog mockups; some cards and metrics are illustrative. `workflows.html` is the workbench shell and needs `bun ui/server.ts` for live data.
