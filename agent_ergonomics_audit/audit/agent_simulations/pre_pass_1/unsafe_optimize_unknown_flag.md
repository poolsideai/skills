# Simulation: Agent Mistypes Optimize Flag

Intent: run a smoke optimizer with a typo in a flag.

Command:

```sh
bun ui/bench.ts optimize-skill --skill ci-log-reducer --badflag --smoke
```

Observed:

- Exit code `0`.
- Detached optimizer launched.
- Output directory was created.
- Unknown flag was omitted from the child configuration.

Expected after apply:

- Exit non-zero before spawn.
- JSON stderr includes unknown flag, allowed flags, and a corrected command.
