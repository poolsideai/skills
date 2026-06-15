---
name: smithers-timetravel
description: Time-travel to a previous task state by reverting filesystem state, resetting DB state, and optionally resuming. Run `bunx smithers-orchestrator timetravel --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator timetravel
---

# bunx smithers-orchestrator timetravel

Time-travel to a previous task state by reverting filesystem state, resetting DB state, and optionally resuming.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `string` | yes | Path to a .tsx workflow file |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--runId` | `string` |  | Run ID |
| `--nodeId` | `string` |  | Task/node ID to travel back to |
| `--iteration` | `number` | `0` | Loop iteration |
| `--attempt` | `number` |  | Attempt number (default: latest) |
| `--noVcs` | `boolean` | `false` | Skip filesystem revert (DB only) |
| `--noDeps` | `boolean` | `false` | Only reset this node, not dependents |
| `--resume` | `boolean` | `false` | Resume the workflow after time travel |
| `--force` | `boolean` | `false` | Force even if run is still running |
