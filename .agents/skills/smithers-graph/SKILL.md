---
name: smithers-graph
description: Render the workflow graph without executing it. Run `smithers graph --help` for usage details.
requires_bin: smithers
command: smithers graph
---

# smithers graph

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
