# Plan 005: Skills page — scorecard, contract tabs, try-it-now playground, improvement queue (handoff screen 03)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8fe6fd5..HEAD -- ui/lib.ts ui/server.ts`
> Plan 001 must be applied; plan 004 should be (the queue panel
> feature-detects and degrades if not).

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM (playground executes pool runs from a web form — detached, bounded, same trust level as the existing run/eval launchers)
- **Depends on**: plan 001 (shell); plan 004 (improvement queue panel — panel hides if its API 404s)
- **Planned at**: commit `8fe6fd5`, 2026-06-11

## Why this matters

Screen 03 of the design handoff
(`.resources/handoff/design_handoff_skills_workbench/README.md`, section
"03 — Skills page" — read it now) makes the skill a first-class surface:
read its contract, see its scorecard, **try it now**, and accept
model-proposed improvements. The handoff singles out the playground as "the
missing primitive … the zero-to-first-success path and the cheapest
trajectory producer" — today there is no way to run a skill against a
prompt at all; the closest thing is hand-crafting an eval case.

## Context

- Plan 001 contracts apply (view module, tokens, classes). Route owned
  here: `#/skills` (first skill auto-selected) and
  `#/skills/<name>?tab=<contract|cases|runs|usedin|versions>`. File:
  `ui/views/skills.js` (replace the plan-001 stub).
- Visual reference: section `data-screen-label="03 Skills page"` in the
  hi-fi prototype.
- Existing data (verified at `8fe6fd5`):
  - `GET /api/skills` → `SkillSummary & { evalSummary }`:
    `{ name, description, version, evalCases, validators[], schemas[],
    path, evalSummary: { withSkill: {pass,total,avgScore},
    withoutSkill: {...} } | null }` (lib.ts `listSkills` line 687 +
    `skillEvalSummaries` line 1159).
  - `GET /api/node-evals?project=` → per-project `NodeEvalRecord[]`
    (carries `skill`, `mode: "in-workflow"|"standalone"`, `status`).
  - `discoverProjects()` / `listNodeEvals(project)` in lib.ts let the
    server aggregate node-evals across projects.
  - `PoolAgent` (`experiments/smithers-pool/src/PoolAgent.ts`): options
    `{ cwd, agentName, id, logDir?, skill?: { name, from } }` — `skill`
    copies the skill (excluding `evals/`) into
    `<cwd>/.poolside/skills/<name>` before the run.
  - `gradeWorkspace(skill, workspace, fallbackExitCode)` (lib.ts line 1250,
    **not exported**) runs the skill's validator against a workspace with a
    scrubbed env — the playground's grader. Export it.
  - Eval-case fixtures: `skills/<skill>/evals/<case>/input/` is "the entire
    world the model sees" (CLAUDE.md); `expected/` mirrors workspace paths.
  - The detached-job house pattern: `startEvalRun` lib.ts lines 919–965
    (spawn + log fd + pid sidecar), reused by plan 004.
  - The generation pipeline for promoting cases:
    `harness/generate/gen_eval_cases.py` — candidates quarantine under
    `runs/generate/` and are **human-promoted**, never auto-merged
    (CLAUDE.md "Eval-case generation").

## Design spec (binding, from the handoff)

Three columns: **library rail (250px, `var(--bg-3)`) · detail (1fr) ·
right rail (390px, `var(--bg-3)`)**.

- **Library rail**: each skill = name (mono), lift % (cyan if positive, red
  if negative), one-line description. Selected: `background: #15212f;
  border: 1px solid #2b3e57;`. **Lift formula (used repo-wide, also by plan
  006)**: `(withSkill.pass/withSkill.total − withoutSkill.pass/withoutSkill.total) × 100`,
  rounded to whole percentage points, rendered `+N%` / `−N%`; null (render
  `—`) when either total is 0.
- **Detail header**: skill name (mono 24px 700) + `v<version>` pill +
  `structure ✓` pill + `View source` button (opens the SKILL.md text in a
  `<pre>` overlay). Description below.
- **Scorecard** = 4 tiles in a row: `WITH SKILL` (green accent: pass/total
  + avg score sub-stat), `WITHOUT` (red accent), `IN-WORKFLOW` (green;
  in-workflow node-eval pass/total), `LIFT` (cyan, accented tile
  `background: #0e1d29; border: 1px solid #1d4a63;`). Tile: big number +
  `.mono-label` caption + sub-stat line.
- **Tabs**: `Contract · Eval cases · Runs · Used in · Versions`.
  - Contract: first ~40 lines of SKILL.md in a mono box + a file list
    (schemas, validators, eval-case count) with `.pill.ok` status marks.
  - Eval cases: rows of `id · bucket · difficulty · expected_status`.
  - Runs: a link-through to `#/runs?skill=<name>` plus the skill's last 10
    eval arm-runs inline (status pill, arm, score, fmtAgo).
  - Used in: workflows whose source installs the skill (Step 1).
  - Versions: current version + accepted proposals from plan 004
    (newVersion, date, summary), newest first.
- **Right rail, panel 1 — TRY IT NOW** (green-bordered:
  `border: 1px solid #1a2e26; background: #0e1a18;`): prompt textarea,
  `workspace` select (`empty` + one entry per eval case's `input/`
  fixture), model select, green **Run** button. Results list under it:
  each playground record = status pill + score + fmtAgo + trajectory link +
  `+ eval case` button. Caption: "graded by the validator · promotable to
  an eval case".
- **Right rail, panel 2 — IMPROVEMENT QUEUE** (amber-bordered:
  `border: 1px solid #3a3014; background: #15110a;`): per proposal — the
  summary sentence, a SKILL.md diff (simple line diff current→proposed:
  removed lines `color: var(--red)` prefixed `−`, added `var(--green)`
  prefixed `+`; reuse plan 002's diff helper if present, else write the
  same ~20-line helper), then `Accept as v<next>` (`.btn.suggest`),
  `View evidence` (expands the proposal's evidence list), ✕ dismiss.
  Pending suggest jobs render as `.pill.live` rows. Footer note:
  "Accepting creates a draft version and re-runs the skill's eval suite."

## Step 1 — `ui/lib.ts`: skill detail + used-in + playground store/launch

Add a `// Skill detail + playground` section:

```ts
export type SkillDetail = {
  skill: SkillSummary & { evalSummary: SkillEvalSummary | null };
  skillMd: string;                       // full content, 40k cap
  inWorkflow: { pass: number; total: number };
  cases: { id: string; bucket: string | null; difficulty: string | null; expectedStatus: string | null }[];
  usedIn: { project: string; path: string; name: string }[];
};
```

- `skillDetail(name)`: 404 if `skills/<name>/SKILL.md` missing.
  `inWorkflow`: iterate `discoverProjects()`, `listNodeEvals(p)`, count
  records with `r.skill === name && r.mode === "in-workflow"` and
  `status !== "error"` as total, `status === "pass"` as pass. `cases`: read
  each `skills/<name>/evals/<case>/metadata.json` (`bucket`, `difficulty`,
  `validator.expected_status`). `usedIn`: for each project,
  `listWorkflows(p)`, read each `.tsx` (size-capped 200k) and match
  `new RegExp('skill:\\s*\\{[^}]*name:\\s*"' + name + '"')` — static
  source scan, no run data needed.
- `listPlayground(skill)` → records from `runs/playground/<skill>/*.json`
  (newest first) + pending sidecars from `runs/playground/.state/`
  (pidAlive pattern).
- `startPlayground(options: { skill, prompt, model?, fixtureCase?, smoke? })`:
  validate skill exists; if `fixtureCase`, validate
  `skills/<skill>/evals/<fixtureCase>/input` exists (reject anything with
  `/` or `..` in the case name). Write params JSON under
  `runs/playground/.state/`, spawn
  `bun ui/playground.ts --params <abs> --out <abs record path>` detached
  (log-fd + sidecar pattern), return `{ ok, tag }`.
- `promotePlayground(skill, id)`: read the record (404 if missing); build a
  candidate case directory
  `runs/generate/<skill>/playground-<id>/` containing `prompt.md` (the
  record's prompt), `input/` (copy of the fixture used, or empty dir),
  `expected/` (copy of the record workspace's `.laguna/` under
  `expected/.laguna/` — only if the workspace still exists, else 410), and
  a `metadata.json` stub (`id`, `skill`, `bucket: "candidate"`,
  `arms: ["xs_without_skill","xs_with_skill"]`,
  `validator: { command: ["bun", "skills/<skill>/scripts/<validator>"], expected_status: "pass" }`,
  `notes: "promoted from playground run <id> — review before gen_eval_cases.py --promote"`).
  Return the path + the exact follow-up command:
  `uv run harness/generate/gen_eval_cases.py --skill <skill> --validate-only <path>`.
  **This never writes into `skills/` or `evals/`** — quarantine only.
- Export `gradeWorkspace` (add `export`, no body change).

## Step 2 — `ui/playground.ts` (the detached worker)

New file, mirroring plan 004's worker conventions. Params:
`{ skill, prompt, model, fixtureCase?, smoke? }`.

1. `mkdtempSync` a workspace; if `fixtureCase`, `cpSync` the case's
   `input/` contents into it.
2. Unless `smoke`: `new PoolAgent({ cwd: workspace, agentName: model,
   id: "pool:playground:<skill>", logDir: join(REPO_ROOT, "runs",
   "playground", ".captures"), skill: { name: skill, from:
   join(REPO_ROOT, "skills", skill) } })`, then
   `await agent.generate({ prompt })` in a try/catch (record the error as
   `note`, exit code 1 semantics — copy `evalNodeStandalone`'s handling,
   lib.ts lines 1612–1626).
3. Grade: `gradeWorkspace(skill, workspace, exitOk ? 0 : 1)` imported from
   `./lib.ts`.
4. Write the record atomically to `--out`:
   `{ kind: "playground", id, skill, prompt, agentName, fixtureCase,
   status, score, checks, grader, durationMs, trajectoryUrl (from
   agent.calls.at(-1)), workspace, createdAtMs, note? }`. Exit 0.

**Verify (no pool spend)**: write
`/tmp/pg.json` = `{"skill":"repo-map","prompt":"x","model":"laguna-m.1","smoke":true}`;
`bun ui/playground.ts --params /tmp/pg.json --out /tmp/pg-rec.json` → exit
0; the record has `status: "fail"` or `"error"` with the validator's real
checks (an empty workspace fails the repo-map validator — that proves the
grading path runs).

## Step 3 — server routes

GET `/api/skill-detail?name=` → `skillDetail`;
GET `/api/playground?skill=` → `listPlayground`;
POST `/api/playground/run` `{ skill, prompt, model?, fixtureCase?, smoke? }`
(400 without skill/prompt) → `startPlayground`;
POST `/api/playground/promote` `{ skill, id }` → `promotePlayground`.

**Verify** (server on 4799):

```sh
curl -s "http://127.0.0.1:4799/api/skill-detail?name=repo-map" | head -5   # JSON with skill/skillMd/cases
curl -s "http://127.0.0.1:4799/api/skill-detail?name=nope" -o /dev/null -w "%{http_code}\n"  # 404
curl -s -X POST http://127.0.0.1:4799/api/playground/run \
  -H 'content-type: application/json' \
  -d '{"skill":"repo-map","prompt":"smoke","smoke":true}'                   # {"ok":true,"tag":...}
sleep 4; curl -s "http://127.0.0.1:4799/api/playground?skill=repo-map"      # one record, real checks
```

## Step 4 — the view (`ui/views/skills.js`)

Replace the stub. `#/skills` with no id → fetch `/api/skills`, navigate to
the first skill. With id: fetch `/api/skills` (rail + lift), `/api/skill-detail`,
`/api/playground?skill=`, `/api/models` (fallback `["laguna-m.1"]`), and —
feature-detected — `/api/proposals?skill=` (404 → hide the queue panel,
render a muted "improvement queue lands with plan 004" note instead).
Render per the design spec. Behaviors:

- Tab state in `?tab=` (default `contract`); rail links are
  `#/skills/<name>` (tab resets).
- TRY IT NOW Run → POST `/api/playground/run`; append a `.pill.live`
  pending row; poll `/api/playground?skill=` every 5s (self-rescheduling,
  miss-tolerant — copy the legacy `scheduleEvalPoll` shape,
  `ui/workflows.js` lines 612–620) until the pending sidecar's `running`
  flips false; then render the graded record. Clean the timer in cleanup.
- `+ eval case` on a record → POST `/api/playground/promote`; show the
  returned candidate path + follow-up command verbatim in a dismissible
  notice ("review + promote is a human step — see CLAUDE.md").
- Queue panel: Accept → POST `/api/proposals/accept`; on `ok:false` show
  the structure-check output in a `<pre>`; on `ok:true` show
  "accepted as v<newVersion> — suite re-running" and refresh the detail
  (version pill changes). Dismiss → POST dismiss + refresh. View evidence
  toggles the evidence list inline.

**Verify**: `bun build ui/app.js --outdir /tmp/wb-check` exits 0.

## Done criteria

1. All Step 2/3 curl checks pass; smoke playground record appears in the
   UI list with its real validator checks visible.
2. Manual: `#/skills` lands on the first skill; scorecard tiles show the
   same pass/total numbers as `bun ui/bench.ts skills` reports for that
   skill; lift matches the formula; tabs all render; `Used in` lists
   `example.workflow.tsx`-style workflows only if they actually reference
   the skill (spot-check the regex against one source file).
3. With plan 004 applied: a smoke proposal renders with a colored diff;
   Accept/dismiss round-trip works (restore SKILL.md via git afterwards,
   per plan 004 Step 6's cleanup).
4. One live playground run (optional, needs authenticated pool): prompt
   `"Map this workspace per the skill's output contract"` with fixture
   `repo-map-bun-cli-workspace` → record lands graded with
   `grader: "skill-validator"`.

## Hard boundaries

- Files in scope: `ui/views/skills.js`, `ui/playground.ts`, `ui/lib.ts`
  (new section + two exports), `ui/server.ts` (four routes),
  `ui/workbench.css` (skills-page classes).
- `promotePlayground` writes ONLY under `runs/generate/` — never `skills/`,
  never `evals/`. The human `--promote` pipeline stays the only road in
  (CLAUDE.md).
- Playground workspaces are temp dirs; never accept an arbitrary
  `workspacePath` from the client — fixtures are named eval-case inputs
  only.
- Do not modify the legacy skill-authoring flow (`generateSkill`,
  `/api/skills/generate`) — plan 007 owns its UI replacement.

## Test plan

Steps 2/3 smoke + the manual checklist. Edge: a skill with zero eval runs
(`workspace-inventory` has no `evals/` dir at `8fe6fd5`) must render with
`—` lift, empty scorecard denominators, and an empty cases tab — no NaN,
no crash.

## Maintenance note

The lift formula lives in the view layer twice after plan 006 (rail +
scorecard there) — keep it as an exported helper in `ui/app.js` if you
prefer one source. Playground records are the fourth trajectory producer;
plan 006's feed reads `listPlayground` across skills — keep the record
shape stable.

## STOP conditions

- Plan 001 not applied.
- `gradeWorkspace` behavior changed since `8fe6fd5` (drift) — re-read
  before exporting.
- The playground worker cannot produce a graded record in smoke mode
  (validator path broken — report, don't patch validators; they're frozen).
