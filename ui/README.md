# Skills & Workflow Workbench

One bench that closes the loop: **author a skill → author a workflow (with
pool executing every node, skills installed per node) → run it → eval it →
watch results live → iterate**. The GitHub Pages catalog (`index.html`)
stays a separate, static showcase; this is the working surface.

```
bun ui/server.ts          # web UI  → http://127.0.0.1:4319/workflows.html
bun ui/bench.ts <cmd>     # the same substrate for agents (JSON in/out)
```

## Quick start

If you want the Smithers demo project to appear in the workbench, initialize it first:

```bash
cd experiments/smithers-pool
bun install
bun run setup
mkdir -p .smithers
cd ../..
bun ui/server.ts
```

Then open `http://127.0.0.1:4319/workflows.html`.

## Three surfaces, one substrate

Everything lives in `ui/lib.ts`; the HTTP server (`ui/server.ts`) and the
agent CLI (`ui/bench.ts`) are thin layers over it. An MCP server would be a
third thin layer if we want one later — nothing in the substrate assumes a
web page. An agent can run the whole loop from natural language:

```bash
bun ui/bench.ts skills
bun ui/bench.ts models                       # pool agents list (laguna first, then anthropic/*, ...)
bun ui/bench.ts skill-generate --name my-skill --prompt "..." --model anthropic/claude-sonnet-4.6
bun ui/bench.ts workflow-generate --prompt "..." --model laguna-m.1 --project experiments/smithers-pool
bun ui/bench.ts workflow-run .smithers/workflows/my-flow.tsx --project experiments/smithers-pool
bun ui/bench.ts runs --project experiments/smithers-pool
bun ui/bench.ts run-show <runId> --project experiments/smithers-pool
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --case <id> --arm xs_with_skill
bun ui/bench.ts eval-runs                    # live harness status + per-arm results
```

## The unifying data model

"An eval is basically any trajectory." Everything the bench lists reduces to
a trajectory record:

- **workflow-run** — from a project's `.smithers/smithers.db`: run → nodes →
  attempts → schema-validated output rows → matched pool captures
  (trajectory URL, skill installed/used, tool calls).
- **eval-run** — from the harness output tree
  `runs/<suite>/<case>/<arm>/`: `manifest.json` (validator status/score/
  checks, timing, agent) + `run-facts.json` (graded_pass, token totals).

Same vocabulary, same UI affordances, regardless of producer.

## Authoring (model-selectable)

Both composers take any tenant agent name (`pool agents list` — Laguna
models, `anthropic/claude-*`, etc.) as the author, via pool's `--agent-name`:

- **Workflows**: the author model gets the known-working
  `experiments/smithers-pool/example.workflow.tsx` as reference, plus the
  current skills catalog so it can install a skill into a node
  (`PoolAgent { skill: { name, from } }`). Output is only saved after
  `smithers graph` verifies it; one repair round on failure. Rule learned
  live: upstream rows flow via `ctx.latest(outputs.key, "node-id")` — a
  `deps={}` function child breaks static graph projection.
- **Skills**: the author works in a scratch dir seeded with the BINDING
  `docs/authoring-guide.md` and the repo-map skill as an exemplar, and must
  produce `SKILL.md` + `schemas/*.schema.json` + `scripts/validate_*.ts`
  (validator-result.v1 contract). The result is installed into `skills/`
  ONLY if `scripts/check_skill_structure.py` passes; otherwise it's rolled
  back and the violations are fed into one repair round.

## Skill linking & node-level evals

- **Skill is the join key**: every eval arm-run resolves its owning skill
  (from the `skills/<skill>/evals/<case>/` layout), and the catalog shows a
  per-skill scorecard split by arm type — `with skill: x/y (avg score)` vs
  `without` — i.e. **skill lift** at a glance. Workflow nodes link to skills
  through their pool captures (`skillInstalled`).
- **Node-level evals** answer "how does this node (often: one skill + one
  prompt) perform?", in two modes sharing one record shape:
  - *in-workflow* — `node-eval-insitu <runId>`: grades each node of a real
    run by running its installed skill's validator against the node's
    workspace (grader falls back to pool exit code for skill-less nodes).
    Free — validators only, no model calls. Caveat recorded per record: node
    workspaces are shared across runs.
  - *standalone* — `node-eval-run <workflow> --node <id> --trials N
    [--model <agent>]`: lifts the node out, re-runs its prompt in fresh
    copies of its latest real workspace (prior `.laguna/` outputs and
    `.poolside/` installs stripped, skill reinstalled from `skills/`), and
    grades every trial. This is the prompt-tuning loop: compare standalone
    pass rates against in-workflow grades, or across authoring models.
  - Records persist under `<project>/node-evals/records/` and render in the
    workbench (Evals panel + per-node chips in run detail, "Grade nodes"
    button).

## Evals, live

- Suites/cases come from `evals/suites/*.json` + each case's `metadata.json`.
- "Run suite" / `eval-run` launches `uv run harness/runner/run_eval.py`
  **detached**, with output to `runs/.harness/harness-<tag>.log` and a JSON
  sidecar (pid, argv) so the server, the CLI, and any agent see the same
  liveness state via pid checks — no in-memory registry, restarts don't lose
  it.
- The UI polls `/api/evals/runs` every 5s while a harness is alive: arm-runs
  appear/refresh as `manifest.json` files land, with status, score, token
  totals, and failing-check detail inline. No manual Python invocation.
- Needs the same auth as any harness run: logged-in pool or
  `$POOLSIDE_TOKEN`; agents per arm come from the harness's matrix
  (`POOLSIDE_EVAL_AGENT_XS` / `POOLSIDE_EVAL_AGENT_M` env overrides).

## The annotation app (harness/review) is wired in, not replaced

The pre-existing trace-annotation tool (`harness/review/serve.py`, standalone default
port 8765, serving `runs/review/traces.json` + `labels.json`) stays its own
deep-review surface. The workbench connects to it rather than reimplementing
it:

- `bun ui/server.ts` **auto-starts** the review server on 8901 if it's not
  already up (so it stops mysteriously dying when a terminal closes), and the
  evals panel shows a "review traces ↗" link plus its live status.
- **Sync workbench → review** (button, or `bun ui/bench.ts review-sync`, or
  `POST /api/review/sync`) folds workbench records into `traces.json` in the
  *same trace shape* `extract_traces.py` emits: one trace per matched
  workflow-node pool capture (prompt, NLJSON trajectory, `.laguna/` outputs,
  validator result from its in-workflow node-eval) and one per standalone
  node-eval trial. It replaces only `workbench/*` traces — harness traces and
  all human labels are preserved. This is the "eval = any trajectory" payoff:
  Smithers node runs become annotatable next to harness eval runs.

## Security model (localhost dev tool)

The server binds 127.0.0.1 and is unauthenticated by design, but it spawns
processes and executes model-generated code, so two real exposures are
mitigated:

- **CSRF / cross-origin POST**: every mutating route (generate, run, eval,
  node-eval, sync) rejects requests whose `Origin` isn't this server — a
  website you visit while it runs can't drive code-gen/exec on your machine.
  No Origin (curl, the CLI) is allowed.
- **Generated-code execution**: validator scripts (`bun validate_*.ts`) and
  workflow module imports (`smithers graph`/`up`) run model-authored code.
  Those sinks now spawn with a **scrubbed env** (PATH/HOME/TMPDIR/LANG only),
  so generated code doesn't inherit `$POOLSIDE_TOKEN`. This is
  defense-in-depth, not a sandbox — a `<a href="javascript:">` from capture
  data is also blocked in the frontend (scheme allowlist), but treat
  generated skills/workflows as code you are choosing to run locally.

## Layout

```
ui/lib.ts          the substrate (projects, runs, workflows, models, skills, evals, node-evals, review sync)
ui/server.ts       HTTP routes + static serving + review-app autostart + Origin gate
ui/bench.ts        agent CLI
ui/app.js          workbench router/frontend entry (loads ui/views/*.js modules)
ui/tsconfig.json   typecheck config (bun x tsc -p ui/tsconfig.json)
workflows.html     the workbench page
index.html         static GitHub Pages catalog (separate concern, untouched)
harness/review/    the annotation app the workbench autostarts + syncs into
```

## Known gaps / next steps

- Standalone node-evals require the node to have run at least once (the
  latest capture supplies the workspace fixture + skill); nodes from
  never-run workflows fall back to an empty workspace.
- In-situ grading trusts the node workspace as it exists now — re-running a
  workflow that shares workdirs overwrites what an earlier run produced.
  Per-run workspaces (Smithers `<Worktree>`) would make grades immutable.
- A skill that ships a `scripts/run_workflow.ts` (pool-as-executor Smithers
  plan) would make workflow runs first-class eval subjects: the case's
  validator grades the workflow's final artifact.
- Authored skills land without eval cases; `skill-generate` could scaffold
  one `easy` case + gold artifacts so the structure check's sibling
  (`check_eval_cases.py`) passes too.
- No MCP wrapper yet; `bench.ts` covers agent use via shell. If MCP is
  preferred, wrap `ui/lib.ts` exports 1:1.
