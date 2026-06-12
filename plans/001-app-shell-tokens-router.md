# Plan 001: App shell — four-noun nav, design tokens, hash router, review proxy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in "STOP conditions" occurs, stop and report — do
> not improvise. When done, update this plan's status row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8fe6fd5..HEAD -- workflows.html ui/server.ts ui/workflows.js styles.css`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (every other plan in this series mounts into this shell)
- **Effort**: M
- **Risk**: MEDIUM (replaces the workbench's main page; mitigated by a legacy escape hatch)
- **Depends on**: none
- **Blocks**: plans 002–008
- **Planned at**: commit `8fe6fd5`, 2026-06-11

## Why this matters

The design handoff at
`.resources/handoff/design_handoff_skills_workbench/README.md` (read its
"Overview", "The system", and "Design Tokens" sections before starting)
collapses three disconnected surfaces — the static catalog (`index.html`),
the workbench (`workflows.html`), and the separately-themed annotation app
(`harness/review/`) — into **one app with four nouns: Skills · Workflows ·
Runs · Review**, plus a `⌘K` launcher. This plan builds the frame: the top
nav, the design-token stylesheet, a hash router with URL-encoded state, the
ES-module view contract that plans 002–008 fill in, and the server-side
proxy to the review app's data (consumed by plans 003 and 008).

## Context for an executor with zero prior knowledge

- This repo is a skill library + eval harness. The workbench is a local dev
  tool: `bun ui/server.ts` serves `workflows.html` at
  `http://127.0.0.1:4319/workflows.html`, with JSON routes over `ui/lib.ts`.
- `ui/lib.ts` (1663 lines) is the data substrate — **do not modify it in
  this plan**. `ui/server.ts` (220 lines) is the HTTP layer — this plan
  makes small additions to it. `ui/workflows.js` (643 lines, vanilla IIFE)
  is the current frontend — this plan preserves it as a legacy page and
  builds the new shell alongside it.
- `styles.css` is **shared with the static GitHub-Pages catalog**
  (`index.html`, `skill.html`). The handoff keeps the catalog separate, so
  this plan creates a NEW stylesheet (`ui/workbench.css`) and leaves
  `styles.css` untouched. Do not edit `styles.css`.
- The hi-fi visual reference is
  `.resources/handoff/design_handoff_skills_workbench/Hi-fi Screens v1.dc.html`
  (open in a browser via any static server if you want to see the target;
  its `support.js` runtime is prototype-only — never port it).

## Current state (verified excerpts at `8fe6fd5`)

`ui/server.ts` lines 62–69 — static file allowlist:

```ts
const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/skill.html": "skill.html",
  "/workflows.html": "workflows.html",
  "/styles.css": "styles.css",
  "/ui/workflows.js": "ui/workflows.js",
};
```

`ui/server.ts` lines 41–60 — the review companion server is auto-started
(`ensureReviewServer()` spawns `uv run harness/review/serve.py --port 8901`
detached). `GET /api/review/status` and `POST /api/review/sync` already
exist. There is **no proxy** for the review data endpoints yet — the review
app on port 8901 serves `GET /api/traces`, `GET /api/labels`,
`POST /api/labels`, `GET /api/version` (see `harness/review/serve.py`,
docstring lines 1–17).

`workflows.html` is a marketing-styled page (hero copy, side panels) with a
nav of `Catalog / Workbench / Evals / GitHub`. `ui/workflows.js` is one IIFE
with helpers `esc`, `fmtDuration`, `fmtAgo`, `statusPill`, `trajectoryLink`,
and an `api()` fetch wrapper (lines 7–80) — these are proven and get copied
into the new `ui/app.js` verbatim.

POSTs are CSRF-gated by an Origin check in `server.ts` (lines 127–143):
same-origin or no Origin (curl) only. Your new POST route inherits this
automatically if you add it inside the existing `if (req.method === "POST")`
block **after** the origin check.

## Design spec (binding values from the handoff)

Top bar: `ps` logo as a mono text badge (`#122433` bg, `#3ec6f2` text), four
nav nouns `Skills · Workflows · Runs · Review`, a project picker, and a
`+ New ⌘K` button at the right. App frame min-width 1480px. Radius small/flat:
2–3px chips/buttons, 4px cards, 6px outer frames, 999px pills. UI font
Helvetica Neue (system fallback); code/labels JetBrains Mono (Google Fonts,
400/500/700). Uppercase mono micro-labels: 10px, `letter-spacing .12–.16em`,
color `#3a4f62`/`#5d7186`.

## Step 1 — Preserve the existing page as a legacy escape hatch

1. Copy `workflows.html` to `workflows-legacy.html` (exact copy, then change
   its `<title>` to `Workbench (legacy) - Poolside Skills`).
2. In `ui/server.ts` `STATIC_FILES`, add:
   `"/workflows-legacy.html": "workflows-legacy.html",`

`ui/workflows.js` stays untouched and keeps powering the legacy page until
plan 008's cleanup step removes both.

**Verify**: `UI_PORT=4799 bun ui/server.ts & sleep 1;
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4799/workflows-legacy.html; kill %1`
→ prints `200`.

## Step 2 — Serve `ui/*.js` and `ui/*.css` generically

In `ui/server.ts`, before the `STATIC_FILES` lookup in the fetch handler,
add a guarded static route so new view modules don't each need an allowlist
entry:

```ts
// Generic static for the workbench frontend: ui/**.js|css only, no traversal.
if (req.method === "GET" && /^\/ui\/[A-Za-z0-9_\/-]+\.(js|css)$/.test(url.pathname)) {
  const abs = join(REPO_ROOT, url.pathname.slice(1));
  if (abs.startsWith(join(REPO_ROOT, "ui") + "/") && existsSync(abs)) {
    return new Response(Bun.file(abs), { headers: { "content-type": contentType(abs) } });
  }
}
```

You will need `import { existsSync } from "node:fs";` at the top of
`server.ts`. The regex already rejects `.` so `..` traversal cannot match;
the `startsWith` check is belt-and-braces.

**Verify**: with the server running as above,
`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4799/ui/workflows.js`
→ `200`, and
`curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:4799/ui/../ui/lib.ts"`
→ `404` (curl normalizes the path; also test
`curl --path-as-is -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:4799/ui/%2e%2e/lib.ts"`
→ `404`).

## Step 3 — Create `ui/workbench.css` (the token sheet)

Create `ui/workbench.css`. The `:root` block below is **the spec** — copy it
exactly; every later plan references these variable names:

```css
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap");

:root {
  color-scheme: dark;
  /* backgrounds, darkest → lighter */
  --bg-page: #07090d;
  --bg-1: #0a0f16;
  --bg-2: #0b1118;
  --bg-3: #0c121a;   /* rails */
  --bg-4: #0d141d;   /* inspector */
  --bg-elevated: #0e1b28;
  --bg-action: #101f30;
  /* borders, subtle → prominent */
  --line-0: #111a24;
  --line-1: #151e2a;
  --line-2: #161f2c;
  --line-3: #1c2c3e;
  --line-4: #1e3349;
  --line-5: #243348;
  --line-focus: #25516e;
  /* text */
  --text-hi: #ffffff;
  --text-0: #dfe9f2;
  --text-1: #c4d2de;
  --text-2: #9fb2c4;
  --text-3: #8fa7ba;
  --text-4: #7d91a4;
  --text-muted: #5d7186;
  --text-faint: #3a4f62;
  /* accents */
  --cyan: #3ec6f2;     /* primary action / selection / workflows */
  --green: #38c08a;    /* pass / skills / playground */
  --red: #ff8a80;      /* fail text */
  --red-btn: #c0392b;  /* Fail button */
  --amber: #e8b13f;    /* improvement / suggest / ungraded */
  /* tinted surfaces */
  --tint-cyan-1: #0f2433;  --tint-cyan-2: #0e1d2c;
  --tint-green-1: #0e2318; --tint-green-2: #0b1512;
  --tint-red-1: #2d1513;   --tint-red-2: #1d100f;
  --tint-amber-1: #15110a; --tint-amber-2: #1d1810;
  /* type */
  --font-ui: "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  /* shadows */
  --shadow-card: 0 24px 80px rgba(0, 0, 0, 0.5);
  --shadow-sticky: 0 2px 12px rgba(0, 0, 0, 0.4);
  --glow-select: 0 0 0 4px rgba(62, 198, 242, 0.09);
}
```

Then add (same file) the shell + shared primitives. Required class contract
(later plans use these names — keep them exact):

- `body.workbench` — `background: var(--bg-page); color: var(--text-0);
  font: 13px/1.5 var(--font-ui); margin: 0; min-width: 1480px;`
- `.topbar` — flex row, `background: var(--bg-1); border-bottom: 1px solid
  var(--line-2); padding: 0 20px; height: 52px; align-items: center;
  gap: 18px; position: sticky; top: 0; z-index: 50;`
- `.topbar .brand-mark` — mono badge: `font-family: var(--font-mono);
  background: #122433; color: var(--cyan); padding: 3px 7px;
  border-radius: 3px; font-weight: 700; font-size: 12px;`
- `.topbar nav a` — `color: var(--text-4); padding: 6px 10px;
  border-radius: 3px; font-size: 13px; text-decoration: none;` and
  `.topbar nav a.active { color: var(--text-hi); background: var(--bg-elevated); }`
- `.mono-label` — `font-family: var(--font-mono); font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted);
  font-weight: 500;`
- `.pill` — `border-radius: 999px; font-family: var(--font-mono);
  font-size: 10px; padding: 2px 9px; border: 1px solid var(--line-3);
  color: var(--text-3);` with modifiers `.pill.ok { color: var(--green);
  border-color: #1d4a36; }`, `.pill.bad { color: var(--red);
  border-color: #4a2522; }`, `.pill.live { color: var(--cyan);
  border-color: #1d4a63; }`, `.pill.warn { color: var(--amber);
  border-color: #4a3d1d; }`
- `.btn` — `border-radius: 3px; border: 1px solid var(--line-4);
  background: var(--bg-elevated); color: var(--text-1); padding: 6px 12px;
  font: 12px var(--font-ui); cursor: pointer;` with modifiers
  `.btn.primary { background: var(--cyan); border-color: var(--cyan);
  color: #06222e; font-weight: 600; }`,
  `.btn.suggest { background: var(--amber); border-color: var(--amber);
  color: #1a1405; font-weight: 600; }`,
  `.btn.danger { background: var(--red-btn); border-color: var(--red-btn);
  color: #fff; font-weight: 600; }`,
  `.btn.pass-tint { background: var(--tint-green-1); border-color: #2a5c42;
  color: var(--green); }`
- `.panel` — `background: var(--bg-2); border: 1px solid var(--line-2);
  border-radius: 4px;`
- `.offline-banner` — visible error strip (reuse the copy from the current
  `#wf-offline` div in `workflows.html`).

**Verify**: file exists and is served:
`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4799/ui/workbench.css` → `200`.

## Step 4 — Rewrite `workflows.html` as the app shell

Replace the entire body with:

```html
<body class="workbench">
  <header class="topbar">
    <a class="brand" href="#/workflows"><span class="brand-mark">ps</span></a>
    <nav id="top-nav" aria-label="Primary">
      <a href="#/skills" data-view="skills">Skills</a>
      <a href="#/workflows" data-view="workflows">Workflows</a>
      <a href="#/runs" data-view="runs">Runs</a>
      <a href="#/review" data-view="review">Review</a>
    </nav>
    <select id="project-pick" title="Workflow project"></select>
    <span style="flex:1"></span>
    <button id="new-button" class="btn primary" type="button">+ New ⌘K</button>
  </header>
  <div id="offline" class="offline-banner" hidden>
    The local API server is not running. Start it with <code>bun ui/server.ts</code>, then reload.
  </div>
  <main id="view"></main>
  <script type="module" src="ui/app.js"></script>
</body>
```

Head: keep charset/viewport, title `Workbench - Poolside Skills`, replace
the stylesheet link with `<link rel="stylesheet" href="ui/workbench.css">`.
Do NOT link `styles.css`.

## Step 5 — Create `ui/app.js` (router + helpers + view mounting)

This file defines the **view module contract** all later plans implement.
Structure:

1. **Helpers** — copy `esc`, `fmtDuration`, `fmtAgo`, `statusPill`,
   `trajectoryLink`, and `api` from `ui/workflows.js` lines 7–80 verbatim
   (change `wf-pill` to `pill` in `statusPill`'s template string to match
   the new CSS contract).
2. **Routes** — hash format `#/<view>[/<id>][?k=v&…]`:

```js
export function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "") || "workflows";
  const [pathPart, queryPart] = hash.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  return {
    view: segments[0] || "workflows",
    id: segments.length > 1 ? decodeURIComponent(segments.slice(1).join("/")) : null,
    params: new URLSearchParams(queryPart || ""),
  };
}
export function navigate(path) { location.hash = path.startsWith("#") ? path : `#${path}`; }
```

   (`id` joins the remaining segments so workflow paths like
   `.smithers/workflows/foo.tsx` survive — views must `encodeURIComponent`
   the id when building links.)
3. **View registry** — static imports:

```js
import * as skillsView from "./views/skills.js";
import * as workflowsView from "./views/workflows.js";
import * as runsView from "./views/runs.js";
import * as reviewView from "./views/review.js";
const VIEWS = { skills: skillsView, workflows: workflowsView, runs: runsView, review: reviewView };
```

4. **Mounting** — on `hashchange` and boot: call the previous view's cleanup
   (if it returned one), look up `VIEWS[route.view]` (unknown view →
   `navigate("/workflows")`), set `aria-current`/`.active` on the matching
   `#top-nav a`, then:

```js
state.cleanup = await view.mount(document.getElementById("view"), {
  project: state.project,
  id: route.id,
  params: route.params,
  navigate,
  helpers: { api, esc, fmtDuration, fmtAgo, statusPill, trajectoryLink },
});
```

   **View module contract (binding for plans 002–008)**: each
   `ui/views/<name>.js` exports `async function mount(container, ctx)`;
   `mount` renders into `container` and may return a cleanup function
   (called before the next mount — clear your poll timers there). Nothing
   else is required.
5. **Project picker** — fetch `/api/projects` at boot, populate
   `#project-pick`, default to the first project, persist the choice in
   `localStorage["wb-project"]`, and re-mount the current view on change.
   On fetch failure show `#offline` and stop.
6. **`#new-button`** — for now: `onclick = () => alert("⌘K launcher lands in plan 007")`.
   (Plan 007 replaces this.)

## Step 6 — Create the four view stubs

Create `ui/views/skills.js`, `ui/views/workflows.js`, `ui/views/runs.js`,
`ui/views/review.js`, each exactly:

```js
export async function mount(container, ctx) {
  container.innerHTML = `<section class="panel" style="margin:24px;padding:32px">
    <span class="mono-label">VIEW</span>
    <h1 style="font-size:24px;font-family:var(--font-mono)">${"<name>"}</h1>
    <p style="color:var(--text-4)">This view is built by plan ${"<NNN>"}.
      The legacy workbench remains at <a href="/workflows-legacy.html" style="color:var(--cyan)">/workflows-legacy.html</a>.</p>
  </section>`;
}
```

(with `<name>`/`<NNN>` filled in: workflows→002/003, skills→005,
runs→006, review→008).

**Verify**: `bun build ui/app.js --outdir /tmp/wb-check` → exits 0 (this
parses `app.js` and all four imported views; any syntax error fails here).

## Step 7 — Review data proxy in `ui/server.ts`

Add three GET routes and one POST route that forward to the review server
(which `ensureReviewServer()` already auto-starts on port 8901). Place a
helper near `reviewRunning()`:

```ts
async function proxyReview(path: string, init?: RequestInit): Promise<Response> {
  const target = `http://127.0.0.1:${REVIEW_PORT}${path}`;
  try {
    const res = await fetch(target, { ...init, signal: AbortSignal.timeout(10_000) });
    return new Response(await res.arrayBuffer(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    void ensureReviewServer();
    return json({ error: "review server not reachable; starting it — retry in a few seconds" }, 503);
  }
}
```

Routes (GET block): `/api/review/traces` → `proxyReview("/api/traces")`,
`/api/review/labels` → `proxyReview("/api/labels")`,
`/api/review/version` → `proxyReview("/api/version")`.
Route (POST block, **after** the origin check):
`/api/review/labels` → `proxyReview("/api/labels", { method: "POST",
body: await req.text(), headers: { "content-type": "application/json" } })`.

Keep the existing `/api/review/status` and `/api/review/sync` routes as-is.

**Verify** (server running; review data may not exist yet — a 404 with the
"run extract_traces.py first" error from serve.py is also a correct
round-trip):

```sh
curl -s http://127.0.0.1:4799/api/review/version          # → {"traces": ..., "labels": ...}
curl -s -X POST http://127.0.0.1:4799/api/review/labels \
  -H 'content-type: application/json' \
  -d '{"trace_id":"plan001-smoke","label":"defer"}'        # → {"ok": true, ...}
curl -s http://127.0.0.1:4799/api/review/labels | head -3  # contains plan001-smoke
curl -s -X POST http://127.0.0.1:4799/api/review/labels \
  -H 'content-type: application/json' \
  -d '{"trace_id":"plan001-smoke","label":null,"notes":""}' # cleanup → entry removed
```

If the first POST returns the 503 "starting it" response, wait 3s and retry
once — `uv run` cold-start is real.

## Done criteria (all machine-checkable except the last)

1. `bun build ui/app.js --outdir /tmp/wb-check` exits 0.
2. `UI_PORT=4799 bun ui/server.ts` then: `/workflows.html`, `/ui/app.js`,
   `/ui/workbench.css`, `/ui/views/skills.js`, `/workflows-legacy.html`,
   `/ui/workflows.js` all return 200; `/ui/%2e%2e/lib.ts` (with
   `--path-as-is`) returns 404.
3. `curl -s http://127.0.0.1:4799/api/review/version` returns JSON (not the
   generic `{"error":"not found"}` 404).
4. The label write/read/cleanup round-trip in Step 7 succeeds.
5. Existing routes unchanged: `curl -s http://127.0.0.1:4799/api/skills | head -1`
   still returns a JSON array.
6. Manual browser check at `http://127.0.0.1:4799/workflows.html`: dark
   `#07090d` page, top bar with ps badge + four nav items + project picker +
   `+ New ⌘K`; clicking each nav item swaps the stub and updates the hash;
   reloading on `#/skills` lands on the skills stub (router works from a
   cold hash); the legacy page still fully works.

## Hard boundaries

- Do not modify: `ui/lib.ts`, `ui/bench.ts`, `styles.css`, `index.html`,
  `skill.html`, anything under `harness/`, `skills/`, `scripts/`, `evals/`,
  `schemas/`, `docs/`.
- Do not port or copy anything from
  `.resources/handoff/design_handoff_skills_workbench/support.js`.
- Do not remove or rename any existing API route (bench.ts and the legacy
  page depend on them).
- Do not add npm dependencies; bun builtins + browser platform only.
- Do not commit; leave changes in the working tree.

## Test plan

No JS test framework exists in this repo (that is a known gap, out of scope
here). The gates are the build check, the curl matrix above, and the manual
browser checklist. Record the curl outputs in your final report.

## Maintenance note

The `:root` token block and the view-module contract are load-bearing for
plans 002–008 — if you must deviate (renamed variable, changed ctx shape),
update this section of every dependent plan or STOP and report. The generic
`/ui/*` static route means new view files need no server change.

## STOP conditions

- The drift check shows `workflows.html` or `ui/server.ts` materially
  changed since `8fe6fd5`.
- `bun ui/server.ts` fails to start on a fresh checkout (broken baseline —
  report, don't fix).
- The review proxy round-trip fails even after retries with
  `uv run harness/review/serve.py --port 8901` confirmed running manually.
