# Plan 003: Run loop — runs table beneath the canvas, content-first node detail (handoff screen 02)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8fe6fd5..HEAD -- ui/lib.ts ui/server.ts`
> Plans 001 and 002 must already be applied (`ui/views/workflows.js` renders
> the canvas). Re-verify the lib.ts excerpts below if that file moved.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: LOW-MEDIUM (read-only endpoints + one label-writing proxy that already exists from plan 001)
- **Depends on**: plan 001 (shell + review-label proxy), plan 002 (this table renders on the same page, below the canvas)
- **Planned at**: commit `8fe6fd5`, 2026-06-11

## Why this matters

Screen 02 of the design handoff
(`.resources/handoff/design_handoff_skills_workbench/README.md`, section
"02 — Run loop" — read it now) is the eval/improvement loop's core gesture:
see how a workflow's runs performed *without leaving the workflow*, open a
failing node, and grade it. The handoff is explicit that the old UI buried
the part that matters — the failing node's actual output next to what it
should have been: **"This side-by-side is non-negotiable — it's the whole
point of opening the row."** Today the run detail renders node cards with
raw JSON dumps (`ui/workflows.js` `loadRunDetail`, lines 236–330) and no
verdict affordance at all.

## Context

- Plan 001 contracts apply (view module `mount(container, ctx)`, CSS
  variables, `.pill`/`.btn`/`.mono-label` classes). The review-label proxy
  from plan 001 Step 7 (`GET/POST /api/review/labels`) is the persistence
  layer for the Pass/Fail/Defer verdict buttons here.
- This plan extends `ui/views/workflows.js` (the canvas page from plan 002):
  the runs table renders **below the canvas+inspector grid**, same page,
  same route. URL state: `?run=<runId>` (expanded run) and
  `?graded=<nodeId>` (expanded node row) appended to the existing
  `#/workflows/<path>?node=…` route.
- Visual reference: section `data-screen-label="02 Run loop"` in
  `.resources/handoff/design_handoff_skills_workbench/Hi-fi Screens v1.dc.html`.

## Current state (verified excerpts at `8fe6fd5`)

- `GET /api/runs?project=` → `TrajectoryRecord[]` (lib.ts lines 140–155):
  `{ kind:"workflow-run", id, project, title, workflowPath, status,
  createdAtMs, startedAtMs, finishedAtMs, nodeCount, nodesFinished, error }`.
- `GET /api/runs/<id>?project=` → `runDetail` (lib.ts line 250):
  `{ run, nodes: [{ nodeId, label, state, attempts:[{attempt, state,
  startedAtMs, finishedAtMs, error, responseText}], startedAtMs,
  finishedAtMs, output }], agentEventCount, captures: PoolCapture[] }` —
  captures carry `matchedNodeId`, `cwd` (the node's workspace), `dir` (the
  capture directory, e.g. `runs/<stamp>`), `skillInstalled`,
  `trajectoryUrl`, `exitCode`, `durationMs`.
- `GET /api/node-evals?project=` → `NodeEvalRecord[]` newest-first; the
  in-workflow record for a run+node carries `status`, `score`,
  `checks: [{id, status, detail?}]`.
- `POST /api/node-evals/insitu` `{ project, runId }` grades every node of a
  run in place (exists; the legacy "Grade nodes" button uses it).
- Model artifacts: `lagunaArtifacts(workspace)` (lib.ts line ~1418, **not
  exported**) reads `<workspace>/.laguna/*` →
  `[{ path: ".laguna/<f>", content (20k cap), missing }]`.
- The capture directory on disk holds `prompt.md` (the exact node prompt),
  `meta.json`, `stdout.ndjson`, `stderr.txt` (see `syncReviewTraces`,
  lib.ts lines ~1496–1505, which reads exactly these four names).
- Gold artifacts: every eval case ships `expected/` mirroring the
  workspace-relative contract path — verified on disk:
  `skills/ci-log-reducer/evals/ci-log-reducer-pytest-single-failure/expected/.laguna/…`
  and `skills/repo-map/evals/repo-map-bun-cli-workspace/expected/.laguna/…`.
- Review labels: `POST /api/review/labels` (plan 001 proxy →
  `harness/review/serve.py`) upserts
  `{ trace_id, label: "pass"|"fail"|"defer"|null, notes? }`. Workbench trace
  ids are `workbench/<runId8>/<nodeId>/<captureDirBasename>` — the exact
  format is built in `syncReviewTraces` (lib.ts line ~1511):
  `` `workbench/${run.id.slice(0, 8)}/${capture.matchedNodeId}/${basename(capture.dir)}` ``.
  **Use the identical construction** so labels written here line up with
  traces synced to the review app.

## Design spec (binding, from the handoff)

Six-column grid, used by the header row, run rows, and node rows:
`STATUS (90px) · RUN/NODE (1fr) · TIMING (160px) · VERDICT (120px) · LABEL (110px) · ▸ (32px)`
— implement as a CSS class `.run-grid { display: grid; grid-template-columns:
90px 1fr 160px 120px 110px 32px; }` in `ui/workbench.css`. Column header row:
`background: #090e15;` with `.mono-label` cells.

- **Expanded run** = a bordered card: `border: 1px solid var(--line-4);
  border-radius: 4px; overflow: clip;` (**SPEC: `clip`, not `hidden`** — the
  card's header row is `position: sticky; top: 52px; z-index: 10;
  box-shadow: var(--shadow-sticky);` and sticky + radius only coexist with
  `clip`; `top: 52px` clears the plan-001 topbar, which is itself sticky).
- **Node rows** inside the run card: `padding-left: 40px`, same grid.
  Status colors: pass `var(--green)`, fail `var(--red)`, ungraded
  `var(--amber)` (a node with no node-eval record for this run is
  `ungraded`).
- **Expanded (failing) node**: `border-left: 3px solid var(--red)`; header
  strip `background: #0d1e2e`; then content-first detail in this exact
  order:
  1. **PROMPT** — plain text, no box (mono-label heading + body text).
  2. **MODEL OUTPUT vs GOLD REFERENCE** — two equal columns showing the
     artifact JSON. Model column tint `background: var(--tint-red-1);
     border-left: 2px solid var(--red)` on the conflicting line, the bad
     value boxed `background: #4a1e1b` with annotation `← doesn't exist`
     (use the failing check's `detail` text); gold column
     `background: var(--tint-green-1); border-left: 2px solid var(--green)`,
     correct value boxed `#163d28`, `← correct`. Line-level conflict
     detection: pretty-print both JSONs; a model line whose trimmed text
     appears in no gold line AND is named by a failing check's detail gets
     the red treatment — best-effort is acceptable, the two-column layout is
     the non-negotiable part. When gold is null (see Step 1), render the
     model column full-width with the note
     `no gold reference — ad-hoc workspace; reference example unavailable`.
  3. **VALIDATOR** — the checks as a readable `✓/✗` list, no boxes; failing
     check in `var(--red)` with its `detail` string.
  4. **ACTION BAR** — elevated full-bleed surface: `background:
     var(--bg-action); border-top: 1px solid var(--line-4); padding: 12px
     16px; display: flex; gap: 10px; align-items: flex-start;`. Left:
     `↺ Re-run` (`.btn`) and `✦ Suggest fix` (`.btn.suggest`). Right
     (flex-end): a **resizable** `<textarea>` (`min-height: 38px;
     resize: vertical;` placeholder
     `What went wrong? Detail routes to the skill's improvement queue.`)
     and verdict buttons **Pass** (`.btn.pass-tint`), **Fail**
     (`.btn.danger`), **Defer** (`.btn`).
- **Collapsed runs** below an `EARLIER RUNS` `.mono-label`: one bordered
  card per run, same grid, including a `running` state (cyan `.pill.live`,
  verdict cell "in progress…").

## Step 1 — `lib.ts` + server: node artifact endpoint (model + gold + prompt)

Export `lagunaArtifacts` from `ui/lib.ts` (add `export` to the existing
function — no body changes). Then add:

```ts
export type NodeArtifacts = {
  prompt: string | null;
  skill: string | null;
  traceId: string | null;        // workbench/<run8>/<node>/<captureDir> — null if no capture matched
  files: {
    path: string;
    model: { content: string; missing: boolean };
    gold: { content: string; case: string } | null;
  }[];
  checks: { id: string; status: string; detail?: string }[];
  status: "pass" | "fail" | "error" | "ungraded";
};

/** Everything the expanded node row needs: the node's prompt (capture
 * prompt.md), its model artifacts (workspace .laguna/), the latest
 * in-workflow grade, and — when the grading skill ships eval cases — a gold
 * reference example matched by workspace-relative artifact path. The gold
 * is labeled a reference EXAMPLE: one acceptable answer from
 * skills/<skill>/evals/<case>/expected/, not this node's own gold. */
export function nodeArtifacts(project: Project, runId: string, nodeId: string): NodeArtifacts {
  const detail = runDetail(project, runId);
  const capture = detail.captures
    .filter((c) => c.matchedNodeId === nodeId && c.cwd)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
  const latestEval = listNodeEvals(project)
    .find((r) => r.mode === "in-workflow" && r.runId === runId && r.nodeId === nodeId) ?? null;
  const skill = capture?.skillInstalled ? basename(capture.skillInstalled) : (latestEval?.skill ?? null);
  let prompt: string | null = null;
  if (capture) {
    try { prompt = readFileSync(join(project.root, capture.dir, "prompt.md"), "utf8"); } catch {}
  }
  const modelFiles = capture?.cwd ? lagunaArtifacts(capture.cwd) : [];
  const files = modelFiles.map((f) => ({
    path: f.path,
    model: { content: f.content, missing: f.missing },
    gold: goldReference(skill, f.path),
  }));
  return {
    prompt,
    skill,
    traceId: capture ? `workbench/${runId.slice(0, 8)}/${nodeId}/${basename(capture.dir)}` : null,
    files,
    checks: latestEval?.checks ?? [],
    status: latestEval ? latestEval.status : "ungraded",
  };
}

/** First gold file at the same workspace-relative path across the skill's
 * eval cases (expected/ mirrors the workspace layout — e.g.
 * expected/.laguna/ci-log-summary.json). */
function goldReference(skill: string | null, relPath: string): { content: string; case: string } | null {
  if (!skill) return null;
  const evalsDir = join(SKILLS_ROOT, skill, "evals");
  if (!existsSync(evalsDir)) return null;
  for (const caseDir of readdirSync(evalsDir).sort()) {
    const goldPath = join(evalsDir, caseDir, "expected", relPath);
    if (existsSync(goldPath)) {
      try { return { content: readFileSync(goldPath, "utf8").slice(0, 20_000), case: caseDir }; } catch {}
    }
  }
  return null;
}
```

Server GET route: `/api/node-artifacts?project=&runId=&nodeId=` → 400 if
runId/nodeId missing, else `json(nodeArtifacts(project(), runId, nodeId))`.

**Verify**: `UI_PORT=4799 bun ui/server.ts &` then
`curl -s "http://127.0.0.1:4799/api/node-artifacts?runId=does-not-exist&nodeId=x"`
→ `{"error":"run does-not-exist not found …"}` with status 404 (the
`runDetail` HttpError propagates). With a real run id from `/api/runs`, the
response carries `prompt`/`files`/`checks`/`status` keys.

## Step 2 — the runs table in `ui/views/workflows.js`

Below the canvas+inspector grid (same `mount`), render:

1. Fetch `/api/runs?project=` and filter to
   `r.workflowPath?.endsWith(relPath.replace(/^\.\//, ""))` — runs of THIS
   workflow. Newest first (already sorted by the API). Fetch
   `/api/node-evals?project=` once and index in-workflow records by
   `runId:nodeId`.
2. Render the column header row, then the **first run expanded by default**
   (or the run named by `?run=`), remaining runs as collapsed cards under
   `EARLIER RUNS`. Run row cells: status pill (`finished→pass-colored only
   if every node eval passes; running→live`), `RUN/NODE` = title + mono
   id8, `TIMING` = `fmtDuration(finishedAtMs - startedAtMs)` +
   `fmtAgo(createdAtMs)`, `VERDICT` = `<passed>/<graded> nodes` (from the
   node-eval index) or `in progress…`, `LABEL` = (count of labeled nodes,
   see step 4) or `—`, `▸` toggles expansion (updates `?run=`).
3. Expanded run: sticky header row (design spec above), then one node row
   per `runDetail.nodes` entry (fetch `/api/runs/<id>` on expansion).
   Node verdict = in-workflow node-eval status or `ungraded`. A
   `Grade nodes` `.btn` in the run header fires
   `POST /api/node-evals/insitu { project, runId }` then re-fetches (port
   the legacy handler, `ui/workflows.js` lines 595–609).
4. Clicking a node row's `▸` expands the detail (updates `?graded=`):
   fetch `/api/node-artifacts`, render PROMPT → MODEL vs GOLD → VALIDATOR →
   ACTION BAR per the design spec. Verdict buttons: on click, POST
   `/api/review/labels` `{ trace_id: <artifacts.traceId>, label,
   notes: <textarea value> }`; highlight the active button (re-GET
   `/api/review/labels` on expansion to show existing labels; the LABEL
   column shows the saved label as a pill). If `traceId` is null, disable
   the buttons with `title="no pool capture matched this node — nothing to
   label"`.
   `↺ Re-run` → `POST /api/node-evals/standalone { project, path, nodeId,
   trials: 1 }` (same pending/timeout handling as plan 002's inspector
   button). `✦ Suggest fix` → same feature-detect + POST as plan 002's
   "Suggest improvements" (`source: "run-loop"`, include
   `refs: { runId, nodeId, traceId }`).
5. Poll while the newest run is `running`/`pending`: re-use the legacy
   self-rescheduling pattern (`ui/workflows.js` `schedulePoll`, lines
   333–349 — copy the miss-counter logic; a transient fetch failure must
   not kill the loop). Clear the timer in the view's cleanup function.

**Verify**: `bun build ui/app.js --outdir /tmp/wb-check` exits 0.

## Done criteria

1. Build + curl checks pass.
2. Manual with at least one finished run (start one from the canvas if
   needed): the table renders beneath the canvas; the newest run is
   expanded; scrolling the node detail keeps the run header pinned below
   the topbar with a drop shadow (the SPEC); ungraded nodes show amber;
   after `Grade nodes`, verdicts update without reload.
3. Expanding a failing node shows prompt, the two-column model/gold layout
   (or the explicit no-gold note), the ✓/✗ check list, and the action bar;
   clicking **Fail** with a note persists — verify with
   `curl -s http://127.0.0.1:4799/api/review/labels` showing the
   `workbench/...` trace id with `"label": "fail"` and your note.
4. A `running` collapsed card shows the cyan pill and "in progress…".
5. Legacy page and `bun ui/bench.ts runs` unaffected.

## Hard boundaries

- Files in scope: `ui/views/workflows.js`, `ui/workbench.css` (`.run-grid`
  + detail classes), `ui/lib.ts` (export `lagunaArtifacts`, add
  `nodeArtifacts` + `goldReference` only), `ui/server.ts` (one GET route).
- Do not modify `harness/review/serve.py` or the label file format — the
  verdict buttons speak the existing `/api/labels` contract via the proxy.
- Do not change the trace-id construction in `syncReviewTraces`; this plan
  copies its format, not the other way around.
- Gold rendering must keep the "reference example from eval case <id>"
  label — never present another case's gold as this node's ground truth.

## Test plan

- Failing-node path: if no real failing node exists, fabricate one — run a
  workflow whose node installs a skill, delete the artifact from the node's
  workspace (`rm <cwd>/.laguna/<artifact>.json` — workspace paths are in
  `/api/runs/<id>` captures), run `Grade nodes`, and confirm the node goes
  red and the expanded row shows `artifact missing` in the model column.
- Label round-trip: write fail + note via the UI, confirm via curl, then
  clear it (`{"trace_id":…,"label":null,"notes":""}`) to leave no test
  residue.

## Maintenance note

The 6-column `.run-grid` grammar is reused by plan 006's Runs feed (with
different column widths) — keep the class parameterized by view, don't
hard-couple. `nodeArtifacts` runs `runDetail` per call; if the table feels
slow on giant run histories, the fix is caching in the view, not loosening
the endpoint.

## STOP conditions

- Plans 001/002 not applied.
- `syncReviewTraces`'s trace-id format differs from the excerpt (drift) —
  labels would land on orphaned ids.
- The review proxy from plan 001 is absent (labels have nowhere to go).
