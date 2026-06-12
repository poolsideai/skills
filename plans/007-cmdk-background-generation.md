# Plan 007: ⌘K launcher + background generation (handoff screen 04)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8fe6fd5..HEAD -- ui/lib.ts ui/server.ts`
> Plan 001 must be applied (the `+ New ⌘K` button currently shows a
> placeholder alert — this plan replaces it).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MEDIUM (new detached worker; existing sync generate endpoints stay untouched for bench.ts/legacy compatibility)
- **Depends on**: plan 001. Independent of 002/005 (destination pages
  enhance the experience when present; a global completion toast makes
  this plan self-sufficient).
- **Planned at**: commit `8fe6fd5`, 2026-06-11

## Why this matters

Screen 04 of the design handoff
(`.resources/handoff/design_handoff_skills_workbench/README.md`, section
"04 — ⌘K" — read it now): authoring a skill or workflow is the product's
most important action, and today it's buried in side-panel forms that
**block the browser tab for 30s–minutes** — `POST /api/workflows/generate`
and `/api/skills/generate` are synchronous (`ui/server.ts` lines 146–172
await `generateWorkflow`/`generateSkill` end-to-end). The handoff's
behavior spec: Enter starts generation **in the background** and navigates
immediately to the destination page. It is equally explicit about what NOT
to build: "Do **not** build a multi-panel generator modal — that was
explicitly rejected; this is a launcher."

## Context

- Plan 001 contracts apply (`ui/app.js` owns the topbar and global key
  handling; views are plug-ins).
- House pattern for detached jobs: `startEvalRun` (`ui/lib.ts` lines
  919–965) — spawn with log-fd, pid sidecar, `pidAlive` liveness. Plans
  004/005 reuse it; this plan does too.
- Slug logic to replicate exactly (destinations must be computable
  *before* the worker finishes):
  - workflow id (`generateWorkflow`, lib.ts 567–573):
    `(options.id || request).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "generated-workflow"`,
    target `.smithers/workflows/<id>.tsx`.
  - skill name (`generateSkill`, lib.ts 746–750):
    `name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")`.
- `generateWorkflow` / `generateSkill` are exported from `ui/lib.ts` — the
  worker imports and calls them unchanged (they already contain the
  verify/repair/rollback gates; do not reimplement any of that).
- Visual reference: section `data-screen-label="04 ⌘K Composer"` in the
  hi-fi prototype — a single input bar, two example rows (cyan `/workflow`
  chip, green `/skill` chip), each ending in a mono `↵ create`.

## Data contracts (binding)

```
runs/.generate/gen-<tag>.json     pid sidecar: { pid, kind, params, destination, logPath, startedAtMs }
runs/.generate/gen-<tag>.log      worker output
runs/.generate/gen-<tag>.result.json   the generate function's return value, written on completion
```

`POST /api/generate/start` body:
`{ kind: "workflow"|"skill", prompt, project?, id?, name?, agentName?, smoke? }`
→ `{ ok: true, tag, kind, destination }` where `destination` is
`{ route: "#/workflows/<encoded relPath>", path: <relPath> }` or
`{ route: "#/skills/<name>", name }`.
`GET /api/generate/status?tag=` →
`{ tag, kind, destination, running, startedAtMs, result: <result.json contents | null> }`.

## Step 1 — `ui/generate.ts` (the worker)

New file. Argv: `bun ui/generate.ts --params <abs params.json> --out <abs result path>`.
Params = the start body plus the resolved `project` id. Logic:

1. `--smoke` in params (`smoke: true`): write
   `{ ok: false, error: "smoke run — no model call", attempts: [] }` to
   `--out` (atomic tmp+rename) and exit 0. This is the permanent no-spend
   pipeline test.
2. `kind === "workflow"` → `await generateWorkflow(getProject(params.project ?? null), params.prompt, { id: params.id, agentName: params.agentName })`.
   `kind === "skill"` → `await generateSkill(params.name, params.prompt, { agentName: params.agentName })`.
3. Write the returned object to `--out` (atomic). A thrown error → write
   `{ ok: false, error: String(error).slice(0, 1200) }` and still exit 0
   (the result file is the channel; a nonzero exit means the worker itself
   broke).

**Verify**:
`echo '{"kind":"skill","name":"x","prompt":"y","smoke":true}' > /tmp/gen.json && bun ui/generate.ts --params /tmp/gen.json --out /tmp/gen-out.json && cat /tmp/gen-out.json`
→ the smoke result JSON.

## Step 2 — `ui/lib.ts`: start + status

- `startGenerate(options)`: validate (`kind` in the two values; `prompt`
  required; `kind==="skill"` additionally requires `name`, and reject if
  `skills/<safeName>` already exists — same 409 as `generateSkill`).
  Compute `destination` with the slug logic above. Write the params file,
  spawn the worker detached (log-fd + sidecar pattern; sidecar includes
  `kind`, `destination`, `params` minus nothing secret — there are no
  secrets in it). Return `{ ok, tag, kind, destination }`.
- `generateStatus(tag)`: validate `/^[a-z0-9]+$/`; read sidecar (404 if
  missing), read `gen-<tag>.result.json` if present →
  `{ ...sidecar, running: pidAlive(pid) && !result, result }`.

Server routes: POST `/api/generate/start` (origin-checked block) and GET
`/api/generate/status?tag=`. **Do not remove or change**
`/api/workflows/generate` and `/api/skills/generate` — `ui/bench.ts`
(`workflow-generate`, `skill-generate`) and the legacy page call them.

**Verify** (server on 4799, no pool spend):

```sh
curl -s -X POST http://127.0.0.1:4799/api/generate/start \
  -H 'content-type: application/json' \
  -d '{"kind":"workflow","prompt":"smoke test workflow","smoke":true}'
# → {"ok":true,"tag":"…","destination":{"route":"#/workflows/.smithers%2Fworkflows%2Fsmoke-test-workflow.tsx", …}}
sleep 2
curl -s "http://127.0.0.1:4799/api/generate/status?tag=<tag>"
# → running:false, result.ok:false, result.error:"smoke run — no model call"
curl -s "http://127.0.0.1:4799/api/generate/status?tag=zzzz" -o /dev/null -w "%{http_code}\n"  # 404
```

(Exact URL-encoding of the destination route may differ — assert the
decoded path, not the byte string.)

## Step 3 — the palette (`ui/app.js` + `ui/workbench.css`)

All in the shell, not a view (it opens from anywhere):

- **Open**: `⌘K`/`Ctrl+K` keydown (ignore when focus is in an
  input/textarea **unless** it's the palette's own input) and the
  `#new-button` click (replace plan 001's placeholder alert). **Close**:
  Esc, scrim click.
- **Markup**: a fixed overlay (`z-index: 100`, scrim
  `rgba(0,0,0,0.6)`) containing one centered input bar
  (`max-width: 860px; width: 90%;` background `var(--bg-4)`, border
  `1px solid var(--line-focus)`, radius 6px) and a result row beneath it.
- **Parsing** (live, on input):
  - `/workflow <description>` → row: cyan chip `/workflow` + the
    description + mono `↵ create`. Destination preview:
    `creates .smithers/workflows/<slug>.tsx` (slug per the workflow rule).
  - `/skill <name>: <description>` → green chip `/skill` + preview
    `creates skills/<safeName>`. Without a colon, slug the first four
    words as the name and show it in the preview (the user sees exactly
    what Enter will do).
  - Anything else → hint row: `Type /workflow or /skill followed by a
    description · $skill-name autocompletes`.
  - `$` typeahead: when the token under the caret starts with `$`, show a
    dropdown of `/api/skills` matches (name + one-line description +
    with/without record, same row format as plan 002's inspector
    typeahead); selection inserts `$<name>` into the text. The reference
    is passed through verbatim in the prompt — `generateWorkflow`'s
    authoring prompt already receives the full skill catalog, so naming a
    skill in the description steers node skill installs.
- **Enter**: POST `/api/generate/start` (with `project` =
  `state.project`, `agentName` defaulted to `"laguna-m.1"`); on `ok`,
  push `{tag, kind, destination, label}` onto a `localStorage`-backed
  pending list, `navigate(destination.route + "?generating=" + tag)`,
  close the palette.
- **Completion watcher** (also in `app.js`): every 5s, if the pending list
  is non-empty, poll each tag's status; when `running` is false, remove it
  and render a topbar toast pill — `result.ok` →
  `.pill.ok` `"<label> ready ✓"` linking to the destination route;
  `!result.ok` → `.pill.bad` `"<label> failed — view log"` whose click
  shows `result.error` + `result.attempts` in an overlay. The watcher
  survives reloads (localStorage) and runs regardless of which view is
  mounted — this is what makes the plan independent of 002/005.
- Views may *additionally* read `?generating=<tag>` to show inline
  progress (plans 002/005 destinations); do not block on that here.

**Verify**: `bun build ui/app.js --outdir /tmp/wb-check` exits 0.

## Done criteria

1. Worker smoke + both curl checks pass; sidecar, log, and result files
   appear under `runs/.generate/`.
2. Manual: `⌘K` opens the palette from every view; Esc closes; typing
   `/workflow run repo-map then summarize` shows the cyan chip + correct
   slug preview; typing `$rep` pops the typeahead with `repo-map` and its
   record; Enter (with `"smoke": true` temporarily hard-wired if pool is
   authenticated and you must avoid spend) navigates to
   `#/workflows/...?generating=<tag>` and, ~5s later, the failure toast
   appears with the smoke error — proving the full loop without a model
   call.
3. One live generation (optional, pool spend): `/workflow …` produces a
   verified `.tsx`, the success toast links to the canvas, and the file
   exists under `.smithers/workflows/`.
4. `bun ui/bench.ts workflow-generate --help`-path unaffected: the old
   sync endpoints still answer (curl `/api/workflows/generate` with a
   missing prompt → the existing 400, not 404).

## Hard boundaries

- Files in scope: `ui/generate.ts`, `ui/app.js`, `ui/workbench.css`,
  `ui/lib.ts` (start/status only), `ui/server.ts` (two routes).
- Do not modify `generateWorkflow`/`generateSkill` themselves — their
  verification gates (smithers graph; check_skill_structure.py) are the
  product's authoring guarantee and the worker inherits them by calling,
  not copying.
- No multi-panel generator modal. One input bar. (Explicitly rejected in
  the handoff.)
- Do not break the synchronous endpoints or `ui/bench.ts`.

## Test plan

Done-criteria 1–2 are the no-spend test plan; 3 is the live check. Edge:
start a smoke generation, kill the server, restart it, and confirm the
completion watcher (localStorage) still resolves the toast — the sidecar
pattern exists precisely so restarts are safe.

## Maintenance note

The palette's slug previews duplicate the lib.ts slug rules by design
(client-side preview); if those rules ever change in lib.ts, update the
palette in the same commit. `runs/.generate/` sidecars accumulate —
acceptable (runs/ is gitignored); a later janitor can prune
`result`-bearing sidecars older than N days.

## STOP conditions

- Plan 001 not applied.
- `generateWorkflow`/`generateSkill` signatures changed since `8fe6fd5`.
- The completion watcher cannot distinguish "worker died" (sidecar pid
  dead, no result file) — if you hit this, render it as a failed toast
  with "worker died — see <logPath>", and report it; do not leave pending
  entries spinning forever.
