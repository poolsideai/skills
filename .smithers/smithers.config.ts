export const repoCommands = {
  lint:
    "uv run scripts/check_skill_structure.py && uv run scripts/check_schemas.py && uv run scripts/check_eval_cases.py",
  test:
    "uv run scripts/check_validator_robustness.py && uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay",
  coverage: null,
} as const;

export default { repoCommands };
