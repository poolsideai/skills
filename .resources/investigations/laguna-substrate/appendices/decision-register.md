# Decision register

Companion detail for §13 of [`../../laguna-skills-and-harness-substrate-2026-06-10.md`](../../laguna-skills-and-harness-substrate-2026-06-10.md).

This is the master list of open decisions across the eight workstreams. The workstream docs carry the context; this file is the index.

Types: `fact-gap` needs verification or discovery; `planner-decides` is for the downstream planner; `Ben-decides` is a strategy call only Ben can make. Gating items are listed first.

Start with these decisions:

1. Laguna model access and eval configs (#1), because they gate all evaluation.
2. v0 milestone scope (#7): one proven skill vs. the first bundle.
3. Forge appetite (#5): PR1-only now vs. PR2-PR6 in parallel.
4. Public vs. private fixtures/artifacts policy (#9).
5. Primary distribution (#6): workspace vs. remote repository.

| # | Decision / question | Type | Blocks | Context pointer |
|---|---|---|---|---|
| 1 | **Model access path for Laguna**: named agent vs standalone `--api-url` vs hand-authored `--agent-config-file`; credential/token source, model IDs, base URL, quotas. | Ben-decides + fact-gap | **All of Workstream B** | Workstream D (§10); verified field detail §6.7 |
| 2 | **Is an M.1-router-to-XS.2-worker run representable in today's `pool exec`?** If not, the orchestration eval arm needs a new invocation mechanism, not just config. | fact-gap (then Ben-decides) | The router-to-worker eval arm | Workstream D (§10); router-arm note §8 |
| 3 | **PR2 sizing**: is the selected agent's `RepositoryDefinitions` available at exec's `AgentRuntime` Options (`main.go:336`)? | fact-gap | PR2 effort estimate | §9 PR2 row; §6.3 |
| 4 | **Laguna model facts**: XS.2 = 33B/3B MoE, 256K context. | fact-gap (❓) | Public messaging only | Source-doc reconciliation #12 (verify via web if it gates messaging) |
| 5 | **Forge change appetite**: are PR2-PR6 on the table now, or does v0 stay entirely in `skills` on today's `pool exec` (PR1 only)? | Ben-decides | Scope of Workstream C; ownership | §9 PR table; §3 |
| 6 | **Primary distribution for v0**: remote repository (product) vs workspace skills (internal dogfooding)? | Ben-decides | Workstream A packaging; PR2 priority | §7 distribution; Workstream H (§10) |
| 7 | **Definition of success / first milestone**: one proven skill with a green with-vs-without eval, or the full first bundle (3 skills + runner + 8–12 cases) Plan A proposes? | Ben-decides | v0 scope across A/B/C | §7; §8 acceptance gates |
| 8 | **GTM / public catalog scope**: in or out of v0, and if in, does it publish eval results + install metadata? | Ben-decides | Workstream F (out of v0 unless scoped) | Workstream F (§10); comp in §4 |
| 9 | **Can eval fixtures/artifacts be public?** Cases may come from real CI logs/issues/diffs; define redaction + IP/license policy. May fixtures + results live in a public repo? | Ben-decides | Publishing B's cases/results | Workstream G (§10) |
| 10 | **Where the eval runner lives** + what graduates to native `pool eval`. | planner-decides | Workstream B/C boundary; PR7 | §8; §9 PR1/PR7 rows |
| 11 | **Ownership boundaries / parallelization**: A+B can proceed in `skills` independently; C requires `forge` access + review. Who owns which; do they parallelize? | planner-decides (Ben input) | Scheduling | §3; §5 |
| 12 | **Distribution mechanism per skill/phase**: workspace / remote / embedded. | planner-decides | Packaging; remote needs PR2 | §7 distribution; §6.2; Workstream H (§10) |
| 13 | **Context-injection path** for chat-completion Laguna models, given `--context-file` deprecation. | planner-decides + fact-gap | Workstream A authoring + B case/prompt assembly | §6.4 |
| 14 | **Authoring standard**: `skill-creator` conventions vs Plan A template; reconcile into one guide. | planner-decides | Workstream A template | §7 |
| 15 | **First-skill identity**: `laguna-task-contract` vs `ci-log-reducer`. | planner-decides | Workstream A v0 | §7 |
| 16 | **`allowed-tools` declaration approach**: doc-only / harness policy / agent-config templates. | planner-decides | Per-skill tool expectations | §7; §6.1 |
| 17 | **Eval matrix arms for v0.** | planner-decides | Workstream B (router arms also blocked by #2) | §8 |
| 18 | **Validator strategy per skill** + schema/validator-first authoring gate (adopt Plan A's per-skill schemas/validators as the v0 spec). | planner-decides | Executable validators; WS-A authoring loop | §8; §7; §11 |
| 19 | **Metrics + acceptance gates blocking for v0** (schema ≥95%, ≥15–20 pp lift, repair ≥50%, violations <5%, no core regressions; + per-skill non-goals + ≥1 adversarial eval). | planner-decides | Publishing lift claims | §8 |
| 20 | **Isolation controls per arm**: tool-disabled / empty-registry / workspace-only / isolated HOME. | planner-decides | Clean no-skill arm | §8; §6.2; §9.1 |
| 21 | **Validator runtime contract specifics**: runtime, deps, no-network, timeouts, result schema, repair-feedback derivation. | planner-decides | Executable validators | §8.1; §11 |
| 22 | **Statistical acceptance specifics**: min cases/repeats, seed/temp, confidence, flake quarantine, labeling, lift-claim threshold. | planner-decides (+ Ben for publishing) | Publishing lift claims | §8.2 |
| 23 | **Case corpus sourcing + gold-output labeling**: where seeds come from, who labels. | planner-decides | Workstream B (publishing depends on #9) | §8; Workstream G (§10) |
| 24 | **Skill-policy flag semantics**: `--disable-skills` / `--skip-default-skills` / `--skills-path` / `--allow-skills` / `--force-skill`. | planner-decides | PR3 | §9.1 |
| 25 | **Eval-runner boundary**: shell-out only; no `forge` imports; hidden flags unstable. | planner-decides | PR1 runner | §9 *Harness constraints* |
| 26 | **PR4 artifact production semantics**: capture / redaction / partial-failure / cleanup. | planner-decides | Reproducible artifacts | §9 PR4 row; §9.2 |
| 27 | **PR5 telemetry event set** + `-o json` back-compat. | planner-decides | Eval metrics | §9 PR5 row; §11 |
| 28 | **Remote-skill pinning / digest / trust policy.** | planner-decides | Reproducible remote-skill evals | Workstream H (§10) |
| 29 | **CI / release gate set**: schema / validator / lint / golden / version checks. | planner-decides | Mechanical enforcement of acceptance gates | Workstream E (§10) |