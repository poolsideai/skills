# Duplication & Slop Map — harness/

Scanners run on baseline commit (main, clean tree):
- `vulture harness --min-confidence 60/80`
- `pylint --enable=duplicate-code --min-similarity-lines=5/8`
- `radon cc harness -s -n C`
- `ast-grep`, `rg` structural census

**Headline: this is a clean codebase.** Almost nothing surfaced. Total harness = 7,341 LOC across 23 py files.

## Candidates found

### C1 — Tolerant NDJSON line-parse loop (Type II/III clone)
The "open file (or read_text), iterate lines, strip, skip blanks, `json.loads` under `try/except json.JSONDecodeError`" pattern.

Sites:
- `harness/runner/artifacts.py:193` — `with open(...) as fh` + `for line in fh` (skip on error), wrapped in `try/except OSError`
- `harness/runner/report.py:121` — `with open(...) as fh` + `for line in fh` (skip on error), wrapped in `try/except OSError`
- `harness/review/extract_traces.py:69` — `read_text().splitlines()` (skip on error), guarded by `is_file()`
- `harness/review/extract_traces.py:94` — `read_text().splitlines()` (**records** unparseable line, does not skip), guarded by `is_file()`

Pylint flagged only the artifacts.py↔report.py pair (≥5 lines identical).

**Divergence (isomorphism trap):**
- artifacts/report use `with open(...)` + `try/except OSError`; extract_traces uses `read_text(...).splitlines()` + `is_file()` precheck (raises on race, no OSError catch).
- extract_traces:94 does NOT skip on decode error — it appends a `{"kind":"raw",...}` step. Different behavior.
- The per-line *body* (what's done with each parsed event) is entirely different at every site.

Only the artifacts↔report pair share both the IO shape AND the skip-on-error semantics. extract_traces sites differ in IO (read_text vs open) and one differs in error handling.

### C2 — Dead local variable (P12-ish, genuine)
- `harness/generate/gen_eval_cases.py:1349` — `is_validate_or_promote = bool(args.validate_only or args.promote)` assigned, never read. Added 2026-06-16 (575e94c). Confirmed not referenced dynamically.

## Non-issues (false positives / intentional)
- `serve.py:56` `log_message(self, fmt, ...)` — required `SimpleHTTPRequestHandler` override signature; "unused fmt" is API contract.
- `serve.py:86 do_POST`, `pool_exec.py:87 probed` — framework override / used dataclass field.
- `gen_eval_cases.py:477-478 clean_cases/has_clean_cases` — 60% confidence, dataclass fields (likely used via attribute access).
- `except Exception` (5 sites) — reviewed, all are intentional broad catches at subprocess/LM boundaries with logged fallbacks, not swallowed.
- No `_v2/_new/_old` orphan files. No re-export webs. No `any`-equivalent. No N+1. No dead feature flags.

## Scored Opportunity Matrix

Score = (LOC_saved × Confidence) / Risk; implement only ≥ 2.0.

| ID | Candidate | LOC | Conf | Risk | Score | Decision |
|----|-----------|-----|------|------|-------|----------|
| C2 | Remove dead `is_validate_or_promote` local | 1 | 5 | 1 | 5.0 | ✅ |
| C1a | Extract shared `iter_json_lines()` helper for artifacts.py + report.py (2 sites, identical semantics) | 2 | 4 | 2 | 4.0 | ⚠️ borderline — only 2 callsites (Rule of 3 not met) |
| C1b | Also fold extract_traces sites into one helper | 2 | 2 | 3 | 1.3 | ❌ divergent IO + error semantics |

## Recommendation
- **C2**: ship — pure dead-code removal, Score 5.0, zero behavior change.
- **C1a**: only 2 callsites → Rule of 3 says note it, don't extract. The "shared home" (`harness/runner/`) has no existing util module; creating one to host a 6-line loop used twice is climbing the abstraction ladder too fast. **Reject** on Rule-of-3 grounds.
- **C1b**: divergent → leave (Type III/IV). **Reject.**

Net actionable: **C2 only** (−1 LOC, but more importantly removes a real dead-code smell).
