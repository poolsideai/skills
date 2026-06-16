# Handoff

Pass 5 completed in focused full apply mode.

No branch was created. Source changes and audit artifacts are in the current working tree under:

```text
/data/projects/poolside/skills/agent_ergonomics_audit/audit/
```

## Applied In Pass 5

1. `R-013`: `gen_eval_cases.py --skill` now accepts either a repo skill name or a path to a skill directory. If the repo copy is missing, the full skill directory is imported into `skills/<frontmatter-name>` before generation/validation.
2. `R-014`: true zero-case skills now infer bootstrap context for generation as well as validate/promote.
3. `R-015`: path import preserves supporting files such as `references/`, and generation config/report metadata records source/import provenance.
4. `R-016`: bench help, command catalog, README, and workbench docs now advertise `eval-case-generate --skill <name-or-path>`.
5. `R-017`: prompt-style external skills that lack `validate_*.ts` now get an actionable validator-bootstrap error with exact next commands.
6. `R-018`: missing LM credentials now produce a clean setup error and next actions, not a Python traceback.

## Pass 5 Verification

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

These were run in temporary copies of the checkout.

- `better-beads` imported with `references/` and `scripts/` preserved, then failed clearly because it has no `scripts/validate_*.ts`.
- `philip` imported with `Workflows/`, `docs/`, and `scripts/` files preserved, added a synthetic schema and `validate_philip_synthetic_bootstrap.ts`, then failed cleanly at missing LM credentials with no traceback.

The actual working tree was not polluted with `skills/better-beads` or `skills/philip`.

Not run to completion:

```sh
bun x tsc -p ui/tsconfig.json
```

This checkout still lacks top-level Bun type dependencies.

## Where To Resume After Pass 5

1. Review and commit the working tree.
2. Run a clean re-score-only pass after commit so `target_sha` can point at committed implementation.
3. Optional next UX pass: make `eval-case-generate` produce a no-LM mechanical bootstrap skeleton when no model key is configured, so the first path command can still create reviewable starter artifacts offline.

Pass 4 completed in resumed full apply mode.

Pass 3 has been restored from archived Codex session evidence at `/home/ben/.codex/archived_sessions/rollout-2026-06-15T19-00-08-019ecca7-c710-79f1-b519-2d474f42d68e.jsonl`; its scorecard is `scorecard_pass_3.md`, and the manifest again records Pass 3 before this Pass 4 continuation.

No branch was created. Source changes and audit artifacts are in the current working tree under:

```text
/data/projects/poolside/skills/agent_ergonomics_audit/audit/
```

## Applied In Pass 4

1. `R-006`: `gen_eval_cases.py --promote` now writes suite JSON through a temp file plus atomic replace, removes temp files during rollback, and bounds post-promote dry-run replay with the existing validator timeout.
2. `R-007`: repo check JSON payloads now include `failure_kind`, `exit_code`, and `next_commands` while preserving `repo-check-result.v1`.
3. `R-008` remainder: `bench eval-runs` now supports `--running`, `--status`, and `--limit`; detached eval-run sidecars include recovery commands and volatile-field metadata.

## Bootstrap Note

The zero-case bootstrap path is intentionally preserved. `tests/test_gen_eval_cases_cli_contract.py` now creates a synthetic no-eval skill to prove implicit bootstrap works for true zero-case skills, and a synthetic broken-eval skill to prove broken visible case dirs are not silently mistaken for true zero.

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

This checkout has no top-level `node_modules/@types/bun`, so `tsc` exits with a missing Bun type-definition error before checking source.

## Where To Resume

1. Review and commit the working tree.
2. Optionally install top-level Bun type dependencies if `bun x tsc -p ui/tsconfig.json` should be part of this repo's local gate.
3. After commit, run a clean re-score-only pass so manifest `target_sha` can point at the committed implementation rather than an uncommitted working tree.
