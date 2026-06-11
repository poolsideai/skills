# Fixture materialization

> What `harness/runner/fixtures.py` does, exactly. Plan item 9; isolation recipe per
> `docs/eval-methodology.md` §3. If you change `fixtures.py`, change this file in the same commit.

Eval runs never point `pool` at the skill source tree or at a case directory. For **every**
case × arm run the runner materializes a throwaway scratch directory:

```
laguna-eval-<case-id>-<arm>-XXXX/          (tempfile.mkdtemp)
├── workspace/        # what pool gets via --directory
├── home/             # what pool gets via HOME
└── state/            # what pool gets via XDG_STATE_HOME
```

## workspace/

1. The case's `input/` is copied in verbatim (`skills/<skill>/evals/<case-id>/input/` →
   `workspace/`). A case with an empty `input/` yields an empty workspace. The model never
   sees `prompt.md`, `expected/`, or `metadata.json` as files.
2. **With-skill arms only:** `skills/<skill>/` is copied to
   `workspace/.poolside/skills/<skill>/` — the discovery path today's `pool exec` actually
   scans. Skipping this step would make with-skill arms silently identical to baseline, so
   `materialize()` hard-fails (`FileNotFoundError`) if the skill directory is missing.
3. **Exclusion:** the skill's `evals/` subtree is **not** copied
   (`SKILL_MATERIALIZATION_EXCLUDES`). It contains the cases themselves — including
   `expected/` gold artifacts for the very case under test — and leaking those into the
   workspace would invalidate the eval. Everything else in the skill
   (`SKILL.md`, `schemas/`, `scripts/`, `references/`) ships verbatim.
4. Baseline (without-skill) arms get **no** `.poolside/` directory at all. The skill tool
   stays enabled in both arms (it is on by default and there is no public flag to disable
   it); baseline = tool enabled, zero project skills available.

## home/ (isolated HOME)

- Created fresh per run with an **empty** `~/.config/poolside/skills/` directory, so the
  developer's real user-global skills (e.g. `skill-creator`) can never contaminate either arm.
- For **live runs only**, and only when `POOLSIDE_TOKEN` is **not** set in the runner's
  environment, the real `~/.config/poolside/credentials.json` is copied in (token env var
  beats the credentials file in pool's resolution order — `docs/model-access-spike.md` §5).
  Dry-run never touches real credentials.
- `settings.yaml` is deliberately **never** copied: the runner passes `--api-url` explicitly
  instead, so no developer-local settings leak into runs.
- Known residue, accepted for v0 (and logged as `isolation-embedded-default-skills` debt in
  every manifest): `pool` auto-installs its embedded default skills into the user-global dir
  on registry init even under a fresh HOME. Identical across arms, so the with/without
  comparison stays controlled.

## state/ (private XDG_STATE_HOME)

Per-run trajectory/session/log isolation (`docs/trajectory-recovery-spike.md` F1; the env
override is honored on every platform including macOS). After the run, recovery reads
`state/poolside/sessions/session-<run_id>.json` and constructs the trajectory path from it —
race-free because nothing else ever writes into this state dir.

## Environment the run gets

`harness/runner/pool_exec.py:build_run_env()`: `HOME=<scratch>/home`,
`XDG_STATE_HOME=<scratch>/state`, `PATH`/`TMPDIR`/`LANG` passthrough, `TERM=dumb`,
`POOLSIDE_TOKEN` forwarded iff set, all proxy variables stripped. Nothing else from the
developer's environment crosses the boundary.

## Replay workspaces (gold replay)

`materialize_replay_workspace()` builds the `evals/README.md` "Gold replay" layout: `input/`
copied in, then `expected/` copied **over** it. Because `expected/` mirrors
workspace-relative output paths, gold artifacts land exactly where a real run would have
written them; the case's validator run against this workspace must return
`validator.expected_status`. Used by `run_eval.py --dry-run --replay`.

## Cleanup

Scratch directories are deleted after each run (`MaterializedRun.cleanup()`), unless
`--keep-workspaces` is passed — then the paths are printed for inspection.

## Validating fixtures without running anything

`run_eval.py --dry-run` calls `validate_fixture()` per case: `metadata.json` conforms to
`schemas/common/eval-case.v1.schema.json`, `prompt.md` exists and is non-empty, `input/` and
`expected/` exist, with-skill arms have a real `skills/<skill>/SKILL.md`, and every
path-looking token in `validator.command` resolves from the repo root. It then performs the
real materialization above into temp dirs (and tears them down) to prove the copy steps work.
