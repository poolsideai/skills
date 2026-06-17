# Pass 6 ce-plan Functional GEPA Continuation

Goal: move beyond saturated no-LM starter cases and test whether an imported
external `ce-plan` skill can bootstrap cases, run evals, and reach actual GEPA
auto-improvement attempts with non-perfect seed scores.

## Corpus

Temporary imported skill:

```text
/home/ben/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.13.0/skills/ce-plan
```

Functional case source:

```text
/data/projects/poolside-studio/docs/plans/acp-plan-composer-rail.md
```

Generated and promoted temporary cases:

- `ce-plan-plan-rail-quality`
- `ce-plan-plan-rail-quality-train`
- `ce-plan-plan-rail-quality-adversarial`

The validator scored `.laguna/ce-plan.json` with partial credit for title,
problem framing, scope boundaries, requirements traceability, implementation
units, repo-relative paths, test scenarios, decisions/risks, and evidence
sources. The adversarial case included a stale path trap.

## Baseline

Command:

```sh
uv run harness/optimize/gepa_skill.py --skill ce-plan --suite evals/suites/skill-ce-plan.json --baseline-only --out-dir runs/optimize/ce-plan/pass6-functional-three-case-baseline --timeout 240 --sandbox auto
```

Result:

- Held-out val cases: `ce-plan-plan-rail-quality`, `ce-plan-plan-rail-quality-adversarial`
- `seed_val_score`: `0.85`
- Main failures: missing explicit `evidence_sources`; adversarial case also
  missed the exact feature title.

## GEPA Runs

OpenRouter was not available in the inherited shell environment, so Pass 6 added
Pool-backed reflection:

```sh
--reflection-pool-agent anthropic/claude-4.5-sonnet
--reflection-pool-agent anthropic/claude-haiku-4.5
```

Runs:

| Run | Reflection | Result |
| --- | --- | --- |
| `pass6-functional-gepa-pool-reflection` | `anthropic/claude-4.5-sonnet` | Reflection timed out twice at 240s; `seed_val_score`/`best_val_score` `0.85`; `best_changed: false`. |
| `pass6-functional-gepa-pool-haiku` | `anthropic/claude-haiku-4.5` | Reflection returned through Pool, but verbose markdown caused a bad extracted candidate; `seed_val_score`/`best_val_score` `0.8`; `best_changed: false`. |
| `pass6-functional-gepa-pool-haiku-contract-feedback` | `anthropic/claude-haiku-4.5` | After cleaned extraction and prompt-contract side info, GEPA still rejected the proposal on train score `0.0`; `seed_val_score`/`best_val_score` `0.85`; `best_changed: false`. |
| `20260616-211543Z` | `openrouter/anthropic/claude-sonnet-4.5` | User-launched 60-call run reached GEPA but started optimizing toward the generated synthetic bootstrap contract; stopped manually after the issue was visible. |
| `pass6-clean-gepa-openrouter-short` | `openrouter/anthropic/claude-sonnet-4.5` | After seed sanitization, the run reached 4/8 calls with `ce-plan.synthetic-bootstrap.v1` disallowed. The proposal was semantically better but tied train subsample score `0.7`, so GEPA skipped it. No `result.json` was written and no candidate was accepted. |
| `pass6-serious-gepa-gemini35-100-fg` | `openrouter/google/gemini-3.5-flash` | 100-call run on a 12-case corpus with 8 train / 4 val cases. Completed 102 metric calls; `seed_val_score`/`best_val_score` `0.875`; `best_changed: false`. Reflection repeatedly proposed broad JSON/artifact-mode rewrites that scored `0.0` on sampled train cases. |
| `pass6-pilot-gpt54-medium-guard-w4-40` | `openrouter/openai/gpt-5.4`, `--reflection-reasoning-effort medium`, `--workers 4` | 40-call guarded pilot. Completed 42 metric calls; `seed_val_score`/`best_val_score` `0.875`; `best_changed: false`. GPT-5.4 produced cleaner prose than Gemini but the same broad artifact-contract rewrite attractor, and each proposed rewrite scored `0.0` on sampled train cases. |
| `pass6-pilot-sonnet45-medium-guard-w4-40` | `openrouter/anthropic/claude-sonnet-4.5`, `--reflection-reasoning-effort medium`, `--workers 4` | Stopped at 10/40 calls after one train-scored broad rewrite scored `0.0` and later OpenRouter/LiteLLM returned malformed blank response content during reflection. No `result.json`; no accepted candidate. |

Actual measured skill-performance uplift: `0.0`.

## Seed Sanitization

The first OpenRouter run exposed a bootstrap-to-optimizer contamination gap:
the imported prompt-style skill needed a generated `Synthetic Laguna Bootstrap
Contract` for first-run starter cases, but calibrated plan-quality cases used a
real validator and prompt-local `.laguna/ce-plan.json` contract. GEPA reflection
was seeing both and could reinforce the wrong synthetic schema.

Pass 6 now detects whether the active suite is synthetic-bootstrap-only. For
non-synthetic suites, optimizer seed loading strips the generated bootstrap
contract from `SKILL.md`, records the sanitizer note in `config.json`, and
rejects candidates that reintroduce `ce-plan.synthetic-bootstrap.v1`.

Verification evidence:

- `runs/optimize/ce-plan/pass6-clean-seed-smoke/config.json` recorded
  `synthetic_bootstrap_only: false`, a `seed_sanitization` note, and
  `disallowed_literals: ["ce-plan.synthetic-bootstrap.v1"]`.
- `runs/optimize/ce-plan/pass6-clean-seed-baseline` held the sanitized baseline
  around `0.8`/`0.85`, preserving real headroom.
- `runs/optimize/ce-plan/pass6-clean-gepa-openrouter-short` reached GEPA with
  the sanitizer active; its candidate no longer pursued the synthetic schema,
  but tied train score and was skipped.

## UX Findings

- The import/bootstrap/eval/optimizer wiring works end to end.
- A saturated starter corpus can prove wiring but cannot prove skill lift.
- Full-`SKILL.md` optimization is the wrong search surface for large imported
  prompt skills. `ce-plan` is roughly 168 KB after import/bootstrap; reflection
  models repeatedly found a broad "artifact contract mode" rewrite instead of
  a small surgical instruction that improved executor behavior.
- Reasoning-capable reflection models need an explicit harness knob. Pass 6 now
  adds `--reflection-reasoning-effort` and forwards it through LiteLLM/OpenRouter
  instead of silently changing only the model id.
- Parallel workers are useful for evaluator throughput, but they do not fix a
  bad mutation surface. The GPT-5.4 pilot used `--workers 4` and still converged
  on rejected broad rewrites.
- Pool-backed reflection is necessary for this repo because the workbench model
  selector already uses Pool while LiteLLM/OpenRouter credentials may be absent.
- Pool reflection needs transcript cleanup because `-o markdown` can include
  trajectory text and tool-call outputs before the final candidate.
- GEPA side info must include the prompt-local artifact contract; validator
  failure lines alone can make the reflector optimize toward a generic synthetic
  bootstrap contract instead of the actual case contract.
- Synthetic bootstrap scaffolding must be treated as a first-run bridge, not as
  durable optimization guidance for non-synthetic suites.
- Even with those fixes, proposal quality is still the limiting factor for
  `ce-plan`: the rejected rewrites did not teach the skill to produce the
  case-specific structured planning artifact reliably.
- The next functional experiment should optimize a small mutable supplement
  such as `references/laguna-eval-artifact.md`, with one stable pointer from
  `SKILL.md`, rather than letting GEPA rewrite the whole skill.

## Cleanup

The imported `skills/ce-plan` directory and `evals/suites/skill-ce-plan.json`
began as temporary Pass 6 artifacts. They are being committed with this pass as
experimental evidence because the user explicitly requested committing the
remaining unstaged Pass 6 workspace. They should still be treated as an
experimental imported skill corpus, not as a reviewed publishable Laguna skill.
