# Simulation: Runner Robot Mode Bad Flag

Intent: get machine-readable failure for a malformed robot dry-run command.

Command:

```sh
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --json-summary --badflag
```

Observed:

- Exit code `2`.
- Argparse prose on stderr.
- No JSON envelope despite JSON summary intent.

Expected after apply:

- JSON error envelope with schema version, phase `args`, exit code, message, and suggested command.
