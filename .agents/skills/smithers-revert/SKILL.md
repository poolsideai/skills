---
name: smithers-revert
description: Revert the workspace to a previous task attempt's filesystem state. Run `bunx smithers-orchestrator revert --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator revert
---

# bunx smithers-orchestrator revert

Revert the workspace to a previous task attempt's filesystem state.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `string` | yes | Path to a .tsx workflow file |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--runId` | `string` |  | Run ID to revert |
| `--nodeId` | `string` |  | Node ID to revert to |
| `--attempt` | `number` | `1` | Attempt number |
| `--iteration` | `number` | `0` | Loop iteration number |
