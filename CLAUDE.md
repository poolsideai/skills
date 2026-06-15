# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A **validator-first skill library** for Poolside's Laguna models plus an **external eval harness**
that drives the `pool` CLI to measure each skill's effect. The founding rule
shapes every design decision here: *a skill is a contract with a mechanical grader.*
Prompt-pack-only skills do not merge.

Plan of record: `docs/plans/laguna-skills-v0-2026-06-10.md`. Authoring standard:
`docs/authoring-guide.md` (binding). Eval method: `docs/eval-methodology.md`.

## Commands

Repo checks (no model access or network; run these before committing skill changes):

```sh
uv run scripts/check_skill_structure.py        # frontmatter, non-goals, schemas/, validators/, no allowed-tools
uv run scripts/check_schemas.py                # every *.schema.json parses
uv run scripts/check_validator_robustness.py   # needs bun: validators must grade junk as "fail", never crash to "error"
```

All repo check scripts accept `--help` and `--json`. They exit `0` when checks pass, `1`
for check violations, and `2` for argument or usage errors. In `--json` mode they emit
`repo-check-result.v1` on stdout with `schema_version`, `tool`, `status`, `counts`,
`violation_count`, and `violations[]` entries (`path`, `check`, `message`). Gold replay
runs through the eval runner:
`uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay`.

Eval-case coverage check (run while working on cases; expected to pass for the
v0 bundle: `ci-log-reducer`, `laguna-task-contract`, `repo-map`,
`bead-selector`, `workspace-inventory`):

```sh
uv run scripts/check_eval_cases.py             # >=3 cases/skill incl. >=1 adversarial, metadata, suites, validator paths
```

Eval suites (runner materializes each case into a fresh temp workspace, runs `pool exec`, then the
case validator):

```sh
# Dry run: prints exact pool commands, validates fixtures, never invokes pool. --replay also
# gold-replays every validator against its case's expected/ artifacts.
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay

# Live run: needs an authenticated `pool` against the tenant backend (--api-url / $POOLSIDE_API_URL).
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json
```

Useful flags: `--case <id>` and `--arm <arm>` (repeatable filters), `--keep-workspaces`,
`--timeout`, `--validator-timeout`, `--sandbox auto|required|disabled`. The four arms are
`xs_without_skill`, `xs_with_skill`, `m_without_skill`, `m_with_skill`. Suites: `smoke.json`
(1 case/skill), `first-bundle.json` (all v0 cases).

Skill optimization (GEPA track; see docs/plans/skill-optimization-gepa-2026-06-11.md;
genome is SKILL.md prose only, validators/cases/schemas are frozen and gate-enforced):

```sh
uv run harness/optimize/gepa_skill.py --skill <name> --smoke   # wiring check, no pool/API keys
uv run harness/optimize/gepa_skill.py --skill <name> --max-metric-calls 60   # live (pool + reflection key)
uv run harness/optimize/fitness.py --skill <name> --skills-root <candidate>/skills  # mean validator score
uv run harness/optimize/frozen_paths_gate.py --skill <name> --candidate-root <dir>  # byte-immutability gate
bun ui/bench.ts optimize-skill --skill <name> [--smoke] && bun ui/bench.ts optimize-runs  # detached + status
```

Eval-case generation (gskill/SWE-smith recipe: LM-synthesize -> mechanical gates incl. gold
replay against the frozen validator -> quarantine under runs/generate/ -> human-reviewed
`--promote`; never auto-merged into evals/):

```sh
bun ui/bench.ts eval-case-generate --skill <name> --n 4                       # needs LM key
bun ui/bench.ts eval-case-generate --skill <name> --validate-only <case-dir>  # offline, no LM
bun ui/bench.ts eval-case-generate --skill <name> --promote <candidate-dir>   # gate + copy + suite
```

The bench command delegates to `uv run harness/generate/gen_eval_cases.py`;
use the raw Python script only when debugging the generator itself.

LM selection (`harness/llm.py`): any litellm id; OpenRouter via
`openrouter/<provider>/<model>` + `OPENROUTER_API_KEY`. For eval-case generation,
OpenAI-compatible endpoints use `--api-base` (+ `--api-key-env`). Reflection endpoint
flags (`--reflection-api-base`, `--reflection-api-key-env`) are for GEPA optimization
reflection only.

Trace annotation (error-analysis-first; the labels file feeds the failure taxonomy):

```sh
uv run harness/review/extract_traces.py        # flatten runs/ -> runs/review/traces.json (--demo for synthetic)
uv run harness/review/serve.py                 # http://127.0.0.1:8765 standalone (ui/server.ts auto-starts it on 8901)
```

Workbench: skills + workflow authoring, eval integration, live run view (requires authenticated
`pool` or `$POOLSIDE_TOKEN`):

```sh
bun ui/server.ts                               # web UI → http://127.0.0.1:4319/workflows.html
                                               # also auto-starts harness/review/serve.py on 8901
bun ui/bench.ts <cmd>                          # agent CLI (shared workbench ops, JSON I/O)
```

Smithers: durable workflow orchestration for multi-step, long-running,
approval-gated, or parallel agent work. Use `bunx smithers-orchestrator ...`
(not `bunx smithers ...`). The root workflow pack is `.smithers/`; project
Smithers setup notes live in `docs/smithers.md`; the older PoolAgent-specific
spike remains `experiments/smithers-pool/`.

```sh
bunx smithers-orchestrator workflow doctor --format md
bunx smithers-orchestrator workflow list --format md
bunx smithers-orchestrator starters --format md
bunx smithers-orchestrator workflow run plan --prompt "Plan the next skill hardening pass"
bunx smithers-orchestrator ps
bunx smithers-orchestrator inspect <runId> --format md
```

Key `bench.ts` commands:

```sh
bun ui/bench.ts doctor                         # readiness snapshot; no web server required
bun ui/bench.ts capabilities                   # CLI contract, output conventions, known mirrors
bun ui/bench.ts commands                       # command catalog with usage, flags, output hints
bun ui/bench.ts help <command>                 # command-specific JSON help (<command> --help also works)
bun ui/bench.ts skills                         # list installed skills
bun ui/bench.ts models                         # pool agents list (laguna first, then anthropic/*, ...)
bun ui/bench.ts skill-generate --name <name> --prompt "..." --model <agent>
                                               # author + install a skill; rolled back if check_skill_structure.py fails
bun ui/bench.ts workflow-generate --prompt "..." --model <agent> --project <path>
                                               # generates workflow; rolls back unverified .tsx files (Smithers graph gate)
bun ui/bench.ts workflow-run <workflow.tsx> --project <path>
bun ui/bench.ts runs / run-show <runId>        # workflow run history (TrajectoryRecords)
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --case <id> --arm xs_with_skill
bun ui/bench.ts eval-runs                      # live harness status + per-arm results (per-suite, not global)
bun ui/bench.ts review-sync                    # fold workbench records into traces.json for annotation
```

There is no separate build or lint step. Skill scripts are run directly: `bun <script>.ts`.

## The two hard gates (a skill that fails either does not merge)

1. **Schema and validator before prose.** Authoring order inside a skill is fixed: (1) output
   `schemas/*.schema.json`, (2) executable `scripts/validate_*.ts`, (3) eval cases incl. the
   adversarial one, (4) `SKILL.md` body. If you can't write the validator, the skill isn't ready.
2. **Non-goals + an adversarial case.** Every `SKILL.md` has a substantive "Do not use when"
   section, and every skill ships ≥1 `bucket: "adversarial"` case that tries to trip it.

## Architecture

### Language split at the process boundary

This is the main structural boundary. It is language-neutral: subprocesses are
named in case `metadata.json`, speaking `validator-result.v1` JSON:

- **Inside a skill** (preprocessors, fact collectors, validators): **TypeScript run with `bun`**,
  using **bun/node builtins only; no `node_modules`**. Skills get copied verbatim into a
  materialized fixture workspace (`.poolside/skills/<name>/`) where nothing is installed, so a
  dependency would break grading. Schema checking is hand-rolled structural validation, not `ajv`.
- **Harness, runner, repo checks**: **Python via `uv`** (`pyproject.toml`, `package = false`; this
  is a script-only repo, never installed as a package).

### Workbench (`ui/`)

`ui/lib.ts` is the substrate for projects, runs, workflows, models, skills, and evals. `ui/server.ts`
uses it for HTTP routes and static serving. `ui/bench.ts` adds the agent CLI contract: command
catalog, capabilities, doctor, command-specific help, flag parsing, JSON error responses, and known
CLI↔HTTP mirror metadata. The web UI (`workflows.html` + `ui/app.js` + `ui/views/*.js`) and
`bench.ts` share the main workbench operations where `capabilities.parity.known_mirrors` says they
mirror each other.

**Authoring gates** are enforced by the substrate and CI: `skill-generate` writes into a
scratch dir, runs `scripts/check_skill_structure.py`, rolls back + feeds violations into one repair
round on failure. Skills only land in `skills/` if structure checks pass. `workflow-generate`
applies the same pattern: unverified `.tsx` files are rolled back if
`bunx smithers-orchestrator graph` rejects them.

**Eval integration**: the server launches `uv run harness/runner/run_eval.py` detached; liveness is
tracked via a pid sidecar under `runs/.harness/` (no in-memory registry, so restarts are safe). The
"running" flag is scoped **per-suite** (not global), so concurrent suite runs don't clobber each
other's state. The UI polls `/api/evals/runs` every 5s with a **self-rescheduling** poller. A
transient 404 (common right after starting a run, before the DB row exists) no longer kills live
updates. One corrupt case no longer drops a whole suite. `caseSkillCache` has a 5s TTL so
newly-authored skills' evals become visible without a restart.

**Trace sync**: `review-sync` / `POST /api/review/sync` folds workbench records into `traces.json`
in the same shape `extract_traces.py` emits: one trace per matched workflow-node pool capture and
one per standalone node-eval trial. It replaces only `workbench/*` traces; harness traces and
`labels.json` are never touched.

**Review app**: `bun ui/server.ts` auto-starts `harness/review/serve.py` on port **8901** if it
isn't already up, so the app survives terminal closes. The evals panel shows a live
"review traces ↗" link. Running the review server manually still works.

**Security for the localhost process-spawning dev tool**:
- *CSRF / cross-origin POST*: every mutating route rejects requests whose `Origin` isn't this
  server (curl / bench CLI with no Origin are allowed). A website open in the same browser can't
  drive code-gen or exec on your machine.
- *Generated-code execution*: `bun validate_*.ts` and
  `bunx smithers-orchestrator graph`/`up` run model-authored code.
  Those sinks spawn with a **scrubbed env** (PATH/HOME/TMPDIR/LANG only), so generated code does not
  inherit `$POOLSIDE_TOKEN`.
- *`javascript:` URLs*: trajectory links from capture data go through a scheme allowlist before
  becoming `href`s in the frontend.

**Node-level evals** (two modes, one record shape):
- *in-situ* (`node-eval-insitu <runId>`): grades each node of a real run with its installed
  skill's validator. This is free and makes no model calls.
- *standalone* (`node-eval-run <workflow> --node <id> --trials N`): re-runs a node in fresh
  workspace copies, grades every trial; the prompt-tuning loop.

### Skill anatomy (`skills/<name>/`)

`SKILL.md` (frontmatter + ten-section body) · `schemas/<artifact>.schema.json` ·
`scripts/validate_<artifact>.ts` (+ optional deterministic preprocessors) ·
optional `references/` (progressive disclosure) · `evals/<case-id>/`. Nothing else at a skill's top
level; no README/CHANGELOG inside a skill. Shared TS helpers live in `skills/_shared/`.

Every skill's **Output contract** pins a **deterministic workspace path** (under `.laguna/`, e.g.
`.laguna/ci-log-summary.json`) where the gradeable JSON artifact lands. Validators grade
**workspace state + the final message only**, never stringified NLJSON tool transcripts. An
artifact that only appears in chat does not exist for grading. The v0 plan-of-record skills are
`ci-log-reducer` (pathfinder), `laguna-task-contract`, and `repo-map`; `bead-selector` and
`workspace-inventory` also ship full eval coverage and dedicated suites
(`evals/suites/skill-bead-selector.json`, `evals/suites/skill-workspace-inventory.json`).
All eval evidence is internal/directional.

### The validator contract (one grader, two callers)

The validator a skill ships is the *same* one the harness runs and the model runs in its repair
loop. Fixed argv contract: `<cmd> --case <case_dir> --workspace <workspace_dir> --out <result_path>`
(`--case` is optional and absent in the live repair loop). All validators import
`skills/_shared/validator-result.ts` (`runValidator`) to emit `validator-result.v1`. Non-negotiable
rules: **always write `--out` and exit 0** whenever a result was written (read the verdict from the
file's `status`, *not* the exit code); nonzero exit = crash, which the harness records as
`status: "error"`. No network ever; explicit paths only; deterministic; bound your own execution
(note: a `setTimeout`/`Promise.race` only preempts an *async* grader; a sync grader must size-cap
reads, cap recursion depth, and never follow symlinks).

### Eval cases (`skills/<name>/evals/<case-id>/`)

`prompt.md` (must name the artifact's workspace path so without-skill arms share the grading target)
· `input/` (the entire world the model sees) · `expected/` (gold artifacts) · `metadata.json`. The
canonical metadata fields are enforced by `check_eval_cases.py`; see authoring-guide §7. Key field:
`validator.expected_status` (`pass`/`fail`) is what the validator must return when **replayed
against the case's own `expected/` gold**, making every case self-testing. **Good-failure cases**
(e.g. `laguna-task-contract`'s "fix this whole repo", which must *fail* contract validation) ship a
deliberately-bad gold artifact and set `expected_status: "fail"`.

### Harness internals (`harness/`)

`runner/` = `run_eval.py` (entry) + `matrix.py` (arm × case expansion; agent names resolve via
`DEFAULT_AGENTS`, overridable with `POOLSIDE_EVAL_AGENT_XS` / `POOLSIDE_EVAL_AGENT_M`) + `fixtures.py`
(workspace materialization) + `pool_exec.py` + `artifacts.py` + `report.py`. `review/` = the
annotation UI. `validators/` = harness-side result/schema helpers. Cross-cutting contracts live in
`schemas/common/` (`validator-result.v1`, `eval-case.v1`, `run-manifest.v0`).

## Conventions and gotchas

- **All eval results are internal/directional**; never publishable lift claims. v0 baselines aren't
  truly zero-skill (`pool` auto-installs embedded default skills), trajectories are recovered via
  `history --latest`, and there's no statistical acceptance policy yet. Each run manifest records
  these workarounds in `harness_debt[]`; that debt list drives which hardening PR lands next
  (eval-methodology §7).
- `metadata.version` in SKILL.md frontmatter is a quoted semver; **bump it on any change** to schema,
  validator, or prose (manifests record it).
- **`allowed-tools` frontmatter is UNSUPPORTED**; `pool` doesn't enforce it. Document runtime
  (`bun` on PATH) and tool/network expectations as prose; enforcement is harness-side.
- Skill `description` is written as explicit **trigger phrases** ("Use when ..."), not a summary. It's
  the only text the agent sees before loading the skill, and activation precision/recall are measured.
- Verified against `uv` 0.11.21, `bun` 1.3.14, `pool` 1.0.5 (see addenda in `docs/model-access-spike.md`
  and `docs/trajectory-recovery-spike.md`).
- `runs/` is gitignored. `index.html`, `skill.html`, `styles.css` are the static GitHub Pages
  catalog mockup; **not part of any skill, the harness, or any check**. `workflows.html` is the
  live workbench frontend (served by `ui/server.ts` at port 4319); `ui/app.js` loads the routed
  `ui/views/*.js` modules. The annotation app (`harness/review/`) defaults to port **8765** standalone and runs on **8901** when auto-started by `ui/server.ts`.
