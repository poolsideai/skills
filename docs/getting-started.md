# Getting Started

A first-session walkthrough of the skill loop. Unfamiliar terms (Laguna, arms, gold replay,
GEPA, and others) are defined in [`concepts.md`](concepts.md); this page sequences commands and links
out rather than restating rules.

## Prerequisites

Install `uv`, `bun`, and `pool` on PATH. Versions and notes are in the root
[`README.md`](../README.md) (Prerequisites). Authenticate `pool` before live evals; the runner can
use `POOLSIDE_TOKEN` or `~/.config/poolside/credentials.json`.

Live evals need `pool` auth. Optimization and eval-case generation also need
either a reflection/generation provider key or a Pool-backed reflection agent.
The default GEPA path accepts `ANTHROPIC_API_KEY`; OpenRouter works through
litellm with model ids such as `openrouter/<provider>/<model>` plus
`OPENROUTER_API_KEY`; other litellm providers work when their usual environment
variables are present. Keep repo-local secrets in `.env.local` and load them
before live generation or optimization:

```bash
set -a
source .env.local
set +a
```

Everything in the offline section below runs with zero credentials.

## Agent starter prompt

For the fastest path to a live pool success, hand an agent the checked-in prompt:

```text
Read AGENTS.md, then follow docs/prompts/first-success-pool-run.md.
Use ci-log-reducer unless I name a different skill.
```

The prompt runs readiness checks, one dry-run suite, a tiny live pool comparison,
GEPA smoke, a small GEPA search, and proposal creation. It tells the agent not
to promote skill changes without explicit approval.

## Task tracking and Beads in this checkout

This repo does not initialize a Beads tracker locally. There is no `.beads/`
here; do not run `br init` or copy `.beads` from another checkout as part of
onboarding. "What Bead should I pick next?" behavior is graded through
[`skills/bead-selector`](../skills/bead-selector/SKILL.md), whose suite at
`evals/suites/skill-bead-selector.json` synthesizes the Beads graph inside
fixture workspaces. The workbench onboarding page also points at external
Beads source skills under `~/.codex/skills/beads-bv` and
`~/.codex/skills/beads-workflow`; if those paths are missing on your machine,
the onboarding run reports the missing source rather than implying a
repo-local tracker exists. See the root [`README.md`](../README.md) section
"Task tracking and Beads" for the full source-of-truth narrative.

## The loop, offline first

Run these from the repo root, in order. None of them call a model or the network.

1. **Readiness snapshot**: tool availability plus basic skill-contract, suite, and WIP coverage checks:

   ```bash
   bun ui/bench.ts doctor
   bun ui/bench.ts capabilities
   ```

2. **Repo checks**: structure, schemas, validator robustness:

   ```bash
   uv run scripts/check_skill_structure.py
   uv run scripts/check_schemas.py
   uv run scripts/check_validator_robustness.py
   ```

   Add `--json` to any check script when CI or another tool needs a structured
   `repo-check-result.v1` payload on stdout. Repo checks exit `0` when checks pass, `1` for
   check violations, and `2` for argument or usage errors. The JSON payload includes
   `schema_version`, `tool`, `status`, `counts`, `violation_count`, and `violations[]`
   entries with `path`, `check`, and `message`.

3. **Eval-case coverage check**: run this while working on cases:

   ```bash
   uv run scripts/check_eval_cases.py
   ```

   Current state: the v0 bundle (`ci-log-reducer`, `laguna-task-contract`,
   `repo-map`, `bead-selector`, and `workspace-inventory`) meets the minimum
   case count (≥3 cases, ≥1 adversarial). This check will flag any new WIP
   skill that lacks coverage.

4. **Eval dry run**: materializes every case into a temp workspace, prints the exact `pool`
   commands a live run would use, and gold-replays each validator against its case's `expected/`
   gold:

   ```bash
   uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
   ```

5. **Optimizer smoke**: verifies the GEPA wiring without pool or API keys:

   ```bash
   uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --smoke
   ```

6. **Review app on demo traces**: see what trace annotation looks like:

   ```bash
   uv run harness/review/extract_traces.py --demo
   uv run harness/review/serve.py          # http://127.0.0.1:8765
   ```

When the repo checks, eval-case coverage check, eval dry run, optimizer smoke,
and demo review app work, the offline loop is wired for local development. The
coverage check is expected to pass for the v0 bundle; it should only turn red
for newly added WIP skills that have not received cases yet.

## The live loop

Use `ci-log-reducer` for the first full pass because it is the worked example and has a per-skill
suite.

1. **Run the structure checks again before spending pool runs.** These should be green unless you
   are intentionally working through a known WIP coverage gap.

   ```bash
   uv run scripts/check_skill_structure.py
   uv run scripts/check_schemas.py
   uv run scripts/check_validator_robustness.py
   uv run scripts/check_eval_cases.py
   ```

2. **Dry-run and replay the target suite.** This validates fixture materialization and gold replay
   without calling `pool`.

   ```bash
   uv run harness/runner/run_eval.py --suite evals/suites/skill-ci-log-reducer.json --dry-run --replay
   ```

3. **Run the live scoreboard suite.** The bench wrapper starts the harness detached and reports the
   pid/log path; poll with `eval-runs` until every arm is finished.

   ```bash
   bun ui/bench.ts eval-run --suite evals/suites/skill-ci-log-reducer.json
   bun ui/bench.ts eval-runs
   ```

4. **Run GEPA through the workbench wrapper.** Start with smoke or baseline-only when validating
   wiring, then run a bounded live search when credentials and budget are ready.

   ```bash
   bun ui/bench.ts optimize-skill --skill ci-log-reducer --smoke
   bun ui/bench.ts optimize-skill --skill ci-log-reducer --baseline-only
   bun ui/bench.ts optimize-skill --skill ci-log-reducer --max-metric-calls 60
   # uses pool auth/model selector, no separate reflection provider key
   bun ui/bench.ts optimize-skill --skill ci-log-reducer --reflection-pool-agent anthropic/claude-4.5-sonnet
   # uses OPENROUTER_API_KEY from the environment
   bun ui/bench.ts optimize-skill --skill ci-log-reducer --reflection-lm openrouter/openai/gpt-5.4 --reflection-reasoning-effort medium
   # useful for imported/bootstrap skills where broad artifact-mode rewrites are a known attractor
   bun ui/bench.ts optimize-skill --skill ce-plan --max-candidate-bytes-over-seed 2500 --reject-broad-artifact-overrides
   bun ui/bench.ts optimize-runs
   ```

   For large imported prompt skills, prefer optimizing a small reference or supplement over
   full-`SKILL.md` mutation. Broad monolithic rewrites often look plausible but fail the actual
   executor/validator loop. See [`gepa-optimization.md`](gepa-optimization.md).

5. **Turn a finished optimization into a proposal, not a direct edit.** This folds the best GEPA
   candidate into `runs/proposals/<skill>/` and the improvement queue. Accepting a proposal bumps
   the skill version, runs the structure gate, and starts the suite again; it is still a human
   review action.

   ```bash
   bun ui/bench.ts optimize-propose --skill ci-log-reducer --run-dir runs/optimize/ci-log-reducer/<stamp>
   ```

   Proposals generated from GEPA include this warning by design: `EVIDENCE LEVEL: search val split
   only - run the full eval suite and check the scoreboard before accepting.` Treat all eval and
   optimization numbers as internal/directional.

## External Skill Bootstrap Loop

Use this flow when importing a skill from outside the repo and building its
first reviewable eval cases. Full details are in
[`external-skill-bootstrap.md`](external-skill-bootstrap.md).

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
cases can be reviewed mechanically. That synthetic contract is a starter
scaffold, not real skill-performance evidence. `--no-lm-skeleton` works without
LM credentials, and LM bootstrap automatically falls back to that skeleton path
when provider setup or the first provider call fails.

## Read one real skill end to end

The abstract rules in [`authoring-guide.md`](authoring-guide.md) map onto a concrete example:
read [`skills/ci-log-reducer/`](../skills/ci-log-reducer/) in authoring order:
`schemas/*.schema.json` first, then `scripts/validate_*.ts`, then one case folder under
`evals/` (note the adversarial one), then `SKILL.md`. That order is Gate 1 of the two hard
gates. For a skill that uses progressive-disclosure `references/`, see
[`skills/laguna-task-contract/`](../skills/laguna-task-contract/).

## Going live

Live steps need credentials. See the matrix in [`concepts.md`](concepts.md).

- **Live eval run** (`pool` auth): the root README's common workflows cover
  eval commands; `POOLSIDE_TOKEN` and `~/.config/poolside/credentials.json`
  are the supported auth paths. Results land under `runs/`.
- **Workbench** (`pool` auth for runs): `bun ui/server.ts` →
  `http://127.0.0.1:4319/workflows.html`, or `bun ui/bench.ts help` for the agent CLI.
  `bun ui/bench.ts commands`, `bun ui/bench.ts help <command>`, and
  `bun ui/bench.ts <command> --help` expose the machine-readable CLI catalog. Bench commands
  write JSON to stdout on success, JSON to stderr on errors, and exit `2` for unknown commands.
  See [`../ui/README.md`](../ui/README.md).
- **Smithers orchestration** (agent-driven durable workflows): use the root
  `.smithers/` workflow pack for multi-step, long-running, approval-gated, or
  parallel work. Start with:

  ```bash
  bunx smithers-orchestrator workflow doctor --format md
  bunx smithers-orchestrator workflow list --format md
  bunx smithers-orchestrator starters --format md
  ```

  Project-local details are in [`smithers.md`](smithers.md). The older
  `experiments/smithers-pool/` sandbox is still the PoolAgent-specific spike.
- **GEPA optimization** (`pool` auth + provider reflection key or
  `--reflection-pool-agent`) and **eval-case generation** (provider key unless
  skeleton fallback applies): commands in the root README; method in
  [`gepa-optimization.md`](gepa-optimization.md) and
  [`plans/skill-optimization-gepa-2026-06-11.md`](plans/skill-optimization-gepa-2026-06-11.md).
  All resulting numbers are internal/directional only
  ([`eval-methodology.md`](eval-methodology.md) §7).

## Where next

Pick your path in the [documentation index](README.md): authoring a skill starts at
[`authoring-guide.md`](authoring-guide.md) (binding), eval cases at
[`../evals/README.md`](../evals/README.md), methodology at
[`eval-methodology.md`](eval-methodology.md). Bringing an existing skill in from
outside the repo starts at [`external-skill-bootstrap.md`](external-skill-bootstrap.md).
