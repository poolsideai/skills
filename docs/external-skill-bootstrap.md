# External Skill Bootstrap

Use this flow when a skill starts outside this repo or has no reviewed eval
corpus yet. The goal is a reviewable, gradeable starter corpus under
`runs/generate/`, not an automatic publishable skill.

## Start Offline

From the repo root:

```bash
bun ui/bench.ts eval-case-generate --skill /path/to/external-skill --no-lm-skeleton
```

`--skill` accepts a repo skill name, an external skill directory, or a
`SKILL.md` path. When the repo copy is missing, path mode imports the full skill
directory into `skills/<name>` before bootstrapping.

`--no-lm-skeleton` needs no provider key. It writes a mechanically generated
starter case under `runs/generate/<name>/<stamp>/candidates/`, runs the same
local gates as LM generation, and leaves the case quarantined for review.

## Prompt-Style Skills

Prompt-style skills often lack Laguna schemas and validators. Bootstrap creates
a synthetic `.laguna/<skill>.json` contract, JSON schema, and validator so the
first case can be checked mechanically.

Treat that synthetic contract as a scaffold. It proves import, quarantine,
validation, and promotion wiring. It does not prove the skill's real task
performance. Before using GEPA output as skill-performance evidence, add
reviewed functional cases with a real validator and prompt-local artifact
contract.

## LM Generation

When provider credentials are available, generate candidate cases with a model:

```bash
set -a
source .env.local
set +a

bun ui/bench.ts eval-case-generate --skill /path/to/external-skill --n 3
```

Common provider keys are `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY`; the
chosen model id determines which key litellm uses. If LM setup or the first
provider call fails during bootstrap, the generator falls back to the no-LM
skeleton path instead of leaving the user with no case artifact.

## Review And Promote

Validate candidates before promotion:

```bash
bun ui/bench.ts eval-case-generate --skill <name-or-path> \
  --validate-only runs/generate/<name>/<stamp>/candidates/<case-id>
```

`--validate-only` is repeatable:

```bash
bun ui/bench.ts eval-case-generate --skill <name-or-path> \
  --validate-only runs/generate/<name>/<stamp>/candidates/<case-a> \
  --validate-only runs/generate/<name>/<stamp>/candidates/<case-b>
```

Promote only reviewed candidates:

```bash
bun ui/bench.ts eval-case-generate --skill <name-or-path> \
  --promote runs/generate/<name>/<stamp>/candidates/<case-id>
```

`--promote` is repeatable. Promotion re-gates, copies cases into
`skills/<skill>/evals/`, appends them to `evals/suites/skill-<skill>.json`, and
rolls back on failure.

## Follow-Up Checks

After promotion:

```bash
uv run scripts/check_skill_structure.py --json
uv run scripts/check_eval_cases.py --json
uv run harness/runner/run_eval.py --suite evals/suites/skill-<skill>.json --dry-run --replay
```
