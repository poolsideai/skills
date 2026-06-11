# Data contracts

Companion detail for §11 of [`../../laguna-skills-and-harness-substrate-2026-06-10.md`](../../laguna-skills-and-harness-substrate-2026-06-10.md).

These four contracts should be updated together. If they drift, eval results become hard to compare across runs.

| Contract | Owned by | Leaf |
|---|---|---|
| Per-skill output schema | Workstream A | [per-skill-output-schema.md](per-skill-output-schema.md) |
| Validator result (`validator-result.v1`) | Workstream B, §8.1 | [validator-result-v1.md](validator-result-v1.md) |
| Run-artifact manifest | Workstream C, §9.2 | [run-artifact-manifest.md](run-artifact-manifest.md) |
| Telemetry events (PR5) | Workstream C, PR5 | [telemetry-events.md](telemetry-events.md) |

Consistency rules:

- A skill output must match its per-skill schema. The validator consumes that same schema.
- The run-artifact manifest embeds a `validator-result.v1` object. Its `repair_feedback` drives the repair loop.
- The manifest's resolved model config must match the `runMetadata` telemetry event and the Workstream D eval-agent config.
- The manifest's skill names, versions, and digests must match `availableSkills` / `skillActivated` telemetry. Remote-skill digests come from Workstream H.
