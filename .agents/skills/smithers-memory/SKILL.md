---
name: smithers-memory
description: View and query cross-run memory facts. Run `bunx smithers-orchestrator memory --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator memory
---

# bunx smithers-orchestrator memory list

List all memory facts in a namespace.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `namespace` | `string` | yes | Namespace to list facts for (e.g. 'workflow:my-flow') |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--workflow` | `string` |  | Path to a .tsx workflow file |
