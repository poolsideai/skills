---
name: smithers-why
description: Explain why a run is currently blocked or paused. Run `bunx smithers-orchestrator why --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator why
---

# bunx smithers-orchestrator why

Explain why a run is currently blocked or paused.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runId` | `string` | yes | Run ID to explain |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | `boolean` | `false` | Output structured JSON diagnosis |
