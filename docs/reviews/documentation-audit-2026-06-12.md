# Documentation Audit

2026-06-15 update: Retain this audit as decision history. The
`workspace-inventory` finding is superseded: the skill now has eval coverage,
and the v0 bundle is expected to pass the repo-wide eval-case gate.

## Executive Summary

As of this audit on 2026-06-12, the docs were closer to publishable: the README
had a first-run path, then-current skill status, artifact names, and clear
boundaries between real tools and prototypes. The remaining risk at that time
was `workspace-inventory`: it was a real skill directory, but it had no eval
cases, so repo-wide eval-case validation still failed until that skill was
finished or removed from the publish surface.

## Findings

### Critical

No critical documentation issue remains after this pass.

### High

- `workspace-inventory` is WIP but still visible as a skill.
  - Problem: The repo contains `skills/workspace-inventory/SKILL.md`, but the skill has no eval cases and fails the repo's stated case-coverage gate.
  - Evidence: `skills/workspace-inventory/SKILL.md`; command output from `uv run scripts/check_eval_cases.py` reported 0 cases and no adversarial case; `docs/plans/skill-optimization-gepa-2026-06-11.md` already called this out.
  - Impact: Readers expect repo-wide eval checks to pass and may treat the library as fully publish-ready.
  - Fix: The README now marks `workspace-inventory` as WIP and states that `check_eval_cases.py` is expected to fail until it has three cases.
  - Verification: ran repo checks and read the skill directory.
  - Confidence: High.

- Stale eval-case layout in the authoring guide.
  - Problem: The layout block used `evals/cases/<case-id>/`, but the harness and actual tree use `evals/<case-id>/`.
  - Evidence: `docs/authoring-guide.md`; `evals/README.md`; `scripts/checklib.py`; actual `skills/*/evals/<case-id>/` directories.
  - Impact: New authors could create cases in a path the checks do not expect.
  - Fix: Updated `docs/authoring-guide.md` to show `evals/<case-id>/`.
  - Verification: cross-checked docs and file layout.
  - Confidence: High.

- Run artifact docs advertised ATIF as the standard artifact.
  - Problem: The README listed `trajectory.atif.json` as standard output, while code treats `trajectory.ndjson` as canonical and ATIF as optional.
  - Evidence: `harness/runner/run_eval.py`; `schemas/common/run-manifest.v0.schema.json`; `docs/trajectory-recovery-spike.md`.
  - Impact: Reviewers and scripts may look for the wrong artifact.
  - Fix: README and schema description now name `trajectory.ndjson` as canonical and ATIF as optional.
  - Verification: read runner artifact map and schema description.
  - Confidence: High.

### Medium

- First-run setup was too implicit.
  - Problem: The README jumped into commands without clearly listing `uv`, `bun`, `pool`, auth, and expected check behavior.
  - Evidence: `README.md`; `pyproject.toml`; `harness/runner/run_eval.py` credential checks.
  - Impact: New contributors had to guess prerequisites and why isolated live runs need `POOLSIDE_TOKEN` or copied credentials.
  - Fix: Rewrote the README with prerequisites, quick checks, dry-run, live-run auth, and review commands.
  - Verification: read runner credential logic and ran safe repo checks.
  - Confidence: High.

- Prototype pages looked more authoritative than they are.
  - Problem: Static HTML pages contained illustrative metrics and planned skill names without a visible prototype warning.
  - Evidence: `index.html`; `skill.html`; current skill list in `skills/`.
  - Impact: A reader could mistake prototype metrics for published eval results.
  - Fix: Added visible prototype notes and corrected stale `validate_contract.py` / `evals/cases/...` examples.
  - Verification: read pages and current skill layout.
  - Confidence: High.

- Historical spike docs front-loaded obsolete `pool` 0.2.172 facts.
  - Problem: The current `pool` 1.0.5 state was in addenda, after older findings.
  - Evidence: `docs/model-access-spike.md`; `docs/trajectory-recovery-spike.md`; `harness/runner/pool_exec.py` probing logic.
  - Impact: Readers could extract stale CLI assumptions before reaching the addendum.
  - Fix: Added current-state sections at the top of both spike docs.
  - Verification: partially verified - doc/code state checked; no live `pool` command run in this pass.
  - Confidence: Medium.

### Low

- Schema docs lacked a direct validation command.
  - Problem: `schemas/common/README.md` described contracts but did not show the check command.
  - Evidence: `schemas/common/README.md`; `scripts/check_schemas.py`.
  - Impact: Readers landing in the schema folder lacked the next action.
  - Fix: Added `uv run scripts/check_schemas.py`.
  - Verification: command was run successfully.
  - Confidence: High.

- Smithers experiment docs used raw commands where package scripts exist.
  - Problem: `experiments/smithers-pool/README.md` used `bun scripts/setup.ts` and raw `smithers up` while `package.json` defines `setup`, `workflow`, and `typecheck` scripts.
  - Evidence: `experiments/smithers-pool/package.json`; `experiments/smithers-pool/README.md`.
  - Impact: Users might miss the maintained script names.
  - Fix: Updated the README to use `bun run setup`, `bun run workflow`, and `bun run typecheck`.
  - Verification: script names cross-checked against `package.json`; commands not executed.
  - Confidence: High.

## Coverage Map

| Area | Docs | Code Evidence | Status |
| --- | --- | --- | --- |
| Entry point and setup | `README.md` | `pyproject.toml`, repo checks, runner args | Improved |
| Skill authoring | `docs/authoring-guide.md`, `evals/README.md` | `scripts/check_*.py`, skill tree | Improved |
| Eval runner | `README.md`, `docs/eval-methodology.md` | `harness/runner/*` | Improved, live run not executed |
| Review tooling | `README.md`, `harness/review/*` | `harness/review/*.py` | Improved |
| Schemas | `schemas/common/README.md`, schema files | `scripts/check_schemas.py` | Improved |
| UI/workbench | `ui/README.md`, `index.html`, `skill.html` | `ui/server.ts`, `ui/bench.ts`, `styles.css` | Improved |
| Experiments | `experiments/smithers-pool/README.md` | `package.json` scripts | Improved |
| WIP skill | `skills/workspace-inventory/SKILL.md` | missing eval cases | Still risky |

## Recommended Plan

1. Add three eval cases for `workspace-inventory`, including one adversarial case, then add it to the appropriate suite.
2. Run `uv run scripts/check_eval_cases.py` again and remove the WIP warning when it passes.
3. If this repo is published externally, keep spike docs but label them as historical evidence, not first-read setup material.

## Unknowns

- Live `pool` eval runs were not executed in this pass.
- The optional OpenRouter judge path was documented as a reading aid, but not tested.
- Link checking was done by file/path inspection, not a full browser crawl.

## Verification Notes

- Ran: `uv run scripts/check_skill_structure.py`, `uv run scripts/check_eval_cases.py`, `uv run scripts/check_schemas.py`, `uv run scripts/check_validator_robustness.py`.
- `check_skill_structure.py`, `check_schemas.py`, and `check_validator_robustness.py` passed.
- On 2026-06-12, `check_eval_cases.py` failed for `workspace-inventory` only:
  0 eval cases and no adversarial case. See the 2026-06-15 status note above
  for the current superseding state.
- Orbit intentionally not checked; local files, scripts, schemas, and command output were enough for this audit.
