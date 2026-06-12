# Post-Pass 2 Canonical Task Simulation

Fresh subagent note:

- A fresh RepoPrompt subagent was launched for this simulation but did not have shell execution tools available.
- The main agent ran the same commands and recorded the observed outcomes below.

## Task 1: Unknown Bench Eval Flag

Command:

```sh
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --jsno
```

Observed:

```json
{"error":"Unknown flag for eval-run: --jsno. Usage: bun ui/bench.ts eval-run --suite evals/suites/<s>.json [--case <id>]... [--arm <arm>]... [--robot-dry-run|--dry-run --json-summary] [--replay]","status":400}
```

Exit: `1`

Result: pass. The malformed command failed before detached harness launch.

## Task 2: Safe Bench Eval Dry Run

Command:

```sh
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --robot-dry-run
```

Observed summary:

```json
{
  "schema_version": "eval-dry-run-summary.v1",
  "ok": true,
  "counts": {
    "runs_planned": 12
  }
}
```

Exit: `0`

Result: pass.

## Task 3: Runner Robot Bad Flag

Command:

```sh
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --json-summary --badflag
```

Observed:

```json
{
  "schema_version": "eval-error.v1",
  "ok": false,
  "phase": "args",
  "exit_code": 2,
  "error": {
    "message": "unrecognized arguments: --badflag"
  },
  "suggested_command": null
}
```

Exit: `2`

Result: pass.

## Task 4: Generator Validate-Only

Command:

```sh
uv run harness/generate/gen_eval_cases.py --skill ci-log-reducer --validate-only skills/ci-log-reducer/evals/ci-log-reducer-pytest-single-failure
```

Observed summary:

```json
{
  "schema_version": "case-generation-result.v1",
  "operation": "validate-only",
  "ok": true,
  "case_id": "ci-log-reducer-pytest-single-failure"
}
```

Exit: `0`

Result: pass.
