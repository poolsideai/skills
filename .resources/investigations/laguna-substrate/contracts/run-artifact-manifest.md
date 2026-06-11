# Run-artifact manifest

> Data contract **3 of 4** · Defined in: **Workstream C** (§9.2, PR4/PR5) · Hub: [`README.md`](README.md) · Router: substrate §11
> Siblings: [`per-skill-output-schema.md`](per-skill-output-schema.md) · [`validator-result-v1.md`](validator-result-v1.md) · [`telemetry-events.md`](telemetry-events.md)

Required fields: run id, skill names + **versions/digests**, resolved model config, pool version, full command
line, workspace-fixture hash, exit code, validator result, raw-trajectory path + ATIF path,
timestamps/duration. *(Without skill versions/digests + a fixture hash, runs are not reproducibly comparable.)*

**Invariants:**
- Its `validator result` field is a [`validator-result.v1`](validator-result-v1.md) object (B ↔ C).
- Its **resolved model config = the `runMetadata` telemetry event = the eval-agent config from Workstream D**
  (C ↔ D).
- Its **skill names + versions/digests = the `availableSkills` / `skillActivated` telemetry**, with remote-skill
  digests sourced from Workstream H (C ↔ H).
