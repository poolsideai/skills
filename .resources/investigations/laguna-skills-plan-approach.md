> **Framing (added 2026-06-10).** Why this exists: Poolside is winding down its product surfaces, so the `pool` CLI (the Pool Harness) is becoming essentially the only way to reach Laguna and future Poolside models — and Laguna leans on the harness (tools, scaffolding, skills, prompts) to perform well. So this is **developer enablement, not a product**: skills first, later possibly MCP servers, CLI tools, and prompt-optimization tooling (e.g., DSPy, GEPA). Almost everything in *this* doc — authoring the skills and their schemas, validators, and eval cases — is **buildable today on `pool exec` with no harness changes**; the forge work in the companion plan (`laguna-skills-plus-pool.md`) mainly makes the evals cleaner and able to back published lift claims. Consolidated facts + open decisions live in `laguna-skills-and-harness-substrate-2026-06-10.md`.

---

## Thesis

Treat this as a validator-first skills library, not a prompt pack.

The attached analysis is pointing in the right direction: Laguna XS.2 should be treated as a bounded coding worker, Laguna M.1 should be used as a constrained router/planner only after it proves reliable, and the skills should turn repeatable engineering workflows into small contracts with schemas, validators, and repair loops. Do not ask the models to behave like better general agents.

Poolside already supports the Agent Skills format: each skill is a directory with a `SKILL.md`, YAML metadata, and optional scripts, references, and assets. Poolside discovers skills mainly from the `description`, then loads the full skill only when relevant, so descriptions and progressive disclosure matter a lot. ([docs.poolside.ai][1])

The win condition: Laguna gets a narrower task, cleaner context, fewer degrees of freedom, and a mechanical way to know whether it succeeded.

---

## Positioning

I would frame the library like this:

> A collection of validator-backed software-engineering skills optimized for Poolside Laguna models. These skills help agents map repositories, reduce logs, route stack traces, produce bounded patches, generate regression tests, and review risk using compact task contracts and executable validation.

That is stronger than "skills for Laguna prompts" because it says what actually matters: reliable work loops, not just better wording around model behavior.

Laguna XS.2 is a good fit because it is a 33B total / 3B active MoE model aimed at agentic coding, with long context and interleaved/preserved thinking support. ([Hugging Face][2]) Poolside also says Laguna XS.2 and M.1 support 256K context, which makes context-reduction and repo-understanding skills especially relevant. ([Poolside][3])

---

## First skill: make it a contract adapter

Your instinct about a "prompt Laguna" skill is good, but I would not call it `Optimize prompt for Laguna models`. That sounds like generic prompt tuning.

I would call it one of:

| Name                     | My take                                             |
| ------------------------ | --------------------------------------------------- |
| `laguna-task-contract`   | Best name. Emphasizes bounded executable contracts. |
| `laguna-worker-contract` | Good if the first version is mostly for XS.2.       |
| `laguna-prompt-adapter`  | Acceptable, but a little too prompt-centric.        |
| `laguna-model-routing`   | Better later, once routing is proven.               |

My recommendation: ship `laguna-task-contract` first.

Its job should be to turn an open-ended user or orchestrator request into a compact, model-specific contract.

### For Laguna XS.2

Use XS.2 as a narrow executor.

The generated contract should include:

```yaml
model_mode: laguna_xs_worker
task_type: single_file_patch | test_generation | log_reduction | stack_trace_routing | repo_map
goal: one sentence
context_packet:
  files:
    - path
    - relevant_snippet
  commands:
    - failing_command
  logs:
    - relevant_log_excerpt
constraints:
  max_files_to_modify: 1
  output_format: unified_diff | json
  must_not:
    - change unrelated behavior
    - perform broad refactors
    - invent unavailable files
validator:
  type: command | schema | patch_apply | test_result
  command: ...
repair_policy:
  max_repairs: 1
  return_only_corrected_output: true
```

### For Laguna M.1

Use M.1 as a router/planner, not a loose autonomous orchestrator.

The generated contract should include:

```yaml
model_mode: laguna_m_router
task:
  user_goal: ...
  candidate_skills:
    - repo-map
    - ci-log-reducer
    - single-file-patch
routing_decision:
  chosen_skill: ...
  reason: ...
delegations:
  - worker_model: laguna_xs
    task_contract: ...
stop_conditions:
  - schema_valid
  - validator_passed
  - escalation_required
```

The important bit is that M.1 should produce skill calls and task contracts, not free-form plans with recursive delegation.

The attached analysis warns against loose orchestration and recommends smaller contracts, schema validation, fewer degrees of freedom, and repair loops. Make that the founding design principle of the repo.

---

## Repo structure

I would structure the repo like this:

```text
skills/
  laguna-task-contract/
    SKILL.md
    references/
      laguna-xs-worker-contract.md
      laguna-m-router-contract.md
      anti-patterns.md
    schemas/
      task-contract.schema.json
      router-contract.schema.json
    scripts/
      validate_contract.py
    evals/
      evals.json
      cases/
        xs_single_file_patch_001/
        xs_ci_log_reduction_001/
        m_skill_routing_001/

  repo-map/
    SKILL.md
    scripts/
      collect_repo_facts.py
      validate_repo_map.py
    schemas/
      repo-map.schema.json
    evals/

  ci-log-reducer/
    SKILL.md
    scripts/
      extract_failure_windows.py
      validate_log_summary.py
    schemas/
      ci-log-summary.schema.json
    evals/

  stack-trace-router/
    SKILL.md
    scripts/
      validate_route.py
    schemas/
      stack-trace-route.schema.json
    evals/

  single-file-patch/
    SKILL.md
    scripts/
      validate_patch.py
    schemas/
      patch-task.schema.json
    evals/

  regression-test-generator/
    SKILL.md
    scripts/
      validate_test_patch.py
    schemas/
      test-generation.schema.json
    evals/

  patch-risk-review/
    SKILL.md
    schemas/
      patch-risk-review.schema.json
    evals/

harness/
  runner/
    run_eval.py
    pool_exec.py
    matrix.py
  validators/
    json_schema.py
    patch_apply.py
    command_result.py
    llm_judge.py
  reports/
    render_report.py

schemas/
  common/
    model-run.schema.json
    eval-case.schema.json
    eval-result.schema.json

docs/
  authoring-guide.md
  eval-methodology.md
  skill-acceptance-gates.md
  laguna-model-guidance.md
```

Keep each `SKILL.md` concise. The Agent Skills spec recommends progressive disclosure: put core instructions in `SKILL.md`, and move longer details into references, scripts, and assets. ([Agent Skills][4])

One Poolside-specific detail matters here: Poolside currently reads the standard Agent Skills fields but does not enforce fields such as `allowed-tools` or `compatibility`. Hard tool restrictions need to live in the harness, agent configuration, or runtime permissions, not just in skill metadata. ([docs.poolside.ai][1])

---

## Standard skill contract

Every skill should have the same shape. Do not let contributors invent their own style.

```text
---
name: skill-name
description: Clear trigger phrase: when this skill should be used and what it produces.
---

# Skill Name

## Purpose
What this skill does.

## Use when
Concrete triggers.

## Do not use when
Boundaries and anti-patterns.

## Inputs expected
Exact fields or context needed.

## Procedure
Small ordered workflow.

## Output contract
Required JSON schema, unified diff, or file artifact.

## Validation
How to check the output.

## Repair behavior
What to do when validation fails.

## Escalation
When to route to M.1, a stronger model, or a human.

## Examples
One minimal example and one realistic example.
```

The attached analysis recommends almost exactly this: trigger, inputs, allowed tools, output schema, validator, repair loop, fallback, and metrics. Make that the repo's authoring standard.

---

## First six skills to ship

I would ship these in this order:

| Priority | Skill                       | Primary model              | Why it fits Laguna                                                                                                     |
| -------: | --------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
|        1 | `laguna-task-contract`      | M.1 + XS.2                 | Establishes the model-specific interaction pattern. Prevents everyone from prompting Laguna like a generic chat model. |
|        2 | `ci-log-reducer`            | XS.2 or deterministic+XS.2 | Huge context, clear failure evidence, compact output, easy validation.                                                 |
|        3 | `repo-map`                  | XS.2                       | Uses long context but asks for structured understanding, not open-ended coding.                                        |
|        4 | `stack-trace-router`        | XS.2                       | Converts noisy failures into likely files/functions. A good bounded retrieval task.                                    |
|        5 | `single-file-patch`         | XS.2                       | High-value coding task with narrow blast radius and mechanical validation.                                             |
|        6 | `regression-test-generator` | XS.2                       | Concrete output, easy to apply, useful before full autonomous fixing.                                                  |

Then add:

| Later skill         | Why later                                                         |
| ------------------- | ----------------------------------------------------------------- |
| `patch-risk-review` | Useful, but harder to grade mechanically.                         |
| `api-migration`     | Good once patch/test validators are mature.                       |
| `experience-reuse`  | Powerful, but only after you have clean run traces and summaries. |
| `multi-file-patch`  | Do not start here. Too many degrees of freedom.                   |
| `m-orchestrator`    | Only after M.1 routing evals prove it helps.                      |

The attached analysis makes the same core recommendation: focus first on repo maps, stack trace routing, CI log reduction, single-file patches, test generation, and patch review. Delay open-ended orchestration until schema adherence is proven.

---

## Eval harness

Use the harness to answer one question:

> Does this skill make Laguna more likely to complete a verified engineering task at lower cost, lower time, or lower tool-call count?

Do not evaluate skills only by "does the output look good?" That will fool you.

The Agent Skills eval guidance recommends running tests both with skill and without skill, using clean contexts, capturing outputs, timing, tokens, assertions, and grading results. ([Agent Skills][5]) Poolside's `pool exec` is a good fit because it runs a single prompt non-interactively and can be used in scripts or CI. ([GitHub][6])

### Eval matrix

For each skill, run:

| Arm                      | Purpose                                   |
| ------------------------ | ----------------------------------------- |
| XS.2 no skill            | Baseline.                                 |
| XS.2 with skill          | Does the skill help the bounded worker?   |
| M.1 no skill             | Baseline for larger model.                |
| M.1 with skill           | Does M.1 use the skill correctly?         |
| M.1 router + XS.2 worker | Does orchestration beat single-model use? |

Optional external baselines:

| Baseline                        | Why                                      |
| ------------------------------- | ---------------------------------------- |
| Qwen/Devstral/Gemma class model | Comparable open coding model baseline.   |
| Claude/other proprietary model  | Instruction-following/control baseline.  |
| Deterministic script only       | Useful for log reduction and repo facts. |

The important comparison is not "Laguna beats every model." It is: Laguna + skill beats Laguna without skill, ideally with lower cost-of-pass.

### Eval case format

Each eval case should be a self-contained folder:

```text
evals/cases/ci_log_reducer_001/
  prompt.md
  input/
    ci.log
    repo_snapshot/
  expected/
    gold_summary.json
    gold_failure_lines.json
  validators/
    validate.py
  metadata.json
```

Example `metadata.json`:

```json
{
  "id": "ci_log_reducer_001",
  "skill": "ci-log-reducer",
  "task_bucket": "ci_failure",
  "difficulty": "easy",
  "expected_outputs": [
    "json_schema_valid",
    "failure_line_cited",
    "failing_command_identified",
    "next_command_valid"
  ],
  "models": [
    "laguna-xs.2",
    "laguna-m.1"
  ]
}
```

### Run artifact format

Every run should produce:

```text
runs/
  2026-06-10/
    ci_log_reducer_001/
      laguna-xs.2/
        without_skill/
          prompt.md
          output.txt
          transcript.json
          metrics.json
          validator.json
        with_skill/
          prompt.md
          output.txt
          transcript.json
          metrics.json
          validator.json
```

Store the skill version, model name, prompt, transcript, output, validator result, token estimate, latency, tool calls, and final verdict.

---

## Metrics that matter

Use these as the core dashboard:

| Metric                     | Meaning                                                       |
| -------------------------- | ------------------------------------------------------------- |
| Skill activation precision | Did the skill trigger only when relevant?                     |
| Skill activation recall    | Did the skill trigger when it should have?                    |
| Schema validity            | Did the model produce parseable output?                       |
| Validator pass rate        | Did the task actually pass?                                   |
| Repair success rate        | Did one repair loop fix invalid output?                       |
| Cost-of-pass               | Tokens or dollars per verified success.                       |
| Time-to-verified-success   | Wall-clock time until validator passes.                       |
| Tool-call count            | Did the skill reduce wandering?                               |
| Context compression ratio  | How much noise was removed?                                   |
| Top-k file recall          | For routing skills, did it identify the right files?          |
| Patch apply rate           | Did the diff apply cleanly?                                   |
| Test pass/fail correctness | Did tests fail before and pass after?                         |
| Instruction violation rate | Did it modify too many files, ignore schema, or invent facts? |
| Escalation accuracy        | Did it know when not to continue?                             |

For early releases, I would use simple gates:

| Gate                                       | Suggested threshold       |
| ------------------------------------------ | ------------------------- |
| `SKILL.md` syntactic validation            | 100%                      |
| Output schema validity                     | >=95%                     |
| Validator pass lift over no-skill baseline | 15-20 percentage points   |
| Repair success after one retry             | >=50% of invalid outputs  |
| Instruction violations                     | <5%                       |
| Regression against no-skill baseline       | None in core cases        |

Agent Skills also recommends starting with a few realistic test cases, running with/without the skill, using verifiable assertions where possible, and inspecting failed transcripts to iterate. ([Agent Skills][5])

---

## Validators by skill

### `laguna-task-contract`

Validate:

- JSON schema is valid.
- `model_mode` is one of the accepted modes.
- Task has a single clear goal.
- XS.2 contracts do not request broad planning.
- M.1 contracts produce skill routing, not free-form execution.
- Validator field is present.
- Repair policy is present.

Good failure examples:

- "Fix this whole repo."
- "Use any approach you want."
- "Return prose explaining the patch."
- "Delegate recursively until solved."

Those should fail validation.

---

### `ci-log-reducer`

Output schema:

```json
{
  "failure_summary": "string",
  "primary_error_lines": [
    {
      "line_number": 123,
      "text": "string",
      "why_relevant": "string"
    }
  ],
  "failing_command": "string",
  "likely_component": "string",
  "next_commands": ["string"],
  "confidence": "low|medium|high"
}
```

Validate:

- Referenced line numbers exist.
- Error lines are copied from the log.
- Failing command appears in log or metadata.
- Summary mentions the real failure class.
- Next commands are safe, local, and relevant.

This skill should include a deterministic preprocessor that extracts tail windows, error windows, traceback blocks, and test summary blocks before the model sees anything. XS.2 will look much better when the input is already shaped.

---

### `repo-map`

Output schema:

```json
{
  "repo_type": "string",
  "languages": ["string"],
  "entry_points": [{"path": "string", "reason": "string"}],
  "test_commands": ["string"],
  "important_directories": [{"path": "string", "purpose": "string"}],
  "dependency_files": ["string"],
  "risk_notes": ["string"]
}
```

Validate:

- All paths exist.
- Test commands are found in package/config/docs or executable.
- Entry points are plausible based on actual files.
- No hallucinated frameworks.

---

### `stack-trace-router`

Output schema:

```json
{
  "likely_files": [
    {
      "path": "string",
      "rank": 1,
      "evidence": ["string"]
    }
  ],
  "likely_symbols": [
    {
      "symbol": "string",
      "path": "string",
      "evidence": "string"
    }
  ],
  "next_inspection_steps": ["string"],
  "confidence": "low|medium|high"
}
```

Validate:

- File paths exist.
- At least one top-3 file matches gold culprit for seeded cases.
- Evidence quotes stack trace or code facts.
- No suggested global search unless confidence is low.

---

### `single-file-patch`

Output should be only a unified diff.

Validate:

- Patch applies with `git apply --check`.
- Only one file changes.
- File exists unless task allows creation.
- Tests pass.
- No unrelated formatting churn.
- No generated prose outside diff.

This is where XS.2 can do well if you keep the task boxed.

---

### `regression-test-generator`

Output should be a unified diff adding or modifying tests.

Validate:

- Patch applies.
- Test file path matches repo conventions.
- Test fails against buggy fixture.
- Test passes after known fix, where fixture has a gold patch.
- No production code changes unless explicitly allowed.

---

### `patch-risk-review`

Output schema:

```json
{
  "summary": "string",
  "risk_level": "low|medium|high",
  "risks": [
    {
      "category": "correctness|security|compatibility|performance|testing|maintainability",
      "severity": "low|medium|high",
      "evidence": "string",
      "recommendation": "string"
    }
  ],
  "missing_tests": ["string"],
  "ship_recommendation": "ship|ship_with_followup|block"
}
```

Validate with seeded diffs and known risk labels. This will need some human or LLM-judge review, but keep as much as possible mechanical.

---

## First PR

The first PR should not contain 20 skills. It should establish the pattern.

Ship:

```text
skills/
  laguna-task-contract/
  ci-log-reducer/
  repo-map/

harness/
  run_eval.py
  validators/

schemas/
  common/

docs/
  authoring-guide.md
  eval-methodology.md
```

Include 8-12 eval cases total:

| Skill                  | Cases |
| ---------------------- | ----: |
| `laguna-task-contract` |     4 |
| `ci-log-reducer`       |     4 |
| `repo-map`             |     3 |

That is enough signal without trying to build the whole library at once.

---

## Skill authoring loop

Use this loop for every new skill:

1. Mine real tasks. Use CI failures, issue threads, diffs, review comments, stack traces, migration PRs, and internal runbooks. Agent Skills best practices explicitly recommend starting from real expertise and real failure cases. ([Agent Skills][7])

2. Write the output schema before the prompt. This forces you to define what "good" means.

3. Write the validator before polishing the skill. If you cannot validate it, the skill is probably too broad.

4. Create 3-5 eval cases. Include one easy, one realistic, one adversarial, and one edge case.

5. Run with and without the skill. Do this for XS.2 and M.1.

6. Inspect transcripts. Look for wandering, schema drift, over-editing, missed evidence, and invalid assumptions.

7. Simplify the skill. Most bad skills are too long, too menu-driven, or too vague.

8. Promote repeated work into scripts. If the model repeatedly greps logs, extracts stack frames, or validates paths, write a script.

9. Add a repair loop. Feed back only validator errors and request corrected output.

10. Version the skill. Track skill version, schema version, and eval result together.

---

## Laguna-specific design principles

### 1. Prefer "context packet" over "full context"

Even with 256K context, do not stuff everything in. Use deterministic tools to create context packets:

```text
task.md
repo_facts.json
relevant_files.md
failure_excerpt.log
constraints.json
output_schema.json
```

Long context helps, but clean context helps more.

### 2. Give XS.2 one job

Bad:

> Investigate the repo, identify the bug, fix it, add tests, and explain your reasoning.

Good:

> Given this failing command, stack trace, and two file snippets, produce a unified diff modifying only `src/parser.ts`. Do not modify tests. Return only the diff.

### 3. Give M.1 routing choices, not open space

Bad:

> Decide how to solve this.

Good:

```json
{
  "available_skills": [
    "repo-map",
    "ci-log-reducer",
    "stack-trace-router",
    "single-file-patch",
    "regression-test-generator"
  ],
  "choose_one_next_skill": true,
  "return_schema": "router-contract.schema.json"
}
```

### 4. Make failure acceptable

Every skill should have an explicit "I cannot complete this safely" path. That matters most for patching and routing.

### 5. Separate thinking help from the output contract

Let the model reason internally, but keep the final output strict. The final answer should be JSON, a diff, or a file artifact. Not prose plus maybe-code.

---

## What not to build first

I would avoid these early:

| Avoid early                          | Why                                         |
| ------------------------------------ | ------------------------------------------- |
| General "autonomous SWE agent" skill | Too broad; hard to validate.                |
| Recursive multi-agent orchestration  | High failure surface.                       |
| Multi-file refactor skill            | Hard to bound and grade.                    |
| "Use Laguna better" mega-prompt      | Will rot quickly and hide failure modes.    |
| Huge repository memory skill         | Retrieval quality matters more than volume. |
| Subjective code-review-only skill    | Useful later, weak validator early.         |

The attached analysis is blunt on this point: put effort into context reducers, schemas, validators, and experience retrieval instead of fighting instruction-following weaknesses head-on.

---

## Public-release acceptance criteria

Before a skill is considered ready, require:

```text
- Skill passes syntactic validation.
- Skill has at least 3 eval cases.
- Skill has a machine-readable output contract.
- Skill has at least one validator.
- Skill has with-skill vs without-skill eval results.
- Skill improves pass rate, cost-of-pass, or time-to-verified-success.
- Skill has documented non-goals.
- Skill has at least one adversarial or edge-case eval.
- Skill has no known high-severity instruction violations.
```

For the repo as a whole, publish a simple benchmark table:

| Skill               | XS.2 baseline pass | XS.2 + skill pass | M.1 baseline pass | M.1 + skill pass | Main lift                    |
| ------------------- | -----------------: | ----------------: | ----------------: | ---------------: | ---------------------------- |
| `ci-log-reducer`    |                45% |               78% |               58% |              82% | Better failure extraction    |
| `repo-map`          |                52% |               74% |               65% |              79% | Better structured repo facts |
| `single-file-patch` |                38% |               55% |               46% |              60% | Fewer invalid diffs          |

The numbers above are placeholders, but the table format is right.

---

## Roadmap

### Phase 1: foundation

Build:

- `laguna-task-contract`
- shared schemas
- basic eval runner
- JSON schema validator
- patch validator
- run artifact format
- 8-12 eval cases

Goal: prove the repo is a testable skill package, not a prompt dump.

### Phase 2: context skills

Build:

- `ci-log-reducer`
- `repo-map`
- `stack-trace-router`

Goal: make Laguna better at finding the right context before editing.

### Phase 3: bounded editing

Build:

- `single-file-patch`
- `regression-test-generator`

Goal: demonstrate verified code changes.

### Phase 4: orchestration experiment

Build:

- M.1 router evals
- M.1 router + XS.2 worker harness
- compare against single-model baselines

Goal: prove or disprove the orchestration thesis with data.

---

## Core bet

The skills library should make this bet:

> Laguna models are strongest when the workflow supplies clean context, narrow contracts, explicit schemas, and executable validation. The library's job is to make those conditions the default.

Start with `laguna-task-contract`, `ci-log-reducer`, and `repo-map`. Put the eval harness in the first PR. Then make every additional skill prove that it improves Laguna's verified outcomes before it becomes part of the library.

[1]: https://docs.poolside.ai/skills "Skills - Poolside"
[2]: https://huggingface.co/poolside/Laguna-XS.2 "poolside/Laguna-XS.2 - Hugging Face"
[3]: https://poolside.ai/blog/long-context-update-laguna-xs-2-and-m-1 "Long context update: Laguna XS.2 and M.1 - Poolside"
[4]: https://agentskills.io/specification "Specification - Agent Skills"
[5]: https://agentskills.io/skill-creation/evaluating-skills "Evaluating skill output quality - Agent Skills"
[6]: https://github.com/poolsideai/pool "GitHub - poolsideai/pool: pool is Poolside's coding agent that runs in your terminal or integrates with any ACP-compatible editor - GitHub"
[7]: https://agentskills.io/skill-creation/best-practices "Best practices for skill creators - Agent Skills"
