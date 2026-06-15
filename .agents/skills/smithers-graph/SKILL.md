---
name: smithers-graph
description: Render the workflow graph without executing it. Run `bunx smithers-orchestrator graph --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator graph
---

# bunx smithers-orchestrator graph

Render the workflow graph without executing it.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `string` | yes | Path to a .tsx workflow file |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--runId` | `string` | `graph` | Run ID for context |
| `--input` | `string` |  | Input data as JSON |
