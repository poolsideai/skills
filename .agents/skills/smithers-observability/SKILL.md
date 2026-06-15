---
name: smithers-observability
description: Start the local observability stack (Grafana, Prometheus, Tempo, OTLP Collector) via Docker Compose. Run `bunx smithers-orchestrator observability --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator observability
---

# bunx smithers-orchestrator observability

Start the local observability stack (Grafana, Prometheus, Tempo, OTLP Collector) via Docker Compose.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--detach` | `boolean` | `false` | Run containers in the background |
| `--down` | `boolean` | `false` | Stop and remove the observability stack |
