---
name: smithers-starters
description: Show plain-English starter workflows with copy-paste commands. Run `bunx smithers-orchestrator starters --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator starters
---

# bunx smithers-orchestrator starters

Show plain-English starter workflows with copy-paste commands.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | no | Starter ID or alias |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--audience` | `string` |  | Filter by audience, such as product, support, or founder |
| `--goal` | `string` |  | Filter by goal, such as plan, build, debug, or quality |
| `--workflow` | `string` |  | Filter by seeded workflow ID |
| `--tag` | `string` |  | Filter by starter tag |
