# First Success Pool Run Prompt

Use this prompt when handing the repo to an agent for the first live run. It is
designed to reach one reviewed pool eval and one small GEPA run without
promoting unreviewed skill changes.

```text
You are working in the Poolside skills repo.

Read AGENTS.md first. Then run the first-success live pool loop for
ci-log-reducer, unless the user names a different skill.

Goal:
- Prove the repo can run checks, live pool evals, and a small GEPA optimization.
- Produce reviewed run artifacts.
- Do not promote or edit skill files unless the user explicitly asks.

Credentials:
- Live evals require pool auth via POOLSIDE_TOKEN or
  ~/.config/poolside/credentials.json.
- For GEPA reflection, prefer the pool model-selector path:
  --reflection-pool-agent anthropic/claude-4.5-sonnet
- If pool-backed reflection is unavailable, load provider keys from .env.local:
  set -a
  source .env.local
  set +a
- Provider-backed reflection can use keys such as OPENROUTER_API_KEY or
  ANTHROPIC_API_KEY. For OpenRouter, use model ids like
  openrouter/openai/gpt-5.4.

Run from the repo root:

1. Capture readiness:
   bun ui/bench.ts doctor
   bun ui/bench.ts capabilities
   uv run scripts/check_skill_structure.py --json
   uv run scripts/check_schemas.py --json
   uv run scripts/check_validator_robustness.py --json
   uv run scripts/check_eval_cases.py --json

2. Dry-run the suite:
   uv run harness/runner/run_eval.py --suite evals/suites/skill-ci-log-reducer.json --dry-run --replay

3. Run a tiny live pool comparison:
   uv run harness/runner/run_eval.py --suite evals/suites/skill-ci-log-reducer.json --arm xs_without_skill --limit 1
   uv run harness/runner/run_eval.py --suite evals/suites/skill-ci-log-reducer.json --arm xs_with_skill --limit 1

4. Run optimizer smoke:
   uv run harness/optimize/gepa_skill.py --skill ci-log-reducer --smoke

5. Run a small GEPA search with pool-backed reflection:
   uv run harness/optimize/gepa_skill.py --skill ci-log-reducer \
     --reflection-pool-agent anthropic/claude-4.5-sonnet \
     --max-metric-calls 12 \
     --max-candidate-bytes-over-seed 2500 \
     --reject-broad-artifact-overrides

   If pool-backed reflection is unavailable, use provider-backed reflection:
   uv run harness/optimize/gepa_skill.py --skill ci-log-reducer \
     --reflection-lm openrouter/openai/gpt-5.4 \
     --reflection-reasoning-effort medium \
     --max-metric-calls 12 \
     --max-candidate-bytes-over-seed 2500 \
     --reject-broad-artifact-overrides

6. Review the GEPA output:
   - Read runs/optimize/ci-log-reducer/<stamp>/result.json.
   - Read runs/optimize/ci-log-reducer/<stamp>/best.diff.
   - Treat eval scores as internal directional evidence.
   - Do not promote the diff automatically.

7. Create a proposal artifact:
   bun ui/bench.ts optimize-propose --skill ci-log-reducer --run-dir runs/optimize/ci-log-reducer/<stamp>

Final report:
- Commands run and pass/fail status.
- Live pool run directories.
- GEPA run directory.
- Baseline score, best score, and metric calls used.
- Whether best.diff is narrow enough to review for promotion.
- Any UX friction, unclear errors, or credential gaps found.

Keep going through nonfatal failures. If a credential is missing, say exactly
which path failed and which credential or auth file is needed.
```
