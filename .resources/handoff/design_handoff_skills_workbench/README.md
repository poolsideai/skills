# Handoff: Skills & Workflow Workbench — unified IA

## Overview

This package redesigns the **Poolside Skills workbench** (`ui/workflows.html` +
`ui/workflows.js` + `styles.css`, served by `bun ui/server.ts`). The current tool
spreads one mental model across three disconnected surfaces — a static catalog
(`index.html`), the workbench (`workflows.html`), and a separately-themed annotation
app (`harness/review/`, port 8901) — and buries its two most important actions
(authoring a skill, authoring a workflow). It also has no way to simply "run a skill
against a prompt."

The redesign collapses everything into **one app with four nouns — Skills · Workflows ·
Runs · Review** — plus a `⌘K` launcher, and makes the eval/improvement loop the spine of
the product. The guiding principle: **wherever you stand, the other nouns arrange
themselves around you** (a skill page shows its runs and the workflows that use it; a
workflow canvas shows its runs beneath it; a run links to its skill and its sibling arms).

There are two design files in this bundle:
- **`Hi-fi Screens v1.dc.html`** — the six redesigned screens (the implementation target).
- **`UX Audit & IA Proposal.dc.html`** — the rationale: 8 audit findings, the concept map,
  the contextual-gravity matrix, and the three IA directions that led here. Read this first
  for the *why*; build from the screens file.

## About the Design Files

The `.dc.html` files in this bundle are **design references created in HTML** — prototypes
showing the intended look and behavior, **not production code to copy directly.** They are
"Design Components" that mount React at runtime via `support.js`; that runtime is a
prototyping convenience, **not** part of the target architecture.

**The task is to recreate these designs in the existing workbench codebase** — vanilla
JS (`ui/workflows.js`) rendering into `workflows.html`, styled by `styles.css`, talking to
the existing HTTP API in `ui/server.ts` (`/api/skills`, `/api/workflows`, `/api/runs`,
`/api/evals/*`, `/api/node-evals/*`, `/api/review/*`). Reuse the existing data model and
endpoints; this is a UI/IA reorganization, not a backend change. Where a screen needs data
that isn't exposed yet (noted per-screen below), add the thin endpoint rather than inventing
a new store.

To open the prototypes: serve the bundle folder over any static server and open the
`.dc.html` files in a browser (they need `support.js`, included here). They are wide
designs (1480px min) — view at full width.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, and component structure are all
intentional and specified below. Recreate the UI faithfully using the workbench's own
patterns, but treat every hex value, font size, and layout dimension here as the spec.
A few behaviors are explicitly marked **SPEC** in the prototype (e.g. the sticky run
header) — those are intent notes for behavior that the static mockup can't fully show.

## The system (read once, applies to every screen)

- **One app, top nav of four nouns:** `Skills` · `Workflows` · `Runs` · `Review`, plus a
  `+ New ⌘K` button at the right of the top bar. The static GitHub-Pages catalog
  (`index.html`) stays separate but should become a build-time export of the same skill +
  scorecard data, not a hand-maintained parallel.
- **Everything is a trajectory record.** Four producers — workflow runs, eval arm-runs,
  node evals (in-workflow + standalone), and a new **playground run** ("try a skill with a
  prompt") — all reduce to the same record shape and render with the same row grammar.
- **The loop is the product:** run → grade (mechanical validator) → label (human, in Review)
  → the failing evidence routes to the skill's **improvement queue**, where a stronger model
  (laguna-m.1) proposes a versioned change you accept. Skills are **never hand-edited inline
  during workflow authoring** — they improve from run evidence and land as new versions.

## Screens / Views

The screens file contains six labeled sections (`data-screen-label`): `01 Workflow canvas`,
`02 Run loop`, `03 Skills page`, `04 ⌘K Composer`, `05 Runs page`, `06 Review mode`.

---

### 01 — Workflow canvas (the authoring home)

**Purpose:** author and iterate a workflow; the node inspector is where skills and workflows
meet (each Smithers node = a prompt + a model + 0…n skills).

**Layout:** Full-app frame. Top app bar (nav + project picker + `+ New ⌘K`). Below it a
workflow sub-header (breadcrumb `Workflows / code-review-ben`, the `.tsx` path, a
`graph verified` pill, `View TSX`, and a primary `▶ Run workflow`). Body is a two-column
grid: **canvas (fluid) + inspector (fixed 470px)**.

- **Canvas:** dotted-grid background (`radial-gradient(circle at 1px 1px, #141d29 1px,
  transparent 0)` at `24–26px`), absolute-positioned node cards (178px wide), SVG edges
  between them (`#2c3d54` default, `#3ec6f2` for the selected path). Each node card: name
  (JetBrains Mono 12px 700), one-line description (#7d91a4 11px), a model·skill footer line,
  and a status dot top-right (`#38c08a` pass / `#e8b13f` ungraded). Selected node has a
  `2px #3ec6f2` border + soft glow. A **chat dock** floats at the bottom of the canvas
  (`#0e1822` bg, `#25516e` border) — natural-language edits rewrite the TSX, with a `$ skill`
  affordance. Zoom controls top-right.
  - **SPEC:** wrap the SVG + node layer in a fixed-size positioned container so edge
    coordinates match node positions at all viewports; give the canvas column
    `overflow: hidden` (or the frame a min-width) so nodes never spill into the inspector.
- **Inspector (470px, `#0d141d`):** the selected node. Top: node name + `agent node` chip +
  close. Then four stacked groups, each with a mono uppercase label (`#5d7186`, 10px,
  letter-spacing .14em):
  - **MODEL** — a select row showing `laguna-xs.2 · worker · 256k ctx`.
  - **PROMPT** — the node's prompt in a `#0f1a26` box, mono 12px; upstream refs like
    `{ctx.latest(outputs.diff, "diff_intake")}` rendered in amber `#c4a052`, paths in cyan.
    Input/output ref line beneath.
  - **SKILLS** — installed skills as cyan pill chips (`$repo-map` + its lift), each with an ✕.
    Below, an **active `$` typeahead** dropdown: typed text on top, then matching skills each
    with a one-line description + their with/without record (e.g. `6/7 ↩`).
  - **NODE PERFORMANCE** — most recent grades for this node descending (in-workflow run,
    standalone trials, prior runs), each a pass/fail badge + label + relative time. Two
    buttons: `Re-run node · 3 trials` (neutral) and `✦ Suggest improvements` (amber). A note
    clarifies Suggest improvements sends trajectories to laguna-m.1 and lands proposals on
    the skill page, never inline.

**Data:** `/api/workflows/graph` for the projected graph; per-node skill from the TSX /
pool captures (`skillInstalled`); node performance from node-evals
(`/api/node-evals`). The `$` typeahead reads `/api/skills`.

---

### 02 — Run loop (runs directly beneath the canvas)

**Purpose:** see how a workflow's runs performed without leaving the workflow; drill into a
failing node and grade it. This is the same page as 01, scrolled down.

**Layout:** A **runs table** with a fixed 6-column grid:
`STATUS (90px) · RUN/NODE (1fr) · TIMING (160px) · VERDICT (120px) · LABEL (110px) · ▸ (32px)`.
Column header row in `#090e15` with mono uppercase labels.

- **Expanded run** = a bordered card (`#1e3349` border, `overflow: clip`). Its header row is
  **`position: sticky; top: 0; z-index: 10`** with a drop shadow — **SPEC:** it pins to the
  viewport top while you scroll the eval detail so run context is never lost (use
  `overflow: clip`, not `hidden`, on the card so radius + sticky coexist).
- **Node rows** sit inside the run card, indented (`padding-left: 40px`), same 6 columns.
  Statuses: `pass` (#38c08a), `fail` (#ff8a80), `ungraded` (#e8b13f).
- **Expanded (failing) node** = a red `3px` left border (`#ff8a80`), a lighter header strip
  (`#0d1e2e`), then **content-first detail** (this is the part that matters most — the old UI
  buried it):
  1. **PROMPT** — plain text, no box.
  2. **MODEL OUTPUT vs GOLD REFERENCE** — two equal columns, the actual JSON artifacts. The
     conflicting line is highlighted: model in red (`#2d1513` bg, `2px #ff8a80` left border,
     the bad value boxed `#4a1e1b`, annotated "← doesn't exist"); gold in green (`#0d2318` bg,
     `2px #38c08a`, correct value boxed `#163d28`, "← correct"). **This side-by-side is
     non-negotiable — it's the whole point of opening the row.**
  3. **VALIDATOR** — checks as a readable `✓/✗` list (no boxes); failing check in red with the
     specific reason.
  4. **ACTION BAR** — its own elevated surface (`#101f30`/`#0e1e2e` bg, `1px #1e3349` border,
     bleeds full-width). Left: `↺ Re-run` (neutral) + `✦ Suggest fix` (solid amber `#e8b13f`,
     black text). Right: a **resizable `<textarea>`** note (min-height 38px, `resize: vertical`,
     placeholder encouraging detail) + verdict buttons **Pass** (green-tinted, `#0e2318`/`#2a5c42`),
     **Fail** (solid red `#c0392b`, white text), **Defer** (neutral). These must read as
     unmistakable buttons — they are the reason the row is open.
- **Collapsed runs** below an `EARLIER RUNS` mono label, each its own bordered card (same
  6-col grid), including a `running` state (cyan `#3ec6f2` status pill, "in progress…" verdict).

**Data:** workflow runs from `.smithers/smithers.db` via `/api/runs`; node grades from
`/api/node-evals`; gold reference from the eval case's `expected/` artifacts.
`Suggest fix` posts to the same flow as the inspector's Suggest improvements.

---

### 03 — Skills page (a separate surface, improved by evidence)

**Purpose:** read a skill's contract, see its scorecard, try it now, and accept
model-proposed improvements. Skill editing lives **here**, never inside workflow authoring.

**Layout:** three columns: **library rail (250px) · detail (1fr) · right rail (390px)**.

- **Library rail** (`#0c121a`): the skills list, each with name + lift % + one-line summary;
  selected item highlighted (`#15212f`/`#2b3e57`).
- **Detail:** skill name (mono 24px 700) + `v0.1.0` + `structure ✓` pills + `View source`.
  Description. **Scorecard** = 4 tiles: `WITH SKILL` (green), `WITHOUT` (red), `IN-WORKFLOW`
  (green), `LIFT` (cyan, accented tile `#0e1d29`/`#1d4a63`), each a number + sub-stat. Tabs:
  `Contract · Eval cases · Runs · Used in (workflows) · Versions`. Contract tab shows a
  `SKILL.md` snippet + the schema / validator / evals files with status counts.
- **Right rail** (`#0c121a`), two panels:
  - **TRY IT NOW** (green-bordered `#1a2e26`/`#0e1a18`): a prompt box + `workspace` + model
    selectors + a green **Run** button. This is the missing **playground run** primitive —
    "graded by the validator, promotable to an eval case." Build this; it's the zero-to-first-
    success path and the cheapest trajectory producer.
  - **IMPROVEMENT QUEUE** (amber-bordered `#3a3014`/`#15110a`): each item is a model proposal —
    a sentence of what laguna-m.1 found across N failing trajectories, then a **SKILL.md diff**
    (red `−` / green `+` lines), then `Accept as v0.1.1` (solid amber) + `View evidence` + ✕.
    Also a "+ new eval case from playground run …" affordance. Footer note: accepting creates
    a draft version that re-runs the suite.

**Data:** `/api/skills` for the list + scorecard (the per-arm split already exists in the
substrate as "skill lift"). Try-it-now needs a small new endpoint: run `pool exec` with the
skill installed against an ad-hoc prompt + workspace, then the skill's validator. The
improvement queue is new: persist model proposals keyed to a skill, sourced from the
Suggest-fix/Suggest-improvements actions.

---

### 04 — ⌘K (quick action palette)

**Purpose:** start a new skill or workflow from anywhere with a slash command. Deliberately
minimal — the real authoring happens on the canvas / skill page this launches you into.

**Layout:** a single input bar (`max-width: 860px`). Type `/workflow` or `/skill` followed by
a natural-language description; `$skill-name` autocompletes inline anywhere in the text. The
prototype shows two example rows: a cyan `/workflow` chip + description, and a green `/skill`
chip + description, each ending in a mono `↵ create`. **Behavior:** Enter starts generation
**in the background** and navigates to the new workflow's canvas or skill's page, where
progress, `smithers graph` verification, and the structure check land. Do **not** build a
multi-panel generator modal — that was explicitly rejected; this is a launcher.

**Data:** posts to `/api/workflows/generate` or `/api/skills/generate` (both exist), then
routes to the entity page. `$` typeahead from `/api/skills`.

---

### 05 — Runs page (one feed, every trajectory)

**Purpose:** the standalone Runs section — answers "how is each skill doing?" and "show me
everything that touched this skill," aggregated *and* disaggregated.

**Layout:** full-app frame, `Runs` nav active.

- **SKILL SCORECARD** (the pivot, on top): a table sorted by **weakest lift first**. Columns:
  `SKILL · LIFT · WITH SKILL (x/y · avg) · WITHOUT · IN-WORKFLOW · UNLABELED · ▸`. The weakest
  skill (`laguna-task-contract −2%`) floats up with a `2 fails →` link; a selected/expanded
  skill row gets a `#0e1d2c` highlight. This makes "where should I spend attention" the first
  thing you see.
- **FACET CHIPS:** `type · skill · workflow · arm · verdict`. The prototype shows
  `skill: repo-map` active (cyan), demonstrating the aggregated view.
- **FEED** (same 6-column grammar as screen 02, columns:
  `TYPE (110px) · RECORD (1fr) · ARM/MODEL (230px) · TIMING (170px) · VERDICT (130px) ·
  LABEL (110px) · ▸`). One row per producer, color-coded TYPE tag:
  - `eval` (amber) — an **eval case card with its arms paired** (`xs_with_skill` +
    `xs_without_skill` as child rows) so per-case lift is visible at a glance.
  - `node` (slate) — in-workflow node grade, and standalone trials (`3/3 pass`).
  - `workflow` (cyan) — a run whose node installs the skill.
  - `playground` (green, tinted row `#0b1512`) — an ad-hoc try-it run, with a `+ eval case`
    promotion in the LABEL column.

This screen is where the "top-level skill run vs. skill-as-node-in-workflow run, aggregated
vs. disaggregated" question is answered — the dimension (skill) is a **facet of one feed**,
not spread across separate sections (which was the core complaint about the old UI).

**Data:** unify the existing producers — `/api/runs` (workflow), `/api/evals/runs` (arm-runs,
already carries validator status/score/checks/tokens), `/api/node-evals` (in-workflow +
standalone). Resolve each record's owning skill (eval cases already live under
`skills/<skill>/evals/<case>/`; workflow nodes via pool captures' `skillInstalled`). The
scorecard reuses the substrate's existing per-arm "skill lift" computation.

---

### 06 — Review mode (the annotation app, absorbed)

**Purpose:** the keyboard-first trace-annotation experience (currently the separate light-
themed app on port 8901) re-themed to match and deep-linked from any failing run row.

**Layout:** full-app frame, `Review` nav active.

- **Mode bar:** `← back to runs`, the case name, the arm + `graded FAIL` + skill pills, and —
  critically — position **within the current facet**: `2 of 3 unlabeled in fails ·
  ci-log-reducer` (NOT a global "1 of 32"). A `Gold: on` toggle.
- **Body:** center content + a **trajectory rail (320px)** on the right.
  - **Center:** a red failure banner (`#1d100f`, `3px #ff8a80` left border) naming the failing
    check; PROMPT (plain text); then **OUTPUT ARTIFACT — MODEL VS GOLD** as a **field-by-field
    table** (columns `FIELD · MODEL OUTPUT · GOLD REFERENCE`), with the differing field rows
    tinted (model `#190d0c`, gold `#0c1812`). This is the high-value part of the old :8901 app
    worth preserving — keep it.
  - **Trajectory rail** (`#0c121a`): the `session.start … tool_call … thought` step tree, mono,
    with one step expandable to show the decisive moment.
- **LABEL BAR** (bottom, high-contrast `#101f30`/`#1e3349`): prev/next arrows, **Pass** (green)
  / **Fail** (red `#c0392b`) / **Defer** buttons, a resizable notes `<textarea>` ("Routes to
  the skill's improvement queue"), and a keyboard-hint line
  (`←→ nav · 1 pass · 2 fail · D defer · U undo · ⌘↵ save+next`). Preserve all the existing
  keyboard shortcuts from `harness/review/`.

**Data:** reuse `harness/review/` (`traces.json` + `labels.json`, the `/api/review/*`
endpoints, the extract/sync flow). The change is presentational (theme) + integration:
deep-link in from a run row carrying the filter context, and on save route the label/note to
the skill's improvement queue (the input to the future DSPy/GEPA prompt-optimization loop).

---

## Interactions & Behavior

- **Navigation:** the four nav items switch top-level sections. A skill name anywhere links to
  its skill page; a workflow name to its canvas; a run hash to the run; a failing row to
  Review mode (carrying the current facet as context).
- **Canvas chat:** NL message → model rewrites the `.tsx` → diff shown → accept/revert → graph
  re-verified with `smithers graph`.
- **`$` typeahead:** typing `$` anywhere in a prompt/description field opens a skill picker
  (name + description + record); selecting inserts the reference and (in a node) installs it.
- **Sticky run header (SPEC):** screen 02, described above.
- **Background generation (SPEC):** screen 04 — Enter navigates immediately; work continues
  server-side and results stream onto the destination page.
- **Grading:** Pass/Fail/Defer auto-save (keyboard `1`/`2`/`D`, `U` undo, `⌘↵` save+next).
- **Suggest fix / Suggest improvements:** sends the trajectory to laguna-m.1; the proposal
  appears in the target skill's improvement queue, accepted as a new version.

## State Management

- Active section (Skills/Workflows/Runs/Review) and selected entity (skill / workflow / run).
- Selected node within a workflow (drives the inspector).
- Run table expand/collapse state (which run, which node row).
- Facet filter state on the Runs page (type/skill/workflow/arm/verdict) — should be URL-
  encoded so a filtered Runs view and a Review session are linkable/shareable.
- Review position within the current facet + label/note drafts (auto-saved).
- Liveness polling for in-flight harness runs (the substrate already exposes this via pid
  checks; the UI polls `/api/evals/runs`).

## Design Tokens

**Colors**
- Backgrounds (darkest→lighter): `#07090d` (page) · `#0a0f16` · `#0b1118` · `#0c121a` ·
  `#0d141d` · `#0e1b28` (elevated/active rows) · `#101f30` (action bars).
- Borders (subtle→prominent): `#111a24` · `#151e2a` · `#161f2c` · `#1c2c3e` · `#1e3349` ·
  `#243348` · `#25516e` (focus).
- Text: `#ffffff` (emphasis) · `#dfe9f2` (primary) · `#c4d2de` · `#9fb2c4` (secondary) ·
  `#8fa7ba` · `#7d91a4` · `#5d7186` (muted) · `#3a4f62` (faint labels).
- Accents: **cyan `#3ec6f2`** (primary action / selection / workflows), **green `#38c08a`**
  (pass / skills / playground), **red `#ff8a80`** (fail text) & **`#c0392b`** (Fail button),
  **amber `#e8b13f`** (improvement / suggest / ungraded).
- Tinted surfaces: cyan `#0f2433`/`#0e1d2c`, green `#0e2318`/`#0b1512`, red `#2d1513`/`#1d100f`,
  amber `#15110a`/`#1d1810`.

**Typography**
- UI / prose: **Helvetica Neue** (system Helvetica/Arial fallback). Sizes: 11–15px body,
  19px section headers, 24–56px page titles. Weights 400/600/700.
- Code / data / labels: **JetBrains Mono** (Google Fonts, weights 400/500/700). 9–13px.
  Uppercase mono micro-labels use `letter-spacing: 0.12–0.16em`, color `#3a4f62`/`#5d7186`.

**Radius:** small/flat throughout — `2–3px` (chips, buttons, inner boxes), `4px` (cards),
`6px` (outer frames), `999px` (pills/status). Keep it flat; earlier rounder values were
dialed back to reduce visual noise.

**Spacing:** 8/10/12/14/16/18/20/24px rhythm. Section gaps 72–88px. App frames are 1480px
min-width (wide desktop tool); content max-widths 860–1620px.

**Shadows:** card elevation `0 24px 80px rgba(0,0,0,0.5)`; sticky header
`0 2px 12px rgba(0,0,0,0.4)`; selection glow `0 0 0 3–5px rgba(62,198,242,0.08–0.1)`.

## Assets

No raster assets. The `ps` logo is a mono text badge (`#122433` bg, `#3ec6f2` text). All
graph edges are inline SVG `<line>`s. All icons are unicode glyphs (▸ ▴ ▾ ✓ ✗ ✦ ↺ ↩ ←→ ⌘).
Use your codebase's existing icon set if you prefer; none are load-bearing.

## Files

- `Hi-fi Screens v1.dc.html` — the six redesigned screens (build target).
- `UX Audit & IA Proposal.dc.html` — audit findings, concept map, contextual-gravity matrix,
  three IA directions + recommendation (the rationale).
- `support.js` — the prototype runtime (lets the `.dc.html` files render in a browser). **Not
  part of the target app** — do not port it.

In the live repo, the surfaces these replace are: `workflows.html` + `ui/workflows.js` +
`styles.css` (workbench), `index.html` (catalog), and `harness/review/app/index.html` +
`harness/review/serve.py` (the annotation app). The API surface to build against is in
`ui/server.ts`.
