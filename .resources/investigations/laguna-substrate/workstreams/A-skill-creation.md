# §7 Workstream A: Skill creation (the library content)

> Full workstream detail · Router: [`../../laguna-skills-and-harness-substrate-2026-06-10.md`](../../laguna-skills-and-harness-substrate-2026-06-10.md) (§7) · Map: substrate §3 · Decisions: substrate §13 · Index: [`README.md`](README.md)

**Scope:** Author the `SKILL.md` directories + their `references/`, `schemas/`, `scripts/`, `evals/`.
**Source proposal (Plan A):** standard skill contract; repo layout under `skills/`; ship `laguna-task-contract`,
`ci-log-reducer`, `repo-map` first; then `stack-trace-router`, `single-file-patch`,
`regression-test-generator`; defer `patch-risk-review`, `m-orchestrator`, `multi-file-patch`.

**Verified anchors:** §6.1 (format/constraints), §6.2 (the `skill-creator` precedent + `metadata.version`
versioning), §6.5 (description = activation surface).

**Open decisions (context; each is indexed in the Decision register, §13):**
- **Authoring standard:** adopt/extend the in-repo `skill-creator` conventions vs Plan A's proposed
  `SKILL.md` template (Purpose/Use-when/Inputs/Output-contract/Validation/Repair/Escalation/Examples). They are
  compatible; reconcile them into one repo authoring guide.
- **First-skill identity:** Plan A argues for `laguna-task-contract` (a contract adapter) first. Open: is the
  contract-adapter skill the right v0, or start with the easiest-to-validate `ci-log-reducer`? (Validator
  maturity vs pattern-establishment trade-off.)
- **Schema/validator-first ordering:** Plan A's authoring loop says write the output schema + validator
  *before* the prose. The planner should encode this as a hard authoring gate.
- **`allowed-tools` gap:** since metadata can't restrict tools (§6.1), decide how each skill *declares* its
  tool expectations (doc-only? harness policy? agent-config templates shipped alongside?).
- **Non-goals per skill:** Plan A's acceptance gates require documented non-goals + one adversarial eval. Bake
  into the template.
- **Repo layout vs runtime discovery:** top-level skill directories are fine for this standalone `skills` repo,
  but Poolside local discovery inside a fixture workspace looks under `.poolside/skills/<name>` and
  `.agents/skills/<name>` (§6.2). The harness must copy, symlink, or point fixture workspaces at the right
  discovery layout; otherwise "with-skill" arms may not actually expose the skill.
- **Distribution mechanism per skill/phase** *(cross-cutting; indexed in the Decision register, §13)*: three
  verified mechanisms, pick per skill/phase:
  - **Workspace** (`.poolside/skills` / `.agents/skills`): simplest for dogfooding/evals, zero forge change.
  - **Remote repository** (`RemoteRepositoryConfig`, enabled-skills list): the likely *product* path; but
    PR2 (exec parity, §6.3) is a prerequisite to evaluate remote skills through `pool exec`, and supply-chain
    pinning is **Workstream H** (§10).
  - **Embedded defaults** (`resources/default_skills/**`): ships in the binary; highest bar (forge change +
    binary size + versioning). Reserve for a curated few.
