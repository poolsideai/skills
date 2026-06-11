# Laguna Skills

A validator-first skill library for Poolside's Laguna models, plus an external eval harness
that drives today's `pool exec` to measure whether each skill actually helps.

The founding rule: a skill is a contract with a mechanical grader, not a prompt pack. Every
skill here ships an output schema, an executable validator, and eval cases — authored in that
order, before any `SKILL.md` prose — and the harness compares with-skill vs without-skill arms
on the same cases through the unmodified `pool` CLI. A skill without a validator and eval
evidence doesn't merge.

Plan of record: [`docs/plans/laguna-skills-v0-2026-06-10.md`](docs/plans/laguna-skills-v0-2026-06-10.md).

## The skills

**[`ci-log-reducer`](skills/ci-log-reducer/SKILL.md)** (pathfinder — first end-to-end) reduces
one failing CI log to a small, machine-checkable failure summary written to
`.laguna/ci-log-summary.json` (schema: `ci-log-summary.schema.json`): the failing command, a
failure kind, the decisive error lines cited verbatim with 1-based line numbers, and one to
five safe local next commands. Its validator checks that every cited line number exists in the
log, error text is copied verbatim, the failing command is supported by the log or job
metadata, and suggested commands are safe and local (no network, nothing destructive).

**[`laguna-task-contract`](skills/laguna-task-contract/SKILL.md)** turns an open-ended
engineering request into a bounded, schema-validated work order: a worker contract for Laguna
XS.2 written to `.laguna/task-contract.json`, or a router contract for Laguna M.1 written to
`.laguna/router-contract.json`. A contract carries a single-concern goal, explicit file scope,
acceptance checks, a bounded repair policy, and an escalation path. Its eval corpus includes
good-failure cases — "fix this whole repo" must *fail* contract validation, and the case's
gold artifact is the rejection.

**[`repo-map`](skills/repo-map/SKILL.md)** maps an unfamiliar repository into an
evidence-backed JSON map written to `.laguna/repo-map.json`: summary, languages, frameworks,
entrypoints, key directories, and test commands. Every claim is mechanically audited against
the tree — all paths must exist, framework claims must cite a dependency manifest (never
prose), and test commands must be supported by repo files.

Each skill's Output contract pins the deterministic workspace path where the gradeable JSON
artifact lands; validators grade workspace state plus the final message, never tool-call
transcripts.

## Repo layout

```text
skills/                  # the skill library (source of truth)
  <name>/                #   SKILL.md, schemas/, scripts/ (TypeScript via bun), evals/<case-id>/
  _shared/               #   validator-result.ts — shared emit helper for skill validators
schemas/common/          # cross-cutting contracts: validator-result.v1, eval-case.v1, run-manifest.v0
evals/
  README.md              # case folder format, validator argv contract, gold replay
  suites/                # suite definitions: smoke.json (1 case/skill), first-bundle.json (all v0 cases)
harness/                 # Python (uv) eval harness — external to forge, zero forge changes
  runner/                # run_eval.py + fixtures / pool_exec / matrix / artifacts / report
  validators/            # harness-side result/schema helpers
scripts/                 # repo structure checks (check_*.py)
docs/                    # authoring guide, eval methodology, plan, spike reports
runs/                    # eval run output (gitignored)
```

Languages split at the process boundary: the harness and repo checks are Python run via `uv`;
everything that ships *inside* a skill (preprocessors, validators) is TypeScript run with
`bun`, using bun builtins only — no `node_modules` — so validators work inside materialized
fixture workspaces. Developed against `uv` 0.10.12, `bun` 1.3.14, `pool` 0.2.172 (since
re-verified against `pool` 1.0.5, which restores the full canonical CLI surface — see the addenda
in `docs/model-access-spike.md` and `docs/trajectory-recovery-spike.md`).

## Running the repo checks

Structure checks enforce the mechanical authoring rules (frontmatter, schemas parse, every
case references an existing validator, ≥3 cases per skill including one adversarial, gold
replay):

```sh
uv run scripts/check_skill_structure.py
uv run scripts/check_eval_cases.py
uv run scripts/check_schemas.py
uv run scripts/check_validator_robustness.py  # needs bun: validators must grade junk output as "fail", never crash to "error"
```

No model access or network required.

## Running the eval suites

The runner materializes each case into a fresh temp workspace (copying the skill into
`.poolside/skills/<name>/` for with-skill arms only), executes `pool exec` under an isolated
HOME, runs the case's validator, and writes
`runs/<suite>/<case>/<arm>/{prompt.md,stdout.nljson,stderr.txt,trajectory.atif.json,validator.json,manifest.json}`.

Dry run — prints exact commands and validates fixtures without invoking `pool`; add
`--replay` to also gold-replay every validator against its case's `expected/` artifacts:

```sh
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
```

Live run — requires `pool` authenticated against the tenant backend (`--api-url` /
`$POOLSIDE_API_URL`) and the agent-name → model mapping documented in
[`docs/model-access-spike.md`](docs/model-access-spike.md):

```sh
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json
```

`--case`, `--arm`, `--keep-workspaces`, and timeout flags are documented in
`uv run harness/runner/run_eval.py --help`. The four v0 arms are `xs_without_skill`,
`xs_with_skill`, `m_without_skill`, `m_with_skill`.

## Reviewing runs (the annotation interface)

Error analysis happens in a browser, not in raw NLJSON. `harness/review/` flattens run dirs
into traces and serves a single-page annotation UI — one case×arm run at a time, with the
model's output artifact, color-coded validator checks, rendered final message, the full
trajectory behind a toggle, and a gold-reference side panel. Reviewers label Pass/Fail/Defer
with notes (keyboard: `1`/`2`/`D`, arrows to navigate, `R` for reference); labels auto-save to
`runs/review/labels.json`, and the page hot-reloads when new runs or labels land.

```sh
uv run harness/review/extract_traces.py            # flatten runs/ -> runs/review/traces.json
uv run harness/review/extract_traces.py --demo     # or: synthetic traces from gold artifacts
uv run harness/review/serve.py                     # http://127.0.0.1:8765
```

The labels file is the input to the failure taxonomy the methodology requires before any
grader is added (`docs/eval-methodology.md`, error-analysis-first).

## Why all results stay internal and directional

Every number this harness produces is labeled **internal/directional** — none are publishable
lift claims. That is a deliberate v0 boundary, not modesty: baselines are not literally
zero-skill (`pool` auto-installs its embedded default skills even under a fresh HOME),
trajectories are recovered via `history --latest` because runs have no stable lookup key,
activation is parsed out of a brittle NLJSON stream, and there is no statistical acceptance
policy (case/repeat minimums, seed controls, confidence reporting) yet. Each run manifest
records these workarounds as harness debt; that debt list is the evidence for which hardening
PR lands next (PR2 remote-skill parity, PR3 real isolation flags, PR4 stable artifact dirs,
PR5 eval-grade telemetry, PR6 model-config ergonomics, PR7 native `pool eval`). Until the
relevant PRs land, readouts feed prioritization only — see
[`docs/eval-methodology.md`](docs/eval-methodology.md) §7 for the full policy.

## Documentation

- [`docs/authoring-guide.md`](docs/authoring-guide.md) — the single authoring standard: hard
  gates, frontmatter rules, the ten-section SKILL.md template, validator contract.
- [`docs/eval-methodology.md`](docs/eval-methodology.md) — arm matrix, isolation recipe,
  metrics, error-analysis-first discipline, reporting policy.
- [`evals/README.md`](evals/README.md) — case folder format, the validator-location rule,
  the gold replay procedure.
- [`docs/plans/laguna-skills-v0-2026-06-10.md`](docs/plans/laguna-skills-v0-2026-06-10.md) —
  the v0 plan; [`docs/reviews/`](docs/reviews/) holds its design critique.
- [`docs/model-access-spike.md`](docs/model-access-spike.md) and
  [`docs/trajectory-recovery-spike.md`](docs/trajectory-recovery-spike.md) — Track 1 spike
  findings (agent names, quotas, trajectory mapping).

## Mockup-era artifacts

`index.html`, `skill.html`, and `styles.css` are a static GitHub Pages prototype of a public
skill catalog from before this plan existed. They are kept untouched for reference and are not
part of the skill library, the harness, or any check. A real public catalog is a later
workstream (out of v0 scope).
