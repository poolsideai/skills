---
name: smithers-gui
description: Open a directory as a workspace in Smithers GUI. Run `smithers gui --help` for usage details.
requires_bin: smithers
command: smithers gui
---

# smithers gui

Open a directory as a workspace in Smithers GUI

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | `string` | no | Directory path (defaults to current working directory) |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--bundleId` | `string` | `com.smithers.SmithersGUI` | Smithers GUI app bundle identifier |
