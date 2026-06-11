# §9 Workstream C: Pool (forge) harness changes

> Full workstream detail · Router: [`../../laguna-skills-and-harness-substrate-2026-06-10.md`](../../laguna-skills-and-harness-substrate-2026-06-10.md) (§9) · Map: substrate §3 · Decisions: substrate §13 · Index: [`README.md`](README.md)
> Data contracts referenced here: [`../contracts/run-artifact-manifest.md`](../contracts/run-artifact-manifest.md), [`../contracts/telemetry-events.md`](../contracts/telemetry-events.md), [`../contracts/validator-result-v1.md`](../contracts/validator-result-v1.md).

**Scope:** The PR sequence that makes `pool exec` eval-grade. **All premises verified (§6, §12).**
Below: each proposed PR, its **verified status**, the **start files**, and the main nuance.

**Read the sequence as two streams (§3.1):** PR1 is the **"now path"**: it lives in the `skills` repo and uses
*today's* `pool exec` with **no forge change**. PR2-PR7 are forge hardening that make the evals isolated,
reproducible, and publishable; they raise rigor and are *not* prerequisites to starting measurement.

**Harness constraints (apply across the PRs below; stated once, referenced by the rows):**
- **`runPoolCLI` calls `os.Exit` unconditionally**, so it is **not reusable in-process**. Anything that needs
  to drive `pool`, including the external runner (PR1) and a future `pool eval` (PR7), must run it as a
  **subprocess** unless `runPoolCLI` is refactored.
- **Hidden/internal flags are unstable** (`--run-id`, `--agent-config-file`, …): usable as a bridge, but every
  reliance must be logged as harness debt (affects PR1, PR3, and the eval-runner boundary in §8).
- **Preserve back-compat** of the existing `-o json` output when adding telemetry (PR5).

| PR (Plan B) | Capability | Problem solved / why this PR exists | Verified status | Start files / anchors | Nuance for planner |
|---|---|---|---|---|---|
| PR1 | External eval runner using *today's* `pool exec`. **The "now path": no forge change.** | Establish a real with-vs-without measurement loop before changing `forge`, and expose which current behaviors are too fragile for evals. | N/A (new code in `skills` repo) | `exec_cmd.go`, `pkg/poolcli/main.go`, `json_formatter.go`, `history_cmd.go` | Lives in `skills`, not `forge`. Runs `pool exec` as a **subprocess** (see *Harness constraints* above). Uses hidden `--run-id` + `history trajectories --atif` as the awkward artifact path until PR4. |
| PR2 | Remote-skill parity for `pool exec` | Product/distribution path likely uses repository-backed skills, but `pool exec` cannot evaluate what ACP agents can see unless remote skill repositories are wired the same way. | ✅ gap confirmed (§6.3) | `pkg/poolcli/main.go:336`, `configbuilder/builder.go:73`, `acp/agentrunner/runner.go:1323` | Likely small **only if** the exec path has the selected agent's `RepositoryDefinitions` available at `main.go:336`. That is the open unknown; if not, PR2 is more than plumbing. Mirror ACP's `RepositoryDefinitions.ToRuntimeConfigs(...)` (`runner.go:1323`) into exec's `AgentRuntime` Options. Pairs with **Workstream H** (pinning/digest, §10). |
| PR3 | Skill isolation/selection flags | Current eval arms are contaminated and ambiguous: defaults may install/upgrade, user-global skills may leak in, and "tool disabled" vs "tool enabled with no skills" are different controls. | ✅ gap confirmed (§6.2/§6.4); **partially pre-wired** | `exec_cmd.go`, `pkg/poolcli/main.go`, `configbuilder/builder.go:411`, `skill/types.go:11`, `skill/local_registry.go:41` | `SkipDefaultSkillInstall` is a **default-install mutation control**, not full isolation. User-global skills still scan (§6.2). `--disable-skills` ≈ drop `SkillToolName` from `EnabledTools` (registry won't init). `--allow-skills`/`--force-skill`/`--skills-path` are net-new. **Each flag's semantics are still undefined; see §9.1.** |
| PR4 | Stable run-artifact output dir | Automation cannot depend on "latest trajectory" lookup or stderr scraping and still produce reproducible, comparable, resumable eval artifacts. | ✅ gap confirmed (§6.6) | `pkg/poolcli/main.go:511`, `history_cmd.go` | The trajectory *path* already exists (`main.go:521`), but artifact **production semantics are real design work**: stdout/stderr capture, exit status, ATIF + raw trajectory, run metadata, redaction, partial-failure behavior, cleanup. Required fields in §9.2. |
| PR5 | Eval-grade JSON/event telemetry | Current JSON is too sparse to compute activation, tool-use, repair-loop, timing, model/config, or structured tool-result metrics without brittle parsers. | ✅ gap confirmed (§6.5) | `pkg/poolcli/json_formatter.go`, `pkg/poolcli/formatter.go`, `cliRun.handleEvent` in `main.go` | Add `runMetadata`, `availableSkills`, `skillActivated`, structured `toolResult`, `trajectorySummary` events while keeping current `-o json` back-compat (see *Harness constraints*). Skill activation currently only inferable from `toolCall name=="skill"`. These events are a **Data contract** (§11). |
| PR6 | Model/eval config ergonomics | Laguna evals need reproducible model, tool, sampling, and reasoning bundles; a raw `--model` flag would hide the very config differences the harness must measure. | ✅ lever and field detail verified (§6.7) | `exec_cmd.go`, `pkg/agent/config/config.go`, `defaults.go` | Prefer config-file-driven runs (`--agent-config-file`) over a raw `--model` flag. Canonical XS.2/M.1 config files are structurally feasible, but blocked on **Workstream D: Model access** (model IDs, base URL, credentials, quotas, router-to-worker semantics; §10). |
| PR7 | Native `pool eval` command | Once the external runner proves the stable workflow, avoid maintaining a permanent out-of-tree eval UX and move the durable subset into `pool`. | N/A (deferred) | `exec_cmd.go`, `history_cmd.go`, `pkg/poolcli/main.go` | Plan B says **do last**, after the external runner stabilizes. Needs the `runPoolCLI` refactor or subprocess execution (see *Harness constraints*). Should shell through the same exec path, not a new runtime. |

**Plan B's five investigation briefs** (it labels them A-E) map cleanly onto these PRs and make good sub-agent
briefs: exec runtime map · skill registry/activation · ACP vs exec parity · artifact/ATIF path ·
model-config matrix.

### 9.1 Skill-policy flag semantics the planner must define
- `--disable-skills`: recommended v0 semantics = remove `SkillToolName` from `EnabledTools`; no registry construction.
- `--skip-default-skills`: recommended v0 semantics = skip embedded default install/upgrade only. Do **not** describe this as full isolation unless paired with disabled user-global scanning or isolated HOME.
- `--skills-path <dir>`: recommended eval semantics = **replace** local discovery roots and disable workspace/user-global discovery unless a separate additive flag is intentionally introduced later.
- `--allow-skills <list>`: recommended semantics = filter after source precedence/dedupe, and record resolved source/version/digest in artifacts; define duplicate-name/source behavior explicitly.
- `--force-skill <name>`: recommended semantics = restrict availability to exactly that resolved skill and emit telemetry that the run was forced. Do not silently smuggle hidden prompt instructions under the same flag; if prompt injection is desired, make it a separate explicit harness behavior.

### 9.2 Minimum run-artifact manifest (PR4/PR5)
The manifest's required fields are a data contract. The canonical definition lives at
[`../contracts/run-artifact-manifest.md`](../contracts/run-artifact-manifest.md) (run id, skill names +
versions/digests, resolved model config, pool version, command line, fixture hash, exit code, validator result,
trajectory/ATIF paths, timing). *(Without skill versions/digests + a fixture hash, runs are not reproducibly
comparable.)* Its `validator result` field is the `validator-result.v1` object (§8.1), and its
skill/model/version fields must match the PR5 telemetry events (§6.5).
