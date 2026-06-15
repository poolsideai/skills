---
name: smithers-gui
description: Open a directory as a workspace in Smithers GUI. Run `bunx smithers-orchestrator gui --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator gui
---

# bunx smithers-orchestrator gui

Open a directory as a workspace in Smithers GUI

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | `string` | no | Directory path (defaults to current working directory) |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--bundleId` | `string` | `com.smithers.SmithersGUI` | Smithers GUI app bundle identifier |
