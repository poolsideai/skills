# Regression Alerts

No pass 2 regression above the 50-point threshold was found.

Compatibility notes:

- `bench` now rejects unknown flags and unexpected positionals that were previously ignored.
- Direct `run_eval.py` human mode still emits prose; robot modes emit JSON errors.
- `gen_eval_cases.py --validate-only` and promote result objects now include `schema_version`, `operation`, and `case_id`.

Known non-regression:

- Pass 4 re-ran `uv run scripts/check_eval_cases.py --json`; it now passes for 5 skills, 65 cases, and 7 suites.
- `bun x tsc -p ui/tsconfig.json` could not run in this checkout because there is no top-level `node_modules/@types/bun` installed; the Bun runtime test suite covers the edited TypeScript paths.
## Pass 5

No regressions above the 50-point threshold were found.

Checked surfaces:

- `generator.first_run_skill_path`
- `generator.zero_case_generation`
- `generator.import_support_files`
- `generator.import_provenance`
- `bench.eval_case_generate_discovery`
- `generator.prompt_style_skill_gap`
- `generator.lm_setup_errors`
