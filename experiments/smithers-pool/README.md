# Spike: pool as a Smithers workflow executor (`PoolAgent`)

Throwaway experiment proving Poolside's `pool` CLI can be the **executor agent
of a Smithers Task**: a workflow node runs `pool exec`, pool does the work in a
real working directory (writing file artifacts, optionally activating a
Poolside skill), and the node's structured output validates against the Task's
Zod schema and persists into Smithers' SQLite run state.

Everything lives in this directory. Nothing under `skills/`, `harness/`,
`scripts/`, or `schemas/` was modified.

## TL;DR

- **Recorded run succeeded.** See [Results](#results). A 4-node workflow (1 intro node,
  then a 2→1 fan-out/fan-in) ran end-to-end with every node executed by
  `pool exec` against the real tenant (`laguna-m.1`), all outputs
  Zod-validated and persisted to `.smithers/smithers.db`. One fan-out node had
  the repo's `repo-map` skill installed in its workspace and activated it; the
  sibling node ran skill-less.
- **The agent contract is small and pool fits it well.** A Smithers agent is
  any object with `generate(args) => Promise<result>` where `result.text` is a
  string. The engine owns prompt schema instructions, JSON extraction, Zod
  validation, and schema-retry loops; the agent only needs to return text.
- **Main blockers are operational polish**: no token usage in pool's `-o json`
  stream, no per-run conversation resume wired up (schema retries re-send a
  flattened transcript), and pool's sandbox can't be enabled without
  container-runtime + workspace config (this spike runs
  `--sandbox disabled` + `--unsafe-auto-allow`, same debt the eval harness
  records).

## 1. The Smithers agent contract (verified from source)

Read from `smithers-orchestrator@0.18.0` (installed here from npm; same
version as the copy in `/Users/ben/code/agents/smithers/code-review/node_modules/`).
The README does not document this; the source does.

### 1.1 The interface

`@smithers-orchestrator/agents/src/AgentLike.ts`:

```ts
export type AgentLike = {
  id?: string;
  tools?: Record<string, unknown>;
  capabilities?: AgentCapabilityRegistry;
  /** True when the agent consumes outputSchema through a native structured-output API. */
  supportsNativeStructuredOutput?: boolean;
  generate: (args?: AgentGenerateOptions) => Promise<unknown>;
};
```

`AgentGenerateOptions` (`BaseCliAgent/AgentGenerateOptions.ts`) — loosely
typed on purpose; the fields the engine actually passes:

```ts
{
  prompt?: unknown;            // string on the first call
  messages?: unknown;          // conversation array on schema-retry calls
  abortSignal?: AbortSignal;
  rootDir?: string;            // task working root (worktree path when used)
  timeout?: { totalMs: number };  // from the Task's timeoutMs prop
  maxOutputBytes?: number;
  onStdout?: (text: string) => void;   // streaming log capture (optional)
  onStderr?: (text: string) => void;
  onEvent?: (event: AgentCliEvent) => unknown;  // progress events (optional)
  onStepFinish?: (step: unknown) => void;       // AI-SDK agents only
  resumeSession?: string;
  outputSchema?: z.ZodObject;  // the Task's Zod schema
}
```

### 1.2 What a Task actually calls

The engine (`@smithers-orchestrator/engine/src/engine.js`) drives the whole
loop; line references are to the installed 0.18.0 build:

1. **Prompt augmentation is the engine's job** (`engine.js:2904-2923`). If the
   Task has an output table and the agent does **not** declare
   `supportsNativeStructuredOutput`, the engine wraps the prompt with
   *"you MUST end your response with a JSON object in a ```json fence matching
   this schema: …"* — including a JSON example derived from the Zod schema. A
   custom CLI agent should NOT duplicate this.
2. **The call** (`engine.js:3067-3089`):
   `agent.generate({ prompt | messages, abortSignal, resumeSession, rootDir,
   maxOutputBytes, timeout, onStdout, onStderr, onEvent, onStepFinish,
   outputSchema })`.
3. **Result shape**: the engine reads `result.text` (string) as the response;
   optionally `result._output` / `result.output` (pre-parsed structured
   output, takes precedence over text parsing), `result.usage`
   (`inputTokens`/`outputTokens`, emitted as `TokenUsageReported` events),
   `result.steps`, `result.finishReason`, `result.response.messages`
   (seeds the schema-retry conversation).
4. **JSON extraction is the engine's job** (`engine.js:3154-3410`): whole-text
   parse → last ```json fence → balanced-brace extraction scanning from the
   END of the text → a follow-up "output ONLY the JSON" generate() call. If
   all fail: `SmithersError("INVALID_OUTPUT")`.
5. **Validation is the engine's job** (`engine.js:3455-3467`): Drizzle insert
   schema, then the Task's Zod schema (`outputSchema.safeParse(payload)`).
6. **Schema retries** (`engine.js:3487-3569`): on validation failure, up to 3
   extra `generate({ messages })` calls where `messages` is the flattened
   conversation plus a correction prompt listing the Zod issues. The source
   comments explicitly say CLI agents are expected to flatten `messages` to
   text. These do NOT count against the Task's `retries`.
7. **Events are optional.** `onStdout`/`onStderr` feed log capture and the
   internal heartbeat (long-silent tasks can be flagged); `onEvent` feeds the
   UI/event log (`AgentCliEvent`: `started` / `action` / `completed`). An
   agent that never calls them still works.
8. **Validated output is persisted** by the engine into the per-schema SQLite
   table (`zodToTable`) keyed by `(run_id, node_id, iteration)` in the
   workflow's `.smithers/smithers.db`.

Note: `@smithers-orchestrator/driver/src/defaultTaskExecutor.js` contains a
different-looking `execute/run/call` duck-typing path — that's the lightweight
driver used for graph projection/tests, **not** the engine path that runs real
workflows. The engine path above is the contract that matters.

### 1.3 How the built-in CLI agents do it

`PiAgent`/`CodexAgent`/`ClaudeCodeAgent` extend `BaseCliAgent`, which is a
generic "spawn a CLI, interpret its output stream" loop: subclasses implement
`buildCommand({prompt, cwd, options}) => { command, args, stdin?, outputFile?,
outputFormat?, cleanup? }` plus a `CliOutputInterpreter` that turns the CLI's
stream into `AgentCliEvent`s and a final answer. `BaseCliAgent` is **not
exported** from the public package (`smithers-orchestrator` exports only the
concrete agents), so a third-party agent implements `AgentLike` directly —
which is what `PoolAgent` does.

## 2. pool's local surface (verified live)

- `pool --version` → **1.0.5**. `pool exec` is a named subcommand and accepts
  the full canonical flag set (`--prompt-file`, `--directory`, `-o json`,
  `--unsafe-auto-allow`, `--sandbox`, `--agent-name`, `--api-url`); this
  matches `docs/model-access-spike.md` §8 (the 0.2.172 drift documented there
  is gone, and `harness/runner/pool_exec.py`'s probing exists for exactly that
  reason).
- `-o json` emits NLJSON events on stdout. Observed live on 1.0.5 with
  `laguna-m.1`: `{"type":"reasoning","reasoning":…}`,
  `{"type":"thought","thought":…}`, `{"type":"toolCall","name":…,"args":…}`,
  `{"type":"toolCallResult","result":…}`. **There is no dedicated
  final-assistant-message event**: the answer surfaces as a `thought` event,
  and a duplicate of the reasoning text can arrive as a *later* thought event,
  so "take the last thought" is not a safe extraction rule.
- The trajectory URL (with `agent_id` + `agent_session_id`) is printed to
  **stderr**; `PoolAgent` parses and records it per call.
- No token/usage data in the NLJSON stream (per-step tokens live only in the
  local trajectory NDJSON; see `docs/model-access-spike.md` §4).
- Auth: token resolves from `$POOLSIDE_TOKEN`, else
  `~/.config/poolside/credentials.json`; default API URL from
  `~/.config/poolside/settings.yaml`. This spike inherits the user
  environment and passes `--api-url https://api.poolsi.de` explicitly, so it
  works in either mode. **Requirement to run this spike: a logged-in pool
  (`~/.config/poolside/credentials.json` present) or `POOLSIDE_TOKEN` set.**
- Skills are discovered at `<dir>/.poolside/skills/<name>/` (project-local) or
  `~/.config/poolside/skills/<name>/` (global).

## 3. What `PoolAgent` does

`src/PoolAgent.ts` implements `AgentLike` directly:

- `generate()` resolves the prompt (`prompt` string, or flattens the
  schema-retry `messages` conversation to a `### role` transcript), writes it
  to a temp file, and spawns:

  ```
  pool exec --prompt-file <tmp> --directory <cwd> -o json \
      --unsafe-auto-allow --sandbox disabled \
      --agent-name laguna-m.1 --api-url https://api.poolsi.de
  ```

  `cwd` is the per-node working directory (constructor option, falling back
  to the engine's `rootDir`). The engine has already embedded the JSON-fence
  output instructions in the prompt, so the temp file contains them verbatim.
- Parses the NLJSON stream incrementally; `thought` texts become the result
  `text` (joined). Tool calls are surfaced as `AgentCliEvent` `action` events
  via `onEvent`; raw chunks go to `onStdout`/`onStderr` (which also feeds
  Smithers' heartbeat, keeping long pool runs alive).
- **Schema-guided extraction**: because the final answer is a `thought` among
  other thoughts, PoolAgent scans balanced JSON candidates from the END of the
  thought stream (the same algorithm as the engine's
  `extractLastBalancedJson`) and returns the first candidate that
  `safeParse`s against the Task's `outputSchema` as `result.output` — which
  short-circuits the engine's text heuristics. With no schema it returns text
  only and lets the engine extract.
- `supportsNativeStructuredOutput` is deliberately `false` so the engine keeps
  owning prompt instructions + validation + retries.
- Honors `abortSignal` and `timeout.totalMs` (SIGTERM, then SIGKILL after 5s).
  Exit code 0 = success; **exit 4** (pool ran but declared the task failed) and
  anything else throw, which the engine converts into a task failure/retry.
- `skill` option: copies a skill directory (excluding `evals/`, matching
  `scripts/install_skill.py --copy` semantics) into
  `<cwd>/.poolside/skills/<name>` before the run.
- Observability: per call, captures `prompt.md`, raw `stdout.ndjson`,
  `stderr.txt`, and `meta.json` (argv, exit code, duration, trajectory URL,
  tool-call list, whether the `skill` tool was called) under `runs/<nn>-<dir>/`,
  and keeps an in-memory `calls` record.

## 4. The example workflow

`example.workflow.tsx` — four Tasks, all executed by pool, mirroring
`createSmithers()` usage from the smithers-canvas reference:

```
Sequence
├─ greet                    pool writes hello.txt in work/greet/        (no skill)
├─ Parallel
│  ├─ repo_map              pool + repo-map skill maps work/repo-fixture/
│  │                        (a seeded git repo) → .laguna/repo-map.json
│  └─ dep_scan              pool reads work/dep-scan/package.json       (no skill)
└─ combine                  deps={repo_map, dep_scan} → prompt is built from
                            both upstream rows; pool writes report.md
```

The fan-in uses the `deps` Task prop with a function child — Smithers
re-renders the tree from SQLite each loop, so by the time `combine` renders
runnable, both upstream rows exist and are interpolated into its prompt.

## 5. How to run

```bash
cd experiments/smithers-pool
bun install
bun run setup              # seeds work/ fixtures (idempotent, wipes work/)
mkdir -p .smithers          # sqlite needs the dir to exist
bun run workflow
```

Inspect afterwards:

```bash
./node_modules/.bin/smithers inspect <runId> --format json
bun -e 'import {Database} from "bun:sqlite"; const db=new Database(".smithers/smithers.db");
  for (const t of ["greet","repo_map","dep_scan","combine"])
    console.log(t, JSON.stringify(db.query(`select * from ${t}`).all()));'
bun run typecheck
ls runs/                    # per-pool-call prompt/stdout/stderr/meta captures
```

## 6. Results

Live run on 2026-06-11 (pool 1.0.5, `laguna-m.1`, smithers-orchestrator
0.18.0): run `c3b7b89d-cbf6-494d-86ec-dd504d776fe5`, status **finished**,
~70 s wall clock, **6 live `pool exec` calls** for the 4 nodes. All four
output rows persisted to `.smithers/smithers.db` and pass their Zod schemas:

| node | pool calls | duration | skill installed | `skill` tool called | output row (abridged) |
|---|---|---|---|---|---|
| `greet` | 2 (schema retry) | 10.3 s + 8.9 s | – | no | `message: "Hello! This is a Smithers x pool spike…", file: "hello.txt"` |
| `repo_map` | 1 | 35.7 s | repo-map | **yes** (1st tool call) | `summary: "fixture-calc is a tiny TypeScript calculator CLI…", artifact: ".laguna/repo-map.json", used_skill: true` |
| `dep_scan` | 2 (schema retry) | 9.2 s + 7.2 s | – | no | `name: "fixture-web", dependency_count: 5, dependencies: [drizzle-orm, effect, hono, react, zod]` |
| `combine` | 1 | 14.8 s | – | no | `headline: "Analyzed fixture-calc … and fixture-web …", report_file: "report.md", sources: 2` |

Success criteria, checked:

- **Pool as executor + schema validation + SQLite persistence**: all four
  nodes; rows queryable per node table (`select * from repo_map` etc.).
- **Skill vs. no skill, visible in trajectories**: `runs/03-repo-fixture/`'s
  tool-call stream begins with a `skill` tool call (the repo-map skill the
  agent installed into that node's `.poolside/skills/`), and the artifact it
  produced passes the skill's own mechanical validator
  (`bun ../../skills/repo-map/scripts/validate_repo_map.ts --workspace
  work/repo-fixture …` → `status: "pass", score: 1`, all 7 checks green).
  The sibling `dep_scan` node ran in a workspace with no skill and made no
  `skill` tool calls.
- **Fan-in actually consumed fan-out outputs**: `runs/06-combine/prompt.md`
  contains both upstream rows interpolated as JSON via the `deps` prop.
- **File artifacts**: `work/greet/hello.txt`,
  `work/repo-fixture/.laguna/repo-map.json`, `work/combine/report.md` all
  written by pool, not by the harness.
- **Durability**: the run's event table holds the full history
  (4× NodeStarted/NodeFinished, 56 AgentEvents bridged from PoolAgent's
  `onEvent`, RunStarted/RunFinished) alongside the output rows.

The schema retries were useful evidence. On 2 of 4 first attempts, the model
**echoed the JSON Schema** from the engine-injected instructions instead of
emitting an instance. PoolAgent's schema-guided extraction rejected the echo
(a naive "last JSON object" extractor would have crashed into Zod validation
the same way), the engine's schema-retry called `generate({ messages })` with
the flattened conversation + Zod issues, and both nodes produced valid
instances on the second turn. See blocker #5 for the prompt-shape fix that
would avoid the extra calls entirely.

## 7. Blockers & friction for a real integration

Ranked, with the smallest framework/CLI change that would fix each:

1. **No final-message event in pool's `-o json`** (pool issue, not Smithers).
   The answer arrives as a `thought` event, sometimes followed by a duplicated
   reasoning thought. PoolAgent compensates with schema-guided
   extract-from-the-end, which is robust in practice but heuristic by
   construction. *Smallest fix: pool emits a `{"type":"message"}` (or
   `final`) event for the closing assistant turn.*
2. **No usage reporting.** The NLJSON stream carries no token counts, so
   Smithers' `TokenUsageReported` accounting is empty for pool nodes. Token
   data exists in pool's local trajectory NDJSON
   (`tool_call.inference.end` events). *Smallest fix: PoolAgent locates the
   local trajectory file (the stderr URL carries `agent_id` +
   `agent_session_id`) and sums per-step tokens into `result.usage`; better:
   pool includes usage in `-o json`.*
3. **Schema retries restart the conversation.** The engine sends the retry as
   a `messages` transcript; PoolAgent flattens it into a fresh one-shot run, so
   pool re-reads the workspace instead of continuing its session. pool has
   `--continue <run-id>` which could make retries true continuations, but the
   NLJSON stream doesn't expose the run/session ID needed (it's only in the
   stderr trajectory URL as `agent_session_id`, and `--continue` wants a *Run
   ID*). *Smallest fix: pool prints its run ID in machine-readable output;
   PoolAgent then maps `messages`-style retries onto `--continue`.*
4. **Sandboxing is off in this spike.** The canonical eval command pairs
   `--unsafe-auto-allow` with `--sandbox required`, but pool's sandbox needs a
   reachable container runtime plus workspace sandbox config. PoolAgent
   defaults to `--sandbox disabled` (constructor option to flip), i.e. pool's
   tools run unsandboxed on the host — fine for a local spike, not for
   production. Smithers' own `allowTools`/`--root` tool sandboxing does NOT
   apply: pool executes its own tools out-of-process, invisible to Smithers.
5. **The engine's schema description invites schema-echoing.** For
   non-native agents the engine embeds `describeSchemaShape(...)` — a full
   JSON-Schema document (`"$schema": …, "properties": …`) — in the prompt and
   in retry prompts. `laguna-m.1` echoed that schema verbatim instead of an
   instance on 2 of 4 first attempts (recovered by schema retries; see
   Results). *Smallest fix: include an instance example
   (`zodSchemaToJsonExample` already exists in
   `@smithers-orchestrator/components` and is used for MDX prompts) instead
   of/alongside the JSON Schema; or PoolAgent appends a one-line "output an
   instance, not the schema" reminder to the prompt.*
6. **`BaseCliAgent` is not exported.** The blessed way to write a CLI agent
   (command builder + output interpreter + banner filtering + session
   handling) is internal to `@smithers-orchestrator/agents`. Implementing
   `AgentLike` directly works fine (this spike), but an upstream
   `smithers-orchestrator` PR would rather subclass `BaseCliAgent` like
   `CodexAgent` does — i.e. *contribute PoolAgent inside the agents package*
   (or ask upstream to export `BaseCliAgent`).
7. **Working-directory semantics differ per node.** Smithers passes one
   `rootDir` per run (plus optional worktrees); this spike wants a *different*
   workspace per node, handled by the `cwd` constructor option (one PoolAgent
   instance per node). A real integration should decide whether workspace =
   Smithers worktree (`<Worktree>` component) or an explicit per-agent dir.
8. **Minor: SQLite dir must pre-exist.** `smithers up` fails with
   `unable to open database file` if `.smithers/` doesn't exist yet —
   `mkdir -p .smithers` before the first run.

These issues do not block integration. The contract is CLI-friendly
(text-in/text-out + optional events), and the engine's non-native
structured-output path supports this kind of agent.

## 8. What's real vs. stubbed

- **Real:** every pool invocation in the recorded run hit the live tenant
  (`laguna-m.1` via `https://api.poolsi.de`); trajectory URLs in
  `runs/*/meta.json` are live console links. Skill installation is a real
  copy into the node workspace, and skill activation is visible in the
  captured tool-call stream.
- **Stubbed/omitted:** nothing is stubbed. Not exercised by this spike:
  pool sandboxing (`--sandbox required`), `--continue` session resume,
  usage accounting, Smithers `<Worktree>`/`<Approval>`/`<Loop>` composition,
  and crash-recovery (`smithers up --resume`) across pool nodes.
