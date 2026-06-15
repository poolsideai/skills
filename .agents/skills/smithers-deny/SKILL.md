---
name: smithers-deny
description: Deny a paused approval gate. Run `bunx smithers-orchestrator deny --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator deny
---

# bunx smithers-orchestrator deny

Deny a paused approval gate.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runId` | `string` | yes | Run ID containing the approval gate |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--node` | `string` |  | Node ID (required if multiple pending) |
| `--iteration` | `number` | `0` | Loop iteration number |
| `--note` | `string` |  | Approval/denial note |
| `--by` | `string` |  | Name or identifier of the approver |
