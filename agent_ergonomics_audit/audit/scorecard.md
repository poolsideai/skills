# Agent Ergonomics Scorecard

Target SHA: `9ab28932b8d42e3493ac49a1ca3b485cb4dc6783`

Mode: audit-only

| Surface | Score | Confidence | Main driver |
| --- | ---: | --- | --- |
| `bench.discovery` | 786 | high | Strong JSON discovery, doctor, command catalog, and help; weak typo recovery. |
| `check_scripts` | 750 | high | Stable `repo-check-result.v1`; lacks next-command and exit-kind metadata. |
| `runner.robot_dry_run` | 709 | high | Excellent JSON success path; prose failures before summary mode. |
| `bench.eval_case_generate` | 705 | medium | Strict wrapper flag handling; promote inherits generator safety limits. |
| `generator.validate_promote` | 573 | medium | Useful validate-only path; ad hoc schema and promote safety gaps. |
| `bench.eval_run` | 473 | high | Unsupported safety flags can be ignored while live detached work starts. |
| `bench.optimize_skill` | 459 | high | Unknown flags can be ignored while optimizer output is created. |

Median score: 705

## Findings

1. `bench eval-run` and `bench optimize-skill` are the highest-risk surfaces because generic parsing permits unknown or unsupported flags to be ignored before launching detached work.
2. The direct Python runner has a good safe success path via `--robot-dry-run`, but robot-mode errors are not consistently JSON.
3. Check scripts are already good agent surfaces; they need richer remediation metadata, not a redesign.
4. `gen_eval_cases.py` needs stable output schemas and promote rollback/timeout hardening before it should be treated as an unattended agent surface.
5. Discovery is strong enough that the apply pass should focus on making execution match the advertised contract.

## Subagent Cross-Check

Four read-only subagents reviewed:

- `ui/bench.ts` and `ui/lib.ts`
- `scripts/check_*.py` and `scripts/checklib.py`
- `harness/runner/run_eval.py` and `harness/generate/gen_eval_cases.py`
- cross-surface synthesis

The subagents converged on the same priority ordering: strict primary CLI validation first, safe robot eval path second, then machine-readable Python failure envelopes and generator promote hardening.
