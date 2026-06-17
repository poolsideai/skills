# Documentation Index

Start at [`getting-started.md`](getting-started.md); [`concepts.md`](concepts.md) defines the
vocabulary and the offline-vs-credentials matrix.

## By audience

- **Newcomer**: [`getting-started.md`](getting-started.md), then the root [`README.md`](../README.md).
- **Skill author**: [`authoring-guide.md`](authoring-guide.md) (binding) + [`external-skill-bootstrap.md`](external-skill-bootstrap.md) + [`../evals/README.md`](../evals/README.md) + [`../schemas/common/README.md`](../schemas/common/README.md).
- **Evaluator**: [`eval-methodology.md`](eval-methodology.md) + the root README's common workflows.
- **Skill optimizer**: [`gepa-optimization.md`](gepa-optimization.md) + [`plans/skill-optimization-gepa-2026-06-11.md`](plans/skill-optimization-gepa-2026-06-11.md).
- **Harness developer**: [`plans/laguna-skills-v0-2026-06-10.md`](plans/laguna-skills-v0-2026-06-10.md) + [`../harness/fixtures/README.md`](../harness/fixtures/README.md) + the two spike docs.
- **Workbench / UI developer**: [`../ui/README.md`](../ui/README.md) + [`../plans/README.md`](../plans/README.md) (workbench redesign plans).
- **Smithers workflow author/operator**: [`smithers.md`](smithers.md) + the root
  `.smithers/` workflow pack.
- **AI agent working in this repo**: [`../CLAUDE.md`](../CLAUDE.md) (binding).

## All docs

- [`getting-started.md`](getting-started.md): first-session walkthrough, offline first.
- [`concepts.md`](concepts.md): glossary + credentials matrix.
- [`authoring-guide.md`](authoring-guide.md): binding skill authoring standard (the two hard gates).
- [`external-skill-bootstrap.md`](external-skill-bootstrap.md): importing external skills, no-LM skeletons, synthetic bootstrap contracts, and promote/validate loops.
- [`gepa-optimization.md`](gepa-optimization.md): GEPA credentials, Pool-backed reflection, reasoning effort, mutation surfaces, and bootstrap guards.
- [`eval-methodology.md`](eval-methodology.md): arms, isolation, metrics, reporting policy.
- [`smithers.md`](smithers.md): repo-local Smithers setup, operating commands, and
  the PoolAgent experiment boundary.
- [`model-access-spike.md`](model-access-spike.md): agent-name → Laguna model mapping, quotas (spike + addenda).
- [`trajectory-recovery-spike.md`](trajectory-recovery-spike.md): run-id → trajectory recovery (spike + addenda).
- [`plans/`](plans/): plans of record (v0, GEPA optimization, onboarding/packaging).
- [`reviews/`](reviews/): critiques and documentation audits (decision history).

Related, outside `docs/`: [`../evals/README.md`](../evals/README.md) (case format),
[`../schemas/common/README.md`](../schemas/common/README.md) (shared contracts),
[`../harness/fixtures/README.md`](../harness/fixtures/README.md) (workspace materialization),
[`../ui/README.md`](../ui/README.md) (workbench), [`../plans/README.md`](../plans/README.md)
(workbench redesign tracker), [`../experiments/smithers-pool/README.md`](../experiments/smithers-pool/README.md)
(pool-as-workflow-executor spike).
