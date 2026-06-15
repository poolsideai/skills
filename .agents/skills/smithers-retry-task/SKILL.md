---
name: smithers-retry-task
description: Retry a specific task within a run, then resume the workflow. Run `bunx smithers-orchestrator retry-task --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator retry-task
---

# bunx smithers-orchestrator retry-task

Retry a specific task within a run, then resume the workflow.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `string` | yes | Path to a .tsx workflow file |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--runId` | `string` |  | Run ID containing the task |
| `--nodeId` | `string` |  | Task/node ID to retry |
| `--iteration` | `number` | `0` | Loop iteration |
| `--noDeps` | `boolean` | `false` | Only reset this node, not dependents |
| `--force` | `boolean` | `false` | Allow retry even if run is still running |
