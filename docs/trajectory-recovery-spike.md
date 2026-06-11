# Trajectory-recovery spike — run → trajectory mapping (plan item 2)

> Status: Resolved (2026-06-10). Read-only investigation: live `pool history` commands (pool 0.2.172),
> on-disk history/trajectory inspection, and forge source spot-checks. **No live `pool exec` runs were made**;
> everything that needs a live run to confirm is flagged as a first-smoke-run assertion (HD-5).
> Resolves: plan item 2 + Open Question "Trajectory mapping"; critique seam 1 / Q1 / Q2
> (`docs/reviews/laguna-skills-v0-critique-2026-06-10.md`); refines verified-state §6.6 / §6.7.
> `forge` paths relative to `/Users/ben/code/poolside/forge/` @ `d6733f6589` (2026-06-10).

## Verdict in one paragraph

A **deterministic run-id → trajectory mapping exists today** and the critique's worry dissolves: every pool
CLI run writes a session-record file **keyed by run id** (`sessions/session-<run_id>.json`) containing
`{run_id, timestamp, agent_id, session_id}`, and the trajectory filename is exactly
`trajectory-<agent_id>_<session_id>.ndjson`. The runner sets `--run-id`, reads the session record, and
constructs the trajectory path — no `--latest`, no substring search, no `pool history` parsing required.
Combined with per-run state isolation (`XDG_STATE_HOME` is honored even on macOS), recovery is race-free,
so serial execution is a v0 simplicity choice, not a correctness requirement. The named agent's **resolved
`model_id` and sampling params are recoverable** from the raw trajectory NDJSON (not from ATIF, which drops
sampling), so `eval-agents/` config-file arms are **conditionally buildable** — blocked only on endpoint +
credentials (Workstream D), no longer on model-config recoverability.

## What was inspected

- `pool history --help`, `pool history sessions`, `pool history trajectories` (list mode), flag probes
  (`--atif`, `--pretty`) against the installed `pool` 0.2.172.
- On-disk state at `~/Library/Application Support/poolside/{sessions,trajectories,logs}/` (230 trajectories,
  40 session records, real run history from 2026-01 → 2026-06).
- Raw trajectory NDJSON contents (a 2026-05-05 `poolcli` 0.2.172 run and the newest 2026-06-09
  `acp:poolside-studio` run).
- Forge source: `cmd/pool/{history_cmd,exec_cmd}.go`, `pkg/poolcli/{main,history,standalone,atif}.go`,
  `pkg/poolcli/history/sessions.go`, `pkg/product/agentproducts/storage/{disk_store,history}.go`,
  `pkg/common/userconfig/path.go`, vendored `adrg/xdg@v0.5.3`.

## Findings

### F1 — Storage layout and how the state dir resolves

All CLI history lives under one XDG **state** directory (`pkg/common/userconfig/path.go:39-53`):

| Artifact | Path | Key |
| --- | --- | --- |
| Session record | `<state>/poolside/sessions/session-<run_id>.json` | **run id** |
| Trajectory | `<state>/poolside/trajectories/trajectory-<agent_id>_<session_id>.ndjson` | agent id + session id |
| Log | `<state>/poolside/logs/pool-<run_id>.log` | **run id** |

`<state>` = `xdg.StateHome`: macOS `~/Library/Application Support`, Linux `~/.local/state` (the
`path.go:39` docstring says `~/.local/share` — stale; the code uses `xdg.StateHome`, which is
`~/.local/state` on Linux per `adrg/xdg@v0.5.3/paths_unix.go:25`) — and the
**`XDG_STATE_HOME` env var overrides it on every platform including macOS**
(`adrg/xdg@v0.5.3/paths_darwin.go:32`). Verified on this machine: the live data is under
`~/Library/Application Support/poolside/`. This is the isolation lever in the recovery procedure below.
(Note: skills/config live under the separate *config* dir `~/.config/poolside/` — unaffected.)

### F2 — The missing run-id key exists: the session record

`pkg/poolcli/main.go:516` — every pool CLI run calls
`history.SaveSessionEntry(args.RunID, time.Now(), agentID, sessionID)` right after the trajectory store is
created. The writer (`pkg/poolcli/history/sessions.go:20-46`) produces `sessions/session-<run_id>.json`:

```json
{
  "run_id": "019df9a7-db9c-74b0-b390-1225a9323b56",
  "timestamp": "2026-05-05T14:40:22.3104-05:00",
  "agent_id": "019a492b-dc74-73cc-b4ef-0e281f3efc8b",
  "session_id": "019df9a7-e199-787a-b46b-6d564f9e5271"
}
```

(real file from this machine, written by `poolcli` 0.2.172). The filename is keyed by run id, so lookup is
a single `open()` — no listing, no sorting, no races. This is exactly the mechanism `--continue <run-id>`
uses internally (`pkg/poolcli/main.go:810-830`).

Caveat A: the write is **best-effort** — failure only logs a warning and the run proceeds
(`main.go:516-518`). Recovery must tolerate a missing session file (fallback chain below).
Caveat B: only the pool CLI writes session records. The ACP/Studio path does not (observed: June
trajectories on this machine have no session records; sessions dir stops at the last CLI run). Irrelevant
for the runner, which only drives `pool exec`.

### F3 — Trajectory filename embeds agent_id + session_id, **not** run id

`pkg/product/agentproducts/storage/disk_store.go:23-27`:
`FilenameForTrajectory(agentID, sessionID) = "trajectory-" + agentID + "_" + sessionID + ".ndjson"`.

So: **does the trajectory filename embed `--run-id`? No** — except in standalone/file-based-config mode,
where `sessionID == runID` by construction (`StandaloneSessionIdentifiers`, `pkg/poolcli/standalone.go:212-216`).
In named-agent (API) mode — the v0 mode — `session_id` is **server-created**
(`agentUtilClient.CreateAgentSession`, `main.go:502`) and has no derivable relationship to the run id.
The session record (F2) is the only run_id → session_id bridge. Verified 1:1 on disk: all four 2026-05-05
session records map to exactly one matching trajectory file each.

A fresh `pool exec` run produces exactly one trajectory file; `ResumeFrom` chaining
(`storage/history.go:41-87`) only applies to `--continue` runs, which the runner never issues.

### F4 — `pool history sessions` exposes run id ↔ session id ↔ agent id

Verified live on 0.2.172 — columns are `DATE / SESSION ID / AGENT ID / RUN ID`:

```
DATE                 SESSION ID        AGENT ID          RUN ID
2026-05-05 14:40:22  019df9a7-e199-…   019a492b-dc74-…   019df9a7-db9c-…
```

So **yes, the CLI exposes the triple** (the critique's `trajectoryHeaders` observation was about the
*trajectories* listing, which indeed has no run-id column — `history_cmd.go:15`). But the runner should
prefer the session-record *file* over parsing this table: the listing extracts the run id from the filename
as a UUID and **silently skips any filename whose run id is not a timestamp-bearing UUIDv7**
(`pkg/poolcli/history.go:85-100` — `uuid.FromString` + `TimestampFromV7`, `continue` on error). A
non-UUIDv7 `--run-id` override produces a session file that exists on disk but is invisible to
`pool history sessions` and to bare `--continue`.

### F5 — `--run-id` semantics

`cmd/pool/exec_cmd.go:104-105`: `--run-id` is a **hidden** flag, "Override the auto-generated run ID".
Validation (`ValidateRunID`, `pkg/poolcli/standalone.go:218-230`): `^[A-Za-z0-9-]+$`, non-empty. The
override flows into `ConfigureLogging` (log filename) and `args.RunID` (session record), i.e. it keys both
recovery files. Given F4's UUIDv7 skip, the harness should generate **genuine UUIDv7 run ids** (not
human-readable slugs) and carry the human-readable case/arm identity in the manifest instead.

### F6 — `--atif` does not exist in the installed pool 0.2.172

Verified live: `pool history trajectories --atif` → `Error: unknown flag: --atif` (same for `--pretty`).
Forge HEAD *does* have both (`history_cmd.go:97-98`) plus `TrajectoryFileToATIFs` — the installed binary
predates them. Consequence for plan item 10: the canonical v0 artifact is the **raw NDJSON trajectory**
(copy the file; rename the planned `trajectory.atif.json` artifact to `trajectory.ndjson`). When a pool
version with `--atif` is installed, the runner may *additionally* emit
`pool history trajectories <session_id> --atif` output — feature-detect via help text, never assume.

### F7 — Resolved model config IS recoverable from the raw trajectory (not from ATIF)

Every `tool_call.inference.start` event embeds the full `chat_completion_request`, including the
**resolved model id and sampling params**. Verified live on two real trajectories:

- `poolcli` 0.2.172 run (2026-05-05): `model = dimdi-y-agent_1003_cc_v2_rc-fp8-tpr`, `temperature = 0.7`,
  `top_k = 20`, `max_completion_tokens = 8192`, `stop = ["</assistant>"]`, `top_p/min_p/seed = null`.
- `acp:poolside-studio` 1.0.4 run (2026-06-09): `model = laguna-m-e0419-polaris-t3-mh-s700-ctx256k`
  (a live **Laguna M** model id — directly useful to the model-access spike, item 1), sampling all null
  (server defaults).

Also recoverable per request from `tool_call.inference.end`: `input_tokens`, `output_tokens`,
`inference_latency` — feeds item 1's cost reporting without any new flags.

**ATIF is not sufficient**: the ATIF request struct keeps only `messages/model/tools/continued`
(`pkg/poolcli/atif.go:20-24`) — sampling params are dropped. Scrape the NDJSON.

**Not recoverable from the trajectory**: provider base URL, credentials, `max_steps`,
`reasoning_effort`/`enable_thinking` (absent from the request payload or unverified). Take the model
config from the **first non-`continued`** request — continued requests may override `model` mid-chain
(`atif.go:509-510`); a multi-model trajectory should be treated as an anomaly.

### F8 — Secondary signals (do not parse)

In API mode `pool exec` prints `Trajectory URL: …` via `RunStartMessage` (`main.go:520-521`) — a remote
viewer URL, not a local path, and absent in standalone mode. Treat as informational only. The local
trajectory file is written by the **local sink**; default sinks are `[api, local]`
(`pkg/agentutil/userconfig/types.go:39-41`) but user settings can override — the runner asserts file
existence rather than assuming (this machine's `settings.yaml` sets only `api_url`; defaults apply).

## Verdict: are `eval-agents/` config-file arms ever buildable?

**Yes — conditionally buildable; stay deferred past v0, but the path is now concrete.** The critique's Q2
blocker ("model_id may be unrecoverable when `--agent-name` hides it") is resolved: run one named-agent
probe per agent, scrape `chat_completion_request.model` + sampling from the first non-continued
`tool_call.inference.start` event, and place them at `model.provider.openai.model_id` + sampling fields in
an `AgentConfig` (§6.7 field map). What still blocks authoring: the provider **base URL and credentials**
must be supplied inside the config file (since `--agent-config-file` is mutually exclusive with both
`--agent-name` *and* `--api-url`) — that is Workstream D material, not a recoverability gap — and live
acceptance of a scraped model id under a config file is unverified without a live run. Net: the
tool-disabled and pinned-sampling arms remain out of v0 (per the critique's §3 cut), but they are not dead;
record the probe-run recipe as the build path.

## Implications for the plan

- **Item 10 (runner)**: keep serial execution for v0 (simpler debugging, trivially ordered manifests), but
  the rationale changes — `--latest` is no longer the recovery mechanism, and parallel arms become a pure
  throughput decision once each run has a private `XDG_STATE_HOME`. The critique's "`--latest` is unusable
  under a concurrent matrix" stays true and stays irrelevant: the primary path never uses `--latest`.
- **Item 10 artifact naming**: `trajectory.atif.json` → `trajectory.ndjson` (F6).
- **Item 1 (model-access spike)**: the trajectory scrape (F7) supplies resolved model ids and token counts;
  one observed Laguna M id is already in hand.
- **Item 7 (manifest)**: `harness_debt[]` entries below are the canonical ids.

## RECOMMENDED RECOVERY PROCEDURE

The runner implements the deterministic mapping (it exists), with `--latest` demoted to a last-resort
fallback. Steps marked **[debt: HD-n]** are fragile dependencies; every triggered one is appended to the
run manifest's `harness_debt[]` as its `HD-n` id plus a one-line detail.

### Primary path (deterministic, per arm-run)

1. **Generate a genuine UUIDv7 `run_id`** in the harness (Python `uuid6`/equivalent). Do not use
   human-readable slugs — non-UUIDv7 run ids vanish from `pool history sessions` and bare `--continue`
   (F4/F5). Case/arm identity lives in the manifest, not the run id.
2. **Create a private state dir** for the run and invoke `pool exec` with:
   `HOME=<isolated_home>` (the plan's skill-isolation recipe) **and** `XDG_STATE_HOME=<run_dir>/state`
   (explicit, platform-independent — verified honored on macOS, F1). Pass `--run-id <run_id>`.
   **[debt: HD-1 — hidden flag]**
3. **After process exit**, read `<run_dir>/state/poolside/sessions/session-<run_id>.json` →
   `{agent_id, session_id}`. **[debt: HD-2 — best-effort write; HD-3 — undocumented layout]**
4. **Construct the trajectory path**:
   `<run_dir>/state/poolside/trajectories/trajectory-<agent_id>_<session_id>.ndjson`. Assert it exists and
   is non-empty NDJSON; copy verbatim into the run's artifact dir as `trajectory.ndjson`.
   **[debt: HD-3; HD-7 — local sink assumed enabled]**
5. **Scrape run facts from the NDJSON** for the manifest: resolved `model` + sampling from the first
   non-`continued` `tool_call.inference.start`; token counts + latency from `tool_call.inference.end`
   events. **[debt: HD-6 — per-request scrape]**
6. **Optional ATIF**: if the installed pool's `history trajectories --help` advertises `--atif`
   (0.2.172 does **not**), additionally run
   `XDG_STATE_HOME=<run_dir>/state pool history trajectories <session_id> --atif > trajectory.atif.json`.
   Never required for grading. **[debt: HD-4 — no ATIF in 0.2.172]**
7. Also collect `<run_dir>/state/poolside/logs/pool-<run_id>.log` (run-id-keyed, F1) as `pool.log`.

### Fallback chain (only when step 3 or 4 fails)

- **F-a.** List `<run_dir>/state/poolside/trajectories/`: if exactly **one** trajectory file exists, take it
  (with per-run state isolation this is `--latest` made race-free). Record `HD-2` in `harness_debt[]`.
- **F-b.** Otherwise (isolation broken or >1 file): run arms **strictly serially** and recover with
  `XDG_STATE_HOME=<run_dir>/state pool history trajectories --latest` immediately after each run. Record
  `HD-2` and `HD-5`. This is the only mode where serial execution is a *correctness* requirement.
- **F-c.** If still nothing: mark the run `error` in the manifest with the stderr tail; never grade a run
  without its trajectory unless the validator only needs workspace state (then record the missing
  trajectory in `harness_debt[]` and proceed).

### Execution-order stance

v0 runs arms **serially** anyway (simplicity, ordered readouts) — but per-run `XDG_STATE_HOME` isolation
means parallelism is unblocked whenever throughput demands it. Do not rebuild the runner around `--latest`.

### Harness-debt register (feeds manifest `harness_debt[]`)

| id | fragile step | why it can break | exit ramp |
| --- | --- | --- | --- |
| HD-1 | `--run-id` is a hidden flag (`exec_cmd.go:104-105`) | hidden flags carry no compat promise; could be renamed/removed | PR4 (`--run-artifacts-dir`/`--trajectory-out`); fallback F-a/F-b meanwhile |
| HD-2 | session-record write is best-effort (`main.go:516-518` warns and continues) | disk/permission issues silently drop the run_id key | fallback F-a/F-b; assert + alert on first occurrence |
| HD-3 | reliance on undocumented on-disk layout (`session-<run_id>.json`, `trajectory-<aid>_<sid>.ndjson`, XDG state dir) | private internals; any release may move/rename | pin + record pool version in manifest; re-verify on every pool upgrade; PR4 is the real fix |
| HD-4 | no `--atif` in installed pool 0.2.172 (verified live) | raw NDJSON schema is itself internal; ATIF was the stable export story | store raw NDJSON now; feature-detect `--atif` after upgrades; PR4/PR5 |
| HD-5 | spike was read-only — no live `pool exec` performed | unverified live: exec writes the session record; installed binary honors `XDG_STATE_HOME`; trajectory fully flushed at process exit (`store.Close` deferred) | first smoke run (item 10 / pathfinder) asserts all three before any matrix run |
| HD-6 | model/sampling scraped from first non-`continued` inference request | continued requests can override `model` (`atif.go:509-510`); payload shape is internal | treat multi-model trajectories as anomalies; PR6 (model-config ergonomics) |
| HD-7 | local trajectory sink assumed enabled (defaults `[api, local]`, user-overridable) | a settings override would silently drop the local file | runner asserts file existence (step 4); isolated HOME also isolates settings |

## Addendum — re-probe after upgrade to pool 1.0.5 (2026-06-10)

The installed CLI moved 0.2.172 → **1.0.5** (`pool update` via brew). Re-probed surface
(`probe_surface()` + manual; this is the HD-3 "re-verify on every pool upgrade" pass for the CLI
surface — the on-disk layout itself still awaits live verification, see HD-5 below):

- **`pool history sessions` now prints a RUN ID column** (`DATE / SESSION ID / AGENT ID / RUN ID`) —
  the F4 mapping is now exposed directly by the CLI, not only via the session-record JSON. Notably,
  the two 0.2.172-era smoke runs from the model-access spike appear with populated run ids, i.e.
  pool assigns and records a run id even when `--run-id` was not (could not be) passed: the run →
  session mapping is recoverable post-hoc as well.
- **`pool exec --run-id` is accepted** (hidden flag, forge-HEAD parity): the primary recovery path
  (run-id-keyed `session-<run_id>.json`) is fully available. HD-1 reduces to its no-compat-promise
  caveat.
- **`pool history trajectories --atif` exists** (with `--pretty`): F6 is obsolete on 1.0.5 and HD-4
  no longer applies; the runner already feature-detects this and will write `trajectory.atif.json`
  alongside the canonical raw NDJSON.
- **Unknown flags now exit 1** with a proper error (0.2.172 exited 0); the runner's `cli_rejection`
  stderr scan remains as defense-in-depth.
- **Execution-order stance unchanged**: with `--run-id` live, parallel arms are unblocked in
  principle, but v0 keeps strictly serial execution by choice (ordered readouts, simpler debugging) —
  per the stance above, not as a correctness requirement.
- **HD-5 stands and now targets 1.0.5**: the first live smoke run must assert (a) `pool exec` writes
  `session-<run_id>.json` under the run's `XDG_STATE_HOME`, (b) the binary honors `XDG_STATE_HOME`,
  (c) the trajectory file is fully flushed at process exit — none of these have been verified live
  against 1.0.5 (the on-disk filenames in F1–F3 were verified against 0.2.172 state dirs and forge
  source; any 1.0.5 layout drift will surface in these assertions).
