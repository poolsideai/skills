# Per-skill output schema

> Data contract **1 of 4** · Defined in: **Workstream A** · Hub: [`README.md`](README.md) · Router: substrate §11
> Siblings: [`validator-result-v1.md`](validator-result-v1.md) · [`run-artifact-manifest.md`](run-artifact-manifest.md) · [`telemetry-events.md`](telemetry-events.md)

The machine-readable output each skill promises (the skill's "output contract"); it is exactly what the
validator consumes. Authored per-skill in **Workstream A** (Plan A's per-skill schemas/validators), under the
schema/validator-first authoring gate (write the schema + validator *before* the prose).

**Invariant (A ↔ B):** a skill's emitted output **conforms to its per-skill output schema**, which is exactly
what the validator consumes.
