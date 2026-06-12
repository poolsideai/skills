# Uplift Diff

Pass 2 was a full apply pass against the pass 1 audit.

| Surface | Pass 1 | Pass 2 | Delta |
| --- | ---: | ---: | ---: |
| `bench.eval_run` | 473 | 830 | +357 |
| `bench.optimize_skill` | 459 | 720 | +261 |
| `runner.robot_dry_run` | 709 | 830 | +121 |
| `generator.validate_promote` | 573 | 690 | +117 |
| `bench.discovery` | 786 | 840 | +54 |
| `bench.eval_case_generate` | 705 | 730 | +25 |
| `check_scripts` | 750 | 750 | 0 |

Median score moved from 705 to 750.

Remaining high-value work:

- Add `gen_eval_cases.py` JSON error envelopes for argparse and `SkillContext` failures.
- Harden promote with rollback-on-exception, atomic suite writes, and subprocess timeouts.
- Add `eval-runs --running/--limit` filters for large status payloads.
