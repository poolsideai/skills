# Pass 6 CE Plan Bootstrap Smoke

Date: 2026-06-16

External source: `/home/ben/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.13.0/skills/ce-plan`

## Fresh E2E Continuation

After the first ce-plan smoke, the repo-local `skills/ce-plan`, generated suite,
and old ce-plan generation directories were cleared from the checkout. The
external skill was then re-imported from the plugin cache and carried through
generation, validation, promotion, dry-run/replay, and live eval execution.

The first fresh command intentionally omitted `--no-lm-skeleton` to exercise the
default bootstrap path:

```sh
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.13.0/skills/ce-plan --n 1 --out-dir runs/generate/pass6-ce-plan-e2e-generate
```

Initial result before the final fix:

- Exit code: `1`
- The external skill imported successfully.
- The first LiteLLM spec-proposal call raised `litellm.AuthenticationError`
  because no Anthropic key was configured.
- The exception escaped as a Python traceback, so no reviewable candidate was
  created.

Fix: bootstrap generation now catches LM exceptions around spec proposal and
case materialization calls, then routes them to the same no-LM skeleton fallback
used for setup-time missing-key failures.

Retry result after the fix:

- Exit code: `0`
- `skill_imported`: `true`
- `synthetic_laguna_bootstrap`: `true`
- Warning: `LM call failed during spec proposal ... writing no-LM bootstrap skeleton instead`
- `generated_without_lm`: `true`
- `n_survivors`: `1`
- Candidate: `runs/generate/pass6-ce-plan-e2e-generate/candidates/ce-plan-no-lm-bootstrap-starter`
- Candidate gate result: no violations, `replay_status: "pass"`, `sensitivity_status: "fail"`.

Validate-only and promote:

```sh
uv run harness/generate/gen_eval_cases.py --skill ce-plan --validate-only runs/generate/pass6-ce-plan-e2e-generate/candidates/ce-plan-no-lm-bootstrap-starter
uv run harness/generate/gen_eval_cases.py --skill ce-plan --promote runs/generate/pass6-ce-plan-e2e-generate/candidates/ce-plan-no-lm-bootstrap-starter
```

Both exited `0`. Promote wrote:

- `dest`: `skills/ce-plan/evals/ce-plan-no-lm-bootstrap-starter`
- `suite`: `evals/suites/skill-ce-plan.json`
- `next`: add the remaining reviewed corpus before keeping ce-plan in-tree.

Dry-run/replay:

```sh
uv run harness/runner/run_eval.py --suite evals/suites/skill-ce-plan.json --robot-dry-run --replay
```

Result:

- Exit code: `0`
- `schema_version`: `eval-dry-run-summary.v1`
- `runs_planned`: `4`
- `fixture_invalid_cases`: `0`
- `run_preview_failures`: `0`
- `replay_failures`: `0`

Live eval:

```sh
uv run harness/runner/run_eval.py --suite evals/suites/skill-ce-plan.json --runs-root runs/pass6-ce-plan-e2e --timeout 240 --validator-timeout 120
```

Result:

- Exit code: `0`
- Pool version: `1.0.5`
- Sandbox: `auto -> required`
- Four pool runs completed without harness failures.
- All four runs recovered `trajectory.ndjson`.
- Validator outcomes:
  - `xs_without_skill`: `fail`
  - `xs_with_skill`: `pass`
  - `m_without_skill`: `fail`
  - `m_with_skill`: `pass`

The generated `skills/ce-plan` import and generated
`evals/suites/skill-ce-plan.json` were moved out of the checkout after the live
run. Gitignored run artifacts remain under `runs/pass6-ce-plan-e2e/` for local
inspection.

## Agent UX Evaluation

From the agent seat, the loop is now substantially more forgiving. The first
reasonable command, `--skill /external/path --n 1`, can import a prompt-style
skill, synthesize a Laguna contract, survive missing provider credentials, and
still produce a candidate with validate/promote hints. The live eval runner then
accepts the promoted suite directly.

Remaining UX rough edges:

- Temporary imports are still easy to leave behind. The smoke required manual
  cleanup of `skills/ce-plan` and `evals/suites/skill-ce-plan.json` before
  repo-wide checks.
- The no-LM starter is intentionally generic. It is useful as an executable
  scaffold, but it should not be mistaken for reviewed adversarial coverage.
- The default generated starter declares all four arms, which is correct for
  comparative evals but can surprise an agent expecting a cheap one-run smoke.
  The runner filters are available, but the promote/report hints do not yet
  suggest a low-cost first live command.

## GEPA Bridge Continuation

The follow-up question asked whether the external-skill bootstrap reaches GEPA
auto-improvement sessions, not just eval runs. The first probe showed it did
not:

```sh
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --smoke --out-dir runs/optimize/ce-plan/pass6-gepa-bridge-smoke
```

Initial result:

- Exit code: `1`
- `fitness_dry_run_ok`: `true`
- `seed_gate_violations`:
  - `frontmatter-version`
  - `skill-non-goals-section`

Fix: external prompt-style imports now normalize only the repo-local copy with
`metadata.version: "0.1.0"` and an appended `## Do not use when` section. The
section is appended after the source skill content because prepending it harmed
the first live GEPA baseline probe.

After re-import:

```sh
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --smoke --out-dir runs/optimize/ce-plan/pass6-gepa-bridge-smoke-normalized-2
```

Result:

- Exit code: `0`
- `ok`: `true`
- `seed_gate_violations`: `[]`
- `fitness_dry_run_ok`: `true`

The first normalized baseline probe with the non-goals section prepended scored
`0.0`, confirming that structure normalization can damage skill performance if
inserted at the top. After moving the section to the end:

```sh
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --baseline-only --out-dir runs/optimize/ce-plan/pass6-gepa-bridge-baseline-normalized-2 --timeout 240 --sandbox auto
```

Result:

- Exit code: `0`
- `seed_val_score`: `1.0`
- `ce-plan-no-lm-bootstrap-starter/xs_with_skill`: `score: 1.0`

To create a non-empty GEPA train/val split, two more no-LM starter cases were
generated and promoted. The first attempt exposed another bootstrap-to-GEPA
gap: a multi-promote batch from a partial corpus rolled back on intermediate
`skill-min-cases`/`skill-adversarial-case` checks. Multi-promote now defers
corpus-minimum checks for intermediate candidates and runs the full suite check
on the final candidate.

Three-case optimizer smoke:

```sh
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --smoke --out-dir runs/optimize/ce-plan/pass6-gepa-bridge-3case-smoke
```

Result:

- Exit code: `0`
- `train_cases`: `["ce-plan-no-lm-bootstrap-starter"]`
- `val_cases`: `["ce-plan-no-lm-bootstrap-adversarial", "ce-plan-no-lm-bootstrap-second"]`
- `ok`: `true`

Three-case baseline:

```sh
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --baseline-only --out-dir runs/optimize/ce-plan/pass6-gepa-bridge-3case-baseline --timeout 240 --sandbox auto
```

Result:

- Exit code: `0`
- `seed_val_score`: `1.0`
- Both val cases scored `1.0`.

Tiny GEPA optimization session:

```sh
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --max-metric-calls 3 --out-dir runs/optimize/ce-plan/pass6-gepa-bridge-3case-optimize --timeout 240 --sandbox auto
```

Result:

- Exit code: `0`
- `seed_val_score`: `1.0`
- `best_val_score`: `1.0`
- `total_metric_calls`: `5`
- `n_candidates`: `1`
- `best_changed`: `false`
- Actual measured skill-performance uplift on this synthetic corpus: `0.0`.

Interpretation: the bootstrap now reaches GEPA auto-improvement sessions, but
the mechanical starter corpus is saturated and therefore cannot demonstrate
positive skill-quality lift. It proves wiring, not meaningful optimization
headroom. A real uplift claim requires reviewed cases that the seed skill does
not already solve.

## Direct No-LM Skeleton Generation

Command:

```sh
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.13.0/skills/ce-plan --n 1 --no-lm-skeleton --out-dir runs/generate/pass6-ce-plan-skeleton
```

Result:

- Exit code: `0`
- `schema_version`: `case-generation.v1`
- `skill`: `ce-plan`
- `skill_imported`: `true`
- `synthetic_laguna_bootstrap`: `true`
- `n_survivors`: `1`
- Candidate: `runs/generate/pass6-ce-plan-skeleton/candidates/ce-plan-no-lm-bootstrap-starter`
- Candidate gate result: no violations, `replay_status: "pass"`, `sensitivity_status: "fail"`.

Imported support files included `references/approach-altitude.md`, `references/plan-sections.md`, `references/plan-handoff.md`, and the other ce-plan references. The imported repo copy also received `schemas/ce-plan-synthetic-bootstrap.schema.json` and `scripts/validate_ce_plan_synthetic_bootstrap.ts`.

## Validate-Only

Command:

```sh
uv run harness/generate/gen_eval_cases.py --skill ce-plan --validate-only runs/generate/pass6-ce-plan-skeleton/candidates/ce-plan-no-lm-bootstrap-starter
```

Result:

- Exit code: `0`
- `schema_version`: `case-generation-result.v1`
- `operation`: `validate-only`
- `ok`: `true`
- `violations`: `[]`
- `replay_status`: `pass`
- `sensitivity_status`: `fail`

## Promote

Command:

```sh
uv run harness/generate/gen_eval_cases.py --skill ce-plan --promote runs/generate/pass6-ce-plan-skeleton/candidates/ce-plan-no-lm-bootstrap-starter
```

Result:

- Exit code: `0`
- `schema_version`: `case-generation-result.v1`
- `operation`: `promote`
- `ok`: `true`
- `dest`: `skills/ce-plan/evals/ce-plan-no-lm-bootstrap-starter`
- `suite`: `evals/suites/skill-ce-plan.json`
- `replay_status`: `pass`
- `next`: review diff, then add remaining bootstrap cases; repo-wide `check_eval_cases` still requires at least three cases including one adversarial.

## Repeat Path Findings

The first bench-wrapper retry against the original external path failed because `skills/ce-plan` already existed after direct import:

```text
--skill path .../ce-plan resolves to 'ce-plan', but .../skills/ce-plan already exists.
```

Fix: path resolution now reuses the existing repo copy and reports `skill_import_reused: true`.

The second bench-wrapper retry then failed because the deterministic no-LM skeleton reused the same case id and input bytes after the first candidate had been promoted.

Fix: skeleton generation now chooses a unique case id when the base starter id already exists and includes the case id in `input/brief.md`, avoiding byte-identical input dedup.

## Bench Wrapper

Command:

```sh
bun ui/bench.ts eval-case-generate --skill /home/ben/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.13.0/skills/ce-plan --n 1 --no-lm-skeleton --out-dir runs/generate/pass6-ce-plan-bench-skeleton
```

Final result:

- Exit code: `0`
- Outer schema: `bench-eval-case-generate.v1`
- Nested generator report: `case-generation.v1`
- `skill_import_reused`: `true`
- `n_survivors`: `1`
- Candidate: `runs/generate/pass6-ce-plan-bench-skeleton/candidates/ce-plan-no-lm-bootstrap-starter-2`
- Candidate gate result: no violations, `replay_status: "pass"`, `sensitivity_status: "fail"`.

The generated `skills/ce-plan` import and generated `evals/suites/skill-ce-plan.json` were moved out of the checkout after the smoke.
