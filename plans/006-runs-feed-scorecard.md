# Plan 006: Runs page — one feed for every trajectory, skill scorecard pivot (handoff screen 05)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8fe6fd5..HEAD -- ui/lib.ts ui/server.ts harness/review/extract_traces.py`
> Plan 001 must be applied. If plan 005 is applied, playground records join
> the feed; if not, that producer is simply absent (feature-detect, no error).

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: LOW (read-only aggregation endpoint + a view; no writes)
- **Depends on**: plan 001; soft-depends on 003 (run links), 005 (playground records), 008 (review deep-links) — all degrade gracefully
- **Planned at**: commit `8fe6fd5`, 2026-06-11

## Why this matters

Screen 05 of the design handoff
(`.resources/handoff/design_handoff_skills_workbench/README.md`, section
"05 — Runs page" — read it now) answers the question the old UI scattered
across four panels: "how is each skill doing, and show me everything that
touched it." The handoff's core complaint: top-level skill runs vs.
skill-as-node-in-workflow runs, aggregated vs. disaggregated, were spread
across separate sections. The fix: **the skill is a facet of one feed**, and
a scorecard sorted weakest-lift-first makes "where should I spend
attention" the first thing on screen.

## Context

- Plan 001 contracts apply. Route owned here: `#/runs?type=&skill=&workflow=&arm=&verdict=`
  — **all facet state URL-encoded in the hash** (handoff "State
  Management": filtered views must be linkable). File: `ui/views/runs.js`
  (replace the stub).
- Visual reference: section `data-screen-label="05 Runs page"` in the hi-fi
  prototype.
- The four producers (all exist at `8fe6fd5` except playground):
  1. Workflow runs — `listRuns(project)` → `TrajectoryRecord` (lib.ts 140).
  2. Eval arm-runs — `listEvalRuns()` → `EvalRunRecord` with `skill`
     resolved via `skillForCase` (lib.ts 1055–1130); carries `status`,
     `gradedPass`, `score`, `checks`, tokens, `arm`, `agentName`.
  3. Node evals — `listNodeEvals(project)` → `NodeEvalRecord` with `skill`,
     `mode`, `status`, `runId`, `trial`.
  4. Playground — `listPlayground(skill)` from plan 005 (skip if absent).
- Human labels live in `runs/review/labels.json` keyed by `trace_id`
  (`harness/review/serve.py` owns writes; reading the file directly is
  safe). Trace-id formats: workbench in-workflow =
  `workbench/<runId8>/<nodeId>/<captureDir>`, standalone =
  `workbench/standalone/<recordId>` (lib.ts `syncReviewTraces` ~1511,
  ~1556). For harness eval runs the id is built in
  `harness/review/extract_traces.py` — **read that file and replicate its
  exact `trace_id` construction** (do not guess; it is near the
  `output_files` assembly around lines 135–180).
- `skillEvalSummaries()` (lib.ts 1159) already computes the with/without
  split per skill — the scorecard extends it, not replaces it.

## Design spec (binding, from the handoff)

- **SKILL SCORECARD** table on top, sorted **weakest lift first** (nulls
  last). Columns:
  `SKILL · LIFT · WITH SKILL (x/y · avg) · WITHOUT · IN-WORKFLOW · UNLABELED · ▸`.
  The weakest skill's row carries a `<n> fails →` link that applies
  `skill=<name>&verdict=fail` to the feed. Selected/expanded skill row:
  `background: #0e1d2c`. Lift formula identical to plan 005's
  (percentage-point delta of pass rates; `—` when a side has no runs).
- **FACET CHIPS** under the scorecard: `type · skill · workflow · arm ·
  verdict`. An active chip renders cyan (`.pill.live` styling) with an ✕ to
  clear; clicking a value anywhere in the feed (a TYPE tag, a skill name,
  an arm) toggles that facet. Chips and hash params are the same state.
- **FEED** below, 7-column grid
  (`.feed-grid { grid-template-columns: 110px 1fr 230px 170px 130px 110px 32px; }`):
  `TYPE · RECORD · ARM/MODEL · TIMING · VERDICT · LABEL · ▸`. Color-coded
  TYPE tag: `eval` amber, `node` slate (`var(--text-3)`), `workflow` cyan,
  `playground` green with the whole row tinted `background: var(--tint-green-2)`.
  - `eval` rows are **case cards with arms paired**: parent row = the case
    (id, skill), child rows = its arms (`xs_with_skill` vs
    `xs_without_skill`…), so per-case lift is visible at a glance.
  - `node` rows: in-workflow grades and standalone trials (`3/3 pass`
    summary for a trial group — group standalone records sharing the same
    id prefix `<tag>-solo-<node>`).
  - `workflow` rows: the run, with the skills its nodes installed.
  - `playground` rows: `+ eval case` promotion affordance in the LABEL
    column (POST `/api/playground/promote`, plan 005 — hide if 404).
  - VERDICT: `pass`/`fail`/`error` pills, `running` (`.pill.live`,
    "in progress…"), `ungraded` (`.pill.warn`).
  - LABEL: the human label pill if present, else `—`.
  - Failing rows link `▸` to `#/review?...` carrying the current facet
    params plus `trace=<traceId>` (plan 008 consumes; before 008 the stub
    renders — acceptable).

## Step 1 — `ui/lib.ts`: the feed builder

```ts
export type FeedRecord = {
  type: "workflow" | "eval" | "node" | "playground";
  id: string;
  title: string;
  skill: string | null;
  workflow: string | null;          // workflowPath when known
  arm: string | null;               // eval arm / "in-workflow" / "standalone #n" / null
  model: string | null;
  atMs: number | null;              // sort key (start/graded/created)
  durationMs: number | null;
  verdict: "pass" | "fail" | "error" | "running" | "ungraded";
  score: number | null;
  label: "pass" | "fail" | "defer" | null;
  traceId: string | null;
  children?: FeedRecord[];          // eval case → its arms
};
export type SkillScorecardRow = {
  skill: string; lift: number | null;
  withSkill: { pass: number; total: number; avgScore: number | null };
  withoutSkill: { pass: number; total: number; avgScore: number | null };
  inWorkflow: { pass: number; total: number };
  unlabeledFails: number;
};
export function buildFeed(project: Project): { scorecard: SkillScorecardRow[]; records: FeedRecord[] };
```

Implementation notes (binding):

- Load labels once: parse `runs/review/labels.json` (missing/corrupt →
  `{}`); helper `labelFor(traceId)` does an exact lookup, and for
  in-workflow node records falls back to a **prefix match** on
  `workbench/<runId8>/<nodeId>/` (the capture-dir suffix isn't known here;
  if multiple match, take the newest key — best-effort, documented).
- Eval producer: group `listEvalRuns()` by `suite/caseId`; parent record
  `type:"eval"`, id `suite/caseId`, verdict = `running` if any arm running,
  else `pass` if every graded arm has `gradedPass`, else `fail`; children =
  one record per arm (verdict from `gradedPass ?? status`, traceId per
  extract_traces.py's format).
- Workflow producer: map `listRuns(project)` (cap **30 newest**); for each,
  `runDetail` → distinct `basename(skillInstalled)` values across matched
  captures (first one fills `skill`, all of them join the title suffix);
  unreadable detail → skill null. Verdict from run status
  (`finished→ungraded` unless every in-workflow node-eval for the run
  passes — reuse the `runId:nodeId` index from `listNodeEvals`).
- Node producer: one record per in-workflow eval
  (`arm: "in-workflow"`, traceId by prefix rule) and one per standalone
  **group** (records sharing `<tag>-solo-<nodeId>`, title `n/m pass`,
  verdict pass iff all pass; child records per trial with
  `workbench/standalone/<id>` traceIds).
- Playground producer: only if `listPlayground` exists in lib.ts (plan
  005); iterate `listSkills()` names, concat records
  (`arm: null`, `model: agentName`).
- Scorecard: start from `skillEvalSummaries()`; add `inWorkflow` counts
  (same aggregation as plan 005's `skillDetail`); `unlabeledFails` = feed
  records (this skill) with verdict `fail` and `label === null`; `lift` per
  the shared formula; sort ascending lift, nulls last.
- Sort `records` by `atMs` desc. Return both.

Server route (GET): `/api/feed` → `json(buildFeed(project()))`.

**Verify** (server on 4799):

```sh
curl -s http://127.0.0.1:4799/api/feed | bun -e '
  const d = await new Response(Bun.stdin.stream()).json();
  console.log("scorecard rows:", d.scorecard.length, "records:", d.records.length);
  console.log("types:", [...new Set(d.records.map(r => r.type))]);'
```

→ prints counts without error; every `type` value is one of the four.
Cross-check one number: the eval parent+children arm count equals
`curl -s http://127.0.0.1:4799/api/evals/runs | bun -e '…(json).runs.length'`.

## Step 2 — the view (`ui/views/runs.js`)

Replace the stub. Fetch `/api/feed?project=`. Render scorecard → chips →
feed per the design spec. Behaviors:

- Facets: read from `ctx.params`; applying/clearing a facet calls
  `navigate("/runs?" + newParams)` (full re-mount keeps state simple).
  Filter client-side: `type`, `skill`, `workflow` (substring on
  workflowPath), `arm`, `verdict` — a parent eval card matches if any
  child matches (and shows only matching children when an `arm` facet is
  active).
- Scorecard row click → toggles `skill=<name>`; the weakest row's
  `<n> fails →` link sets `skill` + `verdict=fail`.
- Feed `▸` expansion: eval cards expand children inline; failing rows also
  render the review deep-link (`#/review?` + current params +
  `&trace=<traceId>`) when `traceId` is non-null.
- Poll every 5s while any record is `running` (self-rescheduling,
  miss-tolerant — same pattern as plans 003/005); cleanup clears it.
- Empty state: "No trajectory records yet — run a workflow, an eval suite,
  or a playground prompt."

**Verify**: `bun build ui/app.js --outdir /tmp/wb-check` exits 0.

## Done criteria

1. `/api/feed` curl checks pass; arm-count cross-check matches.
2. Manual: `#/runs` shows the scorecard sorted weakest-first (with the v0
   skills' real numbers — compare against `bun ui/bench.ts eval-runs`);
   clicking `skill: repo-map` chips the facet, filters the feed, and the
   URL hash updates; reloading that URL restores the filtered view
   (linkable state — the handoff requirement); eval cards pair their arms
   as child rows; a playground record (if plan 005 landed) renders
   green-tinted with the promote affordance.
3. Facet chips and scorecard agree: with `skill: X · verdict: fail` active,
   the feed row count equals the scorecard's unlabeled-fails + labeled
   fails for X (spot-check one skill).
4. No regression on `/api/evals/runs`, `/api/runs`, legacy page.

## Hard boundaries

- Files in scope: `ui/views/runs.js`, `ui/lib.ts` (the `buildFeed` section
  only), `ui/server.ts` (one GET route), `ui/workbench.css` (`.feed-grid`,
  type tags, scorecard classes).
- Read-only: this plan writes nothing anywhere (the promote affordance
  calls plan 005's endpoint).
- Do not modify `skillEvalSummaries`, `listEvalRuns`, or
  `extract_traces.py` — replicate trace-id formats, never change them.
- Do not build a second scorecard implementation on the skills page — plan
  005's tiles and this table share the lift helper.

## Test plan

The cross-checks in done-criteria 1–3 are the test plan. Edge cases to
verify and record: (a) empty `runs/` tree → empty scorecard + empty-state
copy, no crash; (b) corrupt `labels.json` (temporarily move a `{` —
restore after) → feed renders with all labels `—`; (c) a skill with eval
runs but no with-skill arms → lift `—`, sorted last.

## Maintenance note

`buildFeed`'s workflow cap (30 newest runs) and the label prefix-match are
the two deliberate approximations — both noted in code comments. If feed
latency grows, cache `buildFeed` per project with a short TTL (the
`caseSkillCache` 5s pattern, lib.ts 1132) rather than trimming producers.
Plan 008's review view consumes the same trace ids; if extract_traces.py
ever changes its format, both this plan's join and the review deep-links
move together.

## STOP conditions

- Plan 001 not applied.
- `extract_traces.py`'s trace-id construction is ambiguous after reading
  the file (do not guess a join key — report).
- `/api/feed` exceeds ~3s on this machine's real data even after the run
  cap — report with timings instead of shipping a slow landing page.
