# Agent Ergonomics Scorecard Pass 2

Mode: full apply pass

Target branch: `main`

No new branch was created.

| Surface | Pass 1 | Pass 2 | Delta | Main change |
| --- | ---: | ---: | ---: | --- |
| `bench.discovery` | 786 | 840 | +54 | Capabilities now advertise strict flags, intent hints, and safe eval dry-run. |
| `bench.eval_run` | 473 | 830 | +357 | Unknown/unsafe flags fail before launch; `--robot-dry-run` routes to safe JSON runner. |
| `bench.optimize_skill` | 459 | 720 | +261 | Unknown flags, duplicate scalar flags, missing values, and boolean stray values fail before launch. |
| `runner.robot_dry_run` | 709 | 830 | +121 | Robot-mode args/suite errors are JSON; token env no longer changes summaries; schemas pin errors. |
| `generator.validate_promote` | 573 | 690 | +117 | Validate/promote results have schema versions; numeric args validate earlier; schemas pin output. |
| `bench.eval_case_generate` | 705 | 730 | +25 | Shared strict bench validation improves surrounding command behavior; bespoke parser retained. |
| `check_scripts` | 750 | 750 | 0 | No check-script change in pass 2. |

Median score moved from 705 to 750.

No surface regressed by more than 50 points.

## Applied Recommendations

- `R-001`: strict per-command flag and positional validation for `bench`.
- `R-002`: safe primary-CLI robot dry-run path for `bench eval-run`.
- `R-003`: did-you-mean recovery for close command and flag typos.
- `R-004`: runner robot-mode JSON error envelope.
- `R-005`: stable generator validate/promote schemas and clearer result envelopes.
- `R-008`: safer detached status by preventing malformed side-effect launches; eval-run robot path avoids sidecars.

## Ambition Round

The required "That's it??" self-prompt was run after the first implementation slice. The second round added schema-pinned `eval-error.v1` and `case-generation-result.v1` envelopes plus generator result validation.
