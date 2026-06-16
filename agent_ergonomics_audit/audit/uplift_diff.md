# Uplift Diff

Pass 3 was a focused full apply pass against latest `main` after pass 2 had already fixed the highest-risk launch and robot-mode gaps.

| Surface | Pass 2 | Pass 3 | Delta |
| --- | ---: | ---: | ---: |
| `bench.eval_runs` | 520 | 820 | +300 |
| `bench.global_flags` | 610 | 820 | +210 |
| `bench.flag_parser` | 650 | 820 | +170 |
| `bench.errors` | 720 | 850 | +130 |
| `bench.discovery` | 840 | 870 | +30 |
| `check_scripts` | 750 | 750 | 0 |

Median scoped score moved from 650 to 820.

Remaining high-value work:

- Add `harness/runner/report.py --json`, malformed-manifest counts, strict mode, and a documented exit-code contract.
- Add `scripts/install_skill.py --dry-run --json` so install work can be planned before mutation.
- Add workbench HTTP `/api/capabilities` and `/api/commands`.
- Return structured 400s for malformed workbench HTTP JSON bodies.
- Harden promote with rollback-on-exception, atomic suite writes, and subprocess timeouts.

## Pass 4 Update

Pass 4 completed the remaining high-value Python/check-script follow-ups plus the residual `eval-runs` filter work in this checkout:

| Surface | Previous | Pass 4 | Delta |
| --- | ---: | ---: | ---: |
| `generator.validate_promote` | 690 | 760 | +70 |
| `check_scripts` | 750 | 820 | +70 |
| `bench.eval_run` / `eval-runs` | 830 | 860 | +30 |

The median scored surface remains above the Pass 2 bar. No regression above the 50-point threshold was found.

## Pass 5 Update

Pass 5 focused on first-run eval-case generation for brand-new skills with no evals, especially the natural user flow where an agent passes a skill directory path rather than a repo-local skill name.

| Surface | Pre Pass 5 | Pass 5 | Delta |
| --- | ---: | ---: | ---: |
| `generator.first_run_skill_path` | 260 | 850 | +590 |
| `generator.zero_case_generation` | 430 | 840 | +410 |
| `generator.import_support_files` | 500 | 850 | +350 |
| `generator.import_provenance` | 520 | 800 | +280 |
| `bench.eval_case_generate_discovery` | 700 | 850 | +150 |
| `generator.prompt_style_skill_gap` | 250 | 780 | +530 |
| `generator.lm_setup_errors` | 450 | 820 | +370 |

Median scoped uplift: +370. No regression above the 50-point threshold was found.
