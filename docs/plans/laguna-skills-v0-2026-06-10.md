# Laguna Skills v0: Skill Library + Rough-but-Real Eval Loop

> Status: Historical plan of record (deep-plan 2026-06-10; design-critiqued — see `docs/reviews/laguna-skills-v0-critique-2026-06-10.md`)
> Sources: `.resources/investigations/laguna-skills-and-harness-substrate-2026-06-10.md` (substrate),
> `laguna-skills-plan-approach.md` (Plan A — what to build), `laguna-skills-plus-pool.md` (Plan B — PR1 only for v0).
>
> **Current deltas from this plan** (treat the body below as the original v0 scope):
> - `bead-selector` was added after this plan and ships a full dedicated suite at
>   `evals/suites/skill-bead-selector.json`.
> - `workspace-inventory` has minimum eval coverage and a dedicated suite at
>   `evals/suites/skill-workspace-inventory.json`; the validator now enforces
>   lexicographic sorting of `entries[]` per the SKILL.md output contract.
> - Eval evidence remains **internal and directional** under the v0 reporting
>   policy (`docs/eval-methodology.md` §7) — no publishable lift claims.
> - Smithers command policy is `bunx smithers-orchestrator ...`
>   (`docs/smithers.md`); the workbench resolves the runner local-first with a
>   `bunx` fallback (`ui/lib.ts → resolveSmithersRunner`).

## Goal

Ship v0 of the validator-first Laguna skills library in this repo: the first skills (with output
schemas, executable validators, and eval cases), plus an external eval runner that drives **today's**
`pool exec` (Plan B PR1 — zero forge changes) to produce real with-skill vs without-skill evidence.
Harness PRs 2–7 are parallel/later hardening, not v0 blockers.

## Background

Verified facts that shape v0 (full evidence in `.resources/investigations/laguna-substrate/verified-state/`):

- **Workspace skills already run on today's `pool exec`** — discovery looks under `.poolside/skills/` and
  `.agents/skills/` in working dirs; the skill tool is enabled by default (§6.2). Workstream A needs no forge change.
- **`pool` 0.2.172 is installed locally**; user-global `~/.config/poolside/skills/` already contains
  `configure-sandbox` and `skill-creator` — live proof that a clean no-skill arm needs isolation (isolated HOME workaround until PR3).
- **Frontmatter is `name` + `description` (+ optional metadata)**; `allowed-tools` is unsupported and
  `compatibility` is unenforced (§6.1). Tool expectations must be documented/harness-side.
- **Skill discovery is description-driven** (§6.5) — each skill's `description` is part of the eval surface.
- **`pool exec` JSON output is sparse NLJSON**; activation only inferable from `toolCall name=="skill"`;
  artifacts require `history trajectories --atif` scraping — and **`history` has no run-id lookup key**: it
  resolves only `--latest` or a unique filename substring (`history_cmd.go:290–322`). Hidden flags (`--run-id`,
  `--agent-config-file`) are unstable bridges (§6.4–6.6). The runner logs every fragile dependency as harness debt.
- **`--context-file` is deprecated for chat-completion models** (§6.4) — context goes in via prompt assembly +
  fixture workspace files.
- **`--agent-config-file` accepts a full `AgentConfig`** (§6.7) — the reproducible model lever and the future
  mechanism for a "skill tool disabled" arm. It is **mutually exclusive with `--agent-name`**, so config-file
  arms need the named agent's model settings recovered first — deferred past v0.

Decisions made (Ben, 2026-06-10): forge appetite = **PR1 only** for v0 (register #5); eval runner lives **in
this repo, external to forge** (#10); v0 scope = **full first bundle** — 3 skills + runner + ~11 cases (#7);
**`ci-log-reducer` goes end-to-end first** as pathfinder (#15); **model access = named agent** — `pool exec
--agent-name` reaches Laguna today (#1, spike shrinks to documenting IDs/quotas); **language split** — Python/`uv`
for harness and repo tooling, TypeScript/`bun` for everything that ships inside a skill.

The repo is effectively empty (LICENSE, README, static-page mockups, `.resources/`). Everything below is greenfield.

## Approach

v0 ships the smallest validator-first slice that produces real internal evidence: three skills
(`laguna-task-contract`, `ci-log-reducer`, `repo-map`), each with an output schema and executable validator
written **before** the `SKILL.md` prose (the hard authoring gate), a small eval-case corpus (~11 cases), and an
external runner that compares with-skill vs without-skill arms through today's `pool exec`. One skill —
`ci-log-reducer`, the most mechanically gradeable — goes end-to-end first as the pathfinder that proves the
whole loop; the other two follow on the established pattern. This is not a prompt-pack milestone: a skill
without a validator and eval evidence doesn't merge.

Three tracks run in parallel from day one. **Track 1 (spikes)**: named-agent invocation reaches Laguna today,
so the model-access spike just documents which agent names map to XS.2 / M.1 plus quotas and cost reporting; a
second spike resolves the trajectory-recovery gap below. **Track 2 (Workstream A)** authors skills, schemas, and
validators — fully unblocked. **Track 3 (Workstream B + PR1)** builds the case format, fixture materialization,
and subprocess runner, with a dry-run mode so everything except live model calls is testable before Track 1 lands.

Skills live as source under `skills/<name>/` (Plan A's layout). Eval runs never point `pool` at the source tree:
each run materializes a temporary fixture workspace, copying `input/` plus — for with-skill arms only — the
skill into `.poolside/skills/<name>/` (the discovery path `pool exec` actually scans; skipping this step makes
with-skill arms silently identical to baseline). Both arms run under an isolated HOME with an empty user-global
skills dir, so the only difference between arms is the materialized skill. The skill tool stays enabled in both
(baseline = tool enabled, zero skills available); a tool-disabled arm is a different experiment and is deferred
past v0. Each skill's output contract also pins **where the gradeable artifact lands**: a JSON file written to a
deterministic workspace path named in the prompt (or, for patch skills, the diff applied to the tree).
Validators grade workspace state plus the final message — never stringified NLJSON tool results.

The PR1 runner shells out to `pool exec` as a subprocess (`runPoolCLI` calls `os.Exit`; no forge imports). It
captures stdout/stderr/exit code/NLJSON/timing, recovers the trajectory right after each run, runs the skill's
validators, and writes a per-run `manifest.json` embedding the `validator-result.v1` object. One verified gap
shapes its design: `history` has no run-id key, so until the trajectory-recovery spike (item 2) settles a
reliable mapping, the runner executes arms **strictly serially** and recovers each trajectory immediately via
`--latest`. Every reliance on a hidden flag or history scraping is recorded in the manifest as
harness debt — that debt list is the evidence file for which of PR2–PR7 to do next.

Languages split at the process boundary. The harness, runner, and repo checks are Python via `uv` (the evals
world; matches Plan A and the validator runtime contract). Everything that ships *inside* a skill — deterministic
preprocessors, fact collectors, and the validators the model runs in its repair loop — is TypeScript via `bun`
(typed, and it is the code Laguna actually executes), declared as a runtime expectation in each `SKILL.md`. The
boundary stays language-neutral: schemas are hand-authored `.schema.json` files (ajv on the TS side, `jsonschema`
on the Python side — no codegen), validators are subprocesses named by each case's `metadata.json`, and both
sides speak `validator-result.v1` JSON.

v0 evidence is internal and directional only. Publishable lift claims wait on isolation (PR3), stable artifacts
(PR4), telemetry (PR5), a statistical acceptance policy (substrate §8.2), and the data/privacy call on fixtures
(register #9). v0 carries only the data contracts it consumes — per-skill output schemas, `validator-result.v1`,
and a lean versioned `run-manifest.v0`; telemetry-event alignment is PR5's problem, and the manifest's
`schema_version` field is what lets richer fields land later without a format break.

## Work Items

### Track 1 — Spikes (gate live eval runs only; start immediately)

1. **Model-access spike** — `docs/model-access-spike.md`. Named-agent invocation works today; document which
   `--agent-name` values map to XS.2 and M.1, quota/rate limits, token + cost reporting, and smoke-test one
   `pool exec` run per model. Confirm the assumption that an M.1-router→XS.2-worker run is **not** representable
   (register #2; the router arm stays out of the v0 matrix).
2. **Trajectory-recovery spike** — `docs/trajectory-recovery-spike.md`. Verified gap: `history trajectories`
   has no run-id column and resolves only `--latest` or a unique filename substring (`history_cmd.go:290–322`).
   Determine the reliable mapping from a `pool exec` run to its trajectory (does the trajectory filename embed
   `--run-id`? does `history sessions` expose it?), and whether the named agent's resolved model config /
   `model_id` is recoverable from the trajectory or ATIF. Until resolved, the runner executes arms serially and
   recovers via `--latest` immediately after each run, flagged as debt. The model-config answer decides whether
   `eval-agents/` config files (deferred, see Out of scope) are ever buildable.

### Track 2 — Workstream A: skill authoring (no blockers; start immediately)

3. **Authoring guide** — `docs/authoring-guide.md`. One reconciled standard (register #14): pool house style
   from the `skill-creator` precedent (concise `SKILL.md`, trigger-phrase `description` ≤1024 chars, name regex
   `^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`, `metadata.version` semver, progressive disclosure into
   `references/`/`scripts/`) merged with Plan A's section template (Purpose / Use when / Do not use when /
   Inputs / Procedure / Output contract / Validation / Repair / Escalation / Examples). Encode the two hard
   gates: schema + validator exist before prose; non-goals + ≥1 adversarial case required. State that
   `allowed-tools` is unenforced — tool expectations *and* runtime expectations (`bun` for skill scripts) are
   documented per skill and enforced harness-side (register #16). The template's Output-contract section must
   name the deterministic workspace path (or diff target) where the gradeable artifact lands.

4. **`ci-log-reducer`** (pathfinder — first end-to-end) — `skills/ci-log-reducer/`: `SKILL.md`,
   `schemas/ci-log-summary.schema.json`, `scripts/extract_failure_windows.ts` (deterministic preprocessor),
   `scripts/validate_log_summary.ts`, `evals/` with 4 cases (easy / realistic / adversarial / edge). Validator
   checks per Plan A: cited line numbers exist, error lines copied from the log, failing command supported by
   log or metadata, next commands safe and local.
5. **`laguna-task-contract`** — `skills/laguna-task-contract/`: `SKILL.md`,
   `references/{laguna-xs-worker-contract,laguna-m-router-contract,anti-patterns}.md`,
   `schemas/{task-contract,router-contract}.schema.json`, `scripts/validate_contract.ts`, `evals/` with 4 cases
   including Plan A's good-failure cases ("fix this whole repo" must fail validation). Establishes the
   XS.2-as-bounded-worker / M.1-as-router interaction pattern.
6. **`repo-map`** — `skills/repo-map/`: `SKILL.md`, `schemas/repo-map.schema.json`,
   `scripts/{collect_repo_facts,validate_repo_map}.ts`, `evals/` with 3 cases. Validator: all paths exist in
   fixture, test commands supported by repo files, no hallucinated frameworks.

Items 4–6 serialize on the authoring guide for the template, then parallelize; each follows
schema → validator → cases → prose order internally.

### Track 3 — Workstream B + C/PR1: eval loop and runner (start immediately; dry-run until Track 1 lands)

7. **Shared contracts** — `schemas/common/{validator-result.v1,eval-case.v1,run-manifest.v0}.schema.json`.
   Validator result per the substrate contract = `{schema_version, case_id, status, score, checks[],
   repair_feedback[], duration_ms}`. The v0 manifest is deliberately lean: run id, skill name+version, agent
   name, pool version, full command line, exit code, artifact paths, timing, embedded validator result, and a
   `harness_debt[]` list — digests and fixture hashes arrive with PR4/PR5 via the `schema_version` bump.
8. **Eval methodology doc** — `docs/eval-methodology.md`. v0 arms: `xs_without_skill`, `xs_with_skill`,
   `m_without_skill`, `m_with_skill` (router arm deferred per register #2). Isolation recipe per arm. Metrics
   computable today: schema validity, validator pass rate, activation (parse `toolCall name=="skill"`), exit
   code, latency, repair success, instruction violations, tool-call count. Restates the gradeable-artifact rule
   (deterministic workspace path; never parse stringified NLJSON for grading). States the error-analysis-first
   discipline (substrate §3.2): once runs work, read 20–50 real transcripts per skill and build a failure
   taxonomy before adding graders. All v0 numbers labeled internal/directional.
9. **Case format + fixtures** — `evals/README.md` (case folder = `prompt.md`, `input/`, `expected/`,
   `metadata.json` with id/skill/bucket/difficulty/arms/publishability/**validator command**). One
   validator-location rule: the `metadata.json` command is canonical, and by convention it points at the skill's
   `scripts/validate_*.ts` with case gold paths as args; a case adds a local `validators/` dir only for bespoke
   checks. Plus `harness/fixtures/README.md` + `harness/runner/fixtures.py` (materialization: temp workspace ←
   `input/`; with-skill arms also ← `skills/<name>` → `.poolside/skills/<name>/`; isolated HOME + empty
   user-global skills dir for every arm).
10. **Subprocess runner** — `harness/runner/{run_eval,pool_exec,matrix,artifacts,report}.py`. Invokes
    `pool exec --prompt-file … --directory <workspace> -o json --unsafe-auto-allow --sandbox required
    --run-id <id>`; captures stdout/stderr/exit/timing; executes arms **serially**, recovering each trajectory
    immediately after its run (`pool history trajectories --atif` via the item-2 mapping, else `--latest`) with
    every recovery path flagged as debt; writes
    `runs/<suite>/<case>/<arm>/{prompt.md,stdout.nljson,stderr.txt,trajectory.atif.json,validator.json,manifest.json}`.
    `--dry-run` prints commands and validates fixtures without invoking `pool`.
11. **Validator runtime helpers** — `harness/validators/{json_schema,command_result,validator_result}.py`
    (Python/`uv` harness side) plus a small shared TS helper the skill validators import to emit well-formed
    `validator-result.v1` (e.g. `skills/_shared/validator-result.ts`). Rules for both sides: no network,
    timeouts, explicit paths, result JSON to the named output path. The harness invokes each case's validator as
    a subprocess via the `metadata.json` command with a fixed argv contract —
    `<cmd> --case <case_dir> --workspace <workspace_dir> --out <result_path>` — language-agnostic by design.
    Repair feedback derived only from failed checks + schema errors.
12. **Suites + report** — `evals/suites/smoke.json` (1 case/skill, dry-run-able), `evals/suites/first-bundle.json`
    (all ~11 cases). Report (`harness/runner/report.py`): per case × arm — validator status, schema validity,
    activation observed, duration, debt; rendered as the Plan A benchmark-table shape but watermarked
    internal/directional.

### Track 4 — Repo checks (after Tracks 2–3 shapes exist)

13. **Structure checks** — `scripts/{check_skill_structure,check_eval_cases,check_schemas}.py`: frontmatter
    valid (name regex, description ≤1024, `metadata.version`), schemas parse, every case references an existing
    validator, every suite entry references an existing case, every skill has ≥3 cases incl. 1 adversarial.
    Wire as a CI job later (Workstream E); runnable locally for v0.
14. **README update** — replace mockup-era copy: the three skills, how to run checks, how to run the smoke
    suite once model access is configured, why results stay internal until hardening lands.

### v0 done means

- Structure checks green over three skills (schema + validator + ≥3 cases + non-goals + adversarial case each).
- Smoke suite runs end-to-end against real Laguna for at least `ci-log-reducer`, producing manifests + report.
- A directional with/without readout for `ci-log-reducer` exists, plus an error-analysis note on its failures.
- A written harness-debt list ranking which of PR2–PR7 the evidence actually justifies next.

## Out of scope for v0 (later / parallel hardening)

PR2 (remote-skill exec parity), PR3 (skill isolation flags), PR4 (stable artifact dirs), PR5 (eval-grade
telemetry), PR6 (model-config ergonomics), PR7 (native `pool eval`) — plus Workstreams F (public catalog),
G (publishing policy; v0 fixtures stay unpublished), and H (remote-skill pinning). Also deferred:
`eval-agents/` config files (the tool-disabled arm and pinned-sampling runs) — blocked on recovering the named
agent's model config (item 2 outcome). None are v0 prerequisites; the runner's harness-debt log decides their order.

## Open Questions

- **Spike outputs (#1 residue):** which `--agent-name` values map to XS.2 / M.1, and what quotas/rate limits
  apply? Resolved by work item 1; doesn't block any other item.
- **Trajectory mapping (item 2):** can a run be mapped to its trajectory deterministically, and is the resolved
  model config recoverable? Decides serial-vs-parallel execution and whether config-file arms ever exist.
- **Router arm (#2):** assumed not representable in today's `pool exec`; confirm during the spike. Stays out of
  the v0 matrix either way.
- **#9 Fixture publishability:** v0 fixtures/artifacts stay unpublished until the redaction/IP policy exists
  (Workstream G, out of v0).

## References

- Substrate router: `.resources/investigations/laguna-skills-and-harness-substrate-2026-06-10.md`
- Decision register: `.resources/investigations/laguna-substrate/appendices/decision-register.md`
- Data contracts: `.resources/investigations/laguna-substrate/contracts/`
- Plan A (skills + eval methodology): `.resources/investigations/laguna-skills-plan-approach.md`
- Plan B (PR1 + later harness PRs): `.resources/investigations/laguna-skills-plus-pool.md`
- Agent Skills spec & eval guidance: https://agentskills.io/specification · https://agentskills.io/skill-creation/evaluating-skills
- Eval methodology reference: https://github.com/hamelsmu/evals-skills
