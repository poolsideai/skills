# Simplification Pass — harness/

## Summary
| Metric              | Before | After | Δ    | Direction |
|---------------------|--------|-------|------|-----------|
| LOC (harness, py)   | 7,341  | 7,340 | −1   | ↓ ✅      |
| Test pass count     | 46     | 46    | 0    | = ✅      |
| Structure check     | OK     | OK    | 0    | = ✅      |
| Schema check        | OK     | OK    | 0    | = ✅      |
| Smoke replay        | OK     | OK    | 0    | = ✅      |
| Vulture 100%-conf dead vars | 1*  | 0    | −1   | ↓ ✅      |

\* the other 100%-conf hit (`serve.py fmt`) is a required `SimpleHTTPRequestHandler` override signature, not dead code.

## Verdict
`harness/` is a **clean, well-maintained codebase.** Full scanner sweep
(vulture, pylint duplicate-code @min-5, radon cc, ast-grep, rg census)
surfaced essentially nothing actionable:

- **0** orphan `_v2/_new/_old` files
- **0** re-export webs, prop-drilling, `any`-propagation, N+1, dead feature flags
- **1** genuine dead local (removed)
- **1** Type-II clone pair (artifacts↔report NDJSON loop) — only 2 callsites,
  Rule-of-3 not met, **left intentionally**
- Other near-clones (extract_traces) diverge in IO + error semantics (Type III/IV) — **left intentionally**

## Shipped
- **C2**: removed dead `is_validate_or_promote` local in
  `gen_eval_cases.py:1349` (assigned 2026-06-16, never read). Iso card:
  `iso_card_C2.md`. Verified: tests 46→46, all harness gates green.

## Rejected (logged)
- **C1a** extract shared `iter_json_lines()` for artifacts.py+report.py — only
  2 callsites; no existing util home; creating an abstraction for a 6-line loop
  used twice climbs the ladder too fast. Re-open if a 3rd identical site appears.
- **C1b** fold extract_traces sites into the same helper — divergent IO
  (`read_text().splitlines()` vs `open()`) and divergent error handling (one
  records unparseable lines instead of skipping). Type III/IV — coupling cost
  exceeds the ~4 LOC saved.

## Hand-off
Simplification pass complete. Net Δ LOC: −1; one real dead-code smell removed;
no duplication worth merging (the single Type-II pair fails Rule of 3); all
goldens/gates identical; tests still green. The remaining clone candidates are
Type II (sub-threshold) and Type III/IV and should be left alone. Re-open the
loop only after feature work adds a 3rd NDJSON-loop callsite.
