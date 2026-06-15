---
name: smithers-down
description: Cancel all active runs. Like 'docker compose down' for workflows. Run `bunx smithers-orchestrator down --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator down
---

# bunx smithers-orchestrator down

Cancel all active runs. Like 'docker compose down' for workflows.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--force` | `boolean` | `false` | Cancel runs even if they still appear live (default only cancels stale runs) |
