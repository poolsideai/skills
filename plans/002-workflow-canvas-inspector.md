# Plan 002: Workflow canvas + node inspector (handoff screen 01)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8fe6fd5..HEAD -- ui/lib.ts ui/server.ts`
> Plan 001 must already be applied (`ui/app.js` and `ui/views/workflows.js`
> exist). If `ui/lib.ts`'s `workflowGraph`/`listNodeEvals` regions changed
> since `8fe6fd5`, re-verify the excerpts below before proceeding.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM (adds two mutating endpoints that rewrite workflow TSX; both are verification-gated with backup/rollback)
- **Depends on**: plan 001 (shell, ctx contract, tokens)
- **Blocks**: plan 003 (the run-loop table lives on this page, below the canvas)
- **Planned at**: commit `8fe6fd5`, 2026-06-11

## Why this matters

Screen 01 of the design handoff
(`.resources/handoff/design_handoff_skills_workbench/README.md`, section
"01 — Workflow canvas" — read it now, plus "Interactions & Behavior") is the
authoring home: each Smithers node = a prompt + a model + 0…n skills, and
the inspector is where skills and workflows meet. The current UI renders the
graph as a flat SVG with `<title>` tooltips and no node selection at all
(`ui/workflows.js` `renderGraphSvg`, lines 137–204) — there is no way to see
a node's prompt, model, skills, or grades without opening raw files.

## Context

- Read plan `plans/001-app-shell-tokens-router.md` sections "Step 5" (view
  module contract: `mount(container, ctx)` → optional cleanup fn; `ctx` =
  `{ project, id, params, navigate, helpers }`) and "Step 3" (CSS variable
  names). Both are binding here.
- Route owned by this plan: `#/workflows` (workflow list) and
  `#/workflows/<encodeURIComponent(relPath)>?node=<nodeId>` (canvas page).
  File: `ui/views/workflows.js` (replace the plan-001 stub).
- Visual reference: open
  `.resources/handoff/design_handoff_skills_workbench/Hi-fi Screens v1.dc.html`
  in a browser; the section is labeled `data-screen-label="01 Workflow canvas"`.

## Current state (verified excerpts at `8fe6fd5`)

`ui/lib.ts` — the graph projection (`workflowGraph`, lines 479–495) returns:

```ts
export type GraphNode = { id: string; label: string; kind: "task" | "control"; prompt?: string };
export type GraphEdge = { from: string; to: string };
// GET /api/workflows/graph?project&path → { path, nodes: GraphNode[], edges: GraphEdge[] }
```

Nodes carry **no model and no skills** — those live in the TSX and in pool
captures. `lib.ts` already has the recovery pieces:

- `latestNodeCapture(project, workflowPath, nodeId)` (line ~1359, **not
  exported**) walks recent runs and returns the node's newest `PoolCapture`:
  `{ dir, cwd, exitCode, durationMs, trajectoryUrl, skillInstalled,
  skillToolCalls, toolCallCount, mtimeMs, matchedNodeId }`.
- The capture's `meta.json` on disk (at `join(project.root, capture.dir,
  "meta.json")`) has an `argv` array; the agent name follows the
  `"--agent-name"` element (see `syncReviewTraces`, line ~1518, which
  already parses it exactly this way).
- `listNodeEvals(project)` (line 1227) returns `NodeEvalRecord[]` sorted
  newest-first: `{ kind:"node-eval", id, project, workflowPath, nodeId,
  mode:"in-workflow"|"standalone", runId, trial, skill, grader, status:
  "pass"|"fail"|"error", score, checks, durationMs, trajectoryUrl,
  workspace, agentName, gradedAtMs, note? }`.
- `POST /api/node-evals/standalone` (server.ts line ~190) already re-runs a
  node N trials and grades each — the inspector's "Re-run node · 3 trials"
  button calls it as-is. **Caveat**: it is synchronous and takes minutes;
  `Bun.serve` is configured with `idleTimeout: 240` (seconds).
- `generateWorkflow` (lib.ts line 560) shows the house pattern for
  model-rewrites-TSX: prompt → `poolGenerate` → `extractFence` → write →
  verify with `smithers graph` (scrubEnv) → repair round → roll back on
  failure. The chat-dock edit endpoint (Step 2) follows it.
- Layout algorithm to reuse (current `renderGraphSvg`, `ui/workflows.js`
  lines 150–168): BFS depth from roots (nodes with no incoming edges),
  lane = per-depth counter; position
  `x = depth * (W + GX), y = lane * (H + GY)`.

## Design spec (binding, from the handoff)

- Page = workflow sub-header + two-column grid: **canvas (fluid) + inspector
  (fixed 470px)**.
- Sub-header: breadcrumb `Workflows / <name>`, the `.tsx` path (mono,
  `var(--text-muted)`), a `graph verified` pill (`.pill.ok`), a `View TSX`
  button, and a primary `▶ Run workflow` button.
- Canvas: dotted grid background
  `radial-gradient(circle at 1px 1px, #141d29 1px, transparent 0)` sized
  `24px 24px`; node cards **178px wide**, absolutely positioned; SVG edges
  `#2c3d54` (default) / `#3ec6f2` (edges touching the selected node). Node
  card: name (JetBrains Mono 12px 700), one-line description
  (`var(--text-4)` 11px), a `model · skill` footer line (mono 10px), status
  dot top-right (`var(--green)` latest grade pass, `var(--amber)` ungraded,
  `var(--red)` fail). Selected card: `2px solid var(--cyan)` border +
  `box-shadow: var(--glow-select)`.
- **SPEC (from the handoff, non-negotiable)**: wrap the SVG layer and the
  node layer in one `position: relative` container with explicit
  width/height from the layout computation, so edge coordinates match node
  positions at all viewports; the canvas column gets `overflow: hidden`.
- Chat dock floating at the canvas bottom: `background: #0e1822; border:
  1px solid #25516e; border-radius: 4px;` textarea + send button.
- Zoom controls top-right of the canvas (+ / − / reset; CSS
  `transform: scale()` on the inner container is sufficient).
- Inspector (`background: var(--bg-4)`): node name + `agent node` chip +
  close (✕ clears `?node=`). Four stacked groups, each headed by a
  `.mono-label`: **MODEL**, **PROMPT**, **SKILLS**, **NODE PERFORMANCE**.
  - PROMPT: the node's prompt in a `#0f1a26` box, mono 12px; upstream refs
    matching `\{ctx\.[^}]*\}` highlighted amber `#c4a052` (regex-replace on
    the *escaped* text, like the existing `highlightJSON` pattern in
    `harness/review/app/index.html`).
  - SKILLS: installed skills as cyan pill chips (`$repo-map`) each with ✕;
    below, a `$` typeahead input — matching skills listed with one-line
    description + their with/without record (from `/api/skills`'
    `evalSummary`: `withSkill.pass`/`withSkill.total`, e.g. `6/7 ↩`).
  - NODE PERFORMANCE: latest grades for this node, descending — each row a
    pass/fail `.pill` + mode label (`in-workflow run` / `standalone #2`) +
    `fmtAgo(gradedAtMs)`. Buttons: `Re-run node · 3 trials` (`.btn`) and
    `✦ Suggest improvements` (`.btn.suggest`). Footnote text: improvements
    are proposed by laguna-m.1 and land on the skill page — never inline.

## Step 1 — `lib.ts`: per-node enrichment

Add to `ui/lib.ts` (new exported function, placed after `latestNodeCapture`):

```ts
export type NodeFacts = {
  nodeId: string;
  skill: string | null;
  agentName: string | null;
  lastEvals: NodeEvalRecord[]; // newest first, max 5
};

/** Per-node enrichment for the canvas inspector: skill + model recovered
 * from the node's most recent pool capture, grades from node-evals.
 * Scans at most the 10 most recent runs of this workflow (capture matching
 * requires a runDetail per run — keep it bounded). */
export function workflowNodeFacts(project: Project, relPath: string, nodeIds: string[]): NodeFacts[] {
  const evals = listNodeEvals(project);
  const wanted = new Set(nodeIds);
  const captureByNode = new Map<string, PoolCapture>();
  let scanned = 0;
  for (const run of listRuns(project)) {
    if (scanned >= 10 || captureByNode.size === wanted.size) break;
    if (run.workflowPath && !run.workflowPath.endsWith(relPath.replace(/^\.\//, ""))) continue;
    scanned++;
    try {
      const detail = runDetail(project, run.id);
      for (const c of detail.captures) {
        if (c.matchedNodeId && wanted.has(c.matchedNodeId) && !captureByNode.has(c.matchedNodeId)) {
          captureByNode.set(c.matchedNodeId, c);
        }
      }
    } catch { /* unreadable run; keep looking */ }
  }
  return nodeIds.map((nodeId) => {
    const capture = captureByNode.get(nodeId) ?? null;
    let agentName: string | null = null;
    if (capture) {
      try {
        const meta = JSON.parse(readFileSync(join(project.root, capture.dir, "meta.json"), "utf8"));
        const argv = Array.isArray(meta.argv) ? (meta.argv as string[]) : [];
        const i = argv.indexOf("--agent-name");
        agentName = i >= 0 ? argv[i + 1] : null;
      } catch { /* capture meta unreadable */ }
    }
    return {
      nodeId,
      skill: capture?.skillInstalled ? basename(capture.skillInstalled) : null,
      agentName,
      lastEvals: evals
        .filter((r) => r.nodeId === nodeId &&
          (!r.workflowPath || r.workflowPath.endsWith(relPath.replace(/^\.\//, ""))))
        .slice(0, 5),
    };
  });
}
```

Server route (GET block of `ui/server.ts`):

```ts
if (url.pathname === "/api/workflows/nodes") {
  const path = url.searchParams.get("path");
  if (!path) throw new HttpError(400, "path query param required");
  const graph = await workflowGraph(project(), path);
  const taskIds = graph.nodes.filter((n) => n.kind === "task").map((n) => n.id);
  return json(workflowNodeFacts(project(), path, taskIds));
}
```

(add `workflowNodeFacts` to the `./lib.ts` import list.)

**Verify**: `UI_PORT=4799 bun ui/server.ts &`, then
`curl -s "http://127.0.0.1:4799/api/workflows/nodes?path=<an existing .tsx from /api/workflows>"`
→ JSON array with `nodeId`/`skill`/`agentName`/`lastEvals` keys (values may
be null/empty on a machine with no runs — that's fine). Requires a working
`smithers` install in the project (`smithersBin` non-null); if
`/api/workflows` is empty on this machine, verify shape with
`bun -e 'import {workflowNodeFacts, getProject} from "./ui/lib.ts"; console.log(JSON.stringify(workflowNodeFacts(getProject(null), "x.tsx", ["a"])))'`
→ `[{"nodeId":"a","skill":null,"agentName":null,"lastEvals":[]}]`.

## Step 2 — `lib.ts` + server: chat-dock TSX edit with backup/rollback

Add `editWorkflow` to `ui/lib.ts`, modeled exactly on `generateWorkflow`
(lines 560–622 — read it first):

- Signature: `export async function editWorkflow(project, relPath, instruction, options: { agentName?: string } = {})`.
- Resolve the absolute path with the existing `safeWorkflowPath`.
- Read the current source (`before`). Build the prompt: the same hard-rules
  list as `workflowAuthoringPrompt` (reuse the function if you can pass the
  current file as the "reference"; otherwise inline a variant) plus:
  `"Below is the CURRENT file. Apply this change and return the COMPLETE
  updated file in one \`\`\`tsx fence:"` + the instruction + the source.
- `poolGenerate(prompt, agentName, "edit:" + basename(relPath))` →
  `extractFence`. No fence → return `{ ok: false, attempts }` (one repair
  round, same as generateWorkflow).
- Before writing: copy the current file to `<abs>.bak-<tag>` where
  `tag = Date.now().toString(36)`.
- Write the candidate, verify with
  `runCommand([project.smithersBin, "graph", relPath, "--format", "json"], project.root, 90_000, { scrubEnv: true })`.
- Failure after the repair round → restore from the backup, delete it,
  return `{ ok: false, attempts, error }`. Success → return
  `{ ok: true, path: relPath, backup: tag, before, after: source, attempts }`
  (keep the `.bak-<tag>` file for revert).
- Also add `export function revertWorkflow(project, relPath, backupTag)`:
  validate `/^[a-z0-9]+$/.test(backupTag)`, restore `<abs>.bak-<tag>` over
  the file, delete the backup, return `{ ok: true }`. Missing backup →
  `HttpError(404)`.

Server POST routes (inside the origin-checked POST block):
`/api/workflows/edit` → body `{ project?, path, instruction, agentName? }`
(400 if path/instruction missing) → `editWorkflow(...)`;
`/api/workflows/revert` → body `{ project?, path, backup }` →
`revertWorkflow(...)`.
Also add GET `/api/workflows/source?path=` → `safeWorkflowPath` then return
the file as `text/plain` (for the View TSX button).

**Verify** (no pool spend): `curl -s -X POST http://127.0.0.1:4799/api/workflows/edit -H 'content-type: application/json' -d '{"path":"nope.tsx","instruction":"x"}'`
→ a 4xx/5xx JSON error (path validation or missing smithers), **not** a
crash. `curl -s "http://127.0.0.1:4799/api/workflows/source?path=nope.tsx"`
→ 4xx JSON error. Full live verification of the edit loop happens in the
manual test plan (it costs a pool call).

## Step 3 — the view (`ui/views/workflows.js`)

Replace the stub. Structure:

1. **No id** (`#/workflows`): render a `.panel` list from
   `/api/workflows?project=…` — each row `name` + mono path, linking to
   `#/workflows/${encodeURIComponent(w.path)}`. Empty → hint "No workflow
   .tsx files found."
2. **With id**: fetch in parallel `graph` (`/api/workflows/graph`), `facts`
   (`/api/workflows/nodes`), `skills` (`/api/skills`), `models`
   (`/api/models`, fallback to `["laguna-m.1"]` on error like the legacy
   `loadModels`). Render sub-header + canvas + inspector grid
   (`display:grid; grid-template-columns: 1fr 470px;`).
3. **Canvas**: compute positions with the depth/lane algorithm (constants:
   `W=178`, `H=64`, `GX=70`, `GY=28`). Container:
   `position:relative; width:<maxX+W+24>px; height:<maxY+H+24>px;` inside a
   `overflow:hidden` column with the dotted-grid background. One absolutely
   positioned SVG (same width/height) renders edges as cubic paths (reuse
   the `M…C…` math from legacy `renderGraphSvg` lines 170–183); node cards
   are absolutely positioned `<button class="node-card">` elements. Click →
   `navigate` to the same route with `?node=<id>` (preserve other params).
   Selected node: add `.selected` class; edges whose `from` or `to` equals
   the selected id get `stroke: var(--cyan)`.
4. **Inspector**: when `params.get("node")` names a task node, render the
   four groups per the design spec, using `facts` for skill/model/lastEvals
   and `graph.nodes[].prompt` for PROMPT. Otherwise render a hint
   ("Select a node"). Buttons:
   - MODEL select lists `models`, current value = `facts.agentName ?? "laguna-m.1"`,
     **disabled** with `title="model changes land via the chat dock"` (a
     model change is a TSX edit; do not fake it).
   - Skill chip ✕ → confirm dialog → POST `/api/workflows/edit` with
     instruction `Remove the skill "<name>" from node "<nodeId>" (drop its
     PoolAgent skill option). Change nothing else.`
   - Typeahead select → same endpoint, instruction `Install the skill
     "<name>" into node "<nodeId>" via the PoolAgent skill option
     ({ name: "<name>", from: join(ROOT, "..", "..", "skills", "<name>") }).
     Change nothing else.`
   - `Re-run node · 3 trials` → POST `/api/node-evals/standalone`
     `{ project, path, nodeId, trials: 3 }`; while pending show a `.pill.live`
     "running trials…"; on response (or fetch timeout) re-fetch
     `/api/workflows/nodes` and re-render NODE PERFORMANCE; on timeout show
     "still running server-side — grades will appear here when done."
   - `✦ Suggest improvements` → if `GET /api/proposals?skill=<skill>`
     returns 404, render disabled with `title="lands with plan 004"`;
     otherwise POST per plan 004's contract (`/api/proposals/suggest` with
     `{ skill, source: "inspector", refs: { workflowPath, nodeId } }`).
5. **Chat dock**: textarea + Send. On send: POST `/api/workflows/edit`;
   while pending disable + show status. On `ok:false` show the attempts
   list (reuse the legacy composer's attempts rendering, `ui/workflows.js`
   lines 470–478). On `ok:true` show a unified before/after line diff
   (write a ~20-line LCS-free diff: walk both line arrays, mark removed
   lines red `−` / added green `+` using a simple common-prefix/suffix trim
   — perfection not required, this is a preview) with two buttons:
   **Accept** (dismiss the diff, re-fetch graph + facts) and **Revert**
   (POST `/api/workflows/revert` with the returned `backup`, then re-fetch).
6. **Sub-header**: `▶ Run workflow` → POST `/api/workflows/run`
   `{ project, path }` → show `.pill.live` `run started <id8>` (the run
   table arrives in plan 003). `View TSX` → fetch
   `/api/workflows/source?path=…` and show in a `<pre>` overlay (Esc
   closes). `graph verified` pill: `.pill.ok` when the graph fetch
   succeeded, `.pill.bad` with the error message when it failed.
7. Return a cleanup function that clears any timers.

**Verify**: `bun build ui/app.js --outdir /tmp/wb-check` exits 0.

## Done criteria

1. Build check passes; all curl checks from Steps 1–2 pass.
2. Manual, with the server running and at least one workflow present
   (`experiments/smithers-pool` has `example.workflow.tsx`): `#/workflows`
   lists it; clicking opens the canvas; nodes render as cards with edges
   attached at card edges (resize the window — edges must not detach:
   that's the SPEC container); clicking a node selects it (cyan border) and
   fills the inspector; PROMPT shows the node prompt with `{ctx.…}` refs in
   amber; typing in the typeahead filters skills and shows their record.
3. The chat dock round-trip works once live (this spends one pool call):
   send "rename node X's label to Y" → diff appears → Revert restores the
   original (confirm with `git diff` on the .tsx: empty afterwards).
4. No regression: legacy page still loads; `bun ui/bench.ts skills` still
   works.

## Hard boundaries

- Files in scope: `ui/views/workflows.js`, `ui/lib.ts` (only the two new
  functions + exports), `ui/server.ts` (only the three new routes),
  `ui/workbench.css` (canvas/inspector classes only — touch nothing from
  plan 001's contract).
- Do not modify `workflowAuthoringPrompt`'s hard rules, `generateWorkflow`,
  `startRun`, or anything under `harness/`, `skills/`, `scripts/`.
- Never write a workflow file without the `smithers graph` verification +
  backup pattern above. Never delete a user's `.tsx` except restoring from
  a backup the same request created.
- The `.bak-<tag>` files live next to the workflow; do not invent another
  store.

## Test plan

Beyond done-criteria: with no runs database (fresh project), the canvas
must still render (facts all null — status dots amber, footer shows
`laguna-m.1 · no skill`); with `smithers` missing the page must show the
graph-failed pill, not a blank screen. Record both checks in your report.

## Maintenance note

`workflowNodeFacts` is O(runs scanned × runDetail); the cap of 10 runs is
deliberate — if the inspector feels stale for old workflows, raise the cap,
don't remove it. The edit instruction strings ("Remove the skill…", "Install
the skill…") are prompt surface for laguna — treat them as code; plan 004's
proposal prompts follow the same convention.

## STOP conditions

- Plan 001's shell is not in place (no `ui/app.js`).
- `workflowGraph`'s return shape differs from the excerpt (drift).
- The edit endpoint cannot restore from backup in a failure test — report
  immediately; an edit path that can lose a user's workflow must not ship.
