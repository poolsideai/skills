# Codex Guidance

Keep this file short. Treat it as an agent index and put detailed procedures in
`docs/`, `README.md`, `ui/README.md`, or `docs/smithers.md`. Aim to keep it near
150 lines; if a section grows, move the detail to a linked doc.

## Repo Purpose

This is a validator-first skill library for Poolside Laguna models plus an
external eval harness that drives `pool`. A skill is a gradeable contract:
validator, eval evidence, and prose. Prompt-pack-only skills do not merge.

Start here:

- Overview and common workflows: `README.md`
- First live pool run prompt: `docs/prompts/first-success-pool-run.md`
- Full agent/reference guide: `CLAUDE.md`
- External skill bootstrap and no-LM skeletons: `docs/external-skill-bootstrap.md`
- GEPA reflection, provider keys, and mutation guards: `docs/gepa-optimization.md`
- Optional Beads boundaries: `docs/beads.md`
- Binding authoring standard: `docs/authoring-guide.md`
- Eval method and known debt: `docs/eval-methodology.md`
- Plan of record: `docs/plans/laguna-skills-v0-2026-06-10.md`

## Non-Negotiables

- Author schemas and validators before prose: `schemas/*.schema.json`,
  `scripts/validate_*.ts`, eval cases, then `SKILL.md`.
- Every skill needs a substantive "Do not use when" section and at least one
  `bucket: "adversarial"` eval case.
- Skill TypeScript runs with `bun` and bun/node builtins only. Do not add
  `node_modules` dependencies inside skills.
- Validators must emit `validator-result.v1`, write `--out` when possible, and
  exit `0` whenever a result file was written. Nonzero exit means harness crash.
- Grade artifacts from deterministic workspace paths, usually under `.laguna/`.
  An artifact that only appears in chat does not exist for grading.
- `metadata.version` in `SKILL.md` frontmatter is quoted semver. Bump it for any
  schema, validator, or prose change.
- Do not use `allowed-tools` frontmatter; `pool` does not enforce it.

## Checks

Before committing skill changes:

```bash
uv run scripts/check_skill_structure.py
uv run scripts/check_schemas.py
uv run scripts/check_validator_robustness.py
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
```

While working on eval cases:

```bash
uv run scripts/check_eval_cases.py
```

The v0 bundle (`ci-log-reducer`, `laguna-task-contract`, `repo-map`,
`bead-selector`, and `workspace-inventory`) is expected to pass that check;
it will only flag a new WIP skill that lacks coverage. See `README.md` and
`CLAUDE.md` for live evals, GEPA optimization, trace review, and
case-generation commands.

## Optional Beads

This checkout does not initialize a Beads tracker. Do not run `br init` or copy
`.beads` into the repo during ordinary skill work. See `docs/beads.md` only when
working on `bead-selector` or onboarding checks.

## Smithers

Smithers is installed here for durable multi-step workflows, approvals, run
inspection, parallel agent work, and seeded workflow runs. Use it when inline
work would lose state or coordination.

- CLI: use `bunx smithers-orchestrator ...`, not `bunx smithers ...`.
- Setup and operations doc: `docs/smithers.md`
- Root workflow pack: `.smithers/`
- Local workflows: `.smithers/workflows/*.tsx`
- Prompts and components: `.smithers/prompts/`, `.smithers/components/`
- Agent definitions: `.smithers/agents/`
- Project-scoped Smithers command skills: `.agents/skills/smithers-*/SKILL.md`
- MCP server registration: `.mcp.json` runs `bunx smithers-orchestrator --mcp`
- PoolAgent experiment: `experiments/smithers-pool/`

Start with:

```bash
bunx smithers-orchestrator workflow doctor --format md
bunx smithers-orchestrator workflow list --format md
bunx smithers-orchestrator starters --format md
```

Common follow-ups:

```bash
bunx smithers-orchestrator ps
bunx smithers-orchestrator inspect <run-id> --format md
bunx smithers-orchestrator logs <run-id> --tail 40
bunx smithers-orchestrator graph .smithers/workflows/plan.tsx --format json
```

## Workbench

Use the workbench for the skills catalog, workflow catalog, eval runs,
node-level grades, optimization runs, proposals, and trace review.

```bash
bun ui/server.ts          # http://127.0.0.1:4319/workflows.html
bun ui/bench.ts doctor
bun ui/bench.ts commands
bun ui/bench.ts skills
bun ui/bench.ts eval-runs
```

The detailed workbench contract lives in `ui/README.md`. `ui/lib.ts` is the
shared substrate; `ui/server.ts` is HTTP/static serving; `ui/bench.ts` is the
agent CLI surface.

## Repo Map

- `skills/<name>/`: publishable skill sources.
- `skills/_shared/`: shared TypeScript validator helpers.
- `skills/<name>/evals/<case-id>/`: `prompt.md`, `input/`, `expected/`,
  `metadata.json`.
- `harness/runner/`: eval runner, fixture materialization, `pool exec`, reports.
- `harness/review/`: trace review app.
- `schemas/common/`: shared harness/result schemas.
- `runs/`: gitignored run output.
- `index.html`, `skill.html`, `styles.css`: static catalog mockups.
- `workflows.html`: live workbench shell; run `bun ui/server.ts` for data.

## Local Safety

- Treat generated validators, generated workflows,
  `bunx smithers-orchestrator graph`, and `bunx smithers-orchestrator up` as
  local code execution.
- Keep generated-code subprocesses on scrubbed environments so they do not
  inherit tokens.
- Keep the workbench cross-origin POST checks and frontend URL scheme allowlist.
- Eval results are internal and directional. Do not present them as publishable
  lift claims.

## Documentation Maintenance

When docs drift, use the `philip` skill. Documentation claims should trace to
local evidence: code, tests, config, CLI output, schemas, or git history. Prefer
small patches and explicit pointers over duplicating long contracts in this
file.

## Git Attribution

Do not add AI attribution to commits, pull requests, or generated release text.
Commit messages and PR descriptions must not include footers or phrases such as:

- `Generated by Codex`
- `committed with Codex`
- `committed with Claude Code`
- `Co-Authored-By` for Codex/Claude
