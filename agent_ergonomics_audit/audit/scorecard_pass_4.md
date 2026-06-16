# Agent Ergonomics Scorecard Pass 4

Mode: resumed full apply pass

Target branch: `main`

No new branch was created.

| Surface | Previous | Pass 4 | Delta | Main change |
| --- | ---: | ---: | ---: | --- |
| `generator.validate_promote` | 690 | 760 | +70 | Promote suite updates are atomic and post-promote replay is timeout-bound. Zero-case bootstrap coverage is preserved with a synthetic test skill. |
| `check_scripts` | 750 | 820 | +70 | `repo-check-result.v1` now includes optional `failure_kind`, `exit_code`, and `next_commands`. |
| `bench.eval_run` / `eval-runs` | 830 | 860 | +30 | `eval-runs` supports `--running`, `--status`, and `--limit`; launch sidecars include recovery commands and volatile-field metadata. |

No surface regressed by more than 50 points.

## Applied Recommendations

- `R-006`: promote rollback hardening, atomic suite writes, and bounded post-checks.
- `R-007`: richer repo-check next-command and failure metadata.
- `R-008` remainder: bounded `eval-runs` filters and detached-run recovery metadata.

## Verification

Passed:

```sh
bun test ui/*.test.ts
uv run python -m unittest discover -s tests
uv run scripts/check_schemas.py --json
uv run scripts/check_skill_structure.py --json
uv run scripts/check_validator_robustness.py --json
uv run scripts/check_eval_cases.py --json
git diff --check
```

Not run to completion:

```sh
bun x tsc -p ui/tsconfig.json
```

This checkout has no top-level `node_modules/@types/bun`, so `tsc` exits before typechecking source files.
