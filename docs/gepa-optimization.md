# GEPA Optimization

GEPA searches over selected skill authoring components while eval cases,
schemas, and validators stay frozen. Use it for candidate-selection evidence,
not release claims.

## Offline Checks

Start with no credentials:

```bash
uv run harness/optimize/gepa_skill.py --skill <name> --smoke
```

Smoke mode verifies optimizer wiring, candidate materialization, frozen-path
gates, structure checks, and replayable fitness plumbing without calling `pool`
or a reflection model.

## Live Requirements

Live GEPA needs:

- `pool` auth for executor evals: `POOLSIDE_TOKEN` or
  `~/.config/poolside/credentials.json`.
- A reflection path:
  - provider key through litellm, commonly `OPENROUTER_API_KEY` or
    `ANTHROPIC_API_KEY`; or
  - `--reflection-pool-agent`, which uses the authenticated `pool`
    model-selector path instead of a separate provider key.

Repo-local provider keys usually live in `.env.local`:

```bash
set -a
source .env.local
set +a
```

## Reflection Examples

Provider-backed reflection:

```bash
uv run harness/optimize/gepa_skill.py --skill <name> \
  --reflection-lm openrouter/openai/gpt-5.4 \
  --reflection-reasoning-effort medium \
  --max-metric-calls 60
```

Pool-backed reflection:

```bash
uv run harness/optimize/gepa_skill.py --skill <name> \
  --reflection-pool-agent anthropic/claude-4.5-sonnet \
  --max-metric-calls 60
```

`--reflection-reasoning-effort` applies to LiteLLM-backed reflection calls.
OpenRouter receives it as `reasoning.effort`; other providers receive the
OpenAI-style `reasoning_effort` parameter where supported.

## Mutation Surface

By default GEPA mutates `SKILL.md`:

```bash
uv run harness/optimize/gepa_skill.py --skill <name> --max-metric-calls 60
```

Add references when the skill has supporting docs:

```bash
uv run harness/optimize/gepa_skill.py --skill <name> --components references
```

For large imported prompt skills, avoid full-monolith optimization when a small
reference can carry the behavior. Add a stable pointer from `SKILL.md`, then
optimize the small reference/supplement. Broad rewrites can look good in prose
and still fail the executor/validator loop.

## Bootstrap-Specific Guards

When optimizing imported or prompt-style skills after bootstrap, keep synthetic
bootstrap scaffolding out of non-synthetic suites and reject broad artifact-mode
rewrites:

```bash
uv run harness/optimize/gepa_skill.py --skill <name> \
  --max-candidate-bytes-over-seed 2500 \
  --reject-broad-artifact-overrides
```

These guards are optional. Use them when reflection models keep proposing
large alternate output modes instead of a surgical improvement.

## Promotion

Finished runs write to `runs/optimize/<skill>/<stamp>/`:

```text
config.json
result.json
best/
best.diff
```

Review `best.diff` before promotion. A GEPA run is search evidence only; after
accepting a candidate, rerun structure checks and the full skill suite.
