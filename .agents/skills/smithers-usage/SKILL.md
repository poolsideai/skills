---
name: smithers-usage
description: Show how much rate limit / subscription quota each registered account has used. Run `bunx smithers-orchestrator usage --help` for usage details.
requires_bin: bunx
command: bunx smithers-orchestrator usage
---

# bunx smithers-orchestrator usage

Show how much rate limit / subscription quota each registered account has used.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--account` | `string` |  | Only report this account label |
| `--provider` | `string` |  | Only report accounts for this provider |
| `--fresh` | `boolean` | `false` | Bypass the short usage cache (still respects provider rate-limit floors) |
