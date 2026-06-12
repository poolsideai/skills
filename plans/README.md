# Plans index — Skills Workbench redesign (design handoff implementation)

Source mandate: `.resources/handoff/design_handoff_skills_workbench/README.md`
(the spec; binding) + `Hi-fi Screens v1.dc.html` (visual reference; its
`support.js` runtime is prototype-only and must never be ported).
All plans written against commit `8fe6fd5` (2026-06-11) by a planning agent
that audited `ui/`, `harness/review/`, and the handoff bundle. Each plan is
self-contained: an executor needs only the plan file and the repo.

Status: internal implementation tracker for the Skills Workbench redesign. Normal skill authoring and eval work starts in the root README, not here.

## Status

| # | Plan | Screen | Effort | Risk | Depends on | Status |
|---|------|--------|--------|------|------------|--------|
| 001 | [App shell, tokens, router, review proxy](001-app-shell-tokens-router.md) | frame | M | MED | — | DONE — shell/router/static assets validated on refreshed 4319 server with screenshots |
| 002 | [Workflow canvas + node inspector](002-workflow-canvas-inspector.md) | 01 | L | MED | 001 | DONE — workflow list/canvas/inspector validated on refreshed 4319 server with screenshots |
| 003 | [Run loop table + node detail](003-run-loop-table.md) | 02 | L | LOW-MED | 001, 002 | DONE — run-loop table/node detail/API implemented; build/curl/bench and agent-browser smoke pass |
| 004 | [Improvement queue backend](004-improvement-queue-backend.md) | 01/02/03/06 | L | MED | 001 | DONE — proposal worker/store/API implemented; smoke accept/rollback/drift verified on port 4804 |
| 005 | [Skills page + playground](005-skills-page-playground.md) | 03 | L | MED | 001 (soft: 004) | DONE — skills/scorecard/tabs/zero-eval/playground/queue validated on refreshed 4319 server with screenshots |
| 006 | [Runs feed + skill scorecard](006-runs-feed-scorecard.md) | 05 | L | LOW | 001 (soft: 003/005/008) | DONE — runs feed/scorecard/facets/review deep link validated on refreshed 4319 server with screenshots |
| 007 | [⌘K launcher + background generation](007-cmdk-background-generation.md) | 04 | M | LOW-MED | 001 | DONE — launcher palette/typeahead validated on refreshed 4319 server with screenshots; POST generate smoke passed |
| 008 | [Review mode absorbed + cleanup](008-review-mode-absorbed.md) | 06 | L | LOW | 001 (soft: 004; cleanup gated on 002–007) | BLOCKED — refreshed screenshot validation shows `#/review` renders workflow canvas/run-loop instead of distinct review mode |

Status values: TODO → IN PROGRESS → DONE / BLOCKED (with a note). Executors:
update your row when you finish, and record any deviation in a one-line note.

## Execution order

```
001 ──┬── 002 ── 003 ──┐
      ├── 004 ─────────┼── 005
      ├── 006          │
      ├── 007          │
      └── 008 (port) ──┴── 008 (cleanup step, last of all)
```

Recommended serial order: **001 → 002 → 003 → 004 → 005 → 006 → 007 → 008**.
Safe parallel tracks after 001: {002→003}, {004}, {006}, {007}. 005 wants
004 first (queue panel). 008's port can run any time after 001; its Step 3
cleanup (deleting the legacy page + `ui/workflows.js`) only when 002–007
are DONE.

## Shared contracts (defined in plan 001 — binding everywhere)

- CSS custom properties in `ui/workbench.css` `:root` (exact names in plan
  001 Step 3) + classes `.pill`, `.btn`, `.mono-label`, `.panel`.
- View modules: `ui/views/<name>.js` exports
  `async mount(container, ctx) → cleanup?`; ctx =
  `{ project, id, params, navigate, helpers }`.
- Hash routes: `#/skills[/<name>]`, `#/workflows[/<encoded path>]`,
  `#/runs?<facets>`, `#/review?<facets>&trace=` — facet state is always
  URL-encoded (linkable views are a handoff requirement).
- Lift formula (plans 005/006): percentage-point delta of with/without
  pass rates; `—` when a side has zero runs.
- Detached-job pattern (plans 004/005/007): worker script + log-fd + pid
  sidecar under `runs/…/.state/`, copied from `startEvalRun` in
  `ui/lib.ts` — never an in-memory registry.
- Trace ids: replicate `syncReviewTraces` (workbench) and
  `extract_traces.py` (harness) formats exactly; never invent a third.

## Standing rules for executors

- `runs/` is gitignored — all new state (proposals, playground, generate
  sidecars) lives there. Nothing under `skills/` is written except
  `SKILL.md` via plan 004's gated accept.
- Never remove or change an existing `/api/*` route or `ui/bench.ts`
  behavior — the agent CLI and legacy page consume them until 008 cleanup.
- No npm dependencies; bun/node builtins and browser platform only.
- Verification baseline caveat: this repo has no JS test framework. Gates
  are `bun build` syntax checks, curl matrices, the repo's Python checks
  (when `skills/` is touched), and explicit manual browser checklists.
  Do not invent a test framework inside these plans.
- Do not commit; leave changes in the working tree for review.

## Deferred

- **009 — Catalog as build-time export**: `index.html`/`skill.html` become
  a generated export of the same skill + scorecard data instead of a
  hand-maintained parallel (handoff "The system", first bullet). Deferred:
  zero user-facing pain until the redesigned workbench stabilizes; touches
  the GitHub Pages surface which is explicitly outside the app. Write this
  plan when 001–008 are DONE.

## Considered and rejected (do not re-audit)

- **Porting the prototype's `support.js` runtime / React** — rejected; the
  handoff is explicit it is a prototyping convenience, and the repo's
  stack is vanilla JS + Bun static serving.
- **Re-theming `styles.css` in place** — rejected; it is shared with the
  static catalog, which the handoff keeps separate. New `ui/workbench.css`
  instead (plan 001).
- **Multi-panel generator modal for authoring** — explicitly rejected in
  the handoff (screen 04); ⌘K is a launcher, real authoring happens on the
  destination page.
- **Synchronous suggest/playground/generate endpoints** — rejected; pool
  runs take minutes and the repo already has the detached pid-sidecar
  pattern. The pre-existing sync generate endpoints stay for bench.ts
  compatibility but the UI stops using them (plan 007).
- **A new label store for run-loop verdicts** — rejected; verdict buttons
  write the existing `runs/review/labels.json` through serve.py via proxy
  (plans 001/003), keeping one store for human ground truth.
- **Per-node gold artifacts for workflow runs** — not possible honestly;
  workflow nodes are not case-backed. Plan 003 shows a clearly-labeled
  *reference example* from the grading skill's eval cases when paths
  match, single-column otherwise.
- **Deleting `harness/review/` after absorption** — rejected; serve.py
  remains the label-store owner and the standalone app stays valid for
  headless use (plan 008).
