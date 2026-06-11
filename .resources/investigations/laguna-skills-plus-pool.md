> **Framing (added 2026-06-10).** Why this exists: Poolside is winding down its product surfaces, so the `pool` CLI (the Pool Harness) is becoming essentially the only way to reach Laguna and future Poolside models — and Laguna leans on the harness to perform well. So this work is **developer enablement, not a product**. Read the PR plan below as two streams: **PR1 is the "now" path** — a real with/without eval loop on *today's* `pool exec` with zero forge changes — while **PR2–PR7 are harness improvements** that make those evals isolated, reproducible, and able to back published lift claims (they are not prerequisites to starting). Consolidated facts + open decisions live in `laguna-skills-and-harness-substrate-2026-06-10.md`.

---

Do not build a separate eval system that fights `pool`. Build the first eval runner outside `forge`, but make the first few `forge` PRs turn `pool exec` into a more reproducible eval substrate.

The current code is close enough that the recommended PRs are about control, isolation, telemetry, and artifact paths, not a rewrite.

## Current shape of `pool`

`cmd/pool/main.go` wires the CLI together and adds `exec`, `config`, hidden `history`, hidden `agents`, `mcp`, `secret`, `acp`, and update/platform commands. The eval-facing entry point is `pool exec`, with `history` and trajectory inspection nearby.

`pool exec` already has most of what a first evaluator needs: prompt/prompt-file/stdin, working directory, `--agent-name`, `--api-url`, JSON output, context files, sandbox override, hidden agent config file, hidden run ID override, and `--unsafe-auto-allow`. It also has clear exit semantics: `0` for task success, `4` when the agent explicitly indicates failure, and other non-zero codes for unexpected errors.

The agent runtime path does the harness work: it resolves settings, applies user settings, initializes MCP, constructs the execution environment/sandbox, merges prompt context, creates a trajectory, starts a session, streams events, stores trajectory events, and reports the trajectory path in logs.

The skills implementation is also real. There is a `SkillTool`, a registry abstraction, local workspace/user skill discovery, default embedded skill installation, and remote repository-backed skill support. Local discovery checks `.poolside/skills` and `.agents/skills` under working dirs, plus user-global skills. The skill tool exposes names/descriptions to the model and loads the full skill content plus directory path on demand.

That is enough to support the Laguna strategy we discussed: small contracts, clean context, explicit validation, and measured harness effects rather than prompt-only skill marketing. The earlier Laguna analysis still applies here: use XS.2 as a bounded coding worker, be cautious about loose orchestration, and put validators in the middle of the workflow.

## The main gaps I see

The biggest gaps are these:

1. `pool exec` is runnable, but not eval-grade reproducible yet. It has JSON output, but the JSON formatter is sparse: reasoning, thought, tool call, and tool result, with most tool results stringified.

2. Skill availability is not isolated enough for clean evals. Local registry currently installs default user-global skills unless skipped, then scans workspace and user-global locations. That is good for product use, but it can contaminate skill-vs-no-skill evals.

3. Skill selection is model-driven, but not directly controllable from `pool exec`. The model sees available skill names/descriptions and may call the skill tool, but I did not see CLI flags for "disable all skills," "force this skill," "allow only these skills," or "use this skills path." The frontmatter parser also explicitly has a TODO for `allowed-tools`, so per-skill tool restriction is not enforced from skill metadata today.

4. Remote skills appear better wired for ACP than for `pool exec`. In the ACP runner, runtime options pass `RemoteSkillRepositories` from the agent's repository definitions. In the `pool exec` path I inspected, the `AgentRuntime` options include approval, unknown-tool handling, shell manager, execution environment, redaction, and OAuth presenter, but not remote skill repository configs. That is likely a parity PR if the public recommendation is "use skills with `pool exec`."

5. There is trajectory support, but artifact export is awkward for automation. `history trajectories` can list/show trajectories and render ATIF, but eval runners should not need to scrape "latest" or parse stderr to find artifacts.

## Recommended PR plan

### PR 1: External eval runner in the skills repo using today's `pool exec`

This PR should live in the new `skills` repo, not `forge`.

Purpose: prove the evaluation loop without changing `pool`.

Use the current CLI surface:

```bash
pool exec \
  --prompt-file prompt.md \
  --directory workspace \
  --output json \
  --unsafe-auto-allow \
  --sandbox required \
  --run-id <stable-id>
```

Use `history trajectories --atif` as a temporary way to recover full trajectory data. It is awkward, but it lets you start collecting real runs immediately.

Agent investigation prompt:

> Investigate the current `pool exec` automation surface and write a minimal external eval runner plan. Start in `cmd/pool/exec_cmd.go`, `pkg/poolcli/main.go`, `pkg/poolcli/json_formatter.go`, and `cmd/pool/history_cmd.go`. The runner should execute cases, capture stdout/stderr/exit code, recover trajectory/ATIF if possible, and run validators from the skills repo. Identify every place where it currently has to rely on fragile behavior.

Why first: it gives you a baseline and makes the next `forge` PRs easier to justify.

---

### PR 2: Remote skills parity for `pool exec`

This is the first `forge` PR I would do.

Purpose: make `pool exec` and ACP behave consistently with respect to repository-backed skills.

The ACP runner already passes remote skill repository configs into `agentconfigbuilder.AgentRuntime`. The `pool exec` path should do the same, assuming the selected agent has repository definitions available. The remote skill registry already knows how to list repository skills, filter enabled skills, and lazily download/materialize a skill into the execution environment.

Agent investigation prompt:

> Compare skill registry initialization in `pkg/poolcli/main.go` and `cmd/pool/acp/agentrunner/runner.go`. Determine whether `pool exec` currently omits `agentInfo.RepositoryDefinitions.ToRuntimeConfigs(...)`. Propose the smallest safe diff to pass remote skill repositories into `AgentRuntime` for non-standalone `pool exec`, with tests that prove a repository-backed skill is visible to the `skill` tool.

The public story likely becomes: create a skills repo, attach it to an agent/repository definition, and evaluate it through `pool exec`.

---

### PR 3: Skill isolation and selection controls for `pool exec`

Purpose: make skill evals clean.

Add internal or public flags like:

```bash
pool exec --disable-skills
pool exec --allow-skills ci-log-reducer,repo-map
pool exec --force-skill ci-log-reducer
pool exec --skip-default-skills
pool exec --skills-path ./skills
```

You may not need all of these immediately, but you need at least:

```bash
--disable-skills
--allow-skills
--skip-default-skills
```

The current registry scans workspace skills and user-global skills, and it can install bundled defaults automatically. That is correct for normal users, but it makes evals hard to interpret unless you can isolate exactly which skills were available.

Agent investigation prompt:

> Design skill availability controls for `pool exec`. Start in `cmd/pool/exec_cmd.go`, `pkg/poolcli/main.go`, `pkg/agent/configbuilder/builder.go`, and `pkg/agent/llmtools/skill/*`. Propose how to plumb a skill policy through `RunArgs` into `RegistryConfig` without changing default user behavior. Include a test matrix for no skills, default skills, workspace-only skills, allow-list skills, and remote skills.

This is one of the main harness requirements because you need to distinguish:

```text
XS.2 no skill
XS.2 skill available
XS.2 skill forced
M.1 auto-routes to skill
M.1 router + XS.2 worker
```

Those are different experiments.

---

### PR 4: Stable run artifact outputs

Purpose: stop relying on "latest trajectory" lookup.

Add flags like:

```bash
pool exec --run-artifacts-dir ./runs/case-001/xs-with-skill
```

or more granular:

```bash
pool exec --trajectory-out ./trajectory.json
pool exec --atif-out ./trajectory.atif.json
pool exec --metadata-out ./run.json
```

`pool exec` already has a hidden `--run-id`, and the runtime already knows the trajectory store path when it logs the trajectory summary. This PR should be mostly about making that information explicit and machine-consumable.

Agent investigation prompt:

> Investigate trajectory storage and export for `pool exec`. Start in `pkg/poolcli/main.go`, `cmd/pool/history_cmd.go`, and the storage/session-store packages. Propose a stable artifact-output API that writes run metadata, raw trajectory, ATIF trajectory, stdout/stderr, and final exit status to a caller-provided directory. Avoid breaking existing `history trajectories` behavior.

This gives you the artifact boundary for reproducible model/harness comparisons.

---

### PR 5: Eval-grade JSON/event telemetry

Purpose: make `pool exec -o json` usable for metrics.

Today's JSON formatter is fine for basic automation, but weak for evals. It emits reasoning/thought/tool call/tool result events, but tool results are mostly stringified and there is no explicit run metadata event, skill activation event, model identity, pool version, resolved agent config, sandbox config, or skill list.

Add either a new output mode:

```bash
pool exec -o eval-json
```

or a versioned flag:

```bash
pool exec -o json --json-schema-version 2
```

Useful events:

```json
{"type":"runMetadata", "...": "..."}
{"type":"availableSkills", "skills":[...]}
{"type":"skillActivated", "name":"ci-log-reducer", "location":"workspace", "dir_path":"..."}
{"type":"toolCall", "name":"read_file", "args":{...}}
{"type":"toolResult", "name":"read_file", "structured":{...}}
{"type":"trajectorySummary", "duration_ms":..., "exit_reason":"..."}
```

Agent investigation prompt:

> Audit `pkg/poolcli/json_formatter.go`, `pkg/poolcli/formatter.go`, and `cliRun.handleEvent` in `pkg/poolcli/main.go`. Propose an eval JSON v2 format that preserves backward compatibility with current `-o json`, adds run metadata, includes structured tool-result fields where possible, and emits skill activation information when the `skill` tool is called.

This will let you compute "tool-call count," "irrelevant reads," "skill activated," "repair loop count," and "time to first relevant file" without writing brittle regex parsers.

---

### PR 6: Model/eval config ergonomics

Purpose: make model matrix runs easy without depending on named backend agents only.

`pool exec` already has `--agent-name`, `--api-url`, and a hidden `--agent-config-file`. The agent config itself supports OpenAI-compatible model config with `model_id`, sampling params, guided generation fields, streaming controls, and reasoning effort.

For evals, I would not start by adding a simple `--model` flag. A raw model flag can hide a lot of harness configuration. Instead, make model runs config-file driven:

```bash
pool exec --agent-config-file eval-agents/laguna-xs.json ...
pool exec --agent-config-file eval-agents/laguna-m.json ...
```

Then optionally add a nicer wrapper later.

Agent investigation prompt:

> Investigate whether `--agent-config-file` is sufficient for reproducible model evals. Start in `cmd/pool/exec_cmd.go`, `pkg/poolcli/main.go`, and `pkg/agent/config/config.go`. Produce example agent config files for Laguna XS.2 and Laguna M.1, including enabled tools, reasoning settings, max steps, sampling, sandbox assumptions, and context-window settings. Recommend whether to unhide/document `--agent-config-file` for internal eval use or add a dedicated `pool eval` model config format.

This keeps model evaluation honest: model, tools, reasoning behavior, context compaction, and max steps all travel together.

---

### PR 7: Native `pool eval` command, after the external runner proves itself

Do this later, not first.

Purpose: move the stable subset of the skills repo evaluator into `forge`.

Possible command shape:

```bash
pool eval run evals/suites/smoke.yaml
pool eval report runs/2026-06-10-smoke
pool eval compare runs/baseline runs/treatment
```

This should consume declarative suites and cases from the skills repo, invoke `pool exec`, collect artifacts, run validators, and render pass-rate/cost-of-pass reports.

Agent investigation prompt:

> Take the external skills-repo eval runner and identify what belongs inside `pool eval` versus what should remain in the skills repo. Start with `cmd/pool/exec_cmd.go`, `cmd/pool/history_cmd.go`, `pkg/poolcli/main.go`, and any existing test harness patterns in `forge`. Design a minimal `pool eval run` command that shells through the same execution path as `pool exec`, not a separate agent runtime.

Wait until you know what the runner actually needs.

---

## Suggested sequencing

I would sequence it like this:

```text
1. skills repo: external eval runner using current pool exec
2. forge: remote skills parity for pool exec
3. forge: skill disable/allow/skip-default controls
4. forge: stable run artifact output
5. forge: eval JSON v2 / richer telemetry
6. skills repo: Laguna SkillBench v0 with 10–20 cases
7. forge: native pool eval command, if the external runner has stabilized
```

That order keeps the project honest. You do not overbuild `pool eval` before you have real cases and validators.

## What I would have agents investigate first

Here are the highest-yield investigation packets.

### Investigation A: `pool exec` runtime map

Ask an agent:

> Produce a runtime map for `pool exec`: flags → `mainArgs` → `poolcli.RunArgs` → settings → agent config → sandbox → runtime → session → formatter → trajectory store. Identify all extension points for eval metadata, artifact output, skill policy, and model config.

Start files:

```text
cmd/pool/exec_cmd.go
pkg/poolcli/main.go
pkg/poolcli/json_formatter.go
pkg/poolcli/formatter.go
cmd/pool/history_cmd.go
```

### Investigation B: skill registry and skill activation

Ask an agent:

> Map the full skill lifecycle: discovery, default install, local/workspace/user precedence, remote repository listing, skill loading, and skill tool result. Identify where to add disable/allow/force/skip-default controls and where to emit skill telemetry.

Start files:

```text
pkg/agent/llmtools/skill/types.go
pkg/agent/llmtools/skill/local_registry.go
pkg/agent/llmtools/skill/remote_registry.go
pkg/agent/llmtools/skill/composite_registry.go
pkg/agent/llmtools/skill/skill_tool.go
pkg/agent/configbuilder/builder.go
```

### Investigation C: ACP vs `pool exec` parity

Ask an agent:

> Compare ACP runner behavior and `pool exec` behavior for skills, remote repositories, reasoning effort, sandboxing, MCP servers, trajectory storage, and context injection. Produce a parity matrix and recommend which differences are intentional versus eval blockers.

Start files:

```text
cmd/pool/acp/agentrunner/runner.go
pkg/poolcli/main.go
pkg/agent/configbuilder/builder.go
```

### Investigation D: eval artifact and ATIF path

Ask an agent:

> Determine the cleanest way to make `pool exec` emit deterministic artifacts without scraping `history`. Include raw stdout/stderr, JSON events, local trajectory path, ATIF export, run metadata, final status, agent ID, session ID, model ID, pool version, and skill list.

Start files:

```text
pkg/poolcli/main.go
cmd/pool/history_cmd.go
pkg/product/agentproducts/storage/*
pkg/poolcli/history/*
```

### Investigation E: model config matrix

Ask an agent:

> Determine the most reproducible way to run Laguna XS.2, Laguna M.1, and external baselines through the same `pool exec` path. Compare named agents, standalone API URL, and `--agent-config-file`. Recommend a canonical eval-agent config format.

Start files:

```text
cmd/pool/exec_cmd.go
pkg/poolcli/main.go
pkg/agent/config/config.go
pkg/agent/config/defaults.go
pkg/agent/models/*
pkg/agent/models/factory/*
```

## My bottom-line recommendation

Make the public/dev story this:

> Skills are standard Agent Skills, but they are recommended with `pool` because `pool` supplies the harness behavior Laguna needs: preserved trajectory, sandboxed execution, tool protocol, skill discovery, and reproducible non-interactive runs.

Internally, the PR plan should be sharper:

First make `pool exec` a reliable measurement primitive. Then make skill availability controllable. Then add richer telemetry. Only then build `pool eval`.

That gives you a clean way to answer the three questions that matter:

```text
Did Laguna improve?
Did the skill improve Laguna?
Did the harness change improve or hurt Laguna?
```
