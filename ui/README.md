# Skills & Workflow Workbench

One bench that closes the loop: **author a skill → author a workflow (with
pool executing every node, skills installed per node) → run it → eval it →
watch results live → iterate**. The GitHub Pages catalog (`index.html`)
stays a separate, static showcase; this is the working surface.

```
bun ui/server.ts          # web UI  → http://127.0.0.1:4319/workflows.html
bun ui/bench.ts <cmd>     # agent CLI; JSON stdout on success, JSON stderr on errors
bun ui/bench.ts doctor    # readiness snapshot with basic coverage checks
bun ui/bench.ts commands  # machine-readable command catalog
bun ui/bench.ts help <cmd> # command-specific JSON help; <cmd> --help also works
```

On `ben-netcup-v2`, the workbench is also managed by the user systemd unit
`poolside-skills-workbench.service` and exposed privately through Tailscale
Serve at `https://ben-netcup-v2.tail66d6b7.ts.net:10000/workflows.html`.

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

### Onboarding and Beads sources

The onboarding view (`ui/views/onboard.js`) wires its "Check Beads workflow
skill" and "Check Beads priority graph skill" quick-starts to external Beads
source skills under `~/.codex/skills/beads-bv` and
`~/.codex/skills/beads-workflow`. Those paths live outside this checkout. If
they are missing on your machine, the readiness run writes the failure into
`runs/onboard/` rather than implying a local tracker exists. The
"Create bead-selector eval cases" quick-start, in contrast, targets the
repo-local [`skills/bead-selector`](../skills/bead-selector/SKILL.md), which
is the authoritative repo truth for graded Bead-selection behavior. This repo
does not initialize a Beads tracker (`.beads/` is absent on purpose); see
the root [`README.md`](../README.md) "Task tracking and Beads" section for
the full narrative.

## Three surfaces, one substrate

Core workbench operations live in `ui/lib.ts`; the HTTP server (`ui/server.ts`)
uses that substrate for browser routes. `ui/bench.ts` adds the agent CLI contract:
command catalog, capabilities, doctor, command-specific help, flag parsing, and JSON
error responses. Selected commands accept JSON-valued arguments such as
`workflow-run --input`. Some operations, notably GEPA optimization start/propose,
are CLI-first today even when the web UI can show their status.

The CLI writes JSON to stdout on success and JSON to stderr on errors. Exit codes are
`0` for success, `1` for runtime, validation, or command errors, and `2` for
unknown commands. Use `bun ui/bench.ts commands` for the catalog,
`bun ui/bench.ts capabilities` for output conventions and known CLI↔HTTP mirrors,
and `bun ui/bench.ts help <command>` or `bun ui/bench.ts <command> --help` for
command-specific help. Scalar/non-repeatable duplicate flags fast-fail instead of
using the last occurrence. Repeatable flags are command-specific: `--case` and
`--arm` on `eval-run`; `--components` on `optimize-skill`; `--spec`,
`--validate-only`, and `--promote` on `eval-case-generate`. Unknown commands
and close command or flag typos include did-you-mean hints when a close match
exists, including bespoke parsers such as `onboard`, `onboard-prepare`, and
`eval-case-generate`. `--max-metric-calls`, `--max-component-bytes`,
`--max-total-bytes`, `--trials`, and generation count flags must be valid
numbers.

The main loop is available from the CLI:

```bash
bun ui/bench.ts capabilities
bun ui/bench.ts skills
bun ui/bench.ts models                       # pool agents list (laguna first, then anthropic/*, ...)
bun ui/bench.ts skill-generate --name my-skill --prompt "..." --model anthropic/claude-sonnet-4.6
bun ui/bench.ts workflow-generate --prompt "..." --model laguna-m.1 --project experiments/smithers-pool
bun ui/bench.ts workflow-run .smithers/workflows/my-flow.tsx --project experiments/smithers-pool
bun ui/bench.ts runs --project experiments/smithers-pool
bun ui/bench.ts run-show <runId> --project experiments/smithers-pool
bun ui/bench.ts feed --project experiments/smithers-pool
bun ui/bench.ts skill-detail ci-log-reducer
bun ui/bench.ts proposals --skill ci-log-reducer
bun ui/bench.ts node-artifacts --run-id <runId> --node-id <nodeId> --project experiments/smithers-pool
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --case <id> --arm xs_with_skill
bun ui/bench.ts eval-run --suite evals/suites/smoke.json --robot-dry-run --replay
bun ui/bench.ts eval-runs                    # live harness status + per-arm results
bun ui/bench.ts onboard --source <dir>
bun ui/bench.ts onboard-prepare --source <dir> --skill <name> --skip-cases
bun ui/bench.ts eval-case-generate --skill ci-log-reducer --n 4
bun ui/bench.ts eval-case-generate --skill ci-log-reducer --validate-only <case-dir>
bun ui/bench.ts optimize-skill --skill ci-log-reducer --smoke
bun ui/bench.ts optimize-skill ci-log-reducer --smoke
bun ui/bench.ts optimize-skill ci-log-reducer --components references --max-component-bytes 65536 --max-total-bytes 131072
bun ui/bench.ts optimize-runs
bun ui/bench.ts optimize-propose --skill ci-log-reducer --run-dir runs/optimize/ci-log-reducer/<stamp>
bun ui/bench.ts optimize-propose ci-log-reducer --run-dir runs/optimize/ci-log-reducer/<stamp>
```

`optimize-skill --smoke --baseline-only` is rejected as a mode conflict before
optimizer launch, sidecar writes, or log creation. The safe `eval-run`
robot-dry-run JSON redacts custom CLI roots and materialized workspace/home/state/scratch
paths with placeholders; human dry-run/debug prose is not globally redacted.
`onboard` only triages source skill directories. `onboard-prepare` writes
quarantined draft contracts, validators, and optional bootstrap cases under
`runs/onboard/` for human review; it does not promote generated material.
`optimize-skill` mutates `SKILL.md` by default, and `--components references`
adds `references/**` files to the mutable GEPA component set.

### Onboarding and external Beads source skills

The onboarding panel runs readiness checks against external Beads source
skills under `~/.codex/skills/beads-bv` and `~/.codex/skills/beads-workflow`.
Those paths live outside this repo and are not the source of truth for any
in-repo behavior — if they are missing on a given machine, the onboarding run
records the failure and stops rather than treating the absence as repo-local
state. Repo-local "what Bead to pick next?" behavior is owned by
[`skills/bead-selector`](../skills/bead-selector/SKILL.md) and graded through
fixture workspaces, not a live `.beads/` tracker; the workbench does not
initialize `.beads/` here.

## The unifying data model

"An eval is basically any trajectory." Everything the bench lists reduces to
a trajectory record:

- **workflow-run**: from a project's `.smithers/smithers.db`: run → nodes →
  attempts → schema-validated output rows → matched pool captures
  (trajectory URL, skill installed/used, tool calls).
- **eval-run**: from the harness output tree
  `runs/<suite>/<case>/<arm>/`: `manifest.json` (validator status/score/
  checks, timing, agent) + `run-facts.json` (graded_pass, token totals).

Same vocabulary, same UI affordances, regardless of producer.

## Authoring (model-selectable)

Both composers take any tenant agent name (`pool agents list`: Laguna
models, `anthropic/claude-*`, etc.) as the author, via pool's `--agent-name`:

- **Workflows**: the author model gets the known-working
  `experiments/smithers-pool/example.workflow.tsx` as reference, plus the
  current skills catalog so it can install a skill into a node
  (`PoolAgent { skill: { name, from } }`). Output is only saved after
  `bunx smithers-orchestrator graph` verifies it; one repair round on failure.
  The verifier is resolved by `resolveSmithersRunner()` — local
  `.smithers/node_modules/.bin/smithers` fast path, with a
  `bunx smithers-orchestrator` fallback for fresh checkouts (see
  [`docs/smithers.md`](../docs/smithers.md) → Runner resolution). Rule
  learned live: upstream rows flow via `ctx.latest(outputs.key, "node-id")`;
  a `deps={}` function child breaks static graph projection.
- **Skills**: the author works in a scratch dir seeded with the BINDING
  `docs/authoring-guide.md` and the repo-map skill as an exemplar, and must
  produce `SKILL.md` + `schemas/*.schema.json` + `scripts/validate_*.ts`
  (validator-result.v1 contract). The result is installed into `skills/`
  ONLY if `scripts/check_skill_structure.py` passes; otherwise it's rolled
  back and the violations are fed into one repair round.

## Skill linking & node-level evals

- **Skill is the join key**: every eval arm-run resolves its owning skill
  (from the `skills/<skill>/evals/<case>/` layout), and the catalog shows a
  per-skill scorecard split by arm type: `with skill: x/y (avg score)` vs
  `without`, i.e. **skill lift** at a glance. Workflow nodes link to skills
  through their pool captures (`skillInstalled`).
- **Node-level evals** answer "how does this node (often: one skill + one
  prompt) perform?", in two modes sharing one record shape:
  - *in-workflow*: `node-eval-insitu <runId>` grades each node of a real
    run by running its installed skill's validator against the node's
    workspace (grader falls back to pool exit code for skill-less nodes).
    Free: validators only, no model calls. Caveat recorded per record: node
    workspaces are shared across runs.
  - *standalone*: `node-eval-run <workflow> --node <id> --trials N
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
  liveness state via pid checks; no in-memory registry, restarts don't lose
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
  node-eval trial. It replaces only `workbench/*` traces; harness traces and
  all human labels are preserved. This is the "eval = any trajectory" payoff:
  Smithers node runs become annotatable next to harness eval runs.

## Security model (local dev tool)

The server binds `127.0.0.1` by default and is unauthenticated by design. Set
`UI_HOST` to bind a different interface and `UI_PUBLIC_BASE_URL` when a private
proxy such as Tailscale Serve is the browser-facing origin. The server spawns
processes and executes model-generated code, so two real exposures are
mitigated:

- **CSRF / cross-origin POST**: every mutating route (generate, run, eval,
  node-eval, sync) rejects requests whose `Origin` isn't this server. A
  website you visit while it runs can't drive code-gen/exec on your machine.
  No Origin (curl, the CLI) is allowed.
- **Generated-code execution**: validator scripts (`bun validate_*.ts`) and
  workflow module imports (`bunx smithers-orchestrator graph`/`up`) run model-authored code.
  Those sinks now spawn with a **scrubbed env** (PATH/HOME/TMPDIR/LANG only),
  so generated code doesn't inherit `$POOLSIDE_TOKEN`. This is
  defense-in-depth, not a sandbox. A `<a href="javascript:">` from capture
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
- In-situ grading trusts the node workspace as it exists now. Re-running a
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
