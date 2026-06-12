# Agent Ergonomics Playbook

## First 10 Minutes

1. Discover the bench contract:

```sh
bun ui/bench.ts capabilities
bun ui/bench.ts doctor
bun ui/bench.ts commands
```

2. Use bench as the primary safe eval path for robot dry runs:

```sh
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --robot-dry-run
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --robot-dry-run --replay
```

3. Use raw runner commands only as fallback/debug paths when you need lower-level runner behavior or traceback context:

```sh
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --robot-dry-run
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay --json-summary
```

4. Use check scripts as the stable repo-health surface:

```sh
uv run scripts/check_skill_structure.py --json
uv run scripts/check_eval_cases.py --json
uv run scripts/check_schemas.py --json
uv run scripts/check_validator_robustness.py --json
```

5. Treat this known checker failure as existing evaluation debt unless the task is explicitly to fix it:

```text
scripts/check_eval_cases.py --json fails for skills/workspace-inventory eval-case coverage.
```

6. Treat unknown commands, unknown flags, and duplicate scalar flags as structured fast-fail behavior. Close command and flag typos include did-you-mean hints when a match exists, including bespoke bench parsers such as `onboard` and `eval-case-generate`. Repeatable flags are command-specific: `--case` and `--arm` on `eval-run`; `--spec`, `--validate-only`, and `--promote` on `eval-case-generate`. Other duplicates reject instead of silently using the last value.

7. Avoid live optimizer spend unless the task intentionally launches a valid optimization. Use either optimizer skill form:

```sh
bun ui/bench.ts optimize-skill --skill ci-log-reducer --smoke
bun ui/bench.ts optimize-skill ci-log-reducer --smoke
bun ui/bench.ts optimize-propose --skill ci-log-reducer --run-dir runs/optimize/ci-log-reducer/<stamp>
bun ui/bench.ts optimize-propose ci-log-reducer --run-dir runs/optimize/ci-log-reducer/<stamp>
```

`optimize-skill --smoke --baseline-only` rejects before optimizer launch, sidecar writes, or log creation because the modes conflict.

8. Robot dry-run JSON redacts custom CLI roots and materialized workspace/home/state/scratch paths with placeholders. Human dry-run/debug prose is not globally redacted, so use robot JSON for machine-safe path output.

## Apply-Pass Entry Criteria

- Start with `R-001` and `R-002`.
- Add tests before or with implementation.
- Re-run the probe corpus in `intent_inference_corpus.jsonl`.
- Verify no detached sidecar/log/output appears for rejected unknown or unsupported flags.

## Red Flags

- Any command returns exit 0 while omitting an unknown flag from the actual child argv.
- Any robot-mode failure emits prose where the success path emits JSON.
- Any promote/generate operation mutates before all validation and rollback guards are active.
