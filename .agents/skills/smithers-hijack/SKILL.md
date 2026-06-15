---
name: smithers-hijack
description: Hand off the latest resumable agent session or conversation for a run. Run `bunx smithers-orchestrator hijack --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator hijack
---

# bunx smithers-orchestrator hijack

Hand off the latest resumable agent session or conversation for a run.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runId` | `string` | yes | Run ID whose latest agent session should be hijacked |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--target` | `string` |  | Expected agent engine (claude-code or codex) |
| `--timeoutMs` | `number` | `30000` | How long to wait for a live run to hand off |
| `--launch` | `boolean` | `true` | Open the hijacked session immediately |
