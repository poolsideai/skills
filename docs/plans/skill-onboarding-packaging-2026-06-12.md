# Skill onboarding + packaging plan (VPS execution)

Status: planned 2026-06-12, designed for autonomous execution on a remote box.
Owner: Ben. Companion: docs/plans/skill-optimization-gepa-2026-06-11.md,
plans/README.md (UI track), CLAUDE.md (conventions — binding).

## Goal

Make the repo usable by a newcomer with one front door: bring a directory of
foreign skills (e.g. Claude-Code-style SKILL.md folders), get them graded,
get them optimized for Laguna. Also: extend optimization to multi-file
skills (references/, preprocessor scripts).

## Verified ground truth (2026-06-12)

- Runtime already supports complex skills: fixtures.materialize copies the
  whole skill dir minus evals/ (references/ + scripts ship to workspaces).
- frozen_paths_gate already draws the right mutability line: SKILL.md,
  references/, non-validator scripts mutable; evals/, schemas/,
  scripts/validate_*.ts frozen.
- GEPA genome is SKILL.md only (gepa_skill.py CandidateFactory swaps one
  file). gepa's optimize_anything accepts multi-component dict candidates
  with round-robin module selection — the extension point.
- gen_eval_cases.py requires >=1 existing loadable case to seed from
  (no bootstrap mode yet). laguna-task-contract is the existing example of
  a multi-file skill (3 reference docs).

## Finding 2026-06-12 (read first): contract-laden prompts cap skill lift

First full-suite scoreboard (ci-log-reducer v0.1.1, 19 cases x 4 arms):
without-skill arms score 0.959 mean / 36/40 pass; with-skill 0.868 / 30/40
(-15pp pass-rate "lift"). Root causes, verified per-check: (a) eval prompts
spell out the entire output contract (by design, for shared grading
targets), so baselines are nearly saturated and the skill can only add
process overhead on these prompts; (b) the skill's preprocessor workflow
causes error-lines-verbatim regressions when used imperfectly (5 arms, both
model classes) and two artifact-exists total failures (process overhead,
artifact never written). GEPA's within-arm lift on val (0.694 -> 0.837)
remains real; the with-vs-without comparison is structurally biased.

### Work item 0 (new, before item 5): two-tier prompts
Per case, add prompt_realistic.md: names the artifact path (so all arms can
still be graded) but does NOT enumerate fields/rules — contract knowledge
must come from the skill. Harness: --prompt-variant flag in matrix/run_eval
(default current full prompts; realistic variant for lift measurement).
Re-baseline ci-log-reducer both ways; report both numbers. Do NOT accept
open GEPA proposals until realistic-variant evidence exists.

## Work items, in order

### 1. Getting-started packaging (no LM, no pool)
- Rewrite README.md top section: what this repo is (validator-first skill
  library + eval harness + GEPA optimization), the three-command story:
  check -> eval -> optimize. Link the ci-log-reducer arc as the worked
  example (val 0.694 -> 0.837 -> 0.939 across two GEPA rounds; numbers
  internal/directional per docs/eval-methodology.md §7).
- docs/getting-started.md: prerequisites (uv, bun, pool auth,
  OPENROUTER_API_KEY or any litellm provider), the full loop walkthrough
  (structure checks, dry-run replay, live suite, optimize-skill,
  optimize-propose, queue accept semantics incl. EVIDENCE LEVEL warning).

### 2. `onboard` command — triage phase (no LM)
- harness/onboard/triage.py + `bun ui/bench.ts onboard --source <dir>`:
  per skill report — structure delta vs authoring template, frontmatter
  validity, has/implies a deterministic output artifact?, verdict:
  ready | needs-contract | advice-only. JSON + human-readable. No writes
  outside runs/onboard/.
- advice-only skills are flagged honestly; never given synthetic validators.

### 3. Generator bootstrap mode
- gen_eval_cases.py --bootstrap: works with zero existing cases. Seed
  context = SKILL.md + schemas + validator only; first case becomes the
  worked example for subsequent batches. Same gates (incl. gold replay +
  sensitivity probe). Human promote unchanged.

### 4. Onboard prepare phase (LM, quarantined, human-gated)
- For needs-contract skills: LM synthesizes output contract + schema +
  validator (validate_*.ts via _shared/validator-result.ts) + 3 bootstrap
  cases into runs/onboard/<skill>/ (NEVER directly into skills/).
- Mechanical gates before human review: check_skill_structure (imported),
  schema parse, validator robustness battery (junk grading -> "fail",
  never crash; no network; size caps), gold replay, sensitivity probe.
- Human reviews the validator above all (the validator IS the grader; this
  review is the one that can never be skipped), then a promote command
  moves skill + cases into skills/ + suites (rollback on check failure,
  same pattern as gen_eval_cases --promote).

### 5. Multi-file genome (complex-skill optimization)
- gepa_skill.py: seed candidate becomes {skill_md, references/<name>...}
  for skills with references/ (flag --components, default SKILL.md only).
- CandidateFactory: materialize N files; byte cap per component + total;
  anti-overfit literal gate across all components; frozen gate unchanged.
- Pilot on laguna-task-contract (3 reference docs, 16-case corpus).
- Possible follow-up: optimize `description` as separate component
  (activation precision/recall).

## Guardrails for the executing agent

- The two hard gates and the frozen-grader rule are non-negotiable; never
  auto-merge generated validators/cases; quarantine + human promote.
- Run the full check battery + dry-run --replay after every phase; commit
  per phase with evidence in the message; push to a feature branch, open a
  PR per phase (human merges).
- All eval numbers are internal/directional. Record harness debt honestly.

## Verification

Phase done = checks green + (for 2/3/4) the new path exercised end-to-end
on at least one real skill + documented in the phase commit message.
