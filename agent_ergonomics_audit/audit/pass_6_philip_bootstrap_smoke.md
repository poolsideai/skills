# Pass 6 Philip Bootstrap Smoke

Date: 2026-06-16

External source: `/home/ben/.agents/skills/philip`

## Baseline Failure

Command:

```sh
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.agents/skills/philip --n 1 --api-key-env __GEN_EVAL_CASES_PASS6_MISSING_KEY__ --out-dir runs/generate/pass6-philip-current
```

Result before Pass 6 changes:

- Exit code: `2`
- Stderr: clean LM setup failure, but no candidate artifacts were created.
- Finding: a no-key first run still stopped before producing reviewable starter cases.
- Secondary finding: the full-directory import included external local state such as `.beads/` and `agent_ergonomics_audit/`.

The generated `skills/philip` import from this probe was moved out of the checkout.

## Direct No-LM Skeleton Generation

Command:

```sh
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.agents/skills/philip --n 1 --no-lm-skeleton --out-dir runs/generate/pass6-philip-skeleton
```

Result:

- Exit code: `0`
- `schema_version`: `case-generation.v1`
- `skill`: `philip`
- `skill_imported`: `true`
- `synthetic_laguna_bootstrap`: `true`
- `generated_without_lm`: `true`
- `n_survivors`: `1`
- Candidate: `runs/generate/pass6-philip-skeleton/candidates/philip-no-lm-bootstrap-starter`
- Candidate gate result: no violations, `replay_status: "pass"`, `sensitivity_status: "fail"`.

## Validate-Only

Command:

```sh
uv run harness/generate/gen_eval_cases.py --skill philip --validate-only runs/generate/pass6-philip-skeleton/candidates/philip-no-lm-bootstrap-starter
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
uv run harness/generate/gen_eval_cases.py --skill philip --promote runs/generate/pass6-philip-skeleton/candidates/philip-no-lm-bootstrap-starter
```

Result:

- Exit code: `0`
- `schema_version`: `case-generation-result.v1`
- `operation`: `promote`
- `ok`: `true`
- `dest`: `skills/philip/evals/philip-no-lm-bootstrap-starter`
- `suite`: `evals/suites/skill-philip.json`
- `replay_status`: `pass`
- `next`: review diff, then add remaining bootstrap cases; repo-wide `check_eval_cases` still requires at least three cases including one adversarial.

The generated `skills/philip` import and generated `evals/suites/skill-philip.json` were moved out of the checkout after this smoke so the repository checks are not polluted by a one-case external skill.

## Bench Wrapper

Command:

```sh
bun ui/bench.ts eval-case-generate --skill /home/ben/.agents/skills/philip --n 1 --no-lm-skeleton --out-dir runs/generate/pass6-philip-bench-skeleton
```

Result:

- Exit code: `0`
- Outer schema: `bench-eval-case-generate.v1`
- Mode: `generate`
- Nested generator report: `case-generation.v1`
- Nested `n_survivors`: `1`
- Nested `generated_without_lm`: `true`
- Nested candidate gate result: no violations, `replay_status: "pass"`, `sensitivity_status: "fail"`.

The generated import from the bench smoke was moved out of the checkout.
