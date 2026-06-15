---
name: smithers-snapshots
description: List durability snapshots (workspace checkpoints) for a run. Run `bunx smithers-orchestrator snapshots --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator snapshots
---

# bunx smithers-orchestrator snapshots

List durability snapshots (workspace checkpoints) for a run.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runId` | `string` | yes | Run ID to list snapshots for |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | `boolean` | `false` | Emit rows as JSON |
