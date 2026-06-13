---
name: smithers-ui
description: Open the custom UI for a workflow run in your browser. Run `smithers ui --help` for usage details.
requires_bin: smithers
command: smithers ui
---

# smithers ui

Open the custom UI for a workflow run in your browser.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runId` | `string` | no | Run to open. Defaults to the most recent run. |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--gateway` | `string` |  | Gateway base URL (default http://127.0.0.1:<port>). |
| `--port` | `number` | `7331` | Gateway port when --gateway is not set. |
| `--workflow` | `string` |  | Open this workflow's UI directly, skipping run lookup. |
| `--open` | `boolean` | `true` | Open a browser. Use --no-open to just print the URL. |
