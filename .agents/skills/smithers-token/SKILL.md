---
name: smithers-token
description: Issue and revoke short-lived Gateway bearer tokens. Run `smithers token --help` for usage details.
requires_bin: smithers
command: smithers token
---

# smithers token issue

Issue a local short-lived Gateway bearer token grant.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--scopes` | `string` | `run:read` | Comma or space separated Gateway scopes |
| `--role` | `string` | `operator` | Role recorded on the token grant |
| `--userId` | `string` |  | User id recorded on the token grant |
| `--ttl` | `string` | `1h` | Token lifetime, such as 15m or 1h |

---

# smithers token revoke

Revoke a locally issued Gateway bearer token.

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `token` | `string` | yes | Bearer token to revoke |
