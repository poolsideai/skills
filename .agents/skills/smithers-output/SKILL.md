---
name: smithers-output
description: Print node output row. Run `bunx smithers-orchestrator output --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator output
---

# bunx smithers-orchestrator output

Print node output row.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runId` | `string` | yes | Run ID containing the node |
| `nodeId` | `string` | yes | Node ID to fetch output for |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--iteration` | `number` |  | Loop iteration |
| `--json` | `boolean` | `true` | Emit raw row as JSON |
| `--pretty` | `boolean` | `false` | Schema-ordered render |
