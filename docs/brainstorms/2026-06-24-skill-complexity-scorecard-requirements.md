---
title: "Skill Complexity Scorecard Requirements"
date: 2026-06-24
topic: skill-complexity-scorecard
type: requirements
---

# Skill Complexity Scorecard Requirements

## Summary

Build a pre-GEPA skill complexity scorecard that analyzes a skill across user-facing routes, supporting assets, scripts/tools, documentation quality, and agent ergonomics; identifies decomposition hot spots and coarse or missing eval coverage; and emits atomic eval-case specs that can feed the existing bootstrap pipeline. The analyzer should be usable standalone and reused by GEPA as a warn-only diagnostic preflight, while GEPA continues optimizing against the actual eval and validator fitness rather than the scorecard itself.

---

## Problem Frame

Large skills can contain many behavior paths: trigger variants, procedural branches, references, scripts, assets, repair paths, and escalation paths. When a GEPA run optimizes such a skill against one broad prompt or a tiny suite, the feedback can be too muddy to improve the skill, even after many optimization calls.

The practical pain is not only that a skill is long. It is that the model may need to route a request into one of many flows, while the eval corpus gives GEPA little signal about which flow failed or which flow is missing coverage.

---

## Key Decisions

- **Route-organized, multi-dimensional analysis.** Treat user-facing routes and flows as the primary organizing axis because they map to behavior the skill promises, while still analyzing references, scripts, tools, documentation quality, and agent ergonomics as supporting dimensions.
- **One analyzer, two surfaces.** Expose the scorecard as a standalone diagnostic and have GEPA call the same analyzer as a preflight.
- **Diagnostic-only GEPA integration.** GEPA should display complexity and low-signal warnings but should not use the scorecard as the optimization target or block optimization in v1.
- **Bootstrap-compatible output.** The scorecard should emit candidate eval-case specs for uncovered or weak routes and clear cross-cutting obligations so quarantine, validation, automated review, and optional human review stay intact.
- **Advisory split guidance.** The scorecard may flag that a skill looks like multiple skills, but v1 should not automatically split skills.

---

## Actors

- A1. **Skill author or optimizer.** Runs the scorecard before investing in GEPA or eval-case generation.
- A2. **GEPA runner.** Invokes the scorecard as a preflight and surfaces warnings alongside normal optimization configuration.
- A3. **Eval-case bootstrapper.** Consumes emitted atomic case specs and turns them into quarantined candidate cases.
- A4. **Reviewer.** Reviews generated cases through the default automated review path or an explicit human-review mode before promotion into the frozen eval corpus.

---

## Requirements

**Scorecard analysis**

- R1. The scorecard identifies user-facing routes or flows in a skill and reports a route count with separate confidence and documentation-quality labels for each detected route.
- R2. The scorecard includes supporting complexity dimensions such as skill length, reference fanout, script/tool fanout, asset fanout, validator/schema surface, documentation quality, agent ergonomics, and procedural branch density.
- R3. The scorecard compares detected routes with the existing eval suite and marks routes as covered, weakly covered, or uncovered.
- R4. The scorecard assesses whether covered routes produce useful binary pass/fail outcomes with explanatory feedback that can guide optimization.
- R5. The scorecard distinguishes “large but simple” skills from skills that are complex because of routing, supporting assets, scripts/tools, documentation gaps, or cross-cutting obligations.
- R6. The scorecard includes an advisory split signal when the detected routes appear independent enough that one skill may be doing multiple jobs.

**GEPA preflight**

- R7. GEPA preflight displays the scorecard before optimization begins when the target skill appears complex or under-covered.
- R8. GEPA preflight warns when optimization is likely low-signal because the route count materially exceeds the route coverage in the suite or existing covered cases lack useful explanatory feedback.
- R9. GEPA preflight presents the scorecard as diagnostic context only; GEPA still optimizes against the selected eval and validator fitness.
- R10. GEPA preflight remains warn-only in v1 and provides an explicit override-free path to continue the run.

**Eval bootstrapping**

- R11. The scorecard emits concise atomic eval-case specs for missing or weak routes only when route confidence is high enough to support bootstrapping.
- R12. The scorecard can emit atomic specs for cross-cutting obligations when those obligations are clearer than any single route, such as false-trigger boundaries, artifact contracts, CLI/tool ergonomics, or shared validator behavior.
- R13. Each emitted case spec names the target route or cross-cutting obligation, intended bucket, scenario shape, required artifact behavior, route-confidence evidence when applicable, documentation-quality evidence, and why the case improves optimization signal.
- R14. Emitted case specs feed the generated-case pipeline rather than bypassing quarantine, validation, or review.
- R15. The scorecard avoids claiming a generated spec is a valid eval case until mechanical gates and the selected review mode have accepted it.

**Usability and trust**

- R16. The report explains why each warning fired in terms a skill author can act on before running GEPA.
- R17. The report marks uncertain route detections as low confidence instead of turning them into mandatory work or bootstrap-ready specs.
- R18. The report marks routes that are behaviorally clear but poorly documented as high-confidence, low-documentation-quality routes.
- R19. The report stays digestible by presenting the full objective analysis as atomic findings with optional pre-review or prioritization before expensive generation or GEPA runs.
- R20. The report can compare an imported skill against a curated reference bank of high-quality skills to explain structural differences without treating those examples as Laguna ground truth.
- R21. The report is machine-readable enough for GEPA and bench surfaces to consume, while still producing a human-readable summary.

---

## Key Flows

- F1. **Standalone diagnosis**
  - **Trigger:** A skill author wants to know whether a skill is too broad for useful GEPA optimization.
  - **Actors:** A1
  - **Steps:** The author runs the diagnostic, reviews the full route and coverage summary, optionally confirms or prioritizes identified flows, and decides whether to add atomic cases before optimizing.
  - **Outcome:** The author has a scorecard, split advisory if applicable, and candidate case specs for weak or missing routes or obligations.
  - **Covered by:** R1, R2, R3, R6, R11, R16, R18

- F2. **GEPA warn-only preflight**
  - **Trigger:** A user starts GEPA on a skill with route complexity or sparse eval coverage.
  - **Actors:** A1, A2
  - **Steps:** GEPA runs the analyzer, displays scorecard warnings, and continues optimization unless the user chooses to stop manually.
  - **Outcome:** The user sees low-signal risk before spending calls without turning the scorecard into the optimization metric.
  - **Covered by:** R7, R8, R9, R10, R21

- F3. **Atomic case bootstrapping**
  - **Trigger:** The scorecard finds uncovered or weakly covered routes.
  - **Actors:** A1, A3, A4
  - **Steps:** The scorecard emits case specs, the bootstrapper turns specs into mechanically validated quarantined candidates, and the selected review mode decides which accepted cases are promoted.
  - **Outcome:** Large-skill optimization gains atomic eval signal without weakening eval corpus review discipline.
  - **Covered by:** R11, R12, R13, R14, R15

---

## Acceptance Examples

- AE1. **Large route surface with thin coverage**
  - **Covers:** R1, R3, R8, R11
  - **Given:** A skill has many detected user-facing flows and only a few broad eval cases.
  - **When:** GEPA starts with preflight enabled.
  - **Then:** The preflight warns that optimization may be low-signal and lists atomic case specs for high-confidence uncovered or weak flows, without changing the GEPA target metric.

- AE2. **Long but linear skill**
  - **Covers:** R2, R5, R16
  - **Given:** A skill is long because it has extensive examples or references but only one clear workflow.
  - **When:** The standalone diagnostic runs.
  - **Then:** The scorecard reports size complexity without recommending a route explosion or skill split.

- AE3. **Possible split candidate**
  - **Covers:** R6, R17, R18
  - **Given:** A skill contains independent flows with distinct triggers and little shared procedure.
  - **When:** The scorecard analyzes the skill.
  - **Then:** The report marks it as a split candidate with confidence, but does not rewrite or split the skill.

- AE4. **High-confidence but poorly documented route**
  - **Covers:** R1, R13, R18
  - **Given:** A skill clearly names a supported behavior but refers vaguely to supporting references without linking the route to a specific file.
  - **When:** The scorecard analyzes the route.
  - **Then:** The route is high confidence but low documentation quality, and any emitted case spec carries both labels.

- AE5. **Generated specs stay quarantined**
  - **Covers:** R13, R14, R15
  - **Given:** The scorecard emits case specs for uncovered routes or cross-cutting obligations.
  - **When:** The specs are passed to the existing bootstrap path.
  - **Then:** They become candidate cases only through the normal generated-case validation and selected review flow.

---

## Success Criteria

- A skill author can tell before GEPA whether a skill is likely too route-complex for the current suite.
- A GEPA run on a large skill surfaces low-signal risk before spending optimization calls without treating the scorecard as fitness.
- The scorecard identifies when an existing case needs clearer binary judgment and explanatory feedback instead of more quantitative submetrics.
- The scorecard produces actionable atomic case specs for weak or missing routes and for clear cross-cutting obligations.
- The scorecard can use a curated high-quality-skill bank as structural reference material while still validating improvements against Laguna eval outcomes.
- The feature preserves the distinction between generated candidates and reviewed eval corpus entries.
- False positives are tolerable when low-confidence routes remain advisory rather than bootstrap-ready.

---

## Scope Boundaries

- V1 does not automatically split a large skill into multiple skills.
- V1 does not auto-promote generated eval cases without the selected review mode accepting them.
- V1 does not treat the scorecard as evidence that a skill improved or as the GEPA optimization target.
- V1 does not require GEPA to stop when the scorecard warns.
- V1 does not need perfect route detection; it needs useful route-confidence and documentation-quality guidance.

---

## Dependencies / Assumptions

- The generated-case pipeline remains the authority for quarantine, validation, review mode selection, and promotion.
- The GEPA optimization loop can run a preflight diagnostic and display its output before starting metric calls while preserving the selected eval and validator fitness as the optimization target.
- Route detection can start as a best-effort analysis if uncertain detections are labeled and do not block work or emit bootstrap-ready specs.
- Current eval suites may be too small for route-level optimization signal on large skills, so case specs are part of the product surface, not a later nice-to-have.
- Existing high-quality skills are useful reference material for structure and ergonomics, but their performance with stronger models is not proof that the same structure is suitable for Laguna models.

---

## Outstanding Questions

### Deferred to Planning

- What deterministic evidence should map a route into low, medium, or high confidence?
- What deterministic evidence should map a route into low, medium, or high documentation quality?
- Which agent-ergonomics checks should be reused as subanalysis inputs?
- Which skills belong in the curated high-quality reference bank, and what structural traits should the scorecard learn from them?
- What pre-review affordance should let users confirm, correct, or prioritize identified flows before expensive generation or GEPA runs?
- What thresholds should map route count, coverage, script/tool fanout, documentation quality, and asset fanout into low, medium, or high complexity?
- What exact format should emitted case specs use so the bootstrapper can consume them reliably?
- How should the analyzer match existing eval cases to detected routes without overclaiming coverage?
- Which scorecard fields should be stable machine-readable contract fields versus human-only report text?

---

## Sources / Research

- `docs/external-skill-bootstrap.md` documents generated candidates under `runs/generate/`, validation, and the current human promotion flow that this enhancement preserves as an optional stricter mode.
- `harness/generate/gen_eval_cases.py` defines the synthesize, validate, human-review generation pipeline.
- `docs/gepa-optimization.md` documents GEPA’s frozen eval contract and warns against full-monolith optimization for large imported prompt skills.
- `harness/optimize/gepa_skill.py` shows GEPA optimizing selected skill components against frozen cases.
- `docs/authoring-guide.md` defines progressive disclosure across `SKILL.md`, `references/`, and `scripts/`.
- `evals/README.md` defines the case directory, suite, and validator contracts.
