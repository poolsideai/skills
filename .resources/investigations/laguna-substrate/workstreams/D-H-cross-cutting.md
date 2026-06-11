# §10 Workstreams D–H: cross-cutting & supporting

> Full detail · Router: [`../../laguna-skills-and-harness-substrate-2026-06-10.md`](../../laguna-skills-and-harness-substrate-2026-06-10.md) (§10) · Map: substrate §3 · Decisions: substrate §13 · Index: [`README.md`](README.md)

The three core workstreams (A-C) are the main path, but the planner will stall without these. Treat them as
first-class.

## Workstream D: Model access & eval configs
*Gates all of Workstream B.* Put the "how do we actually invoke Laguna" question here, not in three separate
places (referenced from §6.7, §8, the PR6 row, and the Decision register, §13). Decide invocation (named agent
vs `--api-url` standalone vs hand-authored `--agent-config-file`), credential/token source, model IDs,
sampling/reasoning/context limits, quotas/rate limits, token+cost capture, and whether router-to-worker is
representable at all (§8). Deliverable: canonical XS.2 / M.1 eval-agent config files. `AgentConfig` is
structurally capable (§6.7), but actual Laguna IDs/access remain unknown.

## Workstream E: Repo infra / CI / release
Skill syntax + schema validation, validator test suite, eval-case linting, golden-fixture checks, skill
versioning/release gates, and (if public) docs/catalog build checks. This is the contribution gate that enforces
Plan A's acceptance criteria mechanically. Hamel Husain's `hamelsmu/evals-skills` (`error-analysis`,
`generate-synthetic-data`, `write-judge-prompt`, `validate-evaluator`, `build-review-interface`) is a reusable
reference/tooling source for the eval-authoring, case-generation, and judge-calibration steps.

## Workstream F: GTM public catalog
Optional/non-authoritative for this technical plan unless Ben explicitly scopes it in. If in scope later, use the
comp as design inspiration only and define required metadata fields, taxonomy, install instructions,
generated-vs-authored pages, and whether eval results are published.

## Workstream G: Data / privacy / IP
Redaction + allowed-corpora + PII/secrets policy for eval cases mined from real logs/issues/diffs; license/IP
review; whether internal repo snapshots and eval artifacts may be published. Also strip personal/browser capture
metadata from public artifacts (the comp currently records a Chrome profile/display name/email in its
README/extracted JSON).

## Workstream H: Remote-skill supply chain & pinning
Pin repo/commit/version, record materialized skill **digest**, detect local-shadowing of remote skills (local
beats remote; §6.2), offline/cache behavior, and trust policy for scripts bundled inside skills. Current
`RemoteRepositoryConfig` has API base URL, repository ID, enabled skill names, and headers but no pin/digest
(`types.go:27-31`); remote discovery filters by name (`remote_registry.go:223-251`) and downloaded tarballs are
validated only by frontmatter name (`remote_registry.go:260-300`). **PR2 (exec remote-skill parity) is the
prerequisite to evaluating remote skills.**
