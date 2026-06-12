# Regression Alerts

No pass 2 regression above the 50-point threshold was found.

Compatibility notes:

- `bench` now rejects unknown flags and unexpected positionals that were previously ignored.
- Direct `run_eval.py` human mode still emits prose; robot modes emit JSON errors.
- `gen_eval_cases.py --validate-only` and promote result objects now include `schema_version`, `operation`, and `case_id`.

Known non-regression:

- `uv run scripts/check_eval_cases.py --json` still fails for `skills/workspace-inventory` eval coverage. This was known before pass 2.
