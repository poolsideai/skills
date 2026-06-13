---
name: smithers-up
description: Start a workflow execution. Use -d for detached (background) mode. Run `smithers up --help` for usage details.
requires_bin: smithers
command: smithers up
---

# smithers up

Start a workflow execution. Use -d for detached (background) mode.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `string` | yes | Path to a .tsx workflow file |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--detach` | `boolean` | `false` | Run in background, print run ID, exit |
| `--runId` | `string` |  | Explicit run ID |
| `--maxConcurrency` | `number` |  | Maximum parallel tasks (default: 4) |
| `--root` | `string` |  | Tool sandbox root directory |
| `--log` | `boolean` | `true` | Enable NDJSON event log file output |
| `--logDir` | `string` |  | NDJSON event logs directory |
| `--allowNetwork` | `boolean` | `false` | Allow bash tool network requests |
| `--maxOutputBytes` | `number` |  | Max bytes a single tool call can return |
| `--toolTimeoutMs` | `number` |  | Max wall-clock time per tool call in ms |
| `--hot` | `boolean` | `false` | Enable hot module replacement for .tsx workflows |
| `--input` | `string` |  | Input data as JSON string |
| `--annotations` | `string` |  | Run annotations as a flat JSON object of string/number/boolean values |
| `--resume` | `unknown` | `false` | Resume a previous run. Pass true with --run-id, or pass the run ID directly (e.g. --resume <run-id>) |
| `--force` | `boolean` | `false` | Resume even if still marked running |
| `--resumeClaimOwner` | `string` |  | Internal durable resume claim owner |
| `--resumeClaimHeartbeat` | `number` |  | Internal durable resume claim heartbeat |
| `--resumeRestoreOwner` | `string` |  | Internal durable resume restore owner |
| `--resumeRestoreHeartbeat` | `number` |  | Internal durable resume restore heartbeat |
| `--serve` | `boolean` | `false` | Start an HTTP server alongside the workflow |
| `--supervise` | `boolean` | `false` | Run the stale-run supervisor loop (with --serve) |
| `--superviseDryRun` | `boolean` | `false` | With --supervise, detect stale runs without resuming |
| `--superviseInterval` | `string` | `10s` | With --supervise, poll interval (e.g. 10s, 30s) |
| `--superviseStaleThreshold` | `string` | `30s` | With --supervise, stale heartbeat threshold |
| `--superviseMaxConcurrent` | `number` | `3` | With --supervise, max runs resumed per poll |
| `--port` | `number` | `7331` | HTTP server port (with --serve) |
| `--host` | `string` | `127.0.0.1` | HTTP server bind address (with --serve) |
| `--authToken` | `string` |  | Bearer token for HTTP auth (or set SMITHERS_API_KEY) |
| `--metrics` | `boolean` | `true` | Expose /metrics endpoint (with --serve) |
