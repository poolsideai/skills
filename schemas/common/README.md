# Shared contract schemas

JSON Schema (draft 2020-12) definitions for the contracts shared between skills, validators, and the
eval harness. Per-skill output schemas live with each skill under `skills/<name>/schemas/`; only the
cross-cutting contracts live here.

| File | Contract | Produced by | Consumed by |
| --- | --- | --- | --- |
| `validator-result.v1.schema.json` | Result every per-case validator writes to its `--out` path | skill validators (`scripts/validate_*.ts`, bun) | harness runner, repair loop, report |
| `eval-case.v1.schema.json` | An eval case's `metadata.json` (canonical field list) | case authors | harness fixtures/matrix, repo structure checks |
| `run-manifest.v0.schema.json` | Per-run `manifest.json` written under `runs/<suite>/<case>/<arm>/` | harness runner | report, harness-debt review |

## Conventions

- `$id`s are stable identifiers of the form `https://poolside.ai/schemas/common/<file>`; they are not
  expected to resolve over the network. `run-manifest.v0` references `validator-result.v1` by relative
  `$ref`, so loaders must register both schemas (e.g. a `referencing` Registry on the Python side, or
  ajv `addSchema` on the TS side).
- Every instance carries a `schema_version` string (`validator-result.v1`, `run-manifest.v0`, ...).
  New required fields (digests, fixture hashes, resolved model config) land via a `schema_version`
  bump, never by mutating an existing version. `additionalProperties` is `false` throughout, so
  unknown fields are validation errors by design.
- Validators are invoked with the language-agnostic argv contract
  `<cmd> --case <case_dir> --workspace <workspace_dir> --out <result_path>`, run with no network and
  internal timeouts, and write a `validator-result.v1` JSON object to the `--out` path.
- `eval-case.v1` `validator.command` is the canonical validator location: an argv array that by
  convention points at the skill's `scripts/validate_*.ts` via `bun`. `validator.expected_status` is
  what that command must return when replayed against the case's gold `expected/` artifacts
  (good-failure cases expect `"fail"`).
