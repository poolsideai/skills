# Poolside Skills

A validator-first skill library and external eval harness for Poolside's models. This repo is the place to bring a directory of skills, make each skill gradeable, measure it with `pool`, and optimize the instructions with GEPA without changing the grader.

In this repo, a skill is a contract: `SKILL.md` prose, a deterministic output
schema, an executable validator, eval cases including an adversarial case, and
run evidence. Prompt-pack-only skills do not merge. The short form of the loop
is **check -> eval -> optimize**: run local contract checks, replay eval cases,
then search for better skill instructions without changing the grader. Once
credentials are available, replace smoke and dry-run commands with the live
per-skill suite and GEPA run, then review the proposal before accepting
anything.

The worked example is [`ci-log-reducer`](skills/ci-log-reducer/SKILL.md): its validation score moved from 0.694 to 0.837 to 0.939 across two GEPA rounds. Those numbers are internal and directional only, not publishable lift claims; see [`docs/eval-methodology.md`](docs/eval-methodology.md) section 7.

New here? [`docs/getting-started.md`](docs/getting-started.md) walks the full loop, and [`docs/concepts.md`](docs/concepts.md) defines the vocabulary, including Laguna, arms, gold replay, and GEPA.

## What this gives you

- **A skill library** for reusable Laguna behaviors, including CI log reduction, task scoping, and repo mapping.
- **An eval harness** that compares model runs with and without a skill, using deterministic workspace artifacts rather than subjective judgment.
- **GEPA-based skill optimization** that rewrites selected skill authoring components and scores candidates against frozen validators.
- **Eval-case generation** for growing the test corpus, with generated cases quarantined until human review.
- **A local workbench** for the skills catalog, workflow catalog, eval runs, node-level grades, optimization runs, proposals, and trace review.
- **Smithers workflow experiments** where Pool executes workflow nodes and skills can be installed per node.

## What counts as publishable

A publishable skill has:

- `SKILL.md` with clear trigger and boundary instructions.
- A JSON output schema in `schemas/`.
- A validator in `scripts/validate_*.ts`.
- At least three eval cases under `skills/<name>/evals/<case-id>/`, including one adversarial case.

`skill-generate` can draft a structure-valid skill, but generated drafts are not publishable until they pass the eval-case gates.

## Current status

Publish-ready skills:

- [`ci-log-reducer`](skills/ci-log-reducer/SKILL.md) reduces a failing CI or test log to `.laguna/ci-log-summary.json`.
- [`laguna-task-contract`](skills/laguna-task-contract/SKILL.md) turns a broad engineering request into a bounded worker or router contract.
- [`repo-map`](skills/repo-map/SKILL.md) writes `.laguna/repo-map.json`, an evidence-backed map of a repository.

Skills with rough evals:

- [`bead-selector`](skills/bead-selector/SKILL.md) writes `.laguna/bead-selection.json`, the validator-graded record of which local Bead to pick next from `bv`/`br` robot-mode output. The dedicated suite at [`evals/suites/skill-bead-selector.json`](evals/suites/skill-bead-selector.json) covers multiple cases including adversarial ones; treat the resulting numbers as internal/directional.
- [`workspace-inventory`](skills/workspace-inventory/SKILL.md) writes `.laguna/workspace-inventory.json`. The dedicated suite at [`evals/suites/skill-workspace-inventory.json`](evals/suites/skill-workspace-inventory.json) covers six cases: flat workspaces, nested Python and Rust workspaces, and two adversarial "good-failure" cases (`.laguna` listed in entries, shallow-only counts on a Go monorepo). The validator enforces schema, entries-match-tree, lexicographic sorting of `entries[]`, recursive directory file counts, and `total_files`. Eval numbers are internal/directional.

Experimental imports:

- [`ce-plan`](skills/ce-plan/SKILL.md) is an imported prompt-style planning skill with a synthetic bootstrap contract and a 12-case experimental plan-quality corpus. It is committed as Pass 6 evidence, not as a reviewed publishable Laguna skill.

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

Use [`docs/getting-started.md`](docs/getting-started.md) for the full first
session. The short readiness path is:

To hand the repo to an agent for the fastest live success path, tell it:

```text
Read AGENTS.md, then follow docs/prompts/first-success-pool-run.md.
Use ci-log-reducer unless I name a different skill.
```

```bash
bun ui/bench.ts doctor
bun ui/bench.ts capabilities
uv run scripts/check_skill_structure.py
uv run scripts/check_schemas.py
uv run scripts/check_validator_robustness.py
uv run scripts/check_eval_cases.py
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --smoke
```

`doctor` reports tool availability plus basic skill-contract, eval-suite, and WIP
coverage checks without starting the web server. `bench.ts` writes JSON to
stdout on success and JSON to stderr on errors; use
`bun ui/bench.ts help <command>` or `bun ui/bench.ts commands` for the current
CLI contract.

Run the local workbench when you want the browser UI:

```bash
bun ui/server.ts          # http://127.0.0.1:4319/workflows.html
bun ui/bench.ts help      # JSON help for the agent CLI
```

Workbench details live in [`ui/README.md`](ui/README.md).

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

## Common workflows

### Import an external skill and create starter cases

Use this when the source skill lives outside this repo or has no eval corpus yet:

```bash
bun ui/bench.ts eval-case-generate --skill /path/to/external-skill --no-lm-skeleton
bun ui/bench.ts eval-case-generate --skill /path/to/external-skill --n 3
bun ui/bench.ts eval-case-generate --skill <name-or-path> --validate-only runs/generate/<name>/<stamp>/candidates/<case-id>
bun ui/bench.ts eval-case-generate --skill <name-or-path> --promote runs/generate/<name>/<stamp>/candidates/<case-id>
```

`--skill` accepts a repo skill name, an external skill directory, or a
`SKILL.md` path. Path mode imports the full skill directory into
`skills/<name>` when the repo copy is missing. Prompt-style skills missing
Laguna contracts get a synthetic bootstrap schema and validator so the first
cases can be reviewed mechanically. Treat that synthetic contract as a starter
scaffold only; build reviewed functional cases before reading GEPA results as
skill-performance evidence.
Generated cases stay quarantined under `runs/generate/` until `--promote` copies
them into `skills/<skill>/evals/` and updates the per-skill suite.
Full details: [`docs/external-skill-bootstrap.md`](docs/external-skill-bootstrap.md).

### Run evals

Dry run validates fixtures, materialization, manifest shape, and gold replay
without calling `pool`:

```bash
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
```

Live runs require Poolside CLI auth through `POOLSIDE_TOKEN` or
`~/.config/poolside/credentials.json`:

```bash
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --arm xs_with_skill
bun ui/bench.ts eval-runs
```

Run outputs land under `runs/<suite>/<case>/<arm>/`. Eval numbers are internal
and directional; do not publish lift claims from them.

### Optimize a skill

GEPA mutates selected skill authoring components and grades candidates against
frozen eval cases, schemas, and validators. By default the mutable component is
`SKILL.md`; `--components references` adds `references/**`. For large imported
prompt skills, prefer a small reference/supplement component over full-`SKILL.md`
mutation so the optimizer has a narrow target.
Provider-backed reflection uses LiteLLM environment keys such as
`OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`; `--reflection-pool-agent` uses the
authenticated `pool` model-selector path instead.

```bash
uv run harness/optimize/gepa_skill.py --skill <name> --smoke
uv run harness/optimize/gepa_skill.py --skill <name> --baseline-only
uv run harness/optimize/gepa_skill.py --skill <name> --max-metric-calls 60
uv run harness/optimize/gepa_skill.py --skill <name> \
  --reflection-lm openrouter/openai/gpt-5.4 \
  --reflection-reasoning-effort medium
uv run harness/optimize/gepa_skill.py --skill <name> \
  --reflection-pool-agent anthropic/claude-4.5-sonnet
uv run harness/optimize/gepa_skill.py --skill <name> \
  --max-candidate-bytes-over-seed 2500 \
  --reject-broad-artifact-overrides
```

Gate failures score zero before any `pool` spend. Outputs land under
`runs/optimize/<skill>/<stamp>/`; promotion is manual through diff review or:

```bash
bun ui/bench.ts optimize-propose --skill <name> --run-dir runs/optimize/<name>/<stamp>
```

Full details: [`docs/gepa-optimization.md`](docs/gepa-optimization.md).

### Review traces

The standalone review app flattens run directories into traces and serves a
local annotation UI:

```bash
uv run harness/review/extract_traces.py
uv run harness/review/serve.py          # http://127.0.0.1:8765
```

Use `--demo` for synthetic traces. Optional LLM judging is a reading aid, not a
metric, and requires `OPENROUTER_API_KEY`.

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
