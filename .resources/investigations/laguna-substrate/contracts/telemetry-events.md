# Telemetry events (PR5)

> Data contract **4 of 4** · Defined in: **Workstream C** (§6.5 / §9 PR5) · Hub: [`README.md`](README.md) · Router: substrate §11
> Siblings: [`per-skill-output-schema.md`](per-skill-output-schema.md) · [`validator-result-v1.md`](validator-result-v1.md) · [`run-artifact-manifest.md`](run-artifact-manifest.md)

PR5 adds these NLJSON events while keeping the current `-o json` output back-compatible: `runMetadata`,
`availableSkills`, `skillActivated`, structured `toolResult`, `trajectorySummary`. Today, skill activation is
only inferable from `toolCall name=="skill"` (§6.5).

**Invariant (C ↔ D / H):** the manifest's resolved model config = the `runMetadata` event; the manifest's skill
names + versions/digests = the `availableSkills` / `skillActivated` events. Activation metrics are computed from
`skillActivated` / `availableSkills`, fed by the skill `description` activation surface (§6.5).
