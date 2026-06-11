# Skill-optimization track: GEPA over SKILL.md (pilot)

Status: pilot infrastructure landed 2026-06-11. Owner: Ben.
Companion docs: `docs/plans/laguna-skills-v0-2026-06-10.md` (plan of record),
`docs/eval-methodology.md` (all numbers internal/directional).

## Decision record

We evaluated three framework families for auto-optimizing skills against our
harness (evo-hq/evo agentic tree search; DSPy/Ax program optimizers; the
standalone `gepa` library):

- **GEPA wins for our regime** — text-heavy artifact, expensive rollouts
  (every eval is a real `pool exec`), small per-case 0..1 score vectors.
  Reflective mutation extracts a lesson from every failed rollout; per-instance
  Pareto selection maps 1:1 onto our per-case `validator_result.score`.
  Direct precedent: the GEPA team's `gskill` pipeline auto-learns repo-specific
  skill files for coding agents (Mini-SWE-Agent 24→93% on Bleve in <300
  rollouts; skills transfer to Claude Code) —
  https://gepa-ai.github.io/gepa/guides/gskill/
- **evo** stays on the shelf for possible future *code* evolution (validators,
  harness) — its frozen-grader/anti-cheat discipline is adopted here as the
  frozen-paths gate. **DSPy-proper** optimizes DSPy programs (wrong
  abstraction; their own answer for black-box artifacts is
  `optimize_anything`). **Ax (TS)** has AxGEPA but the Python `gepa` package is
  the source-of-truth implementation and our harness is already Python.

Verified against `gepa==0.1.1` (PyPI, Mar 2026):
`gepa.optimize_anything.optimize_anything(seed_candidate, *, evaluator,
dataset, valset, objective, background, config=GEPAConfig(engine=EngineConfig,
reflection=ReflectionConfig))`; evaluator returns `(score, side_info)`.

## Architecture (one frozen grader, three gates, one searcher)

```
harness/llm.py          # shared LM client (litellm): OpenRouter + OpenAI-compatible endpoints
harness/optimize/
  fitness.py            # evaluator half: run_eval.py wrapper -> skill-fitness.v1 JSON
  frozen_paths_gate.py  # byte-immutability of evals/, schemas/, scripts/validate_*
  gepa_skill.py         # GEPA driver (PEP 723 script: gepa, litellm, pyyaml)
harness/generate/
  gen_eval_cases.py     # eval-case generator: synthesize -> mechanical gates -> human promote
evals/suites/skill-<name>.json   # per-skill suites (flat => validated by check_eval_cases.py)
runs/optimize/<skill>/<stamp>/   # config, gepa state (resumable), candidates, result, best/
runs/generate/<skill>/<stamp>/   # generated case candidates (quarantined until --promote)
```

- **Genome = SKILL.md text only.** Candidates are full copies of the canonical
  skill dir with SKILL.md swapped. Frozen surfaces (eval cases + golds,
  schemas, `scripts/validate_*.ts`) are byte-compared per candidate; the
  harness independently resolves cases/validators against the canonical repo
  regardless of `--skills-root` (matrix.py, run_eval.py), so grading cannot be
  tampered with even if the gate were bypassed.
- **Gates run before pool spend** and rejections return score 0 *with the
  violation text as reflection feedback*: frozen-paths gate, the same
  `check_skill_structure.check_skill` checks CI runs (imported, not
  reimplemented), a hard byte cap (default max(32 KiB, 2× seed)), and an
  anti-overfit literal gate — candidates may not quote eval case ids,
  case-specific input filenames, or gold error lines; reflection side info
  uses case aliases instead of raw ids. Literals the seed SKILL.md already
  quotes (its deliberate worked example) are grandfathered, so the gate means
  "no NEW case-specific quotes" — residual risk documented, not hidden.
- **Fitness** = mean `validator_result.score` over (case × arm), arms
  defaulting to `xs_with_skill` only (baseline arms are constant w.r.t. the
  candidate). Harness failures (validator `error`, CLI rejection, missing
  manifest/run dir) score 0.0 and are flagged — never silently dropped.
  Good-failure cases (`expected_status: "fail"`) score on graded correctness.
  Exit 2 = configuration error and aborts the search (never a fake zero).
- **Reflection fuel**: validator `repair_feedback[]` + failed check details
  flow into GEPA's `side_info` — the same strings the model sees in its live
  repair loop.

## Running it

```sh
# wiring check — no pool, no API keys:
uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --smoke

# seed baseline on the val split (live pool):
uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --baseline-only

# live pilot (authenticated pool + reflection key, e.g. ANTHROPIC_API_KEY):
uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --max-metric-calls 60

# workbench (detached, pid sidecar under runs/optimize/.state/):
bun ui/bench.ts optimize-skill --skill ci-log-reducer [--smoke|--baseline-only]
bun ui/bench.ts optimize-runs
```

Cost model: `--max-metric-calls N` bounds total pool execs. Default split is
bucket-aware and deterministic: ALL adversarial-bucket cases plus every 5th
remaining case go to validation, so the adversarial cases are overfitting
tripwires the search never trains on (12-case ci-log-reducer: 8 train / 4
val); a full search
at N=60 plus one confirm pass ≈ 70 pool runs. Reflection LM defaults to
`anthropic/claude-sonnet-4-5` (litellm id; override `--reflection-lm` /
`GEPA_REFLECTION_LM`).

**Promotion is manual and stays inside the normal contract**: review
`runs/optimize/<skill>/<stamp>/best.diff`, bump `metadata.version`, open a PR;
CI structure checks + eval evidence gate the merge as usual.

**LM selection (both tracks, via `harness/llm.py`)**: any litellm model id.
OpenRouter is litellm-native — `openrouter/<provider>/<model>` +
`OPENROUTER_API_KEY`. Any OpenAI-compatible endpoint (vLLM, LiteLLM proxy,
tenant gateways): `--reflection-api-base` / `--api-base` with a bare served
model name (auto-addressed as `openai/<name>`) and `--reflection-api-key-env`
/ `--api-key-env` naming the key's env var. Env defaults:
`GEPA_REFLECTION_LM`, `GEPA_REFLECTION_API_BASE`, `GEPA_REFLECTION_API_KEY_ENV`
(optimization); `CASEGEN_LM`, `CASEGEN_API_BASE`, `CASEGEN_API_KEY_ENV`
(generation, falling back to `GEPA_REFLECTION_LM`).

## Eval corpus (Phase 1b)

ci-log-reducer grew 4 → 12 cases (all gold-replay green): GHA eslint
(lint_error), GHA tsc + ANSI codes (build_error), GitLab go test (nested log
path), OOM-killed exit 137 (infra_error), Jenkins/Gradle single-module
failure, success-epilogue decoy (adversarial), truncated log with command only
in ci-job.json (edge), Buildkite pnpm monorepo. Per-skill suites exist for all
three v0 skills.

## Eval-case generation (Phase 3, landed 2026-06-11)

`harness/generate/gen_eval_cases.py` adapts the gskill/SWE-smith recipe to
this repo. Research notes (verified 2026-06-11): gskill does NOT generate
tasks itself — it delegates entirely to SWE-smith and splits the output
~200 train / ~50 val / ~60 test; SWE-smith's universal gate is
execution-based validation (a candidate bug must break >=1 previously-passing
test and keep >=1 passing), with an overall 50.1% candidate survival rate
(100,074 -> 50,137 instances, paper Table 11; LM-rewrite strategies survive
at ~35%, procedural mutations 2-49%). gskill ships no human review beyond
those mechanical gates — we are deliberately stricter.

Pipeline per candidate: LM spec proposal (diversity against the existing
inventory; explicit `--spec` skips it) -> LM case materialization (full
payload: prompt.md, input/, expected/ gold, metadata) -> mechanical gates ->
bounded LM repair loop on violations -> quarantine under
`runs/generate/<skill>/<stamp>/candidates/`. The gates: the same
`check_eval_cases.py` checks CI runs (imported), prompt-names-artifact
(baseline arms share the grading target), no-gold-leak-into-input/, dedup
(case id + byte-identical input fixtures), size caps + a symlink ban, and the
decisive pair — **gold replay against the frozen validator** (status must
equal `validator.expected_status`; the harness's own replay semantics) and a
**sensitivity probe** (pass-cases replay again with every gold artifact
replaced by junk; a validator that still passes means the case grades nothing
— vacuous golds are rejected mechanically). Dedup violations are diagnostics
that don't block replay, so each repair round carries full validator signal.

**Nothing is auto-merged.** `--promote <candidate-dir>` re-gates, copies into
`skills/<skill>/evals/`, appends to the per-skill suite, re-runs the
skill-scoped CI checks + `run_eval --dry-run --replay`, and rolls back on any
failure; the human reviews the diff and commits. Provenance: generated cases
end their `notes` with "Generated case.". Methodology caveat (eval-methodology
§7 applies): LM-generated cases share failure-mode priors with the LM agents
under test — human review plus adversarial/edge val buckets are the guard.

```sh
uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer --n 4   # needs an LM key
uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer \
    --validate-only <case-dir>                                           # offline gates, no LM
uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer \
    --promote runs/generate/ci-log-reducer/<stamp>/candidates/<case-id>
```

## Caveats and follow-ups

- **Val-set size is the binding constraint.** gskill used ~50 val instances;
  we have 4. Treat lift as directional; grow the corpus with the generator
  above (target ~10-15 cases/skill near-term, ~50 val instances eventually),
  expecting roughly SWE-smith-like survival rates through the gates.
- `workspace-inventory` (4th skill, WIP) has 0 eval cases and fails
  `check_eval_cases.py` repo-wide — pre-existing, needs its 3-case minimum
  before any optimization.
- Possible refinements: optimize `description` as a separate GEPA component
  (activation precision/recall), steal evo's stall-based stopping, fold
  optimization traces into `review-sync`, record a `harness_debt[]`-style
  entry for searches run with <10 val cases.
