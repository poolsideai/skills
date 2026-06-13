---
name: smithers-init
description: Install the local Smithers workflow pack into .smithers/. Run `smithers init --help` for usage details.
requires_bin: smithers
command: smithers init
---

# smithers init

Install the local Smithers workflow pack into .smithers/.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--force` | `boolean` | `false` | Overwrite existing scaffold files |
| `--agentsOnly` | `boolean` | `false` | Only create .smithers/agents/ and leave the rest of the workflow pack untouched |
| `--install` | `boolean` | `true` | Run `bun install` inside .smithers/ after scaffolding (--no-install to skip) |
| `--addAgents` | `boolean` | `false` | After scaffolding, launch the interactive `agents add` wizard to register one or more accounts. |
| `--global` | `boolean` | `false` | Scaffold the global pack in ~/.smithers (honors SMITHERS_HOME) instead of ./.smithers. Global workflows run from any repo; a repo's local pack takes precedence. |
| `--template` | `unknown` |  | Show next steps for a canonical starter template ID after init |
