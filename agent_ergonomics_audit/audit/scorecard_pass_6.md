# Agent Ergonomics Scorecard Pass 6

Mode: focused full apply pass

Target branch: `main`

Focus: real external-skill first-run eval bootstrap using `/home/ben/.agents/skills/philip` and `compound-engineering:ce-plan`.

No new branch was created.

| Surface | Pre Pass 6 | Pass 6 | Delta | Main change |
| --- | ---: | ---: | ---: | --- |
| `generator.no_lm_bootstrap` | 250 | 870 | +620 | `gen_eval_cases.py --no-lm-skeleton` writes a quarantined starter candidate without model credentials, gates it, and returns a generation report with promote hints. Bootstrap LM setup failures now automatically fall back to this skeleton path. |
| `generator.import_hygiene` | 560 | 840 | +280 | External skill import now preserves skill support files while excluding local state directories such as `.beads/`, `agent_ergonomics_audit/`, and `runs/`. |
| `bench.no_lm_bootstrap_discovery` | 500 | 850 | +350 | `bun ui/bench.ts eval-case-generate` help, command catalog, parser, and docs now advertise and forward `--no-lm-skeleton`. |
| `generator.philip_real_smoke` | 780 | 900 | +120 | Real `philip` path generated a valid no-LM candidate; validate-only passed; promote passed and warned that repo-wide checks still require a full corpus. Generated import/suite were moved out of the checkout after the smoke. |
| `generator.repeated_path_import` | 420 | 850 | +430 | Repeating an external skill path after import now reuses the existing repo copy and reports `skill_import_reused: true` instead of failing with an already-exists error. |
| `generator.repeated_no_lm_skeleton` | 430 | 840 | +410 | Repeating no-LM skeleton generation after promote now chooses a unique case id and fixture bytes instead of failing dedup. |
| `generator.lm_call_fallback` | 300 | 860 | +560 | Bootstrap generation now catches call-time LiteLLM auth/provider failures during spec proposal and materialization, then falls back to the no-LM skeleton path instead of leaking a traceback after import. |
| `runner.external_bootstrap_e2e` | 500 | 900 | +400 | A freshly imported `ce-plan` starter case was promoted and run through `run_eval.py` live: four pool runs, four trajectories recovered, with-skill arms passed, without-skill arms failed as graded outcomes, and no harness failures. |
| `optimizer.external_import_bridge` | 250 | 880 | +630 | Imported prompt-style skills now receive repo-local authoring fields needed by GEPA structure gates; `ce-plan` reached optimizer smoke, baseline-only, and a tiny GEPA session. |
| `generator.batch_promote_bootstrap` | 420 | 850 | +430 | Multi-promote now lets a partial bootstrap corpus reach the final valid state instead of rolling back each intermediate candidate on corpus-minimum checks. |
| `optimizer.pool_reflection` | 250 | 820 | +570 | `gepa_skill.py` and `bench optimize-skill` now support `--reflection-pool-agent`, so GEPA reflection can use the authenticated Pool model-selector path when LiteLLM/OpenRouter credentials are unavailable. |
| `optimizer.reflection_output_cleanup` | 300 | 760 | +460 | Pool reflection traces now preserve raw stdout/stderr, timeout artifacts, and cleaned candidate text so GEPA does not consume the first fenced block from a verbose tool transcript. |
| `optimizer.functional_eval_cases` | 250 | 780 | +530 | A calibrated ce-plan corpus from real poolside-studio planning material produced non-perfect seed scores and exposed real proposal-quality gaps instead of saturated no-op uplift. |
| `optimizer.seed_sanitization` | 250 | 830 | +580 | GEPA seed loading now strips generated synthetic bootstrap contracts when optimizing against real validators and rejects candidates that reintroduce the synthetic schema literal. |

No surface regressed by more than 50 points.

## Applied Recommendations

- `R-019`: Add no-LM skeleton generation for first-run bootstrap contexts.
- `R-020`: Keep external skill path imports from pulling local state into `skills/<name>`.
- `R-021`: Expose no-LM bootstrap through bench help, parser, and docs.
- `R-022`: Reuse existing repo copies for repeated external skill path invocations.
- `R-023`: Avoid deterministic starter dedup failures after a skeleton case is promoted.
- `R-024`: Fallback on call-time LM authentication/provider failures during bootstrap.
- `R-025`: Normalize imported prompt-style skills for GEPA structure gates.
- `R-026`: Allow multi-promote batches to complete a partial bootstrap corpus.
- `R-027`: Let GEPA reflection use the authenticated Pool agent selector path.
- `R-028`: Clean Pool reflection transcripts before GEPA candidate extraction.
- `R-029`: Use calibrated external-skill cases with non-perfect seed scores before claiming skill-performance uplift.
- `R-030`: Strip synthetic bootstrap contracts from GEPA seeds when optimizing against real validators.

## Real External Skill Smoke

See `audit/pass_6_philip_bootstrap_smoke.md` and `audit/pass_6_ce_plan_bootstrap_smoke.md`.

Summary:

- Direct generator command against `/home/ben/.agents/skills/philip` produced one clean no-LM candidate under `runs/generate/pass6-philip-skeleton/`.
- `--validate-only` returned `ok: true`, `replay_status: "pass"`, and `sensitivity_status: "fail"`.
- `--promote` returned `ok: true`, wrote the candidate and suite, and warned that the broader repo still needs at least three cases including one adversarial before keeping `philip` in-tree.
- Bench wrapper command against the same external path returned `bench-eval-case-generate.v1` with a nested `case-generation.v1` report.
- A second real external skill smoke against `ce-plan` verified support-file import across `references/`, synthetic contract creation, validate-only, promote, repeated path reuse, repeated skeleton dedup recovery, call-time LM auth fallback, and live eval execution.
- The `ce-plan` e2e run used a fresh import from `/home/ben/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.13.0/skills/ce-plan`, promoted `ce-plan-no-lm-bootstrap-starter`, passed `--robot-dry-run --replay`, then ran the live suite under `runs/pass6-ce-plan-e2e`.
- Live results: `xs_with_skill` and `m_with_skill` returned validator `pass`; `xs_without_skill` and `m_without_skill` returned validator `fail`; all four pool runs exited `0`, recovered `trajectory.ndjson`, and wrote valid harness artifacts.
- GEPA bridge results: initial optimizer smoke failed on imported-skill structure gates, then passed after repo-local import normalization. A three-case temporary starter corpus reached GEPA optimizer execution with `seed_val_score: 1.0`, `best_val_score: 1.0`, `total_metric_calls: 5`, and `best_changed: false`.
- Actual measured skill-performance uplift from this synthetic starter GEPA run: `0.0`; the corpus was saturated, so this proves end-to-end wiring rather than quality lift.

Functional ce-plan continuation:

- See `audit/pass_6_ce_plan_functional_gepa.md`.
- A three-case quality corpus derived from `poolside-studio/docs/plans/acp-plan-composer-rail.md` produced a held-out baseline of `0.85`, so there was real headroom.
- Pool-backed GEPA reflection ran through `anthropic/claude-4.5-sonnet` and `anthropic/claude-haiku-4.5`.
- OpenRouter GEPA exposed a synthetic-bootstrap contamination gap, which Pass 6 fixed by stripping generated bootstrap guidance from non-synthetic optimizer seeds and disallowing the synthetic schema literal.
- A clean short OpenRouter GEPA run reached 4/8 calls with the sanitizer active; its proposal tied train score and was skipped before a final `result.json` was written.
- Actual measured skill-performance uplift remained `0.0`: best completed held-out score stayed `0.85`, and no proposed rewrite was accepted.
- Agent-ergonomics uplift and skill-performance uplift are separate metrics; Pass 6 improved the harness ergonomics/wiring, not ce-plan quality.

## Verification

Passed:

```sh
uv run python -m unittest tests/test_gen_eval_cases_cli_contract.py
uv run python -m unittest discover -s tests
uv run scripts/check_schemas.py --json
uv run scripts/check_skill_structure.py --json
uv run scripts/check_validator_robustness.py --json
uv run scripts/check_eval_cases.py --json
bun test ui/bench-cli-contract.test.ts
bun test ui/*.test.ts
git diff --check
```
