---
name: smithers-diff
description: Print DiffBundle as unified diff. Run `bunx smithers-orchestrator diff --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator diff
---

# bunx smithers-orchestrator diff

Print DiffBundle as unified diff.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runId` | `string` | yes | Run ID containing the node |
| `nodeId` | `string` | yes | Node ID to diff |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--iteration` | `number` |  | Loop iteration |
| `--json` | `boolean` | `false` | Emit raw DiffBundle |
| `--stat` | `boolean` | `false` | Show stat summary only |
| `--color` | `string` | `auto` | Colorize output |
