# Eval Cases

> Case folder format, the validator-location rule, and the gold replay procedure.
> Methodology (arms, isolation, metrics): `docs/eval-methodology.md`.
> Plan: `docs/plans/laguna-skills-v0-2026-06-10.md` (work item 9).

## Layout

Eval cases live **with their skill**, under `skills/<skill>/evals/<case-id>/`. This directory holds
what is shared across skills:

- `evals/suites/*.json` — suite definitions (lists of case paths), e.g. `smoke.json` (one case per
  skill, dry-run-able) and `first-bundle.json` (all v0 cases).
- `evals/README.md` — this document.

## Case folder format

Every case is a directory with exactly these entries:

```
skills/<skill>/evals/<case-id>/
├── prompt.md        # the task prompt given to the model, verbatim
├── input/           # fixture files copied into the run workspace
├── expected/        # gold artifacts, mirroring workspace-relative output paths
├── metadata.json    # canonical case metadata (schema: schemas/common/eval-case.v1.schema.json)
└── validators/      # OPTIONAL — bespoke case-local checks only (see validator rule)
```

- **`prompt.md`** — the exact prompt the runner sends via `pool exec --prompt-file`. It must name the
  deterministic workspace path where the gradeable artifact lands (the skill's Output contract path).
- **`input/`** — the workspace fixture. The runner copies `input/` into a fresh temp workspace; the
  model never sees the case directory itself.
- **`expected/`** — gold output artifacts. Convention: paths inside `expected/` **mirror the
  workspace-relative paths** where the skill's Output contract says the artifacts land. Example: if
  the contract path is `ci-summary.json` at the workspace root, the gold file is
  `expected/ci-summary.json`. This is what makes gold replay (below) a mechanical copy.
- **`metadata.json`** — canonical fields below.

### `metadata.json` — canonical fields

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Kebab-case, prefixed with the skill name. Matches the folder name. |
| `skill` | string | The skill under test (`skills/<skill>/`). |
| `bucket` | enum | `easy` \| `realistic` \| `adversarial` \| `edge`. Every skill needs ≥1 `adversarial` case. |
| `difficulty` | enum | `easy` \| `medium` \| `hard`. |
| `arms` | array | Subset of `["xs_without_skill", "xs_with_skill", "m_without_skill", "m_with_skill"]`. |
| `publishability` | string | `"internal"` for all v0 cases (fixture publishing is gated on the data/privacy policy, register #9). |
| `validator` | object | `{command, expected_status}` — see below. |
| `notes` | string? | Optional: provenance, redaction notes, gotchas. |

- **`validator.command`** — an argv array, resolved from the **repo root**. The harness appends the
  argv-contract flags (next section) when invoking it.
- **`validator.expected_status`** — `pass` \| `fail`: what the validator must return when replayed
  against this case's own gold `expected/` artifacts. Almost always `pass`. **Good-failure cases**
  (adversarial prompts whose *correct* outcome is a validation failure — e.g. `laguna-task-contract`'s
  "fix this whole repo" must fail contract validation) set `fail`, and their `expected/` holds the
  artifact that must be rejected. Live runs are scored against the same field: a run passes when the
  validator's `status` equals `expected_status`.

Example (`skills/ci-log-reducer/evals/ci-log-reducer-flaky-retry/metadata.json`):

```json
{
  "id": "ci-log-reducer-flaky-retry",
  "skill": "ci-log-reducer",
  "bucket": "realistic",
  "difficulty": "medium",
  "arms": ["xs_without_skill", "xs_with_skill", "m_without_skill", "m_with_skill"],
  "publishability": "internal",
  "validator": {
    "command": ["bun", "skills/ci-log-reducer/scripts/validate_log_summary.ts"],
    "expected_status": "pass"
  },
  "notes": "Mined from a real CI failure log; secrets redacted."
}
```

## The validator-location rule

There is **one** rule: **the `metadata.json` `validator.command` is canonical.** Whatever it names is
the validator for that case.

By convention it points at the owning skill's validator — `skills/<skill>/scripts/validate_*.ts`, run
via `bun` (zero npm dependencies; bun builtins only, so it runs inside materialized workspaces with no
`node_modules`). A case adds a local `validators/` directory **only** for bespoke checks that don't
belong in the skill's validator, and then `validator.command` points there instead. Validators are
per-skill by default; per-case is the documented exception, not a parallel mechanism.

### Validator argv contract

Every validator — skill-level or case-local, any language — is invoked as:

```
<command...> --case <case_dir> --workspace <workspace_dir> --out <result_path>
```

- `--case` — the case directory (the validator reaches `expected/` gold files and `metadata.json`
  through it).
- `--workspace` — the workspace to grade (a real run's workspace, or the replay workspace below).
- `--out` — where to write the result JSON.

Validators must: use only explicit paths (no cwd assumptions), make no network calls, enforce an
internal timeout, and write a `validator-result.v1` object to `--out`:

```json
{
  "schema_version": "validator-result.v1",
  "case_id": "...",
  "status": "pass | fail | error",
  "score": 0.0,
  "checks": [{"id": "...", "status": "pass | fail", "detail": "..."}],
  "repair_feedback": ["..."],
  "duration_ms": 1234
}
```

Schema: `schemas/common/validator-result.v1.schema.json`. `status` is `pass`/`fail` on a completed
grade; `error` means the validator itself broke (never counted as a graded outcome). `repair_feedback`
is derived only from failed checks and schema errors.

## Gold replay

Gold replay answers: *does this case's validator, run against the case's own gold artifacts, return
the expected status?* Every case must replay green before it merges, and CI (the structure checks,
plan item 13) can re-run replay for every case with no model calls. Anyone — human or CI — replays a
case the same way:

1. **Build a replay workspace.** Create a temp dir; copy `input/` into it; then copy `expected/` over
   it. Because `expected/` mirrors workspace-relative output paths, this places the gold artifact(s)
   exactly where the skill's Output contract says a real run would write them.
2. **Run the validator** per the argv contract, with `--out` pointing **outside** the workspace (so
   the result file can't interfere with workspace-state checks).
3. **Assert** the result parses as `validator-result.v1` and `status == validator.expected_status`
   from `metadata.json`.

Shell sketch:

```sh
case_dir="skills/ci-log-reducer/evals/ci-log-reducer-flaky-retry"   # repo-root relative
ws="$(mktemp -d)"; out="$(mktemp -d)/validator.json"

cp -R "$case_dir/input/." "$ws/"
cp -R "$case_dir/expected/." "$ws/"

bun skills/ci-log-reducer/scripts/validate_log_summary.ts \
  --case "$case_dir" --workspace "$ws" --out "$out"

# assert: .status in "$out" == .validator.expected_status in "$case_dir/metadata.json"
```

(Replace the `bun ...` line with the case's actual `validator.command` plus the three flags; the
harness does exactly this.)

A case that fails replay is broken regardless of model behavior: either the gold artifacts are wrong,
the validator is wrong, or the Output contract path drifted. Fix the case, not the threshold. For
good-failure cases, "replays green" means the validator returns `fail` on the gold artifact — that is
its `expected_status`.

## Generated candidates

Agents should use the bench wrapper for generation, validation, and promotion:

```sh
bun ui/bench.ts eval-case-generate --skill ci-log-reducer --n 4
bun ui/bench.ts eval-case-generate --skill ci-log-reducer --validate-only <case-dir>
bun ui/bench.ts eval-case-generate --skill ci-log-reducer --promote runs/generate/ci-log-reducer/<stamp>/candidates/<case-id>
```

This delegates to `uv run harness/generate/gen_eval_cases.py`, which remains
available for direct debugging. Generated cases stay under `runs/generate/`
until a human reviews them.

`--promote` is repo-mutating, not just a copy into `skills/<skill>/evals/`: it
updates `evals/suites/skill-<skill>.json`, reruns checks and dry-run replay as
applicable, and rolls back on failure. A human must review the resulting diff
before commit.

## Authoring checklist

Per the hard gates in `docs/authoring-guide.md`:

- [ ] Output schema and executable validator exist **before** any `SKILL.md` prose.
- [ ] Every skill has ≥3 cases including ≥1 `adversarial` bucket case.
- [ ] `prompt.md` names the deterministic artifact path; `expected/` mirrors it.
- [ ] `metadata.json` carries exactly the canonical fields; `publishability` is `"internal"`.
- [ ] Gold replay passes (status matches `expected_status`) before the case merges.
