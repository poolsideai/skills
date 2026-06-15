# Eval Methodology (v0)

> Status: v0. **All numbers produced under this methodology are internal and directional. None are
> publishable lift claims.** (See [Reporting policy](#7-reporting-policy-internal--directional-only).)
> Plan: `docs/plans/laguna-skills-v0-2026-06-10.md` (work item 8).
> Substrate: `.resources/investigations/laguna-skills-and-harness-substrate-2026-06-10.md` (§3.2, §6.2, §6.4, §6.5, §8.2).
> Case format and gold replay: `evals/README.md`. Authoring gates: `docs/authoring-guide.md`.

## 1. What this measures

Each skill in this library carries an output schema, an executable validator, and eval cases. The
question the eval loop answers is narrow: **does materializing this skill into the workspace improve
Laguna's verified outcomes on the skill's cases, compared to the same model with no skill available?**
The runner (`harness/runner/`, plan item 10) drives today's `pool exec` as a
subprocess, with no forge changes. Everything here is bounded by what that CLI
surface exposes today.

## 2. The v0 arm matrix

Four arms, two models × with/without the skill under test:

| Arm | Model (`--agent-name`) | Skill materialized? |
|---|---|---|
| `xs_without_skill` | Laguna XS.2 | no |
| `xs_with_skill` | Laguna XS.2 | yes |
| `m_without_skill` | Laguna M.1 | no |
| `m_with_skill` | Laguna M.1 | yes |

Each eval case declares which subset of these arms it runs in (`arms` in its `metadata.json`; see
`evals/README.md`). Agent-name → model mapping, quotas, and cost reporting are documented by the
model-access spike (`docs/model-access-spike.md`, plan item 1).

**Deferred arms (not in the v0 matrix):**

- **M.1-router → XS.2-worker.** Assumed not representable in today's `pool exec` (decision register #2);
  the spike confirms either way, but the arm stays out of v0 regardless.
- **Skill-tool-disabled baseline.** "Tool disabled" and "tool enabled with zero skills" are different
  experimental controls (substrate §6.2). v0 baselines are the latter. The tool-disabled arm requires
  `--agent-config-file` machinery deferred past v0.

## 3. Per-arm isolation recipe

The invariant: **the only difference between a with-skill arm and its baseline is the skill materialized
into the workspace.** Same prompt, same fixture files, same agent name, same flags, same isolation.

For every arm, the runner (`harness/runner/fixtures.py`):

1. **Creates a fresh temporary workspace** and copies the case's `input/` into it. `pool` is never
   pointed at the skill source tree or the case directory itself.
2. **For with-skill arms only**, copies `skills/<name>/` into `<workspace>/.poolside/skills/<name>/`,
   the discovery path `pool exec` actually scans. Skipping this makes the with-skill arm silently
   identical to baseline.
3. **Runs `pool exec` under an isolated HOME** with an empty user-global skills dir
   (`$HOME/.config/poolside/skills/`), so the developer's real user-global skills
   (e.g. `skill-creator`) can never contaminate either arm.
4. **Leaves the skill tool enabled in both arms.** It is on by default in `pool exec`, and there is no
   public flag to disable it. The baseline is therefore *skill tool enabled, zero project skills
   available*. The model sees the tool report no usable skills, not an absent tool.

Known residue, accepted for v0: `pool` auto-installs its embedded default skills
(`configure-sandbox`, `pool-product-reference`, `skill-creator`) into the user-global dir on registry
init, even under a fresh HOME. This residue is **identical across all arms**, so the with/without
comparison stays controlled, but it means the baseline is not a literal zero-skill environment. The
runner logs this (and every other isolation workaround) as harness debt in each run manifest; PR3
(real isolation flags) is the cleanup.

## 4. The gradeable-artifact rule

Every skill's Output contract names a **deterministic workspace path** where the gradeable JSON
artifact lands (or, for patch skills, the diff target in the tree). The prompt names that path; the
validator reads it from the workspace after the run.

**Validators grade workspace state plus the final message. They never grade stringified NLJSON tool results.**
Today's `pool exec -o json` stringifies every tool-call result (`fmt.Sprint`, substrate §6.5); parsing
those strings for grading is brittle and will silently change when PR5 restructures telemetry. NLJSON
is used for exactly one metric, activation, and even that use is flagged as harness debt.

## 5. Metrics computable today

All computed per case × arm by the runner, from four sources: workspace state after the run, the
validator result (`validator-result.v1`), the `pool exec` process (exit code, timing, NLJSON stream),
and the recovered trajectory.

| Metric | Definition | Source |
|---|---|---|
| **Schema validity** | Gradeable artifact exists at the contract path and validates against the skill's output schema (`skills/<name>/schemas/*.schema.json`). | workspace state |
| **Validator pass rate** | Validator `status` equals the case's `validator.expected_status` (good-failure cases expect `fail`; see `evals/README.md`). | validator result |
| **Activation** | NLJSON stream contains `{"type":"toolCall","name":"skill","args":{"name":"<skill>"}}` for the skill under test. With-skill arms should activate; baselines cannot (the skill is absent). Brittle parse; logged as debt until PR5. | NLJSON |
| **Exit code** | `pool exec` exit status: `0` success, `4` agent-indicated failure, anything else = unexpected/harness error (excluded from pass-rate denominators, reported separately). | process |
| **Latency** | Wall-clock duration of the `pool exec` subprocess; validator `duration_ms` reported separately. | process / validator result |
| **Repair success** | Among runs whose trajectory shows ≥1 failed in-run validator invocation (the skill instructs the model to run its own validator and repair), the fraction whose final artifact passes the harness-side validator. Approximate: depends on trajectory recovery; flagged as debt. | trajectory + validator result |
| **Instruction violations** | Count of failed constraint checks in `checks[]` (invented paths, file-count limits, unsafe/non-local commands, broad refactors), plus violations flagged during transcript reading. | validator result + error analysis |
| **Tool-call count** | Number of `toolCall` events in the NLJSON stream. Crude effort/efficiency proxy. | NLJSON |

Aggregation: per skill, the report (`harness/runner/report.py`, plan item 12) renders case × arm rows
with validator status, schema validity, activation, duration, and accumulated harness debt.
Reports are watermarked internal/directional.

## 6. Error-analysis-first discipline

Per substrate §3.2: **measurement leads and graders follow.** Once runs work for a skill, before
adding any new grader (and before trusting any aggregate number):

1. Run the skill on 20–50 real cases via `pool exec`.
2. **Read the transcripts**: outputs and trajectories, not just validator verdicts.
3. Open-code the failures; cluster them into a per-skill failure taxonomy; count frequencies.
4. Only then decide which checks to add to the validator, which cases to author next, and which
   harness PRs (PR2–PR7) the evidence actually justifies.

The deliverable is a per-skill error-analysis note (the v0 exit criteria require one for
`ci-log-reducer`). A grader added without a failure taxonomy behind it is guessing at what matters.
LLM-as-judge metrics are out of v0 entirely: an uncalibrated judge is not acceptable evidence, and
calibration (judge↔human agreement on a labeled set) is part of the deferred acceptance policy below.

## 7. Reporting policy: internal / directional only

Every number produced under this methodology is labeled **internal/directional**. v0 deliberately
defers the statistical acceptance policy (substrate §8.2): minimum case/repeat counts per compared
arm, seed/temperature controls, confidence reporting, flake quarantine, judge calibration, and the
human-labeling protocol for gold outputs. Publishable lift claims additionally wait on real isolation
(PR3), stable artifacts (PR4), structured telemetry (PR5), and the fixture data/privacy call
(decision register #9).

Concretely: v0 readouts may say "directionally, `ci-log-reducer` improved validator pass rate on this
internal suite" and feed prioritization. They may not appear in the README, catalog, or any external
material as lift claims.

GEPA optimization runs are candidate-selection evidence, not release evidence. They select a possible
`SKILL.md` rewrite against a small train/validation split; accepting a candidate still requires human
review, normal structure checks, and a full skill eval run. LM-generated eval cases are also internal
until a human reviews and promotes them into `skills/<skill>/evals/`.

## 8. Workbench and node-level evals

The workbench broadens the operational surface without changing the v0 lift methodology above. It
shows workflow runs, eval arms, playground records, and node evals as trajectory records. That is useful
for diagnosis and iteration, but only the case × arm harness matrix above supports with-skill vs
without-skill comparisons.

Node-level evals have two modes:

- **In-workflow:** grade nodes from a real Smithers run using the installed skill's validator when one
  exists. This costs no model calls, but the node workspace can be overwritten by later runs.
- **Standalone:** re-run one workflow node in fresh trial workspaces and grade each trial. This is a
  prompt/skill tuning aid, not a publishable benchmark by itself.

Use node-level results to find failures worth reading, create new eval cases, or decide which skill
prose to improve. Do not report them as skill lift without promoting the scenario into the frozen eval
corpus and running the normal harness matrix.

## References

- Plan: `docs/plans/laguna-skills-v0-2026-06-10.md` (items 8, 10, 12)
- Substrate: `.resources/investigations/laguna-skills-and-harness-substrate-2026-06-10.md`
  (§3.2 measurement ladder; §8.2 acceptance policy)
- Verified CLI/telemetry state: `.resources/investigations/laguna-substrate/verified-state/`
  (`6.2` discovery/isolation, `6.4` exec surface + exit codes, `6.5` activation/NLJSON)
- Case format + gold replay: `evals/README.md`
- Methodology reference: `hamelsmu/evals-skills` (error analysis, judge calibration)
