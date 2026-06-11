# Model-access spike: named agents → Laguna models

> Work item 1 (Track 1) of `docs/plans/laguna-skills-v0-2026-06-10.md`.
> Date: 2026-06-10. Method: read-only inspection of the installed `pool` CLI (0.2.172), the local
> forge checkout (`/Users/ben/code/poolside/forge`), `~/.config/poolside/`, read-only GETs against
> the tenant backend API (`https://api.poolsi.de`, same call class as `pool agents list`), local
> trajectory files, plus the two budgeted live smoke runs (one per candidate model).
> Sources: plan item 1; verified-state §6.4 (`.resources/investigations/laguna-substrate/verified-state/6.4-exec-cli-surface.md`)
> and §6.7 (`.../6.7-model-config.md`).

## TL;DR

| Question | Answer |
|---|---|
| Which `--agent-name` reaches M.1? | **`laguna-m.1`** (the tenant **default** agent) → model `laguna-m-e0419-polaris-t3-mh-s700-ctx256k`. Verified end-to-end (API + live trajectory). |
| Which `--agent-name` reaches XS.2? | **`laguna-xs-polaris-base-bs256-s600-ctx256k`** → model of the same name. It is the **only XS-class Laguna agent** in the tenant, but **nothing labels it "XS.2"** — confirm the checkpoint identity with the model team (open item). |
| Quotas / rate limits | **No queryable surface.** Zero quota/rate-limit endpoints or fields in the v0 backend API. Limits, if any, surface only as runtime HTTP errors. Per-run guardrails exist instead (`max_steps`, `http_timeout`). |
| Token reporting | **Not in `-o json` NLJSON.** Per-step tokens are in the local trajectory NDJSON (`tool_call.inference.end`); session totals exist server-side only behind an **admin** endpoint. |
| Cost reporting | **None anywhere.** The string "cost" does not appear in the backend client API; models carry no pricing metadata. |
| Smoke tests | **Both passed** (exit 0; M.1 ≈ 5 s, XS ≈ 2 s). Details below. |
| M.1-router → XS.2-worker in today's `pool exec`? | **Not representable.** One agent = one model per run; no delegation tool. The only two-model mechanism (`advisor` tool) is a one-shot, no-tools consultation — the wrong shape and the wrong direction. **Router arm stays out of the v0 matrix** (register #2 confirmed). |
| Hidden-flag caveat (new finding) | The installed `pool` 0.2.172 **does not have** `--agent-config-file`, `--run-id`, `--sandbox`, or `--ignore-context` (unknown-flag errors). §6.4's "hidden but present" was verified against forge HEAD, not the installed binary. On 0.2.172 **named agent is the only model lever** and `--run-id` cannot exist as a bridge. |

## 1. Agent-name → model mapping

`pool agents list` (works, hits `GET /v0/agents`) prints names only; the CLI deliberately drops
model info (`forge pkg/poolcli/agents.go:15-21`, TODO comment). The mapping below was recovered via
the same API the CLI uses, with full fields:

- `GET /v0/agents?name=<name>` → agent summary incl. `id`, `model_id` (UUID), `is_default`, full stored `config`
- `GET /v0/agents/{agent_id}` → full agent record (config, MCP servers, repo definitions)
- `GET /v0/model/{model_uuid}` → model record (`name`, `type`, `engine`, `mode`, `status`, `context_length`)

(Endpoint paths: `forge pkg/backend/client/client.go:63707` (`/v0/agents`), `:64138`
(`/v0/agents/{id}`), `:69910` (`/v0/model/{id}`).)

### The two eval agents

| | `laguna-m.1` (M.1) | `laguna-xs-polaris-base-bs256-s600-ctx256k` (XS candidate) |
|---|---|---|
| Agent UUID | `019dbc34-2f3c-7c81-8acb-b8c2ccfdd4bd` | `019e20e9-03f5-7b55-89d6-98e9e95e7f0e` |
| Tenant default | **yes** (CLI shows `laguna-m.1 (default)`) | no |
| Model UUID | `019e20e7-4bab-7b53-b350-d69aa89dbe04` | `019e20e9-03e8-7b31-9618-17a5f88a54a7` |
| Resolved model name | `laguna-m-e0419-polaris-t3-mh-s700-ctx256k` | `laguna-xs-polaris-base-bs256-s600-ctx256k` |
| Model type / engine / mode / status | chat / vllm-open / static / ready | chat / vllm-open / static / ready |
| `context_length` | 262144 | 262144 |
| `max_steps` | 1000 | 200 |
| Enabled tools | 25 — incl. **`skill`**, plus `web_fetch`, `web_search`, `sandbox_fs_checkpoint/restore` | 21 — incl. **`skill`**; no web or sandbox-fs tools |
| `enable_thinking` | true | true |
| Sampling params | none pinned (`temperature` etc. unset → server defaults) | none pinned |
| `http_timeout` | 5m0s | 5m0s |

Both agents have the `skill` tool enabled — the eval loop's hard requirement holds for both arms.
The differing `max_steps` (1000 vs 200) and tool sets (no web tools on XS) are arm-level
confounders the runner manifest should record per run.

### Full Laguna family in the tenant (for the record)

| Agent name | Model UUID | Notes |
|---|---|---|
| `laguna-m.1` | `019e20e7-…be04` | tenant default; **the M.1 arm** |
| `laguna-m.1-40k` | `019e20e7-…be04` | same model; presumably context-capped variant |
| `laguna-m.1-opus-advisor` | `019e20e7-…be04` | same model + `advisor` tool enabled (see §5) |
| `laguna-m-e0419-polaris-t3-mh-s700-ctx256k` | `019e20e7-…be04` | raw checkpoint-named alias of the same model |
| `laguna-xs-polaris-base-bs256-s600-ctx256k` | `019e20e9-…54a7` | **the only XS-class agent; the XS arm candidate** |
| `laguna-m-nvfp4-mlp-fp8kv` | `019e5e50-…72f4` | distinct quantized M model (ctx 262144, ready) |
| `laguna-m-e0415-polaris-base-s1100` | `019dbc34-…0e82` | model UUID **404s** on `/v0/model/{id}` (deleted/scoped) |
| `laguna_m_think_tool`, `laguna-spark-agent`, `laguna-web-spark-agent`, `linear-pipeline-laguna-coder`, `tom-agent-laguna` | `019ca0d6-…44be` | all share one model UUID that **404s** (deleted/scoped) |
| `baseten/laguna_m_preview` | `019d8af7-…5f61` | model UUID **404s**; external Baseten-hosted preview |

### XS.2 identity caveat

No agent or model in the tenant carries the literal label "XS.2". The XS candidate's name decodes
as *XS-class, polaris **base** checkpoint, batch-size 256, step 600, 256K context* — i.e. a base
(non-multi-headed) checkpoint, while the M.1 model is an *e0419 polaris **t3-mh** s700* checkpoint.
**Open item:** confirm with the model team that `laguna-xs-polaris-base-bs256-s600-ctx256k` is the
intended XS.2 eval target (or whether a newer XS checkpoint should be promoted as an agent first).
The M.1 side is unambiguous: the product-named `laguna-m.1` default agent.

### How model resolution actually works (matters for future config-file arms)

The stored agent config has `model.provider.openai.model_id = ""`. The model is attached by UUID at
the agent level and injected client-side at load time: `forge
pkg/agent/configbuilder/api/api.go:47-50` sets `provider.BaseURL = {apiURL}/openai`,
`provider.APIKey = {token}`, `provider.ModelID = model.Name`. So a future `--agent-config-file` arm
must replicate exactly that: fetch the agent's config, then set `model_id` to the **model name**
(e.g. `laguna-m-e0419-polaris-t3-mh-s700-ctx256k`), `base_url` to `https://api.poolsi.de/openai`,
and the API key from credentials. The model record also exposes a direct inference URL
(`https://inference-models.ue2.a.poolsi.de/v0/models/{id}/v1`), but named-agent runs go through the
`{apiURL}/openai` proxy. This recovery path is now proven; the config-file arm stays deferred past
v0 per the plan (and is impossible on the installed CLI anyway — see §2).

## 2. Installed-CLI surface check (new finding vs §6.4)

§6.4 verified the exec surface against the forge **source** checkout. The installed binary differs:

- `pool` 0.2.172 has **no `exec` subcommand** — the root command *is* exec ("When run without a
  sub-command the prompt command is run"). Forge HEAD has a named `pool exec` subcommand. Runner
  should invoke plain `pool -p … -a … -d … -o json`.
- Empirically probed on 0.2.172 (all rejected with "unknown flag"): `--agent-config-file`,
  `--run-id`, `--sandbox`, `--ignore-context`. Present: `--agent-name`, `--api-url`, `-o json`,
  `--unsafe-auto-allow`, `--continue`, `--ping-me`, `--placeholder`, and hidden `--image-url`.
- **Exit codes are unreliable for rejection detection** (verified live 2026-06-10): on an unknown
  flag or command, 0.2.172 prints `Error: unknown flag: --sandbox` (plus usage) to stderr,
  executes **nothing**, and still **exits 0** — with or without `--help` (e.g.
  `pool --sandbox required --version` exits 0 and never prints the version). Anything deciding
  "did pool accept this argv" must scan stderr for the unknown-flag/command error, never trust
  the exit code (`harness/runner/pool_exec.py` does both at probe time and after every live run).
- Consequences for v0: **named agent is the only model lever** on the installed CLI (reinforces
  decision #1); the `--run-id` bridge **cannot** be used until the CLI updates, so the runner's
  serial-execution + `--latest`-recovery design is mandatory, not just prudent. Any future
  `pool update` changes this surface — the runner manifest should record the `pool` version per run.

## 3. Quotas and rate limits

- **No quota or rate-limit reporting surface exists.** `grep -i "ratelimit\|quota"` over the
  generated backend client (`pkg/backend/client/client.go`, ~89.6k lines, mirrors the OpenAPI spec)
  returns zero matches; Agent and Model records carry no quota fields.
- What exists instead are **per-run guardrails** in the agent config: `max_steps` (1000 for
  `laguna-m.1`, 200 for the XS agent; platform cap 1000), `http_timeout` (5m0s), and client-side
  completion-retry knobs (`max_completion_retries`, `max_completion_retries_transient`).
- Practical posture for the eval runner: assume server-side limits are opaque and will only
  manifest as HTTP 429/5xx mid-run; the runner already executes arms strictly serially (trajectory
  recovery constraint), which bounds concurrency to 1 and makes throttling unlikely at v0 scale.
  Record any observed throttling in the manifest as harness debt.

## 4. Token and cost reporting surfaces

Three tiers, best to worst:

1. **Local trajectory NDJSON** (the practical surface). Each `tool_call.inference.end` event
   carries `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_write_input_tokens`,
   and `inference_latency` (ns). The runner can sum per-step counts for per-run totals. The
   trajectory also embeds the **resolved model name** in every `chat_completion_request`
   (`"model":"laguna-m-e0419-polaris-t3-mh-s700-ctx256k"`) — so the model identity of any run is
   recoverable after the fact.
2. **Server-side session telemetry** — `AgentTelemetrySessionSummary`
   (`client.go:1442-1473`: `total_input_tokens`, `total_output_tokens`, cache totals,
   `total_duration_ms`, `total_steps`, `turn_count`) — but it is served by
   `GET /v0/admin/agents/metrics/sessions` (`client.go:61456`), an **admin-scoped** endpoint not
   verified accessible with the current api-key token. The non-admin
   `GET /v0/agents/{id}/sessions[/{sid}]` returns raw session records (state, stored config,
   `model_id` UUID) with **no token totals**.
3. **`-o json` NLJSON: nothing.** Confirms §6.5 — no usage events; the smoke runs emitted only
   `thought` / `toolCall` / `toolCallResult` lines.

**Cost:** no cost fields, pricing metadata, or billing endpoints anywhere in the v0 client API.
Internal-only token accounting from tier 1 is the v0 measure; dollar-cost reporting is out of reach
until the platform exposes pricing.

**Run → trajectory mapping bonus** (cross-ref for the trajectory-recovery spike, work item 2): each
run prints `Trajectory URL: …?agent_id={aid}&agent_session_id={sid}` to **stderr**, and the local
trajectory filename is `trajectory-{agent_id}_{agent_session_id}.ndjson`. Parsing stderr therefore
yields a deterministic run→trajectory key even without `--run-id`.

## 5. Smoke tests (2/2 budget used; both passed)

Shape (per arm): fresh temp dir, stdin `</dev/null`, 180 s wall cap, prompt `Reply with exactly: OK`:

```
pool -d "$TMP" -a "<agent-name>" -p "Reply with exactly: OK" -o json --unsafe-auto-allow
```

| | M.1 run | XS run |
|---|---|---|
| Agent | `laguna-m.1` | `laguna-xs-polaris-base-bs256-s600-ctx256k` |
| Exit code | 0 | 0 |
| Wall time | ~5 s | ~2 s |
| NLJSON events | `thought` (`"\nOK\n"`), `toolCall` `exit {success:true}`, `toolCallResult` | identical shape |
| stderr | Trajectory URL with `agent_id` + `agent_session_id` | same |
| Trajectory model | `laguna-m-e0419-polaris-t3-mh-s700-ctx256k` | `laguna-xs-polaris-base-bs256-s600-ctx256k` |
| Tokens (1 inference step) | 6797 in / 35 out | 5183 in / 33 out |

Nuance for Workstream B: the model's final answer surfaced as a **`thought`** event — there is no
distinct final-assistant-message event type in `-o json` from these agents. This reinforces the
plan's rule that validators grade **workspace artifacts** (plus, cautiously, concatenated
thought/message text), never a parsed "final message" event.

Auth note for the runner's isolated-HOME arms: the token resolves from `$POOLSIDE_TOKEN` before
`~/.config/poolside/credentials.json`, but the API URL default comes from
`~/.config/poolside/settings.yaml`. An isolated-HOME run must therefore set `POOLSIDE_TOKEN` *and*
pass `--api-url https://api.poolsi.de` explicitly.

## 6. Router→worker representability (register #2): **not representable — confirmed**

An M.1-router→XS.2-worker run cannot be expressed in today's `pool exec`:

1. **One agent, one model per run.** `-a/--agent-name` takes a single name; the resolved config
   carries a single `model.provider.openai` (§6.7). No multi-agent or delegation flag exists on the
   installed CLI or forge HEAD.
2. **No delegation tool.** Neither Laguna agent's tool set contains a sub-agent/spawn/route tool.
   The only second-model mechanism in the platform is the **`advisor` tool**
   (`tools.advisor.model_id`, `forge pkg/agent/config/config.go:662-679`; enabled on
   `laguna-m.1-opus-advisor`), and it is explicitly a "one-shot, no-tools chat-completion call"
   (`pkg/agent/llmtools/advisor_tool.go:31-35`) — an *executor consults a stronger reviewer*
   pattern. That is the wrong shape (no worker tool loop, no task handoff) and the wrong direction
   (weaker executor → stronger advisor) for M.1-as-router → XS.2-as-worker.
3. Router semantics would require an **outer orchestrator** issuing separate `pool exec` runs per
   leg — that is an eval-runner composition, not a representable single run, and it changes what is
   being measured.

**Verdict:** the router arm stays out of the v0 matrix, exactly as the plan assumes. The
closest near-term proxies — an advisor-tool arm (`tools.advisor.model_id` pointed at a second
Laguna model) or runner-composed two-leg runs — are different experiments and should be proposed
separately if wanted.

## 7. Open items

1. **XS.2 identity**: confirm `laguna-xs-polaris-base-bs256-s600-ctx256k` is the intended XS.2
   eval checkpoint (model team). Until then, eval results should name the checkpoint, not "XS.2".
2. **Admin telemetry access**: check whether the eval identity can read
   `/v0/admin/agents/metrics/sessions` for server-side token totals; otherwise trajectory summing
   stands (it is sufficient for v0).
3. **CLI drift**: 0.2.172 lacks the hidden flags forge HEAD has; pin and record the `pool` version
   per run in `run-manifest.v0`, and re-probe the flag surface after any `pool update`.
4. **Arm confounders**: `max_steps` (1000 vs 200) and tool-set differences (no web tools on XS)
   between the two named agents are not equalizable without `--agent-config-file`; record them in
   the manifest and keep them out of cross-model comparisons until config-file arms exist.

## 8. Addendum — re-probe after upgrade to pool 1.0.5 (2026-06-10)

Open item 3 executed: `pool update` (brew, `poolsideai/poolsi-de/pool`) moved the installed CLI
0.2.172 → **1.0.5**. Re-probed via `harness.runner.pool_exec.probe_surface()` plus manual checks:

- **`pool exec` is now a named subcommand** (the §2 root-command finding is obsolete on 1.0.5).
  Help documents `--sandbox`; the hidden flags `--run-id`, `--agent-config-file`, and
  `--ignore-context` are all **accepted** — the installed CLI now matches the forge-HEAD surface §6.4
  described.
- **The exit-0-on-unknown-flag hazard is fixed**: 1.0.5 prints `Error: unknown flag: …` and exits
  **1**. The harness's stderr scan (`cli_rejection`) stays as defense-in-depth and costs nothing.
- `probe_surface()` against 1.0.5 reports the full canonical surface (exec subcommand, all eight
  probed flags, `history trajectories --atif`), so `build_pool_command` emits the plan-canonical
  argv with **zero CLI-adaptation debt entries**.
- **Named agent is no longer the only model lever in principle**: `--agent-config-file` is accepted,
  so the config-file arm path (using the §1-recovered model settings) is now mechanically possible.
  It stays deferred past v0 per the plan; this only removes the "impossible on the installed CLI"
  blocker recorded in §2.
- §1's agent/model mapping comes from the API and is unaffected by the CLI upgrade. §5's smoke runs
  were performed on 0.2.172; the first 1.0.5 runs should confirm nothing regressed (folds into the
  trajectory spike's HD-5 live assertions).
