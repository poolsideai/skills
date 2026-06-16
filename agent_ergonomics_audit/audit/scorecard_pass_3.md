# Agent Ergonomics Scorecard Pass 3

Mode: full apply pass

Target branch: `main`

Target SHA: `19da102d21bda7c1c7425b19dfc05b2c4667a870`

No new branch was created.

| Surface | Before | After | Delta | Main change |
| --- | ---: | ---: | ---: | --- |
| `bench.eval_runs` | 520 | 820 | +300 | Added `--status`, `--running`, `--limit`, and `--json-lines` with a bounded schema-versioned envelope. |
| `bench.global_flags` | 610 | 820 | +210 | Accepted top-level `--help` and global `--json`/`--no-color` no-op conventions. |
| `bench.flag_parser` | 650 | 820 | +170 | Added `--flag=value` support while preserving boolean-value rejection and duplicate-scalar validation. |
| `bench.errors` | 720 | 850 | +130 | Standardized bench-owned failures on `bench-error.v1` with status and exit code. |
| `bench.discovery` | 840 | 870 | +30 | Advertised global flags and the new `eval-runs` contract through help/capabilities. |
| `check_scripts` | 750 | 750 | 0 | Re-verified only; no check-script changes in pass 3. |

Median scoped score moved from 650 to 820.

No surface regressed by more than 50 points.

## Applied Recommendations

- `R-009`: bounded and filterable `bench eval-runs`.
- `R-010`: top-level help and common global machine-mode flags.
- `R-011`: inline `--flag=value` syntax.
- `R-012`: normalized `bench-error.v1` bench-owned error envelope.

## Ambition Round

The required "That's it??" self-prompt was run after the first implementation slice. The second round added inline flag support and the normalized bench error envelope. The pass remains below the strongest ten-fix ambition target because larger remaining items are separate Python/server surfaces.
