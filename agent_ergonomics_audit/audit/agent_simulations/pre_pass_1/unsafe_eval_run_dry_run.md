# Simulation: Agent Attempts Safe Bench Eval Run

Intent: run the smoke suite without live side effects.

Command:

```sh
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --dry-run
```

Observed:

- Exit code `0`.
- JSON success response.
- Detached harness process launched.
- Child argv omitted `--dry-run`.

Expected after apply:

- Either synchronous robot-dry-run JSON with no sidecar/log, or JSON error explaining the exact safe command to run.
