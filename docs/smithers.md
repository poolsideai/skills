# Smithers Setup

Smithers is available in this repo in two complementary ways:

- **Root workflow pack**: `.smithers/` is the repo-local Smithers project created by
  `bunx smithers-orchestrator init`. Use this for durable multi-step workflows,
  approvals, run inspection, and the seeded Smithers workflows.
- **PoolAgent experiment**: `experiments/smithers-pool/` is the existing spike where
  Smithers tasks execute Poolside `pool exec` through `PoolAgent`. Use this when
  testing Poolside skills inside Smithers nodes.

The official agent docs say to invoke the CLI as `bunx smithers-orchestrator ...`,
not `bunx smithers ...`; `smithers` is only the installed binary alias. The current
npm version resolved here is `smithers-orchestrator@0.23.0`.

## What Was Installed

From the repo root:

```bash
bunx smithers-orchestrator init
bunx smithers-orchestrator skills add --no-global
bunx smithers-orchestrator mcp add --no-global --command "bunx smithers-orchestrator --mcp"
```

This created:

- `.smithers/`: workflows, prompts, components, agent config, local
  `package.json`, `bun.lock`, and local `node_modules` ignored by
  `.smithers/.gitignore`.
- `.agents/skills/`: project-scoped Smithers command skills.
- `.claude/skills/`, `.goose/skills/`, `.openhands/skills/`: symlink mirrors to
  `.agents/skills/` for detected harnesses.
- `.mcp.json`: project MCP registration for Smithers.

## Agent Operating Path

Use Smithers when work is multi-step, long-running, approval-gated, needs
parallel agents, or benefits from durable run state. Keep one-shot answers and
tiny edits inline.

Start by checking local health and available workflows:

```bash
bunx smithers-orchestrator workflow doctor --format md
bunx smithers-orchestrator workflow list --format md
bunx smithers-orchestrator starters --format md
```

Run a seeded workflow:

```bash
bunx smithers-orchestrator workflow run plan --prompt "Plan the next skill hardening pass"
```

Inspect and operate runs:

```bash
bunx smithers-orchestrator ps
bunx smithers-orchestrator inspect <run-id> --format md
bunx smithers-orchestrator logs <run-id> --tail 40
bunx smithers-orchestrator why <run-id>
```

Graph-check a workflow before running it:

```bash
bunx smithers-orchestrator graph .smithers/workflows/plan.tsx --format json
```

## Workbench Integration

The local workbench discovers directories with `.smithers/`. The root project
now uses `.smithers/node_modules/.bin/smithers`; the older experiment still uses
`experiments/smithers-pool/node_modules/.bin/smithers`.

```bash
bun ui/server.ts
bun ui/bench.ts workflows
bun ui/bench.ts workflow-run .smithers/workflows/plan.tsx --project .
```

## PoolAgent Experiment

The experiment remains useful for validating Poolside skill execution inside
Smithers nodes:

```bash
cd experiments/smithers-pool
bun install
bun run setup
mkdir -p .smithers
bun run workflow
```

Use the experiment README for details about `PoolAgent`, node captures, and
the `repo-map` skill install path.

## Sources

- Smithers Introduction: https://smithers.sh/introduction
- Smithers Installation: https://smithers.sh/installation
- Agent Support: https://smithers.sh/agents/overview
- Set up in your harness: https://smithers.sh/agents/setup
- CLI reference: https://smithers.sh/cli/overview
