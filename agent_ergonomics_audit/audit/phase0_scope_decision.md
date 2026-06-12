# Phase 0 Scope Decision

Mode: audit-only

Target repo: `/Users/ben/code/poolside/skills`

Primary CLI:
- `bun ui/bench.ts`

Secondary agent-facing CLIs:
- `scripts/check_*.py`
- `harness/runner/run_eval.py`
- `harness/generate/gen_eval_cases.py`

Workspace constraint:
- All audit artifacts live under `/Users/ben/code/poolside/skills/agent_ergonomics_audit/`.
- No branch was created.
- No apply pass was performed.
- No code edits were made.

Dirty tree handling:
- Pre-existing dirty source/test changes were treated as user-owned and left untouched.

Bootstrap notes:
- Skill preflight found missing macOS helpers `flock` and GNU `timeout`.
- Audit continued because this pass did not require lock-based mutation phases.
- `bun`, `uv`, `jq`, `git`, `node`, `awk`, `find`, and `sed` were available.

Probe cleanup:
- Two `eval-run` probes and one `optimize-skill` probe demonstrated detached side effects from unsupported/unknown flags.
- Their generated sidecars, logs, and optimizer run directory were removed after evidence collection.
