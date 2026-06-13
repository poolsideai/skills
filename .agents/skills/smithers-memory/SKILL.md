---
name: smithers-memory
description: View and query cross-run memory facts. Run `smithers memory --help` for usage details.
requires_bin: smithers
command: smithers memory
---

# smithers memory list

List all memory facts in a namespace.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `namespace` | `string` | yes | Namespace to list facts for (e.g. 'workflow:my-flow') |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--workflow` | `string` |  | Path to a .tsx workflow file |
