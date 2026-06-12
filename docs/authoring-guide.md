# Skill Authoring Guide

The single authoring standard for this repo. It reconciles the pool house style (the
`skill-creator` default skill that ships with `pool`, plus the agentskills.io spec it follows)
with Plan A's fixed section template. Every publishable skill follows this guide; WIP skill directories must be clearly marked until they satisfy the gates. The structure checks in `scripts/` enforce the mechanical parts.

Status: normative for v0 skill authors. Historical source notes live in the plan and investigation files, but this guide is the document to follow.

Worked example: read [`skills/ci-log-reducer/`](../skills/ci-log-reducer/) end to end in authoring
order (schema → validator → eval cases → `SKILL.md`); [`skills/laguna-task-contract/`](../skills/laguna-task-contract/)
shows `references/` usage. A narrative walkthrough lives in [`getting-started.md`](getting-started.md).

---

## 1. The two hard gates

These are not style preferences. A skill that fails either gate does not merge.

Workbench-generated skills are drafts until they pass both gates. `skill-generate` can create a
structure-valid `SKILL.md`, schema, and validator, but publishable status still requires at least
three eval cases, one adversarial case, and a green `uv run scripts/check_eval_cases.py` pass.

**Gate 1: schema and validator before prose.**
The output schema (`schemas/*.schema.json`) and an executable validator
(`scripts/validate_*.ts`) must exist and run before any `SKILL.md` body text is written.
Authoring order inside every skill is fixed:

1. Output schema (hand-authored `.schema.json`)
2. Executable validator (runs against a hand-made gold artifact)
3. Eval cases (including the adversarial one)
4. `SKILL.md` prose

This is the founding design principle of the repo: a skill is a contract with a mechanical
grader rather than a prompt pack. If you cannot write the validator, the skill is not ready to exist.

**Gate 2: non-goals and an adversarial case.**
Every `SKILL.md` has a "Do not use when" section (non-goals, boundaries, anti-patterns), and
every skill ships at least one adversarial eval case (`bucket: "adversarial"`) that tries to
trip the skill: misleading input, out-of-scope bait, or an instruction the skill must refuse to
follow. Minimum corpus per skill: 3 cases including the adversarial one; first-bundle skills
ship 3–4 covering the easy / realistic / adversarial / edge buckets.

---

## 2. Repo layout

Skills live as source under `skills/<name>/`:

```text
skills/<name>/
  SKILL.md                      # required; frontmatter + body per this guide
  schemas/                      # output schema(s), hand-authored JSON Schema
    <artifact>.schema.json
  scripts/                      # TypeScript run with bun
    validate_<artifact>.ts      # the executable validator (required)
    <preprocessor>.ts           # optional deterministic helpers
  references/                   # optional; progressive-disclosure docs
    <topic>.md
  evals/
    <case-id>/                  # one folder per case; format in §7
```

Shared TS helpers live in `skills/_shared/` (notably `validator-result.ts`, which validators
import to emit well-formed result JSON). Do not put anything else at the top level of a skill:
no `README.md`, `CHANGELOG.md`, setup notes, or meta-documentation inside a skill directory.
A skill contains only what the agent needs to do the job (house rule from `skill-creator`).

Eval runs never execute against this source tree. The harness materializes each case into a
temporary fixture workspace and, for with-skill arms, copies the skill into
`.poolside/skills/<name>/` there. Author accordingly: a skill must work when its directory is
copied verbatim into a strange workspace.

## 3. Frontmatter

Verified against `pool` 0.2.172 (`pkg/agent/llmtools/skill/types.go`):

```yaml
---
name: ci-log-reducer
description: >-
  Reduce a failing CI log to a structured failure summary. Use when the user
  provides a CI log, build log, or test output and asks what failed, why a
  pipeline is red, or for the failing command and next steps.
metadata:
  version: "0.1.0"
---
```

Rules:

- **`name`** (required): matches `^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`: lowercase
  alphanumerics and hyphens, ≤64 chars, no leading/trailing/consecutive hyphens. Must equal the
  directory name.
- **`description`** (required, ≤1024 chars): written as explicit **trigger phrases**, not a
  summary. Discovery is description-driven: `name` + `description` are the only text the agent
  sees before deciding to load the skill, so the description is part of the eval surface
  (activation precision/recall are measured). State what the skill produces and the concrete
  situations that should trigger it; include "Use when ..." phrasing. Avoid generic claims that
  would fire on unrelated tasks.
- **`metadata.version`** (required by this repo): semver string, quoted. Bump it on any change
  to schema, validator, or prose; eval manifests record it.
- **`license`** (optional): only if it differs from the repo license.
- **`compatibility`** (optional, ≤500 chars): parsed and length-checked by `pool` but **not
  behaviorally enforced**. You may declare model expectations here, but never rely on it.
- **`allowed-tools` is UNSUPPORTED**: `pool` does not parse or enforce it (literally a `TODO`
  in the loader). Do not add it. Tool restrictions and runtime expectations are documented as
  prose per skill (§5) and enforced harness-side.

## 4. SKILL.md body: the section template

Every skill uses the same ten sections, in this order. Do not invent your own structure.

```markdown
# Skill Name

## Purpose
What this skill does, in one or two sentences.

## Use when
Concrete triggers. Mirrors and expands the frontmatter description.

## Do not use when
Non-goals, boundaries, anti-patterns. (Hard gate 2, required.)

## Inputs
Exact fields, files, or context the skill needs, and where they come from.

## Procedure
Small ordered workflow. Name every bundled script and when to run it.

## Output contract
The required artifact: which schema it must satisfy and the deterministic
workspace path where it lands (or the diff target, for patch skills).

## Validation
How to check the output: the exact validator command and how to read its result.

## Repair
What to do when validation fails. Bounded: state the max repair attempts.

## Escalation
When to stop: route to M.1, a stronger model, or a human instead of retrying.

## Examples
One minimal example and one realistic example.
```

Section-by-section requirements:

- **Output contract** must name the **deterministic workspace path** where the gradeable
  artifact is written, for example, "write the summary to `artifacts/ci-log-summary.json` in the
  workspace root", and the schema it must validate against. For patch-producing skills, name
  the diff target (which file(s) change and how the diff is applied). Validators grade
  **workspace state plus the final message**, never stringified NLJSON tool output, so an
  artifact that only appears inside a chat message does not exist as far as grading is
  concerned. The eval prompt repeats this path; the skill must produce it unprompted.
- **Validation** instructs the model to run the skill's own validator in its repair loop, e.g.
  `bun scripts/validate_log_summary.ts --case ... --workspace ... --out ...` (§6 for the contract).
  The validator a skill ships is the same one the harness runs: one grader, two callers.
- **Repair** is driven only by the validator's `repair_feedback` and schema errors. Cap it
  (Plan A default: one repair attempt) and require returning only the corrected artifact.
- **Examples**: keep them short; if a realistic example is long, move it to `references/` and
  link it.

House style (from `skill-creator`, kept verbatim as our standard):

- **Concise is key.** The context window is shared. Keep the body under 500 lines, well under
  5k words; prefer compact examples over verbose explanation.
- **Progressive disclosure.** Three levels: frontmatter (always in context) → body (loaded on
  trigger) → `references/` and `scripts/` (loaded/executed as needed). Move variant detail,
  long schemas-in-prose, and background into `references/`; keep references one level deep,
  name each file from SKILL.md, and say when to read it. Never duplicate content between
  SKILL.md and a reference file.
- **Degrees of freedom.** Match specificity to fragility: fragile or consistency-critical
  steps get a script (low freedom); judgment calls get heuristics (high freedom). Our skills
  are deliberately low-freedom at the output boundary (schema + named path) and medium-freedom
  in the middle of the procedure.

## 5. Tool and runtime expectations (documented, harness-enforced)

Because `allowed-tools` is unenforced, every skill documents its expectations as prose, usually
with a short "Runtime expectations" note inside **Inputs** or **Procedure**:

- **Runtime**: skill scripts are TypeScript executed with `bun` (`bun scripts/<file>.ts`).
  State this explicitly: "This skill's scripts require `bun` on PATH."
- **Tools**: list which agent tools the procedure assumes (e.g. shell execution, file
  read/write) and anything it must not do (e.g. no network).

Enforcement lives harness-side: the runner configures the environment, and the validators
catch contract violations after the fact. Never claim in a skill that a tool restriction is
enforced. It is an expectation, and instruction violations are an eval metric.

**Language split (repo-wide):** everything that ships *inside* a skill, including preprocessors,
fact collectors, and validators, is TypeScript run with `bun`. The harness, runner, and repo checks
are Python via `uv`. The boundary is language-neutral: subprocesses named by case
`metadata.json`, speaking `validator-result.v1` JSON.

**Zero-dependency TS:** skill scripts use bun builtins only. No `node_modules`, because
scripts must run inside materialized fixture workspaces where nothing was installed. Schema
checking defaults to hand-rolled structural validation against the hand-authored
`.schema.json`. If a skill genuinely needs `ajv`, that requires a root `package.json`, proof
that the validator still runs in a materialized workspace, and a recorded decision. Do not
add dependencies casually.

## 6. Validators

The validator is the skill's grader and the model's repair signal. One per gradeable artifact,
at `skills/<name>/scripts/validate_<artifact>.ts`.

**Argv contract (language-agnostic, fixed):**

```text
<cmd> --case <case_dir> --workspace <workspace_dir> --out <result_path>
```

- `--case`: the eval case folder (gold artifacts under `<case_dir>/expected/`, fixture inputs
  under `<case_dir>/input/`, case `metadata.json`).
- `--workspace`: the workspace to grade: the materialized fixture after the run (or, when
  replaying against gold, a workspace containing the `expected/` artifacts).
- `--out`: where the validator writes its result JSON. Always write it, even on failure.

**Result format: `validator-result.v1`** (schema:
`schemas/common/validator-result.v1.schema.json`; emit it via
`skills/_shared/validator-result.ts`):

```json
{
  "schema_version": "validator-result.v1",
  "case_id": "ci-log-reducer-easy-single-failure",
  "status": "pass",
  "score": 1.0,
  "checks": [
    { "id": "schema-valid", "status": "pass", "detail": "artifact matches ci-log-summary.schema.json" },
    { "id": "cited-lines-exist", "status": "pass", "detail": "all 3 cited line numbers exist in ci.log" }
  ],
  "repair_feedback": [],
  "duration_ms": 412
}
```

- `status`: `"pass" | "fail" | "error"`. `pass`/`fail` are graded verdicts; `error` means the
  validator itself could not grade (missing artifact path is a `fail` with a check, a crash or
  unreadable case dir is an `error`).
- `score`: 0.0–1.0; by default the fraction of passing checks.
- `checks[]`: `{id, status, detail}`. Use small, named, independently legible checks. These are
  the failure taxonomy's raw material; prefer five specific checks over one omnibus check.
- `repair_feedback[]`: strings the model can act on, derived **only** from failed checks and
  schema errors. Keep them concrete and mechanical ("cited line 4012 does not exist in input/ci.log"),
  never speculative advice.

**Validator rules:**

- **No network.** Ever.
- **Explicit paths only**: resolve everything from `--case` and `--workspace`; never assume a
  working directory.
- **Internal timeout / bounded execution**: bound your own execution (and any subprocess) so a
  hang cannot stall the harness or the model's in-workspace repair loop, where no harness wall
  cap protects you. Know what actually bounds you: in a single-process TS validator, a
  `setTimeout`-vs-grader `Promise.race` only preempts an **async** grader; it can never interrupt
  a synchronous one (a sync function blocks the event loop, so the timer fires only after it
  returns). Synchronous graders must instead bound every input: size-cap `readFileSync` on
  untrusted files, cap file counts/recursion depth, and never follow symlinks while walking the
  workspace (a symlink cycle is an unbounded recursion). True preemption requires a separate
  process (subprocess with a kill, as the Python harness does).
- **Deterministic**: same inputs → same result. No clocks in verdicts, no randomness.
- **Always write `--out`**: exit `0` whenever a result file was written (pass or fail alike);
  reserve nonzero exits for crashes, which the harness records as `status: "error"`.
- Grade **workspace state and the final message only**. Never parse stringified NLJSON tool
  results out of transcripts.

## 7. Eval cases

Each case is a self-contained folder under `skills/<name>/evals/<case-id>/`:

```text
<case-id>/
  prompt.md         # the task prompt; names the artifact's workspace path (§4)
  input/            # fixture files materialized into the workspace
  expected/         # gold artifacts the validator can be replayed against
  metadata.json     # canonical case descriptor (below)
  validators/       # OPTIONAL; bespoke checks only; the skill validator is the default
```

**`metadata.json`: canonical fields** (all authors use exactly these; `evals/README.md`
carries the same contract):

```json
{
  "id": "ci-log-reducer-adversarial-decoy-warning",
  "skill": "ci-log-reducer",
  "bucket": "adversarial",
  "difficulty": "medium",
  "arms": ["xs_without_skill", "xs_with_skill", "m_without_skill", "m_with_skill"],
  "publishability": "internal",
  "validator": {
    "command": ["bun", "skills/ci-log-reducer/scripts/validate_log_summary.ts"],
    "expected_status": "pass"
  },
  "notes": "Log opens with a loud deprecation warning; the real failure is 900 lines later."
}
```

- `id`: kebab-case, prefixed with the skill name; must equal the folder name.
- `skill`: the owning skill's `name`.
- `bucket`: `easy | realistic | adversarial | edge`.
- `difficulty`: `easy | medium | hard`.
- `arms`: subset of `[xs_without_skill, xs_with_skill, m_without_skill, m_with_skill]`,
  which eval arms this case participates in.
- `publishability`: `"internal"` for **all** v0 cases (fixtures stay unpublished until the
  redaction/IP policy exists).
- `validator.command`: an **argv array**, paths repo-root-relative. The canonical
  validator-location rule: it points at the skill's `scripts/validate_*.ts` via `bun`; the
  harness appends the §6 contract flags (`--case`, `--workspace`, `--out`) at invocation time,
  and the validator resolves the case's gold paths from `--case`. A case adds a local
  `validators/` dir only for bespoke checks beyond the skill validator.
- `validator.expected_status`: `pass | fail`, the validator result expected when **replayed
  against the case's own gold `expected/` artifacts**. This makes every case self-testing:
  structure checks replay the command with a workspace built from `expected/` and assert the
  status matches. **Good-failure cases** (e.g. `laguna-task-contract`'s "fix this whole repo",
  which must fail contract validation) ship a deliberately-bad gold artifact and set
  `expected_status: "fail"`.
- `notes` (optional): one or two sentences of intent, describing what the case is probing.

**Case design guidance:**

- `prompt.md` must name the deterministic artifact path from the skill's Output contract, so
  without-skill arms have the same grading target.
- `input/` is the entire world the model sees: keep fixtures minimal but real (real log
  shapes, real repo fragments), and never reference files outside the case folder.
- The adversarial case should attack the skill's specific weakness: decoy evidence for
  reducers, scope bait for contract skills, hallucination bait (plausible-but-absent paths,
  frameworks) for mapping skills.
- Edge cases probe boundaries: empty input, enormous input, multiple simultaneous failures.

## 8. Pre-merge checklist

Run `scripts/check_skill_structure.py`, `check_eval_cases.py`, `check_schemas.py`, and
`check_validator_robustness.py` (via `uv`); they enforce the mechanical rows. Add `--json`
for a `repo-check-result.v1` payload on stdout in CI or scripted runs. Repo checks exit `0`
when checks pass, `1` for check violations, and `2` for argument or usage errors. The last one
feeds each validator malformed-but-parseable artifacts (null/primitive array entries, non-object
roots) and requires a graded `"fail"` with repair feedback, never a crash into `"error"`.
The full bar for a skill PR:

- [ ] Frontmatter: `name` matches regex and directory; `description` ≤1024 chars with trigger
      phrases; `metadata.version` is semver.
- [ ] No `allowed-tools` in frontmatter; runtime (`bun`) and tool expectations documented in
      prose.
- [ ] `schemas/*.schema.json` exists, parses, and predates the prose (Gate 1).
- [ ] `scripts/validate_*.ts` exists, follows the §6 argv contract, emits valid
      `validator-result.v1`, and passes the §6 rules (no network, explicit paths, timeout,
      always writes `--out`).
- [ ] Validator replays correctly against every case's `expected/` gold
      (`validator.expected_status` holds for all cases, including good-failure cases).
- [ ] SKILL.md has all ten template sections; "Do not use when" is substantive (Gate 2).
- [ ] Output contract names the deterministic workspace path (or diff target).
- [ ] ≥3 eval cases, ≥1 adversarial; every `metadata.json` uses exactly the §7 fields.
- [ ] Body ≤500 lines; detail pushed to `references/`, each referenced from SKILL.md with a
      when-to-read note; no stray README/CHANGELOG-style files inside the skill.
- [ ] Skill scripts run with bun builtins only (or a recorded decision + root `package.json`
      verified in a materialized workspace).

A skill without a validator and eval evidence does not merge.
