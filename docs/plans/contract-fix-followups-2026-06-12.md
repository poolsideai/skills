# Contract-fix follow-ups plan

Status: planned 2026-06-12. Owner: Ben.

## Goal

Finish the contract-fix follow-ups in the main checkout without copying incomplete RepoPrompt worktree patches. Land one coherent hardening pass across generator JSON output, bench CLI validation, runner robot redaction, common-schema coverage, and agent-facing docs.

## Ground truth

- `harness/generate/gen_eval_cases.py --validate-only` already emits legacy single-case `case-generation-result.v1` for one case and one aggregate object with `counts` + `results` for multiple cases (`harness/generate/gen_eval_cases.py:793-833`). Preserve this; do not replace it with concatenated JSON or a top-level array.
- `schemas/common/case-generation-result.v1.schema.json` already encodes single-vs-aggregate via `oneOf`. Treat generator/schema work as test-pin work unless verification proves runtime drift.
- Bench generic validation rejects unknown flags, duplicate non-repeatable flags, bad/missing values, and excess positionals, with did-you-mean hints (`ui/bench.ts:544-578`). `onboard` and `eval-case-generate` bypass this with bespoke parsers (`ui/bench.ts:700-829`).
- `optimize-skill` and `optimize-propose` runtime accepts `--skill NAME` or first positional skill (`ui/bench.ts:1139-1164`), but command metadata/help does not declare the positional (`ui/bench.ts:410-445`), so validation can reject the documented form before dispatch.
- CLI dispatch rejects `optimize-skill --smoke --baseline-only` (`ui/bench.ts:1142-1145`), but the shared lower layer can still build argv/log/sidecar when called directly with both booleans (`ui/lib.ts:1611-1640`).
- Robot dry-run redaction covers materialized workspace/home/state/scratch only after `fx.materialize()` succeeds (`harness/runner/run_eval.py:403-446`). Static fixture errors from `fx.validate_fixture()` occur before materialization and may include raw custom `--skills-root` paths (`harness/runner/run_eval.py:184-202`, `harness/runner/fixtures.py:160-198`).
- `scripts/check_schemas.py` requires six common schemas (`scripts/check_schemas.py:38-45`), but missing-schema wording still says `missing shared v0 contract schema (plan item 7)` (`scripts/check_schemas.py:82-90`), and regression coverage removes only three of the six (`tests/test_check_scripts_json_contract.py:91-107`).
- `agent_ergonomics_audit/audit/playbook.md` should describe final runtime precisely (`agent_ergonomics_audit/audit/playbook.md:1-57`). If touching bench docs, also fix `ui/README.md`, whose duplicate-flag wording currently conflicts with runtime (`ui/README.md:34-44`).

## Approach

Two invariants drive the implementation:

1. Enforce side-effect-prevention invariants in shared lower layers, not only in CLI dispatch.
2. Redact robot JSON at the runner boundary while preserving human/debug prose and preserving real workspaces for `--keep-workspaces`.

Sequence: generator test pin → bench metadata/parsers → optimizer lower-layer guard → runner redaction → schema checker → docs join.

## Subagent execution lanes

Use four implementation lanes, then a final integration pass:

1. **Generator/schema lane:** confirm the current runtime output matches the existing schema and add only missing test assertions.
2. **Bench lane:** align bespoke parser hints, optimize positional metadata, and optimizer conflict/no-side-effect tests.
3. **Runner lane:** implement robot-only redaction for pre-materialization CLI-root leaks and post-materialization paths.
4. **Checker/docs lane:** update schema-check wording/tests, then update docs after lanes 2–3 settle.

Docs should not land independently before the runtime contract is final.

## Work items

### 1. Pin generator validate-only behavior

Files: `tests/test_gen_eval_cases_cli_contract.py`; production files only if verification fails.

- Confirm single-case `--validate-only` still validates against `case-generation-result.v1` and omits aggregate-only fields.
- Confirm multi-case `--validate-only` emits exactly one JSON object with top-level `ok`, `counts`, and full per-case `results`.
- Confirm mixed pass/fail exits `1`, preserves all per-case records, prefixes aggregate `violations` with case ids, and keeps stdout JSON-only.
- Do not edit `schemas/common/case-generation-result.v1.schema.json` unless runtime output cannot be made compatible with the already-correct `oneOf` contract.

### 2. Align bespoke bench parser strictness and hints

Files: `ui/bench.ts`, `ui/bench-invalid-flags.test.ts`.

- Add did-you-mean hints to bespoke unknown-flag errors:
  - `onboard --sorce` -> `--source`
  - `eval-case-generate --skil` -> `--skill`
  - optionally `eval-case-generate --validate-ony` -> `--validate-only`
- Keep bespoke parsing; do not route these commands through generic validation because `eval-case-generate` needs multi-value `--validate-only` / `--promote` handling.
- Explicit repeatability for these parsers:
  - `onboard`: no repeatable flags; `--source` and `--out-dir` are scalar.
  - `eval-case-generate`: `--spec`, `--validate-only`, and `--promote` are repeatable; all other flags are scalar.
- Tests should assert JSON stderr includes status `400`, the bad flag, and the suggestion, with empty stdout and no child process.

### 3. Make optimize positional skill support real

Files: `ui/bench.ts`, `ui/bench-cli-contract.test.ts`, `ui/bench-invalid-flags.test.ts`.

- Treat positional skill support as a firm yes because runtime and help already promise it.
- Add `positional: [{ name: "skill", description: "Skill directory name; alternative to --skill." }]` to `optimize-skill` and `optimize-propose` metadata.
- Update help/capabilities tests so metadata exposes the positional form.
- Add validation coverage proving `optimize-skill ci-log-reducer --smoke --baseline-only` reaches the mutual-exclusion error, not `Unexpected positional argument`.
- Keep `--skill` precedence over positional when both are present, matching existing runtime.

### 4. Reject invalid optimizer modes before side effects

Files: `ui/lib.ts`, `ui/bench-invalid-flags.test.ts` or a small adjacent Bun test.

- Add `smoke && baselineOnly` rejection at the top of `startOptimizeRun()` before `mkdirSync`, log creation, sidecar writes, or `spawn()`.
- Keep the CLI-level guard as a fast path.
- Test both rejected forms:
  - `bun ui/bench.ts optimize-skill --skill ci-log-reducer --smoke --baseline-only`
  - `bun ui/bench.ts optimize-skill ci-log-reducer --smoke --baseline-only`
- Snapshot these artifact areas before/after rejection: `runs/optimize/.state`, `runs/optimize/ci-log-reducer/`, and any fake-`uv` invocation log used by current tests. Expected: nonzero exit, JSON stderr, empty stdout, no optimizer child, no new sidecars/logs/output dirs.

### 5. Redact robot JSON for custom roots and materialized paths

Files: `harness/runner/run_eval.py`, `tests/test_run_eval_json_summary.py`.

- Add a robot-only recursive redaction helper with explicit inputs: `(value, args, mat=None)`.
- Pre-materialization redaction handles CLI roots only:
  - non-default `args.skills_root` -> `<skills_root>`
  - non-default `args.runs_root` -> `<runs_root>`
- Post-materialization redaction additionally handles `mat.workspace`, `mat.home`, `mat.state`, and `mat.scratch` -> `<workspace>`, `<home>`, `<xdg_state_home>`, `<scratch>`.
- Apply it only to robot JSON fields:
  - `fixtures[].problems`
  - invalid `runs[].fixture.problems`
  - `pool_command.argv` and `pool_command.shell`
  - `validator.argv`
  - `manifest_preview.manifest.command`
  - environment/home/state fields
- Preserve human dry-run/live prose; do not globally change `fixtures.validate_fixture()` messages.
- Preserve `--keep-workspaces`: real dirs remain on disk, JSON reports placeholders, and cleanup remains controlled by existing `if not args.keep_workspaces` branches.
- Replace longer/more-specific paths first to avoid partial redaction.

### 6. Fix common-schema coverage and stale wording

Files: `scripts/check_schemas.py`, `tests/test_check_scripts_json_contract.py`.

- Change missing common schema message to stable wording such as `missing required common contract schema`.
- Remove `v0` and `plan item 7` from the message.
- Update missing-schema tests to iterate `check_schemas.REQUIRED_COMMON_SCHEMAS` directly.
- Assert JSON output remains `repo-check-result.v1`, failure check remains `common-contract-exists`, the missing path names the omitted schema, and stale wording is absent.
- Keep `uv run scripts/check_schemas.py --json` behavior unchanged apart from wording on failures.

### 7. Update docs after runtime settles

Files: `agent_ergonomics_audit/audit/playbook.md`; also `ui/README.md` if keeping bench CLI docs in sync.

- Be precise about duplicate flags: scalar/non-repeatable duplicates fast-fail; repeatable flags are command-specific (`--case`, `--arm`, `--spec`, `--validate-only`, `--promote` where declared).
- Note did-you-mean hints for close command/flag typos, including bespoke bench commands after this pass.
- Use correct optimizer examples:
  - `bun ui/bench.ts optimize-skill --skill ci-log-reducer --smoke`
  - `bun ui/bench.ts optimize-skill ci-log-reducer --smoke`
  - `bun ui/bench.ts optimize-propose --skill ci-log-reducer --run-dir ...`
  - `bun ui/bench.ts optimize-propose ci-log-reducer --run-dir ...`
- State that `optimize-skill --smoke --baseline-only` rejects before optimizer launch/sidecar/log creation.
- Mention robot JSON path redaction without implying human debug prose is redacted.

## Verification

Run the required suite after implementation:

```sh
uv run python -m unittest tests/test_gen_eval_cases_cli_contract.py tests/test_run_eval_json_summary.py tests/test_check_scripts_json_contract.py tests/test_check_scripts_cli.py
bun test ui/bench-cli-contract.test.ts ui/bench-invalid-flags.test.ts ui/bench.mirror-routes.test.ts
uv run scripts/check_schemas.py --json
bun ui/bench.ts capabilities
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --robot-dry-run
```

Targeted probes to record in the implementation summary:

1. `gen_eval_cases.py --validate-only` with two case dirs: stdout is one JSON object; single-case output still validates against `case-generation-result.v1`; mixed pass/fail exits `1` and includes both records.
2. Optimizer rejection: both `--skill ci-log-reducer --smoke --baseline-only` and positional `ci-log-reducer --smoke --baseline-only` exit nonzero with JSON stderr, empty stdout, and no optimizer sidecars/logs/new run artifacts.
3. Runner redaction: custom temp `--skills-root` with `--robot-dry-run --keep-workspaces` and custom temp `--runs-root` with `--robot-dry-run` do not leak raw temp roots in stdout; `--keep-workspaces` still preserves real workspaces on disk.

## Residual risks

- Generator work may be test-only. Avoid production churn unless tests expose runtime/schema drift.
- Robot redaction changes machine-visible strings. Keep placeholders schema-compatible and avoid adding top-level schema fields.
- Lower-layer optimizer rejection intentionally tightens hidden/direct callers that previously launched nonsensical `--smoke --baseline-only` runs.
