---
name: smithers-logs
description: Tail the event log of a specific run. Run `bunx smithers-orchestrator logs --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator logs
---

# bunx smithers-orchestrator logs

Tail the event log of a specific run.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runId` | `string` | yes | Run ID to tail |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--follow` | `boolean` | `true` | Keep tailing (default true for active runs) |
| `--since` | `number` |  | Start from event sequence number |
| `--tail` | `number` | `50` | Show last N events first |
| `--followAncestry` | `boolean` | `false` | Include events from ancestor runs (continuation lineage) |
