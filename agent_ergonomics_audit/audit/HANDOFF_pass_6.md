# Handoff

Pass 6 completed in focused full apply mode.

No branch was created. Source changes and audit artifacts are in the current working tree under:

```text
/data/projects/poolside/skills/agent_ergonomics_audit/audit/
```

## Applied In Pass 6

1. `R-019`: no-LM skeleton bootstrap for first-run eval-case generation. `gen_eval_cases.py --no-lm-skeleton` now writes a quarantined starter candidate, gates it, and reports promote hints; bootstrap LM setup failures fall back to this path.
2. `R-020`: external skill import hygiene. Path import excludes local state directories such as `.beads/`, `agent_ergonomics_audit/`, and `runs/`.
3. `R-021`: bench/docs discovery. `bun ui/bench.ts eval-case-generate` now advertises, parses, and forwards `--no-lm-skeleton`; docs list it as an offline path.
4. `R-022`: repeated external skill path invocations reuse the existing repo copy and report `skill_import_reused: true`.
5. `R-023`: repeated no-LM skeleton generation after promote chooses a unique case id and fixture input to avoid dedup failures.
6. `R-024`: call-time LiteLLM auth/provider failures during bootstrap now fall back to gated no-LM starter candidates instead of leaking a Python traceback.
7. `R-025`: external prompt-style imports now satisfy GEPA structure gates with repo-local authoring fields.
8. `R-026`: multi-promote can complete a partial bootstrap corpus before enforcing full corpus minimums.
9. `R-027`: GEPA reflection can use the authenticated Pool model-selector path via `--reflection-pool-agent`.
10. `R-028`: Pool-backed reflection output is cleaned and traced before GEPA consumes candidate text.
11. `R-029`: calibrated ce-plan quality cases were used to measure actual skill-performance uplift separately from harness ergonomics uplift.
12. `R-030`: optimizer seed loading strips generated synthetic bootstrap contracts for non-synthetic suites and rejects candidates that reintroduce the synthetic schema literal.

## Pass 6 Evidence

Real external skill smoke against `/home/ben/.agents/skills/philip`:

```sh
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.agents/skills/philip --n 1 --no-lm-skeleton --out-dir runs/generate/pass6-philip-skeleton
uv run harness/generate/gen_eval_cases.py --skill philip --validate-only runs/generate/pass6-philip-skeleton/candidates/philip-no-lm-bootstrap-starter
uv run harness/generate/gen_eval_cases.py --skill philip --promote runs/generate/pass6-philip-skeleton/candidates/philip-no-lm-bootstrap-starter
bun ui/bench.ts eval-case-generate --skill /home/ben/.agents/skills/philip --n 1 --no-lm-skeleton --out-dir runs/generate/pass6-philip-bench-skeleton
```

The direct generator candidate had no gate violations, `replay_status: "pass"`, and `sensitivity_status: "fail"`. The promote smoke passed and warned that a durable in-tree `philip` import still needs at least three reviewed cases including one adversarial. The temporary generated import and suite were moved out of the checkout after verification.

Real external skill smoke against `ce-plan`:

```sh
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.13.0/skills/ce-plan --n 1 --no-lm-skeleton --out-dir runs/generate/pass6-ce-plan-skeleton
uv run harness/generate/gen_eval_cases.py --skill ce-plan --validate-only runs/generate/pass6-ce-plan-skeleton/candidates/ce-plan-no-lm-bootstrap-starter
uv run harness/generate/gen_eval_cases.py --skill ce-plan --promote runs/generate/pass6-ce-plan-skeleton/candidates/ce-plan-no-lm-bootstrap-starter
bun ui/bench.ts eval-case-generate --skill /home/ben/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.13.0/skills/ce-plan --n 1 --no-lm-skeleton --out-dir runs/generate/pass6-ce-plan-bench-skeleton
```

The `ce-plan` smoke found and fixed repeat-run issues: path reuse after import and unique skeleton ids after promote. The temporary generated import and suite were moved out of the checkout after verification.

The follow-up ce-plan e2e continuation cleared the repo-local ce-plan artifacts, re-imported the external plugin-cache skill, generated a starter through automatic no-LM fallback after a call-time LiteLLM authentication failure, validated and promoted it, then ran both:

```sh
uv run harness/runner/run_eval.py --suite evals/suites/skill-ce-plan.json --robot-dry-run --replay
uv run harness/runner/run_eval.py --suite evals/suites/skill-ce-plan.json --runs-root runs/pass6-ce-plan-e2e --timeout 240 --validator-timeout 120
```

Live result: four pool runs, four recovered trajectories, no harness failures; with-skill arms passed and without-skill arms failed as graded outcomes. The temporary generated import and suite were moved out of the checkout after the live run.

GEPA bridge result: after fixing import structure normalization and multi-promote completion, a three-case temporary ce-plan starter corpus reached `gepa_skill.py` smoke, baseline-only, and a tiny optimizer session. The optimizer run exited `0` with `seed_val_score: 1.0`, `best_val_score: 1.0`, `total_metric_calls: 5`, and `best_changed: false`. Actual measured skill-performance uplift was `0.0` on this synthetic corpus because the seed was already perfect.

Functional ce-plan quality continuation:

```sh
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --baseline-only --out-dir runs/optimize/ce-plan/pass6-functional-three-case-baseline --timeout 240 --sandbox auto
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --max-metric-calls 4 --reflection-minibatch-size 1 --reflection-pool-agent anthropic/claude-4.5-sonnet --out-dir runs/optimize/ce-plan/pass6-functional-gepa-pool-reflection --timeout 240 --sandbox auto
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --max-metric-calls 4 --reflection-minibatch-size 1 --reflection-pool-agent anthropic/claude-haiku-4.5 --reflection-pool-timeout 600 --out-dir runs/optimize/ce-plan/pass6-functional-gepa-pool-haiku-contract-feedback --timeout 240 --sandbox auto
```

The calibrated quality corpus used real poolside-studio ACP plan material and a held-out baseline of `0.85`, so it had real headroom. GEPA ran through Pool-backed reflection, but actual skill-performance uplift remained `0.0`: best held-out score stayed `0.85`, and proposed rewrites were rejected on train score `0.0`. See `pass_6_ce_plan_functional_gepa.md`.

OpenRouter continuation:

```sh
uv run harness/optimize/gepa_skill.py --skill ce-plan --reflection-lm openrouter/anthropic/claude-sonnet-4.5
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --max-metric-calls 8 --reflection-minibatch-size 1 --reflection-lm openrouter/anthropic/claude-sonnet-4.5 --out-dir runs/optimize/ce-plan/pass6-clean-gepa-openrouter-short --timeout 240 --sandbox auto
```

The first OpenRouter run exposed synthetic-bootstrap contamination: the imported skill's generated bootstrap contract was visible to GEPA while functional cases expected the real `.laguna/ce-plan.json` quality artifact. Pass 6 now strips that generated section for non-synthetic suites and records sanitizer metadata in optimizer `config.json`. The clean short OpenRouter run reached 4/8 calls with `ce-plan.synthetic-bootstrap.v1` disallowed; its candidate tied train score `0.7`, was skipped, wrote no final `result.json`, and produced no accepted skill-performance uplift.

Full Pass 6 artifacts:

- `scorecard_pass_6.md`
- `pass_6_philip_bootstrap_smoke.md`
- `pass_6_ce_plan_bootstrap_smoke.md`
- `HANDOFF_pass_6.md`

Pass 6 verification passed:

```sh
uv run python -m unittest tests/test_gen_eval_cases_cli_contract.py
uv run python -m unittest discover -s tests
uv run scripts/check_schemas.py --json
uv run scripts/check_skill_structure.py --json
uv run scripts/check_validator_robustness.py --json
uv run scripts/check_eval_cases.py --json
bun test ui/*.test.ts
git diff --check
```

## Where To Resume After Pass 6

1. Review and commit the working tree.
2. If `philip` should become a real repo skill, onboard it as separate work and add a full reviewed eval corpus before leaving it under `skills/`.
3. Optional next UX pass: add an explicit generated-import cleanup/quarantine command if repeated external path smokes make temporary imports easy to leave behind.
4. Optional runner UX pass: make the generator/promote report suggest a cheap first live command for a newly promoted starter before the full four-arm suite.
5. For real GEPA lift, improve proposal quality or component granularity. The calibrated ce-plan cases now provide non-saturated seed behavior, and the synthetic-bootstrap contaminant is guarded, but the current full-SKILL.md rewrite path still produces broad rewrites that GEPA skips or rejects.

Pass 5 completed in focused full apply mode.

No branch was created. Source changes and audit artifacts are in the current working tree under:

```text
/data/projects/poolside/skills/agent_ergonomics_audit/audit/
```

## Applied In Pass 5

1. `R-013`: `gen_eval_cases.py --skill` now accepts either a repo skill name or a path to a skill directory. If the repo copy is missing, the full skill directory is imported into `skills/<frontmatter-name>` before generation/validation.
2. `R-014`: true zero-case skills now infer bootstrap context for generation as well as validate/promote.
3. `R-015`: path import preserves supporting files such as `references/`, and generation config/report metadata records source/import provenance.
4. `R-016`: bench help, command catalog, README, and workbench docs now advertise `eval-case-generate --skill <name-or-path>`.
5. `R-017`: prompt-style external skills that lack `validate_*.ts` now get an actionable validator-bootstrap error with exact next commands.
6. `R-018`: missing LM credentials now produce a clean setup error and next actions, not a Python traceback.

## Pass 5 Verification

Passed:

```sh
uv run python -m unittest tests/test_gen_eval_cases_cli_contract.py
bun test ui/bench-cli-contract.test.ts
bun test ui/bench-cli-contract.test.ts ui/bench-invalid-flags.test.ts
uv run python -m unittest discover -s tests
uv run scripts/check_schemas.py --json
uv run scripts/check_skill_structure.py --json
uv run scripts/check_validator_robustness.py --json
uv run scripts/check_eval_cases.py --json
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
bun test ui/*.test.ts
git diff --check
```

Real external skill smoke:

```sh
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.agents/skills/better-beads --n 1
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.agents/skills/philip --n 1
```

These were run in temporary copies of the checkout.

- `better-beads` imported with `references/` and `scripts/` preserved, then failed clearly because it has no `scripts/validate_*.ts`.
- `philip` imported with `Workflows/`, `docs/`, and `scripts/` files preserved, added a synthetic schema and `validate_philip_synthetic_bootstrap.ts`, then failed cleanly at missing LM credentials with no traceback.

The actual working tree was not polluted with `skills/better-beads` or `skills/philip`.

Not run to completion:

```sh
bun x tsc -p ui/tsconfig.json
```

This checkout still lacks top-level Bun type dependencies.

## Where To Resume After Pass 5

1. Review and commit the working tree.
2. Run a clean re-score-only pass after commit so `target_sha` can point at committed implementation.
3. Optional next UX pass: make `eval-case-generate` produce a no-LM mechanical bootstrap skeleton when no model key is configured, so the first path command can still create reviewable starter artifacts offline.

Pass 4 completed in resumed full apply mode.

Pass 3 has been restored from archived Codex session evidence at `/home/ben/.codex/archived_sessions/rollout-2026-06-15T19-00-08-019ecca7-c710-79f1-b519-2d474f42d68e.jsonl`; its scorecard is `scorecard_pass_3.md`, and the manifest again records Pass 3 before this Pass 4 continuation.

No branch was created. Source changes and audit artifacts are in the current working tree under:

```text
/data/projects/poolside/skills/agent_ergonomics_audit/audit/
```

## Applied In Pass 4

1. `R-006`: `gen_eval_cases.py --promote` now writes suite JSON through a temp file plus atomic replace, removes temp files during rollback, and bounds post-promote dry-run replay with the existing validator timeout.
2. `R-007`: repo check JSON payloads now include `failure_kind`, `exit_code`, and `next_commands` while preserving `repo-check-result.v1`.
3. `R-008` remainder: `bench eval-runs` now supports `--running`, `--status`, and `--limit`; detached eval-run sidecars include recovery commands and volatile-field metadata.

## Bootstrap Note

The zero-case bootstrap path is intentionally preserved. `tests/test_gen_eval_cases_cli_contract.py` now creates a synthetic no-eval skill to prove implicit bootstrap works for true zero-case skills, and a synthetic broken-eval skill to prove broken visible case dirs are not silently mistaken for true zero.

## Verification

Passed:

```sh
bun test ui/*.test.ts
uv run python -m unittest discover -s tests
uv run scripts/check_schemas.py --json
uv run scripts/check_skill_structure.py --json
uv run scripts/check_validator_robustness.py --json
uv run scripts/check_eval_cases.py --json
git diff --check
```

Not run to completion:

```sh
bun x tsc -p ui/tsconfig.json
```

This checkout has no top-level `node_modules/@types/bun`, so `tsc` exits with a missing Bun type-definition error before checking source.

## Where To Resume

1. Review and commit the working tree.
2. Optionally install top-level Bun type dependencies if `bun x tsc -p ui/tsconfig.json` should be part of this repo's local gate.
3. After commit, run a clean re-score-only pass so manifest `target_sha` can point at the committed implementation rather than an uncommitted working tree.
