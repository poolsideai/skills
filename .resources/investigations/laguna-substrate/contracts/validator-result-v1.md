# Validator result (`validator-result.v1`)

> Data contract **2 of 4** · Defined in: **Workstream B** (§8.1) · Hub: [`README.md`](README.md) · Router: substrate §11
> Siblings: [`per-skill-output-schema.md`](per-skill-output-schema.md) · [`run-artifact-manifest.md`](run-artifact-manifest.md) · [`telemetry-events.md`](telemetry-events.md)

Per-case validator output. Validators should be executable under a fixed runtime (Python/`uv`, Go, or explicitly
mixed), default to no network, enforce timeouts, consume deterministic input/output paths, capture
stdout/stderr, and emit a machine-readable result such as:

```json
{
  "schema_version": "validator-result.v1",
  "case_id": "...",
  "status": "pass|fail|error",
  "score": 0.0,
  "checks": [{"name": "...", "status": "pass|fail", "message": "..."}],
  "repair_feedback": ["..."],
  "duration_ms": 1234
}
```

This object is embedded into the [run-artifact manifest](run-artifact-manifest.md), and its `repair_feedback` is
what drives Workstream B's repair loop. The planner must also define **how repair-loop feedback is derived from
validator errors**.

**Invariant (B ↔ C):** the manifest's `validator result` field is a `validator-result.v1` object.
