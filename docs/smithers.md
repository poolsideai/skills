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

Project-scoped Smithers command skills under `.agents/skills/smithers-*/` are
normalized to the same `bunx smithers-orchestrator ...` command surface. The
only intentional root-pack exception is `.smithers/package.json`, whose scripts
call the package-local `.smithers/node_modules/.bin/smithers` binary from the
repo root.

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

### Runner resolution

`ui/lib.ts` resolves the Smithers binary in this order:

1. **Local fast path.** If `<project>/node_modules/.bin/smithers` or
   `<project>/.smithers/node_modules/.bin/smithers` exists, the workbench
   invokes that binary directly. This is the documented install and the only
   path that avoids any network hit.
2. **`bunx smithers-orchestrator` fallback.** If no local binary is present
   (e.g. fresh checkout where `bun install` has not been run inside
   `.smithers/`), the workbench falls back to `bunx smithers-orchestrator`.
   The first invocation may need network; afterwards `bun`'s cache makes it
   nearly as fast as the local path. The chosen runner is reported as
   `runner: "local" | "bunx"` on the workflow generate / edit / run responses
   so callers can see which path served them.

### Detached run credentials

The graph/verification and detached-run paths have intentionally different
environment policies, and the runner resolver does not change that:

- **Graph / verification** (`workflowGraph`, `generateWorkflow`,
  `editWorkflow`) runs with a **scrubbed env** (PATH/HOME/TMPDIR/LANG only)
  because it imports the (possibly model-authored) workflow module. Generated
  code never inherits `$POOLSIDE_TOKEN` or other tenant secrets through these
  sinks.
- **Detached run** (`startRun` → Smithers `up`) keeps `process.env` so the
  workflow's nodes can reach the model (`POOLSIDE_TOKEN`,
  `OPENROUTER_API_KEY`, etc.). The `bunx` fallback follows the same policy:
  once it resolves and starts `bunx smithers-orchestrator up`, the detached
  child inherits the same tenant tokens the local binary would.

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
