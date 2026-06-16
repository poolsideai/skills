# Agent Ergonomics Scorecard Pass 5

Mode: focused full apply pass

Target branch: `main`

Focus: `gen_eval_cases.py` first-run UX for brand-new skills with no evals.

No new branch was created.

| Surface | Pre Pass 5 | Pass 5 | Delta | Main change |
| --- | ---: | ---: | ---: | --- |
| `generator.first_run_skill_path` | 260 | 850 | +590 | `--skill` now accepts a repo skill name or a filesystem path to a full skill directory. Passing `SKILL.md` is accepted as an alias for the parent directory. |
| `generator.zero_case_generation` | 430 | 840 | +410 | True zero-case skills now infer bootstrap context for generation as well as validate/promote, so the first generation run does not die on "no loadable eval cases to seed from." |
| `generator.import_support_files` | 500 | 850 | +350 | Path mode imports the full skill directory, preserving supporting files such as `references/`, `schemas/`, and `scripts/`, rather than treating `SKILL.md` as the whole skill. |
| `generator.import_provenance` | 520 | 800 | +280 | Generation config/report metadata records resolved skill name, source path, import status, and imported repo path. Promote hints use the resolved repo skill name. |
| `bench.eval_case_generate_discovery` | 700 | 850 | +150 | Bench help, command catalog, and docs now describe `<name-or-path>` and the first-run bootstrap path. |
| `generator.prompt_style_skill_gap` | 250 | 780 | +530 | Real prompt-style external skills such as `philip` now import, preserve support files, and fail with exact validator-bootstrap next commands instead of a dead-end error. |
| `generator.lm_setup_errors` | 450 | 820 | +370 | Missing model credentials now produce a concise LM setup error and next actions instead of a Python traceback. |

No surface regressed by more than 50 points.

## Applied Recommendations

- `R-013`: Accept skill directory paths for first-run eval-case generation and import missing repo skills before bootstrap.
- `R-014`: Infer bootstrap context for true zero-case generation, not only validate/promote.
- `R-015`: Preserve and test full skill-directory import, including supporting directories.
- `R-016`: Expose the path bootstrap workflow through bench help and docs.
- `R-017`: Turn prompt-style external skill validator gaps into onboarding next commands.
- `R-018`: Report LM setup failures without Python tracebacks.

## Verification

Passed:

```sh
uv run python -m unittest tests/test_gen_eval_cases_cli_contract.py
bun test ui/bench-cli-contract.test.ts
bun test ui/bench-cli-contract.test.ts ui/bench-invalid-flags.test.ts
uv run python -m unittest discover -s tests
uv run scripts/check_schemas.py --json
uv run scripts/check_skill_structure.py --json
uv run scripts/check_validator_robustness.py --json
uv run scripts/check_eval_cases.py --json
uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay
bun test ui/*.test.ts
git diff --check
```

Real external skill smoke:

```sh
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.agents/skills/better-beads --n 1
uv run harness/generate/gen_eval_cases.py --skill /home/ben/.agents/skills/philip --n 1
```

Run in temporary copies of the checkout. Results:

- `better-beads`: imported the real skill directory, preserved `references/` and `scripts/`, then failed clearly with `skill better-beads has no scripts/validate_*.ts -- not generatable yet`.
- `philip`: imported the real skill directory, preserved `Workflows/Audit.md`, `docs/agents/domain.md`, and `scripts/audit-report-lint.mjs`, added a synthetic schema and `validate_philip_synthetic_bootstrap.ts`, then failed cleanly at missing LM credentials with no traceback.

The working tree was not polluted with `skills/better-beads` or `skills/philip`.

Not run to completion:

```sh
bun x tsc -p ui/tsconfig.json
```

This checkout still has no top-level `node_modules/@types/bun`, so `tsc` is not a useful local gate until that dependency state is fixed.
