# Substrate: Laguna skills library + eval + Pool harness

Type: Investigation substrate: verified facts plus decision points. Not a plan.
Audience: A downstream *planning agent* that will produce the execution plan.
Date: 2026-06-10. Author: investigation pass over the two source plans and the `pool`/`forge` codebase.

---

## 0. How to use this document

This is source material for a planning agent. It covers skill creation, skill evaluation, and the `pool` harness changes. Facts are either verified with `file:line` evidence or explicitly marked as unverified / attributed.

Read in this order:

1. Start with §1 and §2 for the problem and goal.
2. Use §3 for the workstream map, dependencies, what can start now (§3.1), and what can be measured today (§3.2).
3. Treat §6 as the verified codebase-state router. Use the §12 appendix when you need the source-doc reconciliation table.
4. Resolve the open calls in §7-§10, using the §13 appendix as the master decision register.
5. Keep the four data contracts in §11 aligned: per-skill output schemas, validator results, run-artifact manifests, and telemetry events.
6. Use §14 when you only need the raw `file:line` anchors.

Non-negotiable: this is a validator-first skills library, not a prompt pack. Every skill needs a machine-readable output contract, an executable validator, and with-skill vs without-skill eval evidence. The harness work exists to measure that evidence.

When this doc says "recommended," "should," or "the likely path," read it as a default the planner may override, not a settled decision. The open calls are consolidated in the §13 appendix.

All `forge` paths below are relative to `/Users/ben/code/poolside/forge/`. All `skills` paths are relative to `/Users/ben/code/poolside/skills/`.

---

## 1. Why this exists

Poolside is winding down its product surfaces. The `pool` CLI, the Pool Harness, is becoming the main supported way to use Poolside's Laguna models and the models that follow them. Laguna's results depend heavily on the harness around the model: tools, scaffolding, skills, and prompts. In practice, the harness is the product surface.

The strategy is developer enablement: ship the assets that let people drive Laguna effectively themselves. Skills are the starting point. Later additions may include MCP servers, CLI tools, and prompt-optimization tooling (for example DSPy or GEPA) for improving skill prompts. The eval harness matters because it captures the usage and feedback data needed to keep improving both Poolside's harness and users' own harnesses.

---

## 2. The goal

Build a public-facing library of **Agent Skills** (standard `SKILL.md` directories) optimized for Poolside's
**Laguna** models (XS.2 as a bounded coding worker; M.1 as a constrained router/planner). The library is
"go-to-market" content: **skill files only, no model training**. It still needs an **evaluation
harness** that proves each skill improves Laguna's *verified* outcomes (pass rate, cost-of-pass,
time-to-verified-success). The eval substrate is `pool exec`; making it eval-grade requires a set of
**`pool` (forge) changes** for skill isolation, telemetry, artifacts, and remote-skill parity.

---

## 3. Workstreams and sequencing

There are eight workstreams. A-C are the core deliverables. D-H support those core streams, and D gates the eval work. Every open decision across all eight is indexed in the decision-register appendix (§13).

| Workstream | Scope (one line) | Key dependency |
|---|---|---|
| **[A: Skill creation](laguna-substrate/workstreams/A-skill-creation.md)** (§7) | Author the `SKILL.md` library: contracts, `references/`, `schemas/`, `scripts/`, `evals/`. | Fixture discovery layout must actually expose skills to the with-skill arms (§6.2). |
| **[B: Skill evaluation](laguna-substrate/workstreams/B-skill-evaluation.md)** (§8) | Prove each skill lifts Laguna's *verified* outcomes (runner, cases, validators, metrics, gates). | **Gated by Workstream D**; needs C's isolation/telemetry/artifacts to interpret cleanly. |
| **[C: Pool (forge) harness changes](laguna-substrate/workstreams/C-pool-harness-changes.md)** (§9) | The PR1-PR7 sequence that makes `pool exec` eval-grade. | External runner (PR1) before native `pool eval` (PR7). |
| **[D: Model access & eval configs](laguna-substrate/workstreams/D-H-cross-cutting.md)** (§10) | How we actually invoke Laguna XS.2 / M.1 + the canonical eval-agent config files. | **Gates all of Workstream B**; fact-gap on IDs/credentials/quotas. |
| **[E: Repo infra / CI / release](laguna-substrate/workstreams/D-H-cross-cutting.md)** (§10) | Mechanically enforce Plan A's authoring + acceptance gates (schema/validator/lint/golden/version checks). | Encodes A's authoring gates + B's validators. |
| **[F: GTM public catalog](laguna-substrate/workstreams/D-H-cross-cutting.md)** (§10) | Optional public skills directory. | Out of v0 unless Ben scopes it in. |
| **[G: Data / privacy / IP](laguna-substrate/workstreams/D-H-cross-cutting.md)** (§10) | Redaction + IP/license policy for cases mined from real logs/issues/diffs. | Gates publishing B's fixtures/artifacts. |
| **[H: Remote-skill supply chain & pinning](laguna-substrate/workstreams/D-H-cross-cutting.md)** (§10) | Pin / digest / trust for repository-backed skills. | Prerequisite (with PR2) to evaluating *remote* skills. |

**Gating edges the planner must respect:**

- **Model access (D) gates the evaluation workstream (B)**: no evals until we can invoke Laguna.
- **Remote-skill parity (PR2) is a prerequisite to evaluating remote skills** through `pool exec`, and pairs
  with **Workstream H** to make those evals reproducible.
- **The external eval runner (PR1) comes before any native `pool eval` (PR7).**
- **Data/privacy policy (G) gates publishing any eval fixtures or artifacts.**
- **Skill `description` quality (A) gates activation metrics (B)**: discovery is description-driven (§6.5).
- **The four Data contracts (§11) must stay mutually consistent.**

**Ownership / sequencing:** Workstreams A + B can proceed in the `skills` repo independently; Workstream C
requires `forge` access + review (tracked in the decision-register appendix, §13).

### 3.1 What's buildable now vs. what needs the harness

Two streams run in parallel; keep them distinct so the planner doesn't treat harness work as a prerequisite
to starting.

- **Stream 1: buildable now (zero harness changes).** Author the full skill library (Workstream A) and run a
  *real but rough* with/without eval loop on **today's `pool exec`** via an external runner (Workstream C / PR1,
  which is **not** a forge change; skills already run in `pool exec`, §6.2). Enough to start measuring this week.
- **Stream 2: harness hardening (parallel / later).** PR2-PR7 make those evals isolated, reproducible,
  automated, and ergonomic, and unlock remote-skill and router-to-worker evaluation. They raise the **ceiling** on
  rigor; they are not the **floor** for starting.

**Invariant: buildable now is not publishable now.** Workstream A and a rough Workstream B runner can begin
immediately; **public lift claims wait** for isolation, reproducible artifacts, structured telemetry, and the
statistical acceptance policy (§8.2). This *is* the validator-first directive: validators and cases start now;
harness hardening improves the quality of the evidence.

| Capability | Works today? | Rough edge now | Harness PR that cleans it up |
|---|---|---|---|
| Author skills + schemas + validators | Yes | none material | n/a |
| Run local / workspace skills | Yes | must use `.poolside/skills` / `.agents/skills` discovery layout (§6.2) | n/a |
| With/without eval loop | Yes (external runner, PR1) | contamination; manual artifact scraping | PR3 / PR4 |
| Clean "no-skill" arm | Workaround | isolated HOME / custom agent config; no public CLI flag today | PR3 |
| Structured metrics | Partial | parse NLJSON `toolCall` + stderr / `history` | PR5 |
| Reproducible artifacts | Partial | scrape `history` | PR4 |
| Remote-skill evals | No (via exec remote repos) | approximate by materializing the skill locally | PR2 (+ Workstream H) |
| Router-to-worker evals | Unknown | may not be representable | needs design (Workstream D) |
| Publishable lift claims | Not yet | isolation / telemetry / stats immature | PR3/4/5 + stats policy (§8.2) |

*Most "Works today" rows assume Laguna invocation is resolved (Workstream D, §10).*

### 3.2 What you can measure today without no harness changes

The highest-ROI eval work is mostly **methodology rather than infrastructure**, and it runs today by executing
the model and inspecting outputs. **Measurement leads and harness follows:** start here, because what these runs
reveal tells you which harness PRs actually earn their keep. (Methodology reference: Hamel Husain's
`hamelsmu/evals-skills`, which covers error analysis, synthetic data, and judge calibration.)

0. **Error analysis first (pure methodology, highest ROI).** Run each skill on 20–50 real cases via `pool exec`;
   read the outputs + trajectories; open-code the failures; cluster into a per-skill failure taxonomy; count
   frequencies. Output: what's actually broken, and which graders to build.
1. **A small gold / labeled set.** Hand-label correct outputs for ~10–30 cases per skill (a lightweight review
   pass). Your ground truth + seed corpus.
2. **Code-based graders on captured output (deterministic).** Check schema validity against each skill's output contract, then use mechanical checks where they exist:
   - `single-file-patch`: patch applies and tests pass.
   - `regression-test-generator`: test compiles, fails before the fix, and passes after the fix.
   - `ci-log-reducer`: reduced log contains the gold root-cause lines.
   - `stack-trace-router`: routed file/symbol matches gold.

   Also track constraint adherence (≤N files changed, no broad refactor, no invented paths), rough skill activation (parse NLJSON `toolCall name=="skill"`), determinism (run k×), latency, and cost.
3. **Calibrated LLM-as-judge for subjective quality** (`repo-map` usefulness, log-reduction quality, routing
   rationale). Discipline: **measure judge↔human agreement (TPR/TNR) on the labeled set and report it before
   trusting the judge** (§8.2).
4. **Directional comparisons** (with/without skill; XS.2 vs M.1) using the isolated-HOME workaround for a
   passable no-skill arm. Internal/directional only; publishable numbers wait per the invariant above.

---

## 4. Source materials & how to read them

| Doc | Path | What it is | How to read it |
|---|---|---|---|
| Plan A | `.resources/investigations/laguna-skills-plan-approach.md` | The **skills + eval strategy**: positioning, repo structure, the standard skill contract, first 6 skills, eval matrix/metrics/validators, acceptance gates, authoring loop. | The *what to build* and *what "good" means*. Strongest parts: the per-skill output schemas + validators (§"Validators by skill") and the acceptance gates. Treat the roadmap/phases as **a proposal**, not a decision. |
| Plan B | `.resources/investigations/laguna-skills-plus-pool.md` | The **pool harness PR plan**: PR1-PR7 turning `pool exec` into a reproducible eval substrate (external runner -> remote-skill parity -> isolation controls -> artifacts -> telemetry -> model-config -> native `pool eval`). | The *how to measure it*. Every premise here was **verified true** (§6, §12). Read it as a menu of harness capabilities + their start-file pointers. |
| Comp | `.resources/comps/jeffreys-skills/` | Screenshots + design findings of a **public skills-directory website** (catalog-first: search, category tabs, difficulty tags, install counts, "skill packs"). | Optional GTM/presentation reference only (see Workstream F, §10). The repo also has starter static pages (`index.html`, `skill.html`, `styles.css`), but those are **non-authoritative mock-up/prototype material** and should not drive the technical plan unless Ben explicitly scopes catalog work in. |

**Relationship between A and B:** A defines the library + eval methodology; B defines the `pool` plumbing that
makes A's evals reproducible and honest. They are complementary, not overlapping. A's "Eval harness" section
assumes capabilities (skill isolation, structured telemetry, stable artifacts) that B shows **do not exist yet**.
That gap is the core of the harness workstream (Workstream C).

---

## 5. Environment ground truth

- **Two repos in play, only partially loaded:**
  - `skills/`: the target library repo. It has `LICENSE`, `README.md`, `.resources/` (the two plans + comp +
    this substrate), and starter static-page mock-ups (`index.html`, `skill.html`, `styles.css`) that are
    **non-authoritative** for this technical planning pass. Git history is a single `Initial commit` (`9339131`);
    the current working tree contains untracked investigation/prototype materials plus a modified README.
    **No actual skill directories, harness, schemas, validators, or `AGENTS.md` yet.**
  - `forge/cmd/pool/`: the loaded slice of the `forge` monorepo (the `pool` CLI command layer).
- **The harness code lives outside the loaded workspace root.** The full monorepo is on disk at
  `/Users/ben/code/poolside/forge/` (has `pkg/`, `cmd/`, `ui/`, bazel, etc.). All of Plan B's
  `pkg/poolcli/...`, `pkg/agent/llmtools/skill/...`, `pkg/agent/configbuilder/...` files **exist** but are
  **not** in a loaded RepoPrompt root. `read_file`/`context_builder`/oracle cannot see them; they were read
  via shell for this investigation. **Implication for the planner's agents:** to work Workstream C (the
  harness), load `forge` (or `forge/pkg`) as a workspace root, or use shell-based reads.

---

## 6. Current state

This section is a router, not the evidence dump. Each item gives the short verified state and the planning consequence. The detailed `file:line` evidence stays in the leaf docs under [`laguna-substrate/verified-state/`](laguna-substrate/verified-state/) (index: [`README`](laguna-substrate/verified-state/README.md)). §14 lists the same anchors without commentary.

### 6.1 Skill format & authoring constraints

Used by: Workstream A.

Frontmatter is limited to `name`, `description`, and optional metadata fields. `allowed-tools` is not supported, and `compatibility` is parsed but not enforced. Workstream A should follow the existing `skill-creator` / `metadata.version` conventions instead of inventing a new format.

Evidence lives in [`laguna-substrate/verified-state/6.1-skill-format-and-authoring.md`](laguna-substrate/verified-state/6.1-skill-format-and-authoring.md).

### 6.2 Skill discovery, registry & lifecycle

Used by: Workstream B, and Workstream C / PR3.

Skills are enabled by default in `pool exec`, and default/user-global skill discovery can contaminate a with/without eval. A clean no-skill arm needs real isolation. The useful part is that workspace skills already run on today's `pool exec`, so Workstream A can start before forge changes land.

Evidence lives in [`laguna-substrate/verified-state/6.2-discovery-registry-lifecycle.md`](laguna-substrate/verified-state/6.2-discovery-registry-lifecycle.md).

### 6.3 Remote-skill parity: exec vs ACP

Used by: Workstream C / PR2.

ACP can pass remote skill repositories into the runtime; `pool exec` does not. Remote-skill evals need PR2, or a temporary local-materialization workaround.

Evidence lives in [`laguna-substrate/verified-state/6.3-remote-skill-parity.md`](laguna-substrate/verified-state/6.3-remote-skill-parity.md).

### 6.4 `pool exec` CLI surface

Used by: Workstream C / PR3, PR4, and PR6.

`pool exec` has the normal execution flags and a few hidden ones, but no skill-selection flags, artifact-output flags, or `--model`. It also has a deprecated `--context-file` path, so the planner needs to decide how Laguna prompts get context.

Evidence lives in [`laguna-substrate/verified-state/6.4-exec-cli-surface.md`](laguna-substrate/verified-state/6.4-exec-cli-surface.md).

### 6.5 Skill activation & JSON telemetry

Used by: Workstream A, Workstream B, and Workstream C / PR5.

Current NLJSON is too sparse for clean activation and run-metadata metrics. Skill discovery is description-driven, which makes each skill's `description` part of the eval surface.

Evidence lives in [`laguna-substrate/verified-state/6.5-activation-and-telemetry.md`](laguna-substrate/verified-state/6.5-activation-and-telemetry.md).

### 6.6 Trajectory & artifact export

Used by: Workstream C / PR4.

`pool exec` writes trajectory state, but callers cannot choose a stable artifact directory. PR4 needs to make artifact output explicit instead of relying on `history` lookup or stderr scraping.

Evidence lives in [`laguna-substrate/verified-state/6.6-trajectory-and-artifact-export.md`](laguna-substrate/verified-state/6.6-trajectory-and-artifact-export.md).

### 6.7 Model config

Used by: Workstream D, and Workstream C / PR6.

`--agent-config-file` is already the reproducible model-matrix lever. PR6 should make that path easier to use; Workstream D still owns model IDs, base URL, credentials, quotas, and router-to-worker invocation semantics.

Evidence lives in [`laguna-substrate/verified-state/6.7-model-config.md`](laguna-substrate/verified-state/6.7-model-config.md).

---

## 7. Workstream A: Skill creation (the library content)

Delivers: the `SKILL.md` library, including contracts, `references/`, `schemas/`, `scripts/`, and `evals`. First skills: `laguna-task-contract`, `ci-log-reducer`, and `repo-map`. Verified anchors: §6.1, §6.2, §6.5.
Open calls (indexed in §13): authoring standard (`skill-creator` vs Plan A template), first-skill identity,
schema/validator-first gate, `allowed-tools` declaration, per-skill non-goals, fixture discovery layout, and
distribution mechanism (workspace / remote / embedded).
Full workstream: [`laguna-substrate/workstreams/A-skill-creation.md`](laguna-substrate/workstreams/A-skill-creation.md).

---

## 8. Workstream B: Skill evaluation (prove the skills work)

**Delivers:** the eval runner, case format, validators, metrics, and acceptance gates. **Measurable today** via
`pool exec` (§3.2, §6.4); the rough edges (isolation §6.2, telemetry §6.5, artifacts §6.6) are exactly what
PR3/4/5 clean up. **Gated by Workstream D** (§10). Includes **§8.1** the validator runtime contract (schema:
[`contracts/validator-result-v1.md`](laguna-substrate/contracts/validator-result-v1.md)) and **§8.2** the
statistical acceptance + judge-calibration policy.
Open calls (indexed in §13): runner location, eval-matrix arms, validator strategy, acceptance gates, corpus
sourcing, isolation controls, router-to-worker feasibility.
Full workstream: [`laguna-substrate/workstreams/B-skill-evaluation.md`](laguna-substrate/workstreams/B-skill-evaluation.md).

---

## 9. Workstream C: Pool (forge) harness changes

**Delivers:** the PR1–PR7 sequence that makes `pool exec` eval-grade (all premises verified, §6/§12). **PR1 is
the "now path"** (external runner in the `skills` repo, no forge change); **PR2–PR7** harden isolation,
artifacts, telemetry, model config, and remote-skill parity. Includes **§9.1** skill-policy flag semantics and
**§9.2** the run-artifact manifest (fields: [`contracts/run-artifact-manifest.md`](laguna-substrate/contracts/run-artifact-manifest.md)).
**Harness constraints:** `runPoolCLI` calls `os.Exit` (subprocess only); hidden flags are unstable; preserve
`-o json` back-compat.
Full workstream and PR table: [`laguna-substrate/workstreams/C-pool-harness-changes.md`](laguna-substrate/workstreams/C-pool-harness-changes.md).

---

## 10. Workstreams D-H: cross-cutting & supporting

The core (A-C) stalls without these; treat them as first-class.
- **D: Model access & eval configs** (*gates all of Workstream B*): how we actually invoke Laguna XS.2 / M.1; deliverable is the canonical eval-agent config files (§6.7).
- **E: Repo infra / CI / release**: mechanical enforcement of the authoring + acceptance gates.
- **F: GTM public catalog**: optional/non-authoritative unless Ben scopes it in.
- **G: Data / privacy / IP**: redaction + IP/license policy; gates publishing fixtures/artifacts.
- **H: Remote-skill supply chain & pinning**: pin/digest/trust; pairs with PR2.

Full detail: [`laguna-substrate/workstreams/D-H-cross-cutting.md`](laguna-substrate/workstreams/D-H-cross-cutting.md).

---

## 11. Data contracts (must agree)

Four machine-readable contracts run through the whole effort. They are defined in different workstreams but
must stay mutually consistent. A change to one forces a change in the others; treat them as one coupled schema set. The canonical definitions and consistency invariants live in
[`laguna-substrate/contracts/`](laguna-substrate/contracts/) (index: [`README`](laguna-substrate/contracts/README.md)).

| Contract | Defined in | Definition |
|---|---|---|
| **Per-skill output schema** | Workstream A | [contracts/per-skill-output-schema.md](laguna-substrate/contracts/per-skill-output-schema.md) |
| **Validator result** (`validator-result.v1`) | Workstream B, §8.1 | [contracts/validator-result-v1.md](laguna-substrate/contracts/validator-result-v1.md) |
| **Run-artifact manifest** | Workstream C, §9.2 | [contracts/run-artifact-manifest.md](laguna-substrate/contracts/run-artifact-manifest.md) |
| **Telemetry events** (PR5) | Workstream C, §6.5 / §9 (PR5) | [contracts/telemetry-events.md](laguna-substrate/contracts/telemetry-events.md) |

The coupling in one line: a skill's output conforms to its per-skill schema, and that schema is the validator's input. The manifest embeds a `validator-result.v1`; its model and skill fields must match the `runMetadata`, `availableSkills`, and `skillActivated` telemetry. If any of the four drifts, the eval numbers stop being comparable.

---

## 12. Source-doc claim reconciliation

The reconciliation table now lives in [`laguna-substrate/appendices/source-doc-claim-reconciliation.md`](laguna-substrate/appendices/source-doc-claim-reconciliation.md). Use it when you need to check which Plan A / Plan B claims were verified against code and which ones are still only attributed.

---

## 13. Decision register

The decision register now lives in [`laguna-substrate/appendices/decision-register.md`](laguna-substrate/appendices/decision-register.md). Use it as the master list of open calls before writing the execution plan.

---

## 14. Evidence index

*Flat anchor list. For the same anchors with prose nuance + verdicts, see the per-subarea leaves under [`laguna-substrate/verified-state/`](laguna-substrate/verified-state/) (router: §6).*

- Skill format/constraints: `pkg/agent/llmtools/skill/types.go:11-21, 39-61, 70-96, 102-109`
- Discovery dirs: `pkg/agent/llmtools/skill/local_registry.go:33, 41-43`
- Composite/dedupe: `pkg/agent/llmtools/skill/composite_registry.go:15-34`
- Remote registry: `pkg/agent/llmtools/skill/remote_registry.go:52, 68-78, 254`
- Default install/embed/versioning: `pkg/agent/llmtools/skill/default_skills.go:19-23, 31-43, 80-98`
- Default skills shipped: `pkg/agent/llmtools/skill/resources/default_skills/{configure-sandbox,pool-product-reference,skill-creator}/SKILL.md`
- Skill tool (activation surface + result): `pkg/agent/llmtools/skill/skill_tool.go:24-62, 70-87`
- Skill tool enabled by default: `pkg/agent/config/defaults.go:70`
- Registry construction (EnabledTools gate): `pkg/agent/configbuilder/builder.go:73-74, 411-425, 491, 550`
- exec to AgentRuntime Options (no remote skills): `pkg/poolcli/main.go:336-347`
- ACP sets remote skills: `cmd/pool/acp/agentrunner/runner.go:1323`
- exec CLI flags: `cmd/pool/exec_cmd.go` (whole `execCommand`)
- JSON telemetry: `pkg/poolcli/json_formatter.go` (whole file, 95 L)
- Trajectory store + URL: `pkg/poolcli/main.go:511, 521`
- History/ATIF export: `cmd/pool/history_cmd.go:66-99, 290-322, 436`
- Model config: `pkg/agent/config/config.go:64,159-190,206-215,260-285,543-546`; `pkg/agent/config/defaults.go:15,47`

*(All `forge` paths relative to `/Users/ben/code/poolside/forge/`. The `pkg/...` files are outside the loaded
workspace root; load `forge` as a root to work them.)*
