# Plan 004: Improvement queue — proposal store, Suggest fix/improvements, accept-as-version

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8fe6fd5..HEAD -- ui/lib.ts ui/server.ts skills/repo-map/SKILL.md`
> Plan 001 must be applied. Also confirm `git status --porcelain skills/`
> is clean — Step 6's accept-flow test temporarily modifies a SKILL.md and
> restores it via git.

## Status

- **Priority**: P1 (the loop's "improve" half; screens 01/02/03/06 all point at it)
- **Effort**: L
- **Risk**: MEDIUM (writes to `skills/<name>/SKILL.md` on accept — gated by the repo's own structure check + rollback, mirroring `generateSkill`)
- **Depends on**: plan 001 (server shell; no UI of its own — plans 002/003 buttons light up, plan 005 renders the queue)
- **Planned at**: commit `8fe6fd5`, 2026-06-11

## Why this matters

The handoff's system principle
(`.resources/handoff/design_handoff_skills_workbench/README.md`, "The
system" and screen 03's "IMPROVEMENT QUEUE" — read both now): skills are
**never hand-edited inline during workflow authoring** — they improve from
run evidence. A stronger model (laguna-m.1) reads failing trajectories,
proposes a versioned SKILL.md change, and a human accepts it on the skill
page. Today nothing implements this: "Suggest fix/improvements" buttons
from plans 002/003 ship feature-detected-disabled until this plan lands.

This is also the bridge to the GEPA optimization track
(`docs/plans/skill-optimization-gepa-2026-06-11.md`): the same constraint
applies — **the genome is SKILL.md prose only; validators, cases, and
schemas are frozen**. A proposal that touches anything but SKILL.md is
invalid by construction here.

## Context

- `runs/` is gitignored (verified: `.gitignore` covers it; CLAUDE.md states
  it) — all proposal state lives under `runs/proposals/`.
- House pattern for long-running jobs (copy it, don't invent):
  `startEvalRun` in `ui/lib.ts` lines 919–965 — detached `spawn` with
  stdio to a log-file fd, pid sidecar JSON on disk, liveness via
  `pidAlive(pid)` (`process.kill(pid, 0)`), so server, CLI, and agents all
  see the same state with no in-memory registry.
- House pattern for gated writes to `skills/`: `generateSkill` lib.ts lines
  741–808 — install, run `uv run scripts/check_skill_structure.py`
  (120s timeout), **roll back on nonzero exit**.
- Model calls from TS: `PoolAgent` at
  `experiments/smithers-pool/src/PoolAgent.ts` — options
  `{ cwd, agentName, id, logDir?, skill? }`, then
  `await agent.generate({ prompt })` → `{ text }`. `lib.ts`'s
  `poolGenerate` (line 497) wraps it for one-shot prompts; `extractFence`
  (line 507) pulls the largest fenced block. `DEFAULT_AGENT = "laguna-m.1"`.
- SKILL.md frontmatter version: quoted semver under `metadata:`
  (e.g. `version: "0.1.0"`); `parseFrontmatter` (lib.ts line 663) reads it
  with `/version:\s*"?([^"\n]+)"?/`. CLAUDE.md rule: **bump it on any prose
  change** — the accept flow enforces the bump itself.
- Evidence sources already on disk: `listNodeEvals(project)` (failing
  node-eval records with `checks` + `note`), `listEvalRuns()` (failing
  arm-runs with `checks`), and review labels/notes (routed here by plans
  003/008 via the evidence endpoint below).

## Data contracts (binding)

```
runs/proposals/<skill>/proposal-<tag>.json    one file per proposal
runs/proposals/<skill>/evidence.jsonl         append-only human evidence
runs/proposals/.state/suggest-<tag>.json      pid sidecar per suggest job
runs/proposals/.state/suggest-<tag>.log       worker stdout/stderr
```

```ts
export type SkillProposal = {
  id: string;                       // "proposal-<tag>"
  skill: string;
  createdAtMs: number;
  status: "open" | "accepted" | "dismissed";
  source: string;                   // "inspector" | "run-loop" | "review" | "manual"
  model: string;                    // agent that authored it
  summary: string;                  // one sentence: what it found across N trajectories
  baseVersion: string | null;       // SKILL.md version it was computed against
  proposedContent: string;          // the COMPLETE proposed SKILL.md
  evidence: { kind: string; ref: string; detail?: string }[];
  acceptedAtMs?: number;
  newVersion?: string;
};
```

Evidence line (`evidence.jsonl`):
`{ "atMs": number, "skill": string, "source": string, "traceId"?: string, "note"?: string, "refs"?: object }`.

## Step 1 — `ui/propose.ts` (the detached worker)

New file. Argv: `bun ui/propose.ts --skill <name> --params <abs path to params.json> --out <abs path to proposal json>`.
Params file: `{ skill, source, model, refs?, note?, evidence: [{kind, ref, detail?}] }`
(the server pre-collects evidence — Step 2 — so the worker stays dumb).

Worker logic:

1. Read `skills/<skill>/SKILL.md`; `parseFrontmatter`-equivalent regex for
   the current version (or import `parseFrontmatter` if you export it from
   lib.ts — exporting it is allowed).
2. Build the prompt (treat this text as code — keep it tight):

```
You are improving the Poolside skill "<skill>". Below is its current
SKILL.md, followed by evidence from failing runs (validator checks that
failed, reviewer notes, missing artifacts).

Rules:
- Propose a revision of SKILL.md PROSE ONLY. Keep the YAML frontmatter keys
  and the ten-section structure intact. Do NOT change the output contract
  path, the schema, or any file references — validators, schemas, and eval
  cases are frozen.
- Target the failure pattern in the evidence. Smallest change that
  plausibly fixes it.
- Reply with exactly: one line starting "SUMMARY: " describing what you
  found across the failing trajectories and what you changed, then the
  complete revised SKILL.md in a single ```markdown fence.

--- CURRENT SKILL.md ---
<content>
--- EVIDENCE (<n> items) ---
<one block per item: kind, ref, detail — cap each at 800 chars, cap total at 16k>
```

3. `--smoke` flag (for verification without pool spend): skip the model
   call; `summary = "SMOKE: no model call"`, `proposedContent =` current
   content with `\n<!-- smoke-proposal -->\n` appended before EOF.
4. Otherwise call `PoolAgent` (`cwd` = a `mkdtempSync` scratch dir,
   `agentName` from params, `id: "pool:propose:<skill>"`), extract the
   `SUMMARY:` line and the fenced markdown. No fence → exit 1 with a clear
   stderr message (the sidecar's log captures it).
5. Write the proposal JSON (shape above, `status: "open"`) to `--out`
   atomically (tmp + rename). Exit 0.

**Verify**:
`bun ui/propose.ts --skill repo-map --params /tmp/p.json --out /tmp/prop.json --smoke`
(with `/tmp/p.json` = `{"skill":"repo-map","source":"manual","model":"laguna-m.1","evidence":[]}`)
→ exit 0, `/tmp/prop.json` parses, `proposedContent` ends with the smoke
marker, `baseVersion` equals the version in `skills/repo-map/SKILL.md`.

## Step 2 — `ui/lib.ts`: store + launch + accept

Add a `// Improvement-queue` section:

- `listProposals(skill: string)` → read `runs/proposals/<skill>/*.json`
  (skip unreadable), sort newest first; also return pending suggest jobs
  for the skill from `runs/proposals/.state/` sidecars with
  `running: pidAlive(pid)` (copy the `listHarnessProcesses` shape, lines
  904–917).
- `appendEvidence(skill, item)` → validate skill exists
  (`existsSync(join(SKILLS_ROOT, skill, "SKILL.md"))`, else HttpError 404),
  append one JSON line to `evidence.jsonl` (mkdir -p first).
- `startSuggest(options: { skill, source, model?, refs?, note? })`:
  1. Validate the skill exists. 2. Collect evidence (server-side, bounded):
  last 5 failing/error `listNodeEvals` records across all projects'
  `discoverProjects()` where `record.skill === skill` (kind
  `"node-eval"`, ref = record.id, detail = failing checks joined); last 5
  failing `listEvalRuns()` where `run.skill === skill` (kind `"eval-run"`,
  ref = run.id, detail likewise); last 10 lines of `evidence.jsonl` (kind
  `"human-note"`). 3. Write the params file under
  `runs/proposals/.state/suggest-<tag>.params.json`. 4. Spawn
  `["bun", "ui/propose.ts", "--skill", skill, "--params", <abs>, "--out",
  join(REPO_ROOT, "runs", "proposals", skill, `proposal-${tag}.json`)]`
  detached with the log-fd + sidecar pattern copied from `startEvalRun`
  (env: `process.env` — the worker needs pool credentials; this is the
  same trust level as `startRun`). 5. Return `{ ok: true, tag, sidecar }`.
- `acceptProposal(skill, id)`:
  1. Read the proposal; 404 if missing, 409 if not `open`.
  2. Read the live `skills/<skill>/SKILL.md` (`original`). If
     `parseFrontmatter(original).version !== proposal.baseVersion`, throw
     HttpError 409 `"skill changed since proposal was computed (<live> vs
     <base>) — dismiss and re-suggest"`.
  3. Compute `newVersion` = baseVersion with patch+1
     (`x.y.z → x.y.(z+1)`; unparseable → 409).
  4. Take `proposal.proposedContent`, **force** the version line:
     `content.replace(/version:\s*"?[^"\n]+"?/, \`version: "${newVersion}"\`)`
     (refuse with 422 if the pattern is absent, or if the frontmatter
     `name:` differs from the skill).
  5. Write it to SKILL.md, run
     `runCommand(["uv", "run", "scripts/check_skill_structure.py"], REPO_ROOT, 120_000)`.
     Nonzero → restore `original`, return
     `{ ok: false, error: <check output slice 1500> }` (proposal stays open).
  6. Success → update the proposal file
     (`status: "accepted", acceptedAtMs, newVersion`), and if
     `evals/suites/skill-<skill>.json` exists, fire
     `startEvalRun({ suite: \`evals/suites/skill-${skill}.json\` })` and
     include its sidecar in the response (the handoff: "accepting creates a
     draft version that re-runs the suite").
- `dismissProposal(skill, id)` → set `status: "dismissed"`.

## Step 3 — server routes (`ui/server.ts`)

GET: `/api/proposals?skill=<name>` → 400 without skill, else
`json(listProposals(skill))`.
POST (inside the origin-checked block): `/api/proposals/suggest`
`{ skill, source?, model?, refs?, note? }` → `startSuggest`;
`/api/proposals/evidence` `{ skill, source?, traceId?, note?, refs? }` →
`appendEvidence`; `/api/proposals/accept` `{ skill, id }` →
`acceptProposal`; `/api/proposals/dismiss` `{ skill, id }` →
`dismissProposal`. Import the five new lib functions.

**Verify** (server on 4799):

```sh
curl -s "http://127.0.0.1:4799/api/proposals?skill=repo-map"        # → {"proposals":[],"pending":[]}
curl -s "http://127.0.0.1:4799/api/proposals?skill=nope" -o /dev/null -w "%{http_code}\n"  # 400 or 404
curl -s -X POST http://127.0.0.1:4799/api/proposals/evidence \
  -H 'content-type: application/json' \
  -d '{"skill":"repo-map","source":"manual","note":"plan004 smoke"}' # → {"ok":true,...}
cat runs/proposals/repo-map/evidence.jsonl                           # contains the line
```

## Step 4 — light up the plan 002/003 buttons

If plans 002/003 are applied, their "Suggest improvements"/"Suggest fix"
buttons already feature-detect `GET /api/proposals?skill=` — confirm they
now POST `/api/proposals/suggest` and surface the returned `tag` as a
`.pill.live` ("proposal job started — lands on the skill page"). If those
plans are not yet applied, skip this step and note it in your report.

## Step 5 — smoke the suggest pipeline end-to-end (no pool spend)

Temporarily test via the worker directly (Step 1's command) plus
`startSuggest` smoke: add `smoke?: boolean` to `startSuggest`'s options,
passed through as `--smoke` to the worker, and accept `"smoke": true` in
the POST body. Then:

```sh
curl -s -X POST http://127.0.0.1:4799/api/proposals/suggest \
  -H 'content-type: application/json' -d '{"skill":"repo-map","smoke":true}'
sleep 3
curl -s "http://127.0.0.1:4799/api/proposals?skill=repo-map"   # one open proposal, summary "SMOKE: …"
```

Keep the `smoke` flag — it is the permanent no-spend test path.

## Step 6 — verify the accept gate (mutates + restores `skills/`)

Precondition: `git status --porcelain skills/repo-map/` is empty.

```sh
# id from the previous step's listing:
curl -s -X POST http://127.0.0.1:4799/api/proposals/accept \
  -H 'content-type: application/json' -d '{"skill":"repo-map","id":"<id>"}'
# → {"ok":true,...,"newVersion":"0.1.1"} (or current patch+1)
grep -n 'version:' skills/repo-map/SKILL.md      # shows the bumped version
uv run scripts/check_skill_structure.py          # exit 0
git checkout -- skills/repo-map/SKILL.md         # restore — this was a smoke proposal
```

Also verify the rollback path: hand-edit a copy of the proposal file to
make `proposedContent` invalid (e.g. delete its frontmatter), accept it,
confirm the response is `ok:false`, `skills/repo-map/SKILL.md` is unchanged
(`git status` clean), and the proposal is still `open`. Delete the doctored
proposal file afterwards.

## Done criteria

1. Worker smoke run writes a valid proposal JSON (Step 1).
2. All curl checks in Steps 3/5 pass; evidence line lands in
   `evidence.jsonl`.
3. Accept bumps the patch version, passes the structure check, and fires
   the skill suite when `evals/suites/skill-<name>.json` exists; failure
   path restores SKILL.md byte-identically (`git status` clean).
4. Version-drift guard works: accepting a proposal whose `baseVersion`
   mismatches the live SKILL.md returns 409.
5. `bun build ui/propose.ts --outdir /tmp/wb-check` exits 0; existing
   routes unaffected.

## Hard boundaries

- The ONLY file under `skills/` this feature may ever write is
  `skills/<skill>/SKILL.md`, only via `acceptProposal`, only behind the
  structure-check + rollback gate. Schemas, validators, eval cases,
  references are frozen — there is no code path that touches them.
- Do not modify `scripts/check_skill_structure.py`,
  `harness/optimize/*` (GEPA owns its own loop), or `generateSkill`.
- All proposal/evidence/sidecar state under `runs/proposals/` — nothing in
  the repo tree, nothing committed.
- The worker must never run with `scrubEnv` (it needs pool credentials) but
  must also never `eval` or execute model output — proposals are data until
  a human accepts.

## Test plan

Steps 1, 5, 6 are the test plan (smoke worker, end-to-end suggest, accept
gate + rollback + drift guard). One optional live check if pool is
authenticated: `POST /api/proposals/suggest {"skill":"ci-log-reducer"}`
after seeding evidence, wait for the sidecar's `running` to flip false,
confirm the proposal's `summary` references the evidence. Record outcomes.

## Maintenance note

`acceptProposal`'s base-version check is the concurrency story — two open
proposals against the same version: first accept wins, second 409s into
re-suggest. If GEPA later lands optimized SKILL.md candidates, route them
through this same store (status `open`, source `"gepa"`) rather than a
second pipeline.

## STOP conditions

- `git status --porcelain skills/` is dirty before Step 6.
- `uv run scripts/check_skill_structure.py` fails on a clean checkout
  (broken baseline).
- The rollback test leaves `skills/repo-map/SKILL.md` modified — a write
  path that can corrupt a skill must not ship.
