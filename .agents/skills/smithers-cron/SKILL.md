---
name: smithers-cron
description: Manage and run background schedule triggers. Run `bunx smithers-orchestrator cron --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator cron
---

# bunx smithers-orchestrator cron add

Register a new workflow cron schedule.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pattern` | `string` | yes | Cron execution pattern (e.g. '0 * * * *') |
| `workflowPath` | `string` | yes | Path or ID of the workflow to schedule |

---

# bunx smithers-orchestrator cron list

List all registered background cron schedules.

---

# bunx smithers-orchestrator cron rm

Delete an existing cron schedule by ID.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `cronId` | `string` | yes | Cron ID to delete |

---

# bunx smithers-orchestrator cron start

Start the background scheduler loop in the current terminal.
