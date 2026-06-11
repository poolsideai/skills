/**
 * PoolAgent — a Smithers `AgentLike` whose executor is Poolside's `pool` CLI.
 *
 * Contract (verified against smithers-orchestrator 0.18.0 source,
 * @smithers-orchestrator/engine/src/engine.js:3067 and :3551):
 *
 *   - The engine calls `agent.generate({ prompt | messages, abortSignal,
 *     rootDir, timeout, maxOutputBytes, onStdout, onStderr, onEvent,
 *     onStepFinish, outputSchema, ... })` and expects a result object with at
 *     minimum `.text` (string). `.output` (already-parsed structured output),
 *     `.usage`, `.steps`, `.finishReason`, `.response.messages` are optional.
 *   - Because `supportsNativeStructuredOutput` is false here, the engine
 *     ITSELF prepends/appends the "you MUST end your response with a JSON
 *     object in a ```json fence matching this schema" instructions to the
 *     prompt (engine.js:2906-2923), then extracts + Zod-validates JSON from
 *     `result.text` (or takes `result.output` verbatim when present), with up
 *     to 3 schema-retry turns that re-call `generate({ messages })`.
 *   - Schema retries arrive as `messages` (a flattened conversation), not
 *     `prompt`; CLI agents are expected to flatten them to text
 *     (engine.js:3489-3492 comment).
 *
 * Execution: shells out to
 *   pool exec --prompt-file <tmp> --directory <cwd> -o json
 *     --unsafe-auto-allow --sandbox <mode> --agent-name <a> --api-url <u>
 * parses the NLJSON event stream on stdout (`reasoning` / `thought` /
 * `toolCall` / `toolCallResult` events on pool 1.0.5; the final assistant
 * answer surfaces as a `thought` event — there is no dedicated final-message
 * event type), and returns the concatenated thought text. When the Task has a
 * Zod `outputSchema`, candidate JSON objects are scanned from the END of the
 * stream and the first one that validates is returned as `.output`, which
 * short-circuits the engine's own extraction. Auth comes from the user's
 * `~/.config/poolside/credentials.json` (or $POOLSIDE_TOKEN), inherited via
 * the environment.
 */

import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

type ZodLikeSchema = {
  safeParse: (value: unknown) => { success: boolean; data?: unknown };
};

type ConversationMessage = { role?: string; content?: unknown };

/**
 * Subset of AgentGenerateOptions the engine actually passes (engine.js:3067).
 * `prompt`/`messages`/`timeout`/`outputSchema` are typed `unknown` to stay
 * structurally assignable to Smithers' AgentGenerateOptions; they are
 * narrowed at runtime.
 */
export type PoolGenerateArgs = {
  prompt?: unknown;
  messages?: unknown;
  abortSignal?: AbortSignal;
  rootDir?: string;
  timeout?: unknown;
  maxOutputBytes?: number;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onEvent?: (event: never) => unknown;
  outputSchema?: unknown;
  [key: string]: unknown;
};

export type PoolAgentSkill = {
  /** Skill directory name under .poolside/skills/ */
  name: string;
  /** Absolute path to the skill source dir (must contain SKILL.md) */
  from: string;
};

export type PoolAgentOptions = {
  /** Working directory for `pool exec --directory`; falls back to the engine's rootDir, then process.cwd(). */
  cwd?: string;
  /** Tenant agent name (model lever). Default: laguna-m.1 (tenant default; see docs/model-access-spike.md). */
  agentName?: string;
  apiUrl?: string;
  poolBin?: string;
  /**
   * Pool sandbox mode. Default "disabled": the canonical eval command pairs
   * --unsafe-auto-allow with --sandbox required, but pool's sandbox needs a
   * reachable container runtime + workspace sandbox config; for this local
   * spike tools run unsandboxed (same debt the harness records as
   * "sandbox-disabled").
   */
  sandbox?: "required" | "disabled";
  /** Install (copy, excluding evals/) a skill into <cwd>/.poolside/skills/<name> before running. */
  skill?: PoolAgentSkill;
  /** Directory to capture per-call observability: prompt, NLJSON stdout, stderr, meta.json. */
  logDir?: string;
  id?: string;
};

export type PoolCallRecord = {
  argv: string[];
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  trajectoryUrl: string | null;
  skillInstalled: string | null;
  toolCalls: { name: string; args: unknown }[];
  skillToolCalls: number;
  logPath: string | null;
};

export class PoolAgentError extends Error {}

/** onEvent is contravariantly typed against Smithers' AgentCliEvent; cast once here. */
function emitEvent(args: PoolGenerateArgs, event: Record<string, unknown>): void {
  (args.onEvent as undefined | ((e: unknown) => unknown))?.(event);
}

function asZodSchema(value: unknown): ZodLikeSchema | undefined {
  return value && typeof (value as ZodLikeSchema).safeParse === "function"
    ? (value as ZodLikeSchema)
    : undefined;
}

let callSeq = 0;
// Capture dirs must be unique across workflow runs (each `smithers up` is a
// fresh process, so a bare counter would collide and overwrite old captures).
const PROCESS_TAG = Date.now().toString(36);

export class PoolAgent {
  /**
   * Deliberately false: pool has no native structured-output API, and leaving
   * this false makes the Smithers engine inject the JSON-fence output
   * instructions into the prompt and run its own extraction/validation/retry
   * loop — exactly what a CLI agent wants.
   */
  readonly supportsNativeStructuredOutput = false;
  readonly id: string;
  readonly opts: PoolAgentOptions;
  /** Observability: one record per generate() call, newest last. */
  readonly calls: PoolCallRecord[] = [];

  constructor(opts: PoolAgentOptions = {}) {
    this.opts = opts;
    this.id = opts.id ?? `pool:${opts.agentName ?? "laguna-m.1"}`;
  }

  async generate(args: PoolGenerateArgs = {}): Promise<{
    text: string;
    output?: unknown;
    finishReason: string;
    response: { messages: { role: string; content: string }[] };
  }> {
    const prompt = resolvePrompt(args);
    const cwd = resolve(this.opts.cwd ?? args.rootDir ?? process.cwd());
    mkdirSync(cwd, { recursive: true });

    const skillInstalled = this.installSkill(cwd);

    const promptDir = mkdtempSync(join(tmpdir(), "pool-agent-"));
    const promptFile = join(promptDir, "prompt.md");
    writeFileSync(promptFile, prompt, "utf8");

    const argv = [
      this.opts.poolBin ?? "pool",
      "exec",
      "--prompt-file",
      promptFile,
      "--directory",
      cwd,
      "-o",
      "json",
      "--unsafe-auto-allow",
      "--sandbox",
      this.opts.sandbox ?? "disabled",
      "--agent-name",
      this.opts.agentName ?? "laguna-m.1",
      "--api-url",
      this.opts.apiUrl ?? "https://api.poolsi.de",
    ];

    const call = ++callSeq;
    const label = `${PROCESS_TAG}-${String(call).padStart(2, "0")}-${basename(cwd)}`;
    emitEvent(args, { type: "started", engine: "pool", title: `pool exec (${this.id}) in ${cwd}` });

    const started = Date.now();
    const result = await this.runPool(argv, args);
    const durationMs = Date.now() - started;

    // The final assistant answer arrives as `thought` events; `reasoning`
    // events are chain-of-thought. A duplicated reasoning-thought can follow
    // the answer (observed live on 1.0.5), so candidates are schema-checked
    // from the end rather than blindly taking the last thought.
    const thoughts = result.events
      .filter((e) => e.type === "thought" && typeof e.thought === "string")
      .map((e) => String(e.thought).trim())
      .filter(Boolean);
    const text = thoughts.join("\n\n");

    let output: unknown;
    const schema = asZodSchema(args.outputSchema);
    if (schema) {
      outer: for (let i = thoughts.length - 1; i >= 0; i--) {
        for (const candidate of jsonCandidatesFromEnd(thoughts[i])) {
          const parsed = schema.safeParse(candidate);
          if (parsed.success) {
            output = candidate;
            break outer;
          }
        }
      }
    }

    const toolCalls = result.events
      .filter((e) => e.type === "toolCall")
      .map((e) => ({ name: String(e.name ?? "unknown"), args: e.args }));
    const skillToolCalls = toolCalls.filter((t) => t.name === "skill").length;

    const record: PoolCallRecord = {
      argv,
      cwd,
      exitCode: result.exitCode,
      durationMs,
      timedOut: result.timedOut,
      aborted: result.aborted,
      trajectoryUrl: result.trajectoryUrl,
      skillInstalled,
      toolCalls,
      skillToolCalls,
      logPath: null,
    };

    if (this.opts.logDir) {
      const logPath = join(resolve(this.opts.logDir), label);
      mkdirSync(logPath, { recursive: true });
      writeFileSync(join(logPath, "prompt.md"), prompt, "utf8");
      writeFileSync(join(logPath, "stdout.ndjson"), result.rawStdout, "utf8");
      writeFileSync(join(logPath, "stderr.txt"), result.rawStderr, "utf8");
      record.logPath = logPath;
      writeFileSync(
        join(logPath, "meta.json"),
        JSON.stringify(
          { ...record, text, outputValidated: output !== undefined },
          null,
          2,
        ),
        "utf8",
      );
    }
    this.calls.push(record);

    if (result.aborted) {
      throw new PoolAgentError(`pool exec aborted by the engine (cwd=${cwd})`);
    }
    if (result.timedOut) {
      throw new PoolAgentError(`pool exec timed out after ${durationMs}ms (cwd=${cwd})`);
    }
    // pool exit codes: 0 = task success, 4 = pool ran but declared the task
    // failed, anything else = unexpected error (pool exec --help).
    if (result.exitCode !== 0) {
      const tail = result.rawStderr.slice(-800);
      throw new PoolAgentError(
        `pool exec exited ${result.exitCode} (cwd=${cwd}). stderr tail: ${tail}`,
      );
    }

    emitEvent(args, { type: "completed", engine: "pool", ok: true, answer: text });
    return {
      text,
      output,
      finishReason: "stop",
      response: { messages: [{ role: "assistant", content: text }] },
    };
  }

  /** Copy the configured skill into <cwd>/.poolside/skills/<name> (excluding evals/, matching scripts/install_skill.py --copy). */
  private installSkill(cwd: string): string | null {
    const skill = this.opts.skill;
    if (!skill) return null;
    const source = resolve(skill.from);
    if (!existsSync(join(source, "SKILL.md"))) {
      throw new PoolAgentError(`skill source ${source} has no SKILL.md`);
    }
    const dest = join(cwd, ".poolside", "skills", skill.name);
    if (!existsSync(dest)) {
      mkdirSync(join(cwd, ".poolside", "skills"), { recursive: true });
      cpSync(source, dest, {
        recursive: true,
        filter: (src) => basename(src) !== "evals",
      });
    }
    return dest;
  }

  private runPool(
    argv: string[],
    args: PoolGenerateArgs,
  ): Promise<{
    exitCode: number | null;
    timedOut: boolean;
    aborted: boolean;
    events: Record<string, unknown>[];
    rawStdout: string;
    rawStderr: string;
    trajectoryUrl: string | null;
  }> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(argv[0], argv.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      let rawStdout = "";
      let rawStderr = "";
      let lineBuffer = "";
      let timedOut = false;
      let aborted = false;
      const events: Record<string, unknown>[] = [];
      let actionSeq = 0;

      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          events.push(event);
          if (event.type === "toolCall") {
            const id = `pool-action-${++actionSeq}`;
            const action = { id, kind: "tool", title: String(event.name ?? "tool") };
            emitEvent(args, { type: "action", engine: "pool", phase: "started", action });
            emitEvent(args, { type: "action", engine: "pool", phase: "completed", action, ok: true });
          }
        } catch {
          // Non-JSON stdout line; keep it in rawStdout only.
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        rawStdout += text;
        args.onStdout?.(text);
        lineBuffer += text;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        rawStderr += text;
        args.onStderr?.(text);
      });

      const killTree = () => {
        if (!child.killed) child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 5_000).unref();
      };

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const totalMs = (args.timeout as { totalMs?: number } | undefined)?.totalMs;
      if (totalMs && totalMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          killTree();
        }, totalMs);
        timeoutHandle.unref();
      }

      const onAbort = () => {
        aborted = true;
        killTree();
      };
      if (args.abortSignal) {
        if (args.abortSignal.aborted) onAbort();
        else args.abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      child.on("error", (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        rejectPromise(new PoolAgentError(`failed to spawn ${argv[0]}: ${error.message}`));
      });
      child.on("close", (exitCode) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        args.abortSignal?.removeEventListener("abort", onAbort);
        consumeLine(lineBuffer);
        const trajectoryMatch = rawStderr.match(/Trajectory URL: (\S+)/);
        resolvePromise({
          exitCode,
          timedOut,
          aborted,
          events,
          rawStdout,
          rawStderr,
          trajectoryUrl: trajectoryMatch ? trajectoryMatch[1] : null,
        });
      });
    });
  }
}

/** Engine schema-retries pass `messages`, not `prompt`; flatten them to a transcript (engine.js:3489-3492 expects CLI agents to do exactly this). */
function resolvePrompt(args: PoolGenerateArgs): string {
  if (typeof args.prompt === "string" && args.prompt.length > 0) return args.prompt;
  if (Array.isArray(args.messages) && args.messages.length > 0) {
    return (args.messages as ConversationMessage[])
      .map((m) => `### ${m.role ?? "user"}\n\n${flattenContent(m.content)}`)
      .join("\n\n");
  }
  throw new PoolAgentError("generate() called without prompt or messages");
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof (part as { text?: unknown })?.text === "string"
            ? String((part as { text: string }).text)
            : "",
      )
      .join("");
  }
  return content == null ? "" : JSON.stringify(content);
}

/**
 * Yield parsed JSON objects found in `text`, scanning balanced `{...}` spans
 * from the END of the string (mirrors the engine's extractLastBalancedJson,
 * engine.js:3189-3239, so PoolAgent's pre-validation agrees with what the
 * engine would extract).
 */
function* jsonCandidatesFromEnd(text: string): Generator<unknown> {
  let pos = text.lastIndexOf("{");
  while (pos >= 0) {
    const span = balancedJsonAt(text, pos);
    if (span) {
      try {
        yield JSON.parse(span);
      } catch {
        // not JSON; keep scanning
      }
    }
    pos = text.lastIndexOf("{", pos - 1);
  }
}

function balancedJsonAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
