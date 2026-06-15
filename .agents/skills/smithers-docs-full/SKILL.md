---
name: smithers-docs-full
description: Print llms-full.txt (full docs bundle for LLMs) for this CLI version. Run `bunx smithers-orchestrator docs-full --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator docs-full
---

# bunx smithers-orchestrator docs-full

Print llms-full.txt (full docs bundle for LLMs) for this CLI version.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--latest` | `boolean` | `false` | Fetch the latest docs from smithers.sh instead of docs for this CLI version |
| `--docsVersion` | `string` |  | Fetch docs for a specific Smithers version, e.g. 0.22.0 or v0.22.0 |
