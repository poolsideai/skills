# Concepts and Glossary

Definitions for terms used across this repo, plus the credentials matrix. The binding rules live
in the linked docs; this page only orients. If a definition here ever disagrees with a linked
doc, the linked doc wins.

## Glossary

- **Laguna**: Poolside's model family. The eval harness exercises two sizes, XS.2 and M.1,
  reached through named `pool` agents. Agent-name mapping and quota notes:
  [`model-access-spike.md`](model-access-spike.md).
- **pool**: the Poolside CLI. The harness drives `pool exec` in isolated workspaces; the
  workbench uses it for authoring and playground runs. Verified version is recorded in
  [`CLAUDE.md`](../CLAUDE.md) (Conventions) and the spike addenda.
- **skill**: in this repo, a contract with a mechanical grader, not a prompt pack: `SKILL.md`
  plus an output schema, an executable validator, and eval cases (including one adversarial
  case). Binding rules: [`authoring-guide.md`](authoring-guide.md).
- **validator**: a `bun`-run TypeScript script that grades workspace state and emits a
  `validator-result.v1` JSON file. Fixed argv contract, no network, deterministic. Spec:
  [`../evals/README.md`](../evals/README.md) and [`../schemas/common/README.md`](../schemas/common/README.md).
- **validator-result.v1**: the result JSON every validator writes (`status`, `score`,
  `checks[]`, `repair_feedback[]`). Schema lives in `schemas/common/`; the shared emitter is
  `skills/_shared/validator-result.ts`.
- **workspace artifact**: the deterministic file a skill's Output contract pins (under
  `.laguna/`, e.g. `.laguna/ci-log-summary.json`). Validators grade workspace state plus the
  final message only; an artifact that only appears in chat does not exist for grading.
- **gold replay**: copying a case's `input/` and `expected/` gold artifacts into a fresh
  workspace and running the validator against them, asserting it returns the case's
  `expected_status`. Makes every case self-testing. Procedure: [`../evals/README.md`](../evals/README.md).
- **arms**: the four eval conditions: `xs_without_skill`, `xs_with_skill`, `m_without_skill`,
  `m_with_skill` (model size × skill installed). Matrix and metrics:
  [`eval-methodology.md`](eval-methodology.md).
- **bucket vs difficulty**: two independent case fields. `bucket` is the case's *role*
  (`easy | realistic | adversarial | edge`; every skill needs ≥1 adversarial case).
  `difficulty` is how hard it is (`easy | medium | hard`). Field table:
  [`../evals/README.md`](../evals/README.md).
- **good-failure case**: a case whose gold artifact is deliberately bad and whose
  `validator.expected_status` is `"fail"`: the right behavior is to refuse or fail validation.
- **activation**: whether the model actually loaded and followed the skill in a with-skill arm;
  measured because the skill `description` is the only text the agent sees before loading it.
- **fixture materialization**: building the isolated per-run sandbox (workspace copy, fresh
  HOME, private `XDG_STATE_HOME`, scrubbed env) before `pool exec` runs. Spec:
  [`../harness/fixtures/README.md`](../harness/fixtures/README.md).
- **GEPA**: the optimization track that rewrites `SKILL.md` prose only, graded against frozen
  cases/validators (the grader can never change). Plan:
  [`plans/skill-optimization-gepa-2026-06-11.md`](plans/skill-optimization-gepa-2026-06-11.md).
- **harness debt**: known workarounds (e.g. trajectories recovered via `history --latest`)
  recorded per run in `manifest.json` `harness_debt[]`; the list drives hardening priorities.
  Policy: [`eval-methodology.md`](eval-methodology.md) §7.
- **NLJSON**: newline-delimited JSON, the event stream `pool exec -o json` emits (thoughts,
  tool calls, results). Validators never grade it; it feeds run facts and trajectories.
- **trajectory / ATIF**: `trajectory.ndjson` (raw NDJSON) is the canonical recovered
  trajectory; ATIF is an optional export format pool can produce. Details:
  [`trajectory-recovery-spike.md`](trajectory-recovery-spike.md).
- **Smithers**: the TypeScript workflow engine used in workbench experiments; `pool` acts as a
  node executor via `PoolAgent`. Spike: [`../experiments/smithers-pool/README.md`](../experiments/smithers-pool/README.md).
- **workbench**: the local UI (`bun ui/server.ts`, port 4319) and agent CLI (`bun ui/bench.ts`)
  over a shared substrate for authoring, runs, evals, and review. `bench.ts` also owns the
  agent CLI contract, command catalog, and JSON error responses. Docs: [`../ui/README.md`](../ui/README.md).

## What runs offline vs what needs credentials

| Command | Needs |
| --- | --- |
| `uv run scripts/check_*.py` (all four repo checks) | nothing (robustness check needs `bun` on PATH) |
| `uv run harness/runner/run_eval.py --suite ... --dry-run --replay` | nothing |
| `uv run harness/optimize/gepa_skill.py --skill <name> --smoke` | nothing |
| `bun ui/bench.ts eval-case-generate --skill <name> --validate-only <case-dir>` | nothing |
| `uv run harness/review/extract_traces.py [--demo]` + `serve.py` | nothing |
| `uv run harness/runner/run_eval.py --suite ...` (live) | `pool` auth (`POOLSIDE_TOKEN` or `~/.config/poolside/credentials.json`) |
| `bun ui/server.ts` / `bun ui/bench.ts` run commands | `pool` auth for anything that executes models |
| `bun ui/bench.ts eval-case-generate --skill <name> --n N` | an LM key (litellm id, e.g. `OPENROUTER_API_KEY`) |
| `uv run harness/optimize/gepa_skill.py` (live) | `pool` auth **and** a reflection LM key |
| `uv run harness/review/judge.py` | `OPENROUTER_API_KEY` (optional reading aid only) |
