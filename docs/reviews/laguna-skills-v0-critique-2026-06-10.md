# Critique — Laguna Skills v0 plan

> Reviews `docs/plans/laguna-skills-v0-2026-06-10.md` against the substrate
> (`.resources/investigations/laguna-skills-and-harness-substrate-2026-06-10.md` + leaf docs).
> Scope: seams, contradictions, over-planning, order-changing questions. Settled context not relitigated.
> Verdict: structurally sound; tighten three seams and cut one track before building.

## 1. Top 3 under-specified seams

1. **Run-id → trajectory correlation (item 10).** The plan says the runner "recovers trajectories via
   `pool history trajectories --atif` keyed on hidden `--run-id`." Spot-checked in code: there is no run-id key.
   `history_cmd.go:15` `trajectoryHeaders = {DATE, AGENT ID, SESSION ID, FILENAME}` — no run-id column; and
   `resolveSingleTrajectoryEntry` (`:290–318`) resolves *only* by `--latest` or a filename **substring**, which
   errors on >1 match. Run-id↔trajectory must route through `pool history sessions` (the only place mapping
   RUN ID↔SESSION ID↔AGENT ID) or fall back to `--latest`. The plan owes the actual correlation procedure, and
   should state plainly that `--latest` is unusable under a concurrent matrix.

2. **How the gradeable artifact leaves `pool exec` (items 8, 10, 11).** Schema validity + validator pass are the
   headline metrics, but nothing says *where the skill's JSON output comes from*. §6.5 (`6.5-activation-and-telemetry.md`)
   is explicit that NLJSON stringifies tool results and emits no structured "final output" event. Is the gradeable
   object the final assistant text, a file the skill writes into the workspace, or only recoverable from the scraped
   ATIF? Until this is pinned, the #1 metric and the validator input are both undefined — and it decides whether
   validators read stdout or the trajectory.

3. **Validator invocation contract (item 11).** "The harness invokes each case's validator as a subprocess via
   the command in `metadata.json`" never defines the calling convention: what argv/paths the validator receives
   (workspace dir? extracted-output path? `expected/` dir?) and where it reads the model output (seam 2). The
   `validator-result.v1` *output* shape is specified; the *input* contract is not.

## 2. Contradictions / missing dependencies

- **Validator location is specified three incompatible ways.** Items 4–6 place validators in skill
  `scripts/validate_*.ts` (one per skill); item 9 gives every *case* a `validators/` dir; item 11 says validators
  are "named by each case's `metadata.json`." Pick one home and state whether validators are per-skill or per-case.
- **Item 2's config arms depend on a model_id that may be unrecoverable.** The `*-noskilltool` and pinned-sampling
  variants need `--agent-config-file`, which is mutually exclusive with `--agent-name` and must replicate the named
  agent's `model.provider.openai.model_id` + sampling (§6.7). But §6.7 marks actual Laguna model IDs "still open
  (Workstream D)." The plan asserts configs "replicate the named agent's settings" without saying how those settings
  are discovered when `--agent-name` hides them. Unstated hard dependency. (See Q2.)
- **"Dry-run testable before Track 1" is overstated** if the artifact lives only in the ATIF (seam 2/3): then
  schema-grading also depends on seam 1, and the validator I/O can't be exercised without a real run.

## 3. Over-planning — cut or simplify

- **Cut item 2's `*-noskilltool` config + pinned-sampling variants from v0.** Settled context is "named agent works
  today," and the plan itself calls the tool-disabled arm an *optional* third control. v0 "done" needs only the four
  named-agent arms + a ci-log-reducer readout. Keep `--agent-name`; defer the `AgentConfig` apparatus to whenever the
  tool-disabled experiment actually runs. This also dissolves the model_id-recovery dependency above.
- **Drop the "keep all four contracts structurally aligned" work (item 7 + closing Approach para).** Telemetry-events
  is PR5 (out of scope); the run-manifest's reproducibility fields (skill digests, fixture hash matching telemetry)
  serve *publishable* claims, which v0 explicitly defers. Ship `validator-result.v1` + a minimal manifest; note future
  alignment as a one-line nicety, not a deliverable.
- **Minor:** item 13's three check scripts for three skills could be one script. Low stakes.

## 4. Questions that would change implementation order

- **Q1 (highest leverage): can a trajectory be fetched by the run-id you set, or only via `pool history sessions`
  lookup / `--latest`?** If correlation needs the sessions hop, it's a runner-design input that must be proven in
  the spike (item 1) *before* the matrix (item 10); if only `--latest` works, arms must run **serially**. Pulls
  correlation forward into Track 1.
- **Q2: is the named agent's `model_id`/sampling externally recoverable?** If no, item 2 can't be authored and the
  tool-disabled arm is blocked — confirming the §3 cut and keeping v0 on `--agent-name` only.
- **Q3: where does the skill's structured output physically appear** (final assistant text / workspace file / only
  ATIF)? This should be the *first* thing the ci-log-reducer pathfinder nails: it determines whether validators read
  stdout or the trajectory (items 10/11) and how much is dry-run-testable.
