# §8 Workstream B: Skill evaluation (prove the skills work)

> Full workstream detail · Router: [`../../laguna-skills-and-harness-substrate-2026-06-10.md`](../../laguna-skills-and-harness-substrate-2026-06-10.md) (§8) · Map: substrate §3 · Decisions: substrate §13 · Index: [`README.md`](README.md)
> Data contracts referenced here: [`../contracts/validator-result-v1.md`](../contracts/validator-result-v1.md), [`../contracts/run-artifact-manifest.md`](../contracts/run-artifact-manifest.md).

**Scope:** The eval harness/runner, eval-case format, metrics, validators, acceptance gates, benchmark table.
**Source proposal:** Plan A (eval matrix arms, case folder format, metrics dashboard, per-skill validators,
public acceptance criteria) + Plan B PR1 (external runner using *today's* `pool exec`) and PR7 (eventual native
`pool eval`).

**Start here: what you can measure today.** `pool exec` *is* a usable measurement primitive (§6.4): with Laguna
access resolved (Workstream D), the skills repo can run a real-but-rough with/without loop now. Author and run
workspace skills, capture stdout/stderr/exit code/NLJSON, recover trajectories via `history`, and grade with
code-based validators plus a calibrated judge. The concrete ladder (error-analysis first) is in §3.2; these runs
are gold for iteration and internal evidence.

Three known rough edges make today's runs **hard to interpret for *published* claims**. Read them as *why the
first harness PRs raise rigor*, not as reasons evals can't start (all verified):
1. **No isolation**: defaults auto-install + user-global skills merge in (§6.2); a clean "no-skill" arm needs the isolated-HOME workaround until PR3.
2. **No structured telemetry**: activation/tool-call/repair metrics need brittle NLJSON / stderr parsing until PR5 (§6.5).
3. **No stable artifacts**: must scrape `history` / parse stderr until PR4 (§6.6).

**Open decisions (context; each is indexed in the Decision register, §13):**
- **Where does the eval runner live?** Plan B says: **external runner in the `skills` repo first** (PR1), move
  the stable subset into `pool eval` (PR7) only after it proves out. Confirm this boundary.
- **Eval matrix scope:** which arms are v0 (Plan A lists: XS.2 no-skill / XS.2+skill / M.1 no-skill / M.1+skill /
  M.1-router+XS.2-worker, plus optional external baselines). Router arms depend on M.1 routing maturity.
- **Validator strategy per skill:** Plan A already specifies output schemas + validators for `ci-log-reducer`,
  `repo-map`, `stack-trace-router`, `single-file-patch`, `regression-test-generator`, `patch-risk-review`.
  These are strong; the planner should treat them as the v0 validator spec.
- **Metrics + acceptance gates:** Plan A's gates (schema validity ≥95%, ≥15–20 pp lift over no-skill, repair
  success ≥50%, instruction violations <5%, no core-case regressions). Decide which are blocking for v0.
- **Case corpus sourcing:** real CI failures / issues / diffs / stack traces (Plan A authoring loop step 1).
  Where do seed cases come from, and who labels gold outputs? (Publishing them depends on Workstream G, §10.)
- **Model access:** how we actually invoke Laguna XS.2 / M.1. This is consolidated in **Workstream D: Model access**
  (§10), which **gates all of Workstream B**.
- **Isolation controls (be concrete):** spell out how *each arm* achieves isolation: tool-disabled vs empty-registry vs workspace-only vs isolated HOME. `SkipDefaultSkillInstall` alone is insufficient (§6.2).
- **Router-to-worker arm feasibility:** it is **unknown whether today's `pool exec` can represent an M.1-router-to-XS.2-worker run at all.** Treat this arm as *unavailable until the invocation mechanism is designed* (Workstream D, §10); do not assume it's just another matrix row.
- **Eval-runner boundary (PR1):** may shell out to `pool` and read hidden `history`; must **not** import `forge` internals; must treat hidden flags (`--run-id`, `--agent-config-file`) as **unstable** and log every fragile dependency it relies on (see *Harness constraints*, §9).
- **Data/privacy (public repo):** cases mined from real CI logs/issues/diffs/stack traces need a redaction + allowed-corpora + PII/secrets + IP/license policy, plus a decision on whether fixtures/artifacts may be published. That is **Workstream G** (§10).

### 8.1 Minimum validator runtime contract

To add before real evals: validators should be executable under a fixed runtime (Python/`uv`, Go, or explicitly
mixed), default to no network, enforce timeouts, consume deterministic input/output paths, capture stdout/stderr,
and emit a machine-readable `validator-result.v1` object. That schema is a data contract; the canonical definition (with the JSON shape) lives at [`../contracts/validator-result-v1.md`](../contracts/validator-result-v1.md).
It is embedded into the run-artifact manifest ([`../contracts/run-artifact-manifest.md`](../contracts/run-artifact-manifest.md)),
and its `repair_feedback` is what drives the repair loop. The planner must also define **how repair-loop feedback
is derived from validator errors**.

### 8.2 Minimum statistical acceptance policy

To add before publishing lift claims: define minimum case count and/or repeat count per compared arm,
seed/temperature controls when available, confidence/uncertainty reporting, flake quarantine rules, and
human-labeling protocol for gold outputs. Early smoke results can guide work, but the public catalog/README
should not claim lift until the methodology says the comparison is strong enough.

**LLM-judge calibration:** any LLM-as-judge metric must be validated against the human-labeled gold set before it
counts as evidence; report judge↔human agreement (e.g., TPR/TNR) and correct for judge bias. An uncalibrated
judge is not acceptable evidence (cf. `hamelsmu/evals-skills`).
