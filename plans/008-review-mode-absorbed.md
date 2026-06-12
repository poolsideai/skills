# Plan 008: Review mode absorbed — keyboard-first annotation inside the workbench (handoff screen 06)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8fe6fd5..HEAD -- harness/review/app/index.html harness/review/serve.py`
> Plan 001 must be applied (the `/api/review/*` proxy is this view's data
> layer). If the review app changed since `8fe6fd5`, re-read it before
> porting — this plan ports its logic, not its bytes.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: LOW (presentational port + integration; the label store and its
  server stay exactly as they are)
- **Depends on**: plan 001 (proxy). Soft: plan 004 (label→evidence
  routing), plans 003/006 (deep-links in). Includes the series' final
  cleanup step (conditional).
- **Planned at**: commit `8fe6fd5`, 2026-06-11

## Why this matters

Screen 06 of the design handoff
(`.resources/handoff/design_handoff_skills_workbench/README.md`, section
"06 — Review mode" — read it now): the annotation app
(`harness/review/app/index.html`, light-themed, port 8901) is the
error-analysis engine of this repo's methodology, but it lives in a
different tab, a different theme, and a global trace list. The handoff
absorbs it: same app, workbench theme, deep-linked from any failing run
row, position shown **within the current facet** ("2 of 3 unlabeled in
fails · ci-log-reducer" — NOT "1 of 32"), and labels routing to the
skill's improvement queue. The handoff names what to preserve: the
field-by-field model-vs-gold table is "the high-value part of the old
:8901 app worth preserving — keep it", and **all** keyboard shortcuts.

## Context

- Plan 001 contracts apply. Route owned here:
  `#/review?skill=&arm=&verdict=&label=&trace=` — same facet params plans
  003/006 emit. File: `ui/views/review.js` (replace the stub).
- Data endpoints (all proxied by plan 001 to `harness/review/serve.py`,
  auto-started on port 8901): `GET /api/review/traces` →
  `{ schema_version, demo, trace_count, traces: [...] }`;
  `GET /api/review/labels` → `{ <trace_id>: { label, notes, updated_at,
  reviewer } }`; `POST /api/review/labels` upserts
  `{ trace_id, label: "pass"|"fail"|"defer"|null, notes? }`;
  `GET /api/review/version` → `{ traces: <mtime>, labels: <mtime> }` for
  hot reload.
- The donor app is one self-contained file:
  `harness/review/app/index.html` (770 lines, read it in full before
  porting). The logic to port, by line region at `8fe6fd5`:
  - `verdict(t)` (~line 300): graded PASS/FAIL/ERROR = validator status vs
    `expected_status` — **this encodes good-failure cases** (a validator
    `fail` can be graded PASS); port it verbatim.
  - `renderComparison` + the `.cmp` grid (~lines 70–95 CSS, ~420–450 JS):
    the field-by-field `FIELD · MODEL OUTPUT · GOLD REFERENCE` table with
    per-field diff/validator-failure marks, missing-field handling, and
    the raw-JSON fallback. This is the must-preserve centerpiece.
  - `renderValue`/`humanArtifact`/`prettyBlock`/`highlightJSON`/`mdLite`
    (~lines 250–300, 330–360): JSON/markdown rendering, escape-first.
  - `renderValidator`, `verdictBanner`, `renderTrajectory`,
    `renderCollapsed` (stderr/debt/command accordions), `renderJudge`,
    `renderBadges` + the `INFO` tooltip dictionary (~lines 270–300) — keep
    the tooltips; they teach the methodology.
  - State machinery: `applyFilters`, `persist` (with the
    localStorage-pending retry), `setLabel` (click-again-to-clear + undo
    stack), `saveNotes` (600ms debounce + blur flush), `nav`,
    `startHotReload` (~lines 470–620).
  - Keyboard map (~lines 700–720): `←`/`→` nav · `1` pass · `2` fail ·
    `D` defer · `U` undo · `R` gold toggle · `⌘S` save · `⌘⏎` save+next ·
    Esc blurs the notes field; keys suppressed while typing. Preserve
    every binding.
- What is intentionally **not** ported: the left sidebar (the feed +
  facets replaced it), the header filter `<select>`s (facets arrive via
  the hash), the jump-to-trace datalist.

## Design spec (binding, from the handoff)

- **Mode bar** (top of the view): `← back to runs` (navigates to `#/runs?`
  + the current facet params, minus `trace`), the case name (mono), pills
  for arm + `graded FAIL` + skill, then the facet position:
  `<i> of <n> <facet description>` where the description names the active
  facets (e.g. `unlabeled in fails · ci-log-reducer`; no facets → `all
  traces`). Right: `Gold: on` toggle button.
- **Body**: center column + **trajectory rail (320px, `var(--bg-3)`)** on
  the right.
  - Center: red failure banner (`background: var(--tint-red-2);
    border-left: 3px solid var(--red)`) naming the first failing check
    (port `verdictBanner`, restyled); PROMPT plain (no box); then the
    field-by-field table — differing field rows tinted: model cell
    `background: #190d0c`, gold cell `background: #0c1812`; then
    validator, judge, final message, collapsed diagnostics.
  - Trajectory rail: the `session.start … tool_call … thought` step tree,
    mono, per-step `<details>` accordions (port `renderTrajectory`; keep
    `white-space: pre` for JSON detail).
- **LABEL BAR** fixed to the viewport bottom (`background:
  var(--bg-action); border-top: 1px solid var(--line-4); z-index: 40`):
  prev/next arrows, **Pass** (`.btn.pass-tint`), **Fail** (`.btn.danger` —
  solid `#c0392b`, white text), **Defer** (`.btn`), Undo, a resizable
  notes `<textarea>` (`min-height: 38px; resize: vertical`, placeholder
  `Notes — routes to the skill's improvement queue.`), save status, and
  the keyboard-hint line
  `←→ nav · 1 pass · 2 fail · D defer · U undo · R gold · ⌘S save · ⌘↵ save+next`.

## Step 1 — port the view

Build `ui/views/review.js`:

1. `mount` fetches `/api/review/traces` + `/api/review/labels` in
   parallel. Fetch failure → render the donor app's guidance ("Run
   `uv run harness/review/extract_traces.py --demo` then reload"), plus
   "or `Sync workbench → review` from a run page" — not a blank screen.
2. Filtering: derive `state.view` from the hash facets — `skill`
   (`t.skill`), `arm` (`t.arm`), `verdict` (graded verdict via the ported
   `verdict(t)`), `label` (`unlabeled` | `pass` | `fail` | `defer` against
   the labels map). `trace=<id>` sets the cursor to that trace within the
   filtered view (fall back to 0 + a small "trace not in this facet"
   notice if absent).
3. Rendering: mode bar + center + rail + label bar per the design spec,
   reusing the ported render functions restyled with workbench classes
   (move the donor's CSS into `ui/workbench.css` under a `.review-*`
   prefix, swapping its light palette for the token equivalents: `--card`
   → `var(--bg-2)`, `--border` → `var(--line-2)`, pass/fail/defer/error →
   `var(--green)`/`var(--red)`/`var(--amber)`/`var(--amber)`, accent →
   `var(--cyan)`; keep structural rules as-is).
4. Persistence: port `persist`/`setLabel`/`saveNotes`/`undo` against
   `POST /api/review/labels`. **Addition**: when a save carries
   `label === "fail"` and the trace has a `skill`, also POST
   `/api/proposals/evidence` `{ skill, source: "review", traceId,
   note: <notes> }` — feature-detect (404 → skip silently, plan 004 not
   landed). Never block or fail the label save on the evidence call.
5. Navigation: cursor moves update `trace=` in the hash via
   `history.replaceState` (no re-mount churn); `← back to runs` builds the
   `#/runs?` link. Keyboard map identical to the donor (suppressed while
   the palette from plan 007 is open — check for its overlay element).
6. Hot reload: port `startHotReload` against `/api/review/version`
   (2s interval), preserving the merge-without-losing-place behavior and
   the in-progress-notes guard; the interval is cleared in the view's
   cleanup function (the donor never unmounts; this port does).

**Verify**: `bun build ui/app.js --outdir /tmp/wb-check` exits 0. Then
seed data and check the flow end to end without real runs:

```sh
uv run harness/review/extract_traces.py --demo
# server on 4799 →  open http://127.0.0.1:4799/workflows.html#/review
```

## Step 2 — deep-link integration check

If plans 003/006 are applied: from a failing feed/run row, the `▸` link
opens `#/review?skill=…&verdict=fail&trace=…`; confirm the mode-bar
position reads within that facet (e.g. `1 of 2 in fails · <skill>`), and
`← back to runs` restores the exact filtered feed. If they are not
applied, navigate to
`#/review?skill=ci-log-reducer&label=unlabeled&verdict=FAIL` by hand and
confirm the same facet behavior against demo traces.

## Step 3 — conditional cleanup (the series' last act)

**Only if** plans 002–007 are all marked DONE in `plans/README.md`:

1. Delete `workflows-legacy.html` and `ui/workflows.js`; remove their
   entries from `STATIC_FILES` in `ui/server.ts`
   (`"/ui/workflows.js"`, `"/workflows-legacy.html"`).
2. `grep -rn "workflows.js\|workflows-legacy" ui/ *.html docs/ AGENTS.md CLAUDE.md`
   — update any stale references (CLAUDE.md's line "`ui/workflows.js` is
   its script" becomes the new entry-point description; keep the edit
   minimal and factual).
3. Do **not** delete `harness/review/app/` or `serve.py` — the standalone
   app remains valid (headless annotation, other reviewers) and serve.py
   is still the label-store owner this view talks to through the proxy.

Otherwise: skip, and write "cleanup deferred — plans NNN pending" in your
report and in the README status row.

## Done criteria

1. Build check passes; with demo traces the review view renders: failure
   banner, plain prompt, field-by-field model-vs-gold table with tinted
   differing rows, ✓/✗ validator list, trajectory rail with expandable
   steps, fixed label bar.
2. Every keyboard shortcut works exactly as in the donor app (test all
   nine; `R` hides/shows the gold column; `⌘↵` saves and advances).
3. Label round-trip: `2` (fail) + a note → `curl -s
   http://127.0.0.1:4799/api/review/labels` shows the entry with reviewer
   + timestamp (written by serve.py, proving the proxy path); `U` undoes
   it. The old app at `http://127.0.0.1:8901/` shows the same label — one
   store, two frontends.
4. With plan 004 applied: the fail-label save appends a `review`-sourced
   line to `runs/proposals/<skill>/evidence.jsonl`; without it, saving
   works with no console errors.
5. Facet position counter is facet-scoped (done-criteria of Step 2).
6. Hot reload: re-run `extract_traces.py --demo` while the view is open →
   "traces refreshed" without losing the cursor.

## Hard boundaries

- Files in scope: `ui/views/review.js`, `ui/workbench.css`
  (`.review-*` rules), and — Step 3 only — the cleanup deletions +
  reference updates.
- Do not modify `harness/review/serve.py`, `extract_traces.py`,
  `labels.json` semantics, or `traces.json` shape. The proxy is the only
  integration point.
- Do not alter `syncReviewTraces` in `ui/lib.ts`.
- Escape-first rendering is non-negotiable: every ported render function
  escapes before injecting (the donor is rigorous about this — keep it).
  Trace content is model output; treat it as hostile.

## Test plan

Demo traces exercise every UI state by construction (`--demo` synthesizes
pass/fail/error per case — see `extract_traces.py` `demo_traces`). Beyond
done-criteria: (a) a trace with no validator result renders the "no
validator result" badge, not a crash; (b) notes typed but not saved
survive a labels hot-reload (the donor's in-progress guard — port it
faithfully); (c) offline serve.py (kill it) → label save shows
"save failed — kept locally" and retries on next load (localStorage
pending path).

## Maintenance note

This view and the standalone 8901 app now share the store but not the
code. That is deliberate (the standalone app stays dependency-free), but
it means renderer fixes may need mirroring — note it in any future change
to either. If a second reviewer workflow emerges, the label store's
`reviewer` field (set server-side by serve.py from the OS user) is already
per-entry.

## STOP conditions

- Plan 001's review proxy is absent or broken.
- The donor app's structure diverges badly from the line regions above
  (drift) — re-read and re-map before porting, or report.
- Any ported render path injects unescaped trace content (check with a
  demo trace whose notes contain `<img onerror>` — inject one via curl,
  confirm it renders inert, then remove it).
