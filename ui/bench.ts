#!/usr/bin/env bun
/**
 * bench — agent-facing CLI over the workbench substrate (ui/lib.ts).
 * Everything the web UI can do, scriptable from natural language by any
 * agent that can run shell commands. All output is JSON on stdout; errors
 * are JSON on stderr with a non-zero exit code. No server needed.
 *
 *   bun ui/bench.ts capabilities
 *   bun ui/bench.ts commands
 *   bun ui/bench.ts doctor
 *   bun ui/bench.ts projects
 *   bun ui/bench.ts models
 *   bun ui/bench.ts runs [--project <id>]
 *   bun ui/bench.ts run-show <runId> [--project <id>]
 *   bun ui/bench.ts workflows [--project <id>]
 *   bun ui/bench.ts workflow-graph <path> [--project <id>]
 *   bun ui/bench.ts workflow-generate --prompt "..." [--id <name>] [--model <agent>] [--project <id>]
 *   bun ui/bench.ts workflow-run <path> [--input '<json>'] [--project <id>]
 *   bun ui/bench.ts skills
 *   bun ui/bench.ts skill-generate --name <name> --prompt "..." [--model <agent>]
 *   bun ui/bench.ts eval-case-generate --skill <name> [--n N|--spec "..."]
 *   bun ui/bench.ts eval-case-generate --skill <name> --validate-only <case-dir>
 *   bun ui/bench.ts eval-case-generate --skill <name> --promote <case-dir>
 *   bun ui/bench.ts eval-suites
 *   bun ui/bench.ts eval-run --suite <path> [--case <id>]... [--arm <arm>]...
 *   bun ui/bench.ts eval-runs
 *   bun ui/bench.ts optimize-skill --skill <name> [--max-metric-calls N] [--smoke|--baseline-only]
 *   bun ui/bench.ts optimize-runs
 *   bun ui/bench.ts optimize-propose --skill <name> [--run-dir <dir>]
 *   bun ui/bench.ts node-evals [--project <id>]
 *   bun ui/bench.ts node-eval-insitu <runId> [--project <id>]
 *   bun ui/bench.ts node-eval-run <workflowPath> --node <id> [--trials N] [--model <agent>]
 *
 * Flags: only --case, --arm, --spec, --validate-only, and --promote are
 * repeatable (all occurrences used); for every other flag the LAST occurrence wins.
 * Unknown commands exit 2 with
 * JSON on stderr; `help` (or no command) prints usage on stdout. Use
 * `help <command>` or `<command> --help` for command-specific JSON help.
 */

import {
  discoverProjects,
  evalNodeStandalone,
  evalWorkflowNodes,
  generateSkill,
  generateWorkflow,
  getProject,
  HttpError,
  listEvalRuns,
  listEvalSuites,
  listHarnessProcesses,
  listModels,
  listNodeEvals,
  listOptimizeRuns,
  proposalFromOptimizeRun,
  listRuns,
  listSkills,
  listWorkflows,
  runDetail,
  skillEvalSummaries,
  startEvalRun,
  startOptimizeRun,
  startRun,
  syncReviewTraces,
  workflowGraph,
} from "./lib.ts";

type Flags = { positional: string[]; flags: Record<string, string[]> };

function parseArgs(argv: string[]): Flags {
  const out: Flags = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      (out.flags[key] ??= []).push(value);
    } else {
      out.positional.push(arg);
    }
  }
  return out;
}

function flag(args: Flags, key: string): string | undefined {
  const values = args.flags[key];
  return values?.[values.length - 1]; // last occurrence wins, like most CLIs
}

function positiveIntegerFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, `${name} must be a positive integer`);
  }
  return Number(value);
}

function nonNegativeIntegerFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new HttpError(400, `${name} must be a non-negative integer`);
  }
  return Number(value);
}

function numberFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `${name} must be a number`);
  }
  return parsed;
}

function emit(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const USAGE = {
  usage: "bun ui/bench.ts <command>",
  commands: [
    "capabilities — machine-readable CLI contract, output conventions, commands, and parity map",
    "commands — command catalog with usage, flags, and output shape hints",
    "doctor — machine-readable readiness check for repo, tools, skill contracts, suites, and run state",
    "help [command] — usage summary, or command-specific JSON help",
    "projects — list Smithers workflow projects",
    "models — list pool agent names usable as authoring/executor models",
    "runs [--project <id>] — workflow runs as TrajectoryRecords",
    "run-show <runId> [--project <id>] — node detail, outputs, pool captures",
    "workflows [--project <id>] — workflow .tsx files",
    "workflow-graph <path> [--project <id>] — DAG projection {nodes, edges}",
    'workflow-generate --prompt "..." [--id <name>] [--model <agent>] [--project <id>] — pool authors a workflow (verified)',
    "workflow-run <path> [--input '<json>'] [--project <id>] — start a run, returns runId immediately",
    "skills — skills catalog (frontmatter, validators, eval case counts)",
    'skill-generate --name <name> --prompt "..." [--model <agent>] — pool authors a skill, gated by check_skill_structure.py',
    "eval-case-generate --skill <name> [--n N|--spec '...'] — generate, validate, or promote quarantined eval cases via harness/generate/gen_eval_cases.py",
    "eval-suites — suites + cases from evals/suites/*.json",
    "eval-run --suite evals/suites/<s>.json [--case <id>]... [--arm <arm>]... — launch harness run",
    "eval-runs — harness processes + per-arm results from runs/<suite>/<case>/<arm>/",
    "optimize-skill --skill <name> [--suite <path>] [--max-metric-calls N] [--reflection-lm <id>] [--arm <arm>]... [--smoke|--baseline-only] — launch detached GEPA SKILL.md optimization (harness/optimize/gepa_skill.py)",
    "optimize-runs — optimization processes + result.json summaries from runs/optimize/",
    "optimize-propose --skill <name> [--run-dir <dir>] — fold a finished GEPA run into the improvement queue (accept = version bump + checks + re-eval)",
    "node-evals [--project <id>] — node-level eval records (in-workflow + standalone)",
    "node-eval-insitu <runId> [--project <id>] — grade every node of a finished run via its skill validator",
    "node-eval-run <workflowPath> --node <id> [--trials N] [--model <agent>] [--project <id>] — re-run a node standalone and grade each trial",
    "review-sync [--project <id>] — fold workflow node captures + node evals into runs/review/traces.json for the annotation app",
  ],
};

type CommandDetail = {
  name: string;
  category: string;
  summary: string;
  usage: string;
  output: string;
  flags?: { name: string; value?: string; repeatable?: boolean; description: string }[];
  positional?: { name: string; description: string }[];
  notes?: string[];
  mirrors?: string[];
};

const COMMAND_DETAILS: CommandDetail[] = [
  {
    name: "capabilities",
    category: "discovery",
    summary: "Machine-readable CLI contract, output conventions, commands, and parity map.",
    usage: "bun ui/bench.ts capabilities",
    output: "bench-capabilities.v1",
  },
  {
    name: "commands",
    category: "discovery",
    summary: "Command catalog with usage, flags, and output shape hints.",
    usage: "bun ui/bench.ts commands",
    output: "bench-command-catalog.v1",
  },
  {
    name: "doctor",
    category: "discovery",
    summary: "Readiness check for repo, tools, skill contracts, suites, and run state.",
    usage: "bun ui/bench.ts doctor",
    output: "bench-doctor.v1",
    notes: ["Returns status ok, warn, or fail; warnings are actionable but do not imply the CLI is unusable."],
  },
  {
    name: "help",
    category: "discovery",
    summary: "Print global usage or command-specific JSON help.",
    usage: "bun ui/bench.ts help [command]",
    output: "bench usage object or bench-command-help.v1",
    positional: [{ name: "command", description: "Optional command name to inspect." }],
    notes: ["Equivalent command-specific form: `bun ui/bench.ts <command> --help`."],
  },
  {
    name: "projects",
    category: "workflow",
    summary: "List Smithers workflow projects.",
    usage: "bun ui/bench.ts projects",
    output: "Project[] without local root paths",
  },
  {
    name: "models",
    category: "workflow",
    summary: "List pool agent names usable as authoring/executor models.",
    usage: "bun ui/bench.ts models",
    output: "string[]",
  },
  {
    name: "runs",
    category: "workflow",
    summary: "List workflow runs as TrajectoryRecords.",
    usage: "bun ui/bench.ts runs [--project <id>]",
    output: "TrajectoryRecord[]",
    flags: [{ name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." }],
    mirrors: ["GET /api/runs"],
  },
  {
    name: "run-show",
    category: "workflow",
    summary: "Show node detail, outputs, and pool captures for a workflow run.",
    usage: "bun ui/bench.ts run-show <runId> [--project <id>]",
    output: "RunDetail",
    positional: [{ name: "runId", description: "Workflow run id." }],
    flags: [{ name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." }],
  },
  {
    name: "workflows",
    category: "workflow",
    summary: "List workflow .tsx files.",
    usage: "bun ui/bench.ts workflows [--project <id>]",
    output: "WorkflowFile[]",
    flags: [{ name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." }],
  },
  {
    name: "workflow-graph",
    category: "workflow",
    summary: "Render a workflow file as a DAG projection.",
    usage: "bun ui/bench.ts workflow-graph <path> [--project <id>]",
    output: "{ nodes, edges }",
    positional: [{ name: "path", description: "Project-relative workflow file path." }],
    flags: [{ name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." }],
  },
  {
    name: "workflow-generate",
    category: "workflow",
    summary: "Ask pool to author a verified workflow.",
    usage: 'bun ui/bench.ts workflow-generate --prompt "..." [--id <name>] [--model <agent>] [--project <id>]',
    output: "WorkflowGenerationResult",
    flags: [
      { name: "--prompt", value: "text", description: "Workflow authoring prompt. Required." },
      { name: "--id", value: "name", description: "Workflow id/file stem." },
      { name: "--model", value: "agent", description: "Authoring agent name." },
      { name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." },
    ],
  },
  {
    name: "workflow-run",
    category: "workflow",
    summary: "Start a workflow run and return its run id immediately.",
    usage: "bun ui/bench.ts workflow-run <path> [--input '<json>'] [--project <id>]",
    output: "{ runId, ... }",
    positional: [{ name: "path", description: "Project-relative workflow file path." }],
    flags: [
      { name: "--input", value: "json", description: "JSON object passed as workflow input." },
      { name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." },
    ],
  },
  {
    name: "skills",
    category: "skills",
    summary: "List the skill catalog with frontmatter, validators, schemas, and eval case counts.",
    usage: "bun ui/bench.ts skills",
    output: "SkillSummary[] with evalSummary",
    mirrors: ["GET /api/skills"],
  },
  {
    name: "skill-generate",
    category: "skills",
    summary: "Ask pool to author a new validator-first skill, gated by check_skill_structure.py.",
    usage: 'bun ui/bench.ts skill-generate --name <name> --prompt "..." [--model <agent>]',
    output: "SkillGenerationResult",
    flags: [
      { name: "--name", value: "name", description: "Skill directory/frontmatter name. Required." },
      { name: "--prompt", value: "text", description: "Skill authoring prompt. Required." },
      { name: "--model", value: "agent", description: "Authoring agent name." },
    ],
  },
  {
    name: "eval-suites",
    category: "evals",
    summary: "List suites and cases from evals/suites/*.json.",
    usage: "bun ui/bench.ts eval-suites",
    output: "EvalSuite[]",
  },
  {
    name: "eval-case-generate",
    category: "evals",
    summary: "Generate, validate, or promote quarantined eval cases for a skill.",
    usage: 'bun ui/bench.ts eval-case-generate --skill <name> [--n N|--spec "..."] [--validate-only <case-dir>] [--promote <case-dir>]',
    output: "bench-eval-case-generate.v1",
    flags: [
      { name: "--skill", value: "name", description: "Skill directory name. Required unless supplied as the first positional arg." },
      { name: "--n", value: "N", description: "Number of candidates to generate. Defaults to the generator default." },
      { name: "--spec", value: "text-or-json", repeatable: true, description: "Explicit case spec. Repeatable; skips LM spec proposal." },
      { name: "--model", value: "id", description: "litellm model id for generation." },
      { name: "--api-base", value: "url", description: "OpenAI-compatible endpoint base URL." },
      { name: "--api-key-env", value: "name", description: "Environment variable holding the API key for --api-base." },
      { name: "--max-output-tokens", value: "N", description: "LM completion cap." },
      { name: "--temperature", value: "number", description: "LM sampling temperature." },
      { name: "--max-repair-rounds", value: "N", description: "LM repair rounds after gate rejection; zero is allowed." },
      { name: "--seed-example", value: "case-id", description: "Existing case id to use as the worked example." },
      { name: "--validator-timeout", value: "seconds", description: "Per-validator timeout used by mechanical gates." },
      { name: "--out-dir", value: "dir", description: "Output directory; default is runs/generate/<skill>/<utc-stamp>." },
      { name: "--validate-only", value: "case-dir", repeatable: true, description: "No LM: run mechanical gates against existing case dir(s)." },
      { name: "--promote", value: "case-dir", repeatable: true, description: "No LM: gate and copy reviewed candidate(s) into the frozen eval set." },
    ],
    notes: [
      "This is a JSON-normalizing wrapper around `uv run harness/generate/gen_eval_cases.py`; the raw Python invocation remains supported.",
      "`--validate-only` and `--promote` are mutually exclusive.",
      "Generated candidates remain quarantined under runs/generate/ until a human reviews and promotes them.",
    ],
  },
  {
    name: "eval-run",
    category: "evals",
    summary: "Launch a detached harness run.",
    usage: "bun ui/bench.ts eval-run --suite evals/suites/<s>.json [--case <id>]... [--arm <arm>]...",
    output: "StartEvalRunResult",
    flags: [
      { name: "--suite", value: "path", description: "Repo-relative suite path. Required." },
      { name: "--case", value: "id", repeatable: true, description: "Case id filter. Repeatable." },
      { name: "--arm", value: "arm", repeatable: true, description: "Harness arm filter. Repeatable." },
    ],
  },
  {
    name: "eval-runs",
    category: "evals",
    summary: "List harness processes and per-arm results from runs/<suite>/<case>/<arm>/.",
    usage: "bun ui/bench.ts eval-runs",
    output: "{ harness, runs }",
  },
  {
    name: "optimize-skill",
    category: "optimization",
    summary: "Launch detached GEPA SKILL.md optimization.",
    usage: "bun ui/bench.ts optimize-skill --skill <name> [--suite <path>] [--max-metric-calls N] [--reflection-lm <id>] [--arm <arm>]... [--smoke|--baseline-only]",
    output: "StartOptimizeRunResult",
    flags: [
      { name: "--skill", value: "name", description: "Skill to optimize. Required unless supplied as the first positional arg." },
      { name: "--suite", value: "path", description: "Suite path override." },
      { name: "--max-metric-calls", value: "N", description: "GEPA metric-call budget." },
      { name: "--reflection-lm", value: "id", description: "Reflection model id." },
      { name: "--arm", value: "arm", repeatable: true, description: "Harness arm filter. Repeatable." },
      { name: "--smoke", description: "Run the smoke-sized optimizer path." },
      { name: "--baseline-only", description: "Run baseline scoring without proposing improvements." },
    ],
  },
  {
    name: "optimize-runs",
    category: "optimization",
    summary: "List optimization processes and result.json summaries from runs/optimize/.",
    usage: "bun ui/bench.ts optimize-runs",
    output: "OptimizeProcess[]",
  },
  {
    name: "optimize-propose",
    category: "optimization",
    summary: "Fold a finished GEPA run into the improvement queue.",
    usage: "bun ui/bench.ts optimize-propose --skill <name> [--run-dir <dir>]",
    output: "OptimizeProposal",
    flags: [
      { name: "--skill", value: "name", description: "Optimized skill. Required unless supplied as the first positional arg." },
      { name: "--run-dir", value: "dir", description: "Specific optimization run directory." },
    ],
    mirrors: ["POST /api/proposals"],
  },
  {
    name: "node-evals",
    category: "node evals",
    summary: "List node-level eval records, both in-workflow and standalone.",
    usage: "bun ui/bench.ts node-evals [--project <id>]",
    output: "NodeEvalRecord[]",
    flags: [{ name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." }],
    mirrors: ["GET /api/node-evals"],
  },
  {
    name: "node-eval-insitu",
    category: "node evals",
    summary: "Grade every node of a finished workflow run via its skill validator.",
    usage: "bun ui/bench.ts node-eval-insitu <runId> [--project <id>]",
    output: "NodeEvalRecord[]",
    positional: [{ name: "runId", description: "Workflow run id." }],
    flags: [{ name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." }],
  },
  {
    name: "node-eval-run",
    category: "node evals",
    summary: "Re-run a node standalone and grade each trial.",
    usage: "bun ui/bench.ts node-eval-run <workflowPath> --node <id> [--trials N] [--model <agent>] [--project <id>]",
    output: "NodeEvalRecord[]",
    positional: [{ name: "workflowPath", description: "Project-relative workflow file path." }],
    flags: [
      { name: "--node", value: "id", description: "Workflow node id. Required." },
      { name: "--trials", value: "N", description: "Number of standalone trials." },
      { name: "--model", value: "agent", description: "Execution agent name." },
      { name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." },
    ],
  },
  {
    name: "review-sync",
    category: "review",
    summary: "Fold workflow node captures and node evals into runs/review/traces.json.",
    usage: "bun ui/bench.ts review-sync [--project <id>]",
    output: "{ ok, tracesPath, count }",
    flags: [{ name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." }],
  },
];

const COMMAND_BY_NAME = new Map(COMMAND_DETAILS.map((cmd) => [cmd.name, cmd]));

class UnknownCommandError extends Error {
  constructor(command: string) {
    super(`Unknown command: ${command}`);
  }
}

class BenchCommandError extends Error {
  body: unknown;

  constructor(message: string, body: unknown) {
    super(message);
    this.body = body;
  }
}

function commandHelp(name?: string): unknown {
  if (!name) {
    return {
      ...USAGE,
      help: "Use `bun ui/bench.ts help <command>` or `bun ui/bench.ts <command> --help` for command-specific JSON help.",
    };
  }
  const command = COMMAND_BY_NAME.get(name);
  if (!command) throw new UnknownCommandError(name);
  return {
    schema_version: "bench-command-help.v1",
    command,
    conventions: {
      stdout: "JSON only on success.",
      stderr: "JSON only on error.",
      repeatable_flags: ["--case", "--arm", "--spec", "--validate-only", "--promote"],
      flag_precedence: "For non-repeatable flags, the last occurrence wins.",
    },
  };
}

function capabilities(): unknown {
  return {
    schema_version: "bench-capabilities.v1",
    contract: {
      invocation: "bun ui/bench.ts <command>",
      stdout: "JSON only on success.",
      stderr: "JSON only on error.",
      exit_codes: {
        0: "success",
        1: "runtime, validation, or HTTP-style command error",
        2: "unknown command",
      },
      repeatable_flags: ["--case", "--arm", "--spec", "--validate-only", "--promote"],
      flag_precedence: "For non-repeatable flags, the last occurrence wins.",
    },
    environment: {
      cwd: "repo root",
      server_required: false,
      runtime: "bun",
    },
    commands: COMMAND_DETAILS,
    parity: {
      shared_substrate: "ui/lib.ts",
      web_server: "ui/server.ts",
      cli: "ui/bench.ts",
      known_mirrors: COMMAND_DETAILS.filter((cmd) => cmd.mirrors?.length).map((cmd) => ({
        command: cmd.name,
        mirrors: cmd.mirrors,
      })),
    },
    next_commands: [
      "bun ui/bench.ts doctor",
      "bun ui/bench.ts commands",
      "bun ui/bench.ts help eval-run",
      "bun ui/bench.ts help eval-case-generate",
    ],
  };
}

function decode(bytes: { toString(encoding?: string): string }): string {
  return bytes.toString("utf8");
}

function parseJsonDocuments(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    return [JSON.parse(trimmed)];
  } catch {
    // Some generator modes print one pretty JSON object per input case.
  }

  const docs: unknown[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        docs.push(JSON.parse(trimmed.slice(start, i + 1)));
        start = -1;
      }
    }
  }
  return docs;
}

function pushOptional(argv: string[], key: string, value: string | undefined): void {
  if (value !== undefined) argv.push(key, value);
}

const EVAL_CASE_GENERATE_FLAGS = new Set([
  "skill",
  "n",
  "spec",
  "model",
  "api-base",
  "api-key-env",
  "max-output-tokens",
  "temperature",
  "max-repair-rounds",
  "seed-example",
  "validator-timeout",
  "out-dir",
  "validate-only",
  "promote",
]);

function parseEvalCaseGenerateArgs(argv: string[]): Flags {
  const out: Flags = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out.positional.push(arg);
      continue;
    }

    const key = arg.slice(2);
    if (!EVAL_CASE_GENERATE_FLAGS.has(key)) {
      throw new HttpError(400, `Unknown flag for eval-case-generate: --${key}`);
    }

    if (key === "validate-only" || key === "promote") {
      const values: string[] = [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        values.push(argv[++i]);
      }
      if (values.length === 0) {
        throw new HttpError(400, `--${key} requires at least one case dir`);
      }
      (out.flags[key] ??= []).push(...values);
      continue;
    }

    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : undefined;
    if (value === undefined) {
      throw new HttpError(400, `--${key} requires a value`);
    }
    (out.flags[key] ??= []).push(value);
  }
  return out;
}

function runEvalCaseGenerate(rawArgv: string[]): unknown {
  const args = parseEvalCaseGenerateArgs(rawArgv);
  const skillFromFlag = flag(args, "skill");
  const skill = skillFromFlag ?? args.positional[0];
  if (!skill) throw new HttpError(400, "usage: eval-case-generate --skill <name>");
  const unexpectedPositionals = skillFromFlag ? args.positional : args.positional.slice(1);
  if (unexpectedPositionals.length > 0) {
    throw new HttpError(400, `Unexpected positional argument(s): ${unexpectedPositionals.join(", ")}`);
  }
  const validateOnly = args.flags["validate-only"] ?? [];
  const promote = args.flags["promote"] ?? [];
  if (validateOnly.length > 0 && promote.length > 0) {
    throw new HttpError(400, "--validate-only and --promote are mutually exclusive");
  }

  const n = positiveIntegerFlag(flag(args, "n"), "--n");
  const maxOutputTokens = positiveIntegerFlag(flag(args, "max-output-tokens"), "--max-output-tokens");
  const maxRepairRounds = nonNegativeIntegerFlag(flag(args, "max-repair-rounds"), "--max-repair-rounds");
  const validatorTimeout = numberFlag(flag(args, "validator-timeout"), "--validator-timeout");
  const temperature = numberFlag(flag(args, "temperature"), "--temperature");

  const argv = ["uv", "run", "harness/generate/gen_eval_cases.py", "--skill", skill];
  if (n !== undefined) argv.push("--n", String(n));
  for (const spec of args.flags["spec"] ?? []) argv.push("--spec", spec);
  pushOptional(argv, "--model", flag(args, "model"));
  pushOptional(argv, "--api-base", flag(args, "api-base"));
  pushOptional(argv, "--api-key-env", flag(args, "api-key-env"));
  if (maxOutputTokens !== undefined) argv.push("--max-output-tokens", String(maxOutputTokens));
  if (temperature !== undefined) argv.push("--temperature", String(temperature));
  if (maxRepairRounds !== undefined) argv.push("--max-repair-rounds", String(maxRepairRounds));
  pushOptional(argv, "--seed-example", flag(args, "seed-example"));
  if (validatorTimeout !== undefined) argv.push("--validator-timeout", String(validatorTimeout));
  pushOptional(argv, "--out-dir", flag(args, "out-dir"));
  if (validateOnly.length > 0) argv.push("--validate-only", ...validateOnly);
  if (promote.length > 0) argv.push("--promote", ...promote);

  const result = Bun.spawnSync({
    cmd: argv,
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = decode(result.stdout).trim();
  const stderr = decode(result.stderr).trim();
  const stdoutJson = parseJsonDocuments(stdout);
  const mode = validateOnly.length > 0 ? "validate-only" : promote.length > 0 ? "promote" : "generate";
  const exitCode = result.exitCode ?? 1;
  const payload = {
    schema_version: "bench-eval-case-generate.v1",
    ok: exitCode === 0,
    mode,
    command: argv,
    exit_code: exitCode,
    stdout_json: stdoutJson.length === 1 ? stdoutJson[0] : stdoutJson,
    stdout_text: stdoutJson.length === 0 && stdout ? stdout : null,
    stderr_text: stderr || null,
  };

  if (exitCode !== 0) {
    throw new BenchCommandError(`eval-case-generate failed with exit ${exitCode}`, payload);
  }
  return payload;
}

type DoctorStatus = "ok" | "warn" | "fail";

function toolStatus(name: string, required = true): { name: string; status: DoctorStatus; path: string | null } {
  const path = Bun.which(name);
  return {
    name,
    status: path ? "ok" : required ? "fail" : "warn",
    path,
  };
}

function aggregateStatus(items: { status: DoctorStatus }[]): DoctorStatus {
  if (items.some((item) => item.status === "fail")) return "fail";
  if (items.some((item) => item.status === "warn")) return "warn";
  return "ok";
}

function doctor(): unknown {
  const prerequisites = [
    toolStatus("bun"),
    toolStatus("uv"),
    toolStatus("python3"),
    toolStatus("git"),
    toolStatus("pool", false),
  ];
  const skills = listSkills();
  const incompleteContracts = skills.filter((skill) => skill.validators.length === 0 || skill.schemas.length === 0);
  const lowCaseCoverage = skills.filter((skill) => skill.evalCases < 3);
  const suites = listEvalSuites();
  const suiteCaseCount = suites.reduce((sum, suite) => sum + suite.cases.length, 0);
  const harness = listHarnessProcesses();
  const evalRuns = listEvalRuns();
  const optimizeRuns = listOptimizeRuns();

  const checks: { id: string; status: DoctorStatus; detail: string }[] = [
    {
      id: "prerequisites",
      status: aggregateStatus(prerequisites),
      detail: `${prerequisites.filter((tool) => tool.status === "ok").length}/${prerequisites.length} tools found`,
    },
    {
      id: "skills-present",
      status: skills.length > 0 ? "ok" : "fail",
      detail: `${skills.length} skill(s) discovered`,
    },
    {
      id: "skill-contracts",
      status: incompleteContracts.length === 0 ? "ok" : "fail",
      detail:
        incompleteContracts.length === 0
          ? "all discovered skills expose at least one schema and validator"
          : `${incompleteContracts.length} skill(s) are missing validators or schemas`,
    },
    {
      id: "eval-case-coverage",
      status: lowCaseCoverage.length === 0 ? "ok" : "warn",
      detail:
        lowCaseCoverage.length === 0
          ? "all discovered skills have at least three eval cases"
          : `${lowCaseCoverage.length} skill(s) have fewer than three eval cases`,
    },
    {
      id: "eval-suites",
      status: suites.length > 0 && suiteCaseCount > 0 ? "ok" : "warn",
      detail: `${suites.length} suite(s), ${suiteCaseCount} suite case reference(s)`,
    },
  ];

  return {
    schema_version: "bench-doctor.v1",
    status: aggregateStatus(checks),
    prerequisites,
    checks,
    catalog: {
      skills: skills.length,
      skills_missing_contracts: incompleteContracts.map((skill) => skill.name),
      skills_below_three_cases: lowCaseCoverage.map((skill) => skill.name),
      suites: suites.length,
      suite_case_references: suiteCaseCount,
    },
    runtime_state: {
      harness_processes: harness.length,
      running_harness_processes: harness.filter((process) => process.running).length,
      eval_runs: evalRuns.length,
      optimize_runs: optimizeRuns.length,
    },
    next_commands: [
      "uv run scripts/check_skill_structure.py --json",
      "uv run scripts/check_eval_cases.py --json",
      "bun ui/bench.ts eval-case-generate --skill <name> --n 4",
      "uv run scripts/check_schemas.py --json",
      "uv run scripts/check_validator_robustness.py --json",
      "uv run harness/runner/run_eval.py --suite evals/suites/smoke.json --dry-run --replay",
    ],
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const project = () => getProject(flag(args, "project") ?? null);

  if (command && flag(args, "help") === "true") return emit(commandHelp(command));

  switch (command) {
    case "capabilities":
      return emit(capabilities());
    case "commands":
      return emit({ schema_version: "bench-command-catalog.v1", commands: COMMAND_DETAILS });
    case "doctor":
      return emit(doctor());
    case "projects":
      return emit(discoverProjects().map(({ root: _root, ...p }) => p));
    case "models":
      return emit(await listModels());
    case "runs":
      return emit(listRuns(project()));
    case "run-show": {
      const runId = args.positional[0];
      if (!runId) throw new HttpError(400, "usage: run-show <runId>");
      return emit(runDetail(project(), runId));
    }
    case "workflows":
      return emit(listWorkflows(project()));
    case "workflow-graph": {
      const path = args.positional[0];
      if (!path) throw new HttpError(400, "usage: workflow-graph <path>");
      return emit(await workflowGraph(project(), path));
    }
    case "workflow-generate": {
      const prompt = flag(args, "prompt");
      if (!prompt) throw new HttpError(400, "--prompt is required");
      return emit(
        await generateWorkflow(project(), prompt, {
          id: flag(args, "id"),
          agentName: flag(args, "model"),
        }),
      );
    }
    case "workflow-run": {
      const path = args.positional[0];
      if (!path) throw new HttpError(400, "usage: workflow-run <path>");
      const inputRaw = flag(args, "input");
      let input: Record<string, unknown> | undefined;
      if (inputRaw) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(inputRaw);
        } catch (error) {
          throw new HttpError(
            400,
            `--input must be valid JSON (got: ${inputRaw.slice(0, 60)}): ${(error as Error).message}`,
          );
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new HttpError(400, `--input must be a JSON object, got ${JSON.stringify(parsed)?.slice(0, 60)}`);
        }
        input = parsed as Record<string, unknown>;
      }
      return emit(await startRun(project(), path, input));
    }
    case "skills": {
      const summaries = skillEvalSummaries();
      return emit(listSkills().map((s) => ({ ...s, evalSummary: summaries[s.name] ?? null })));
    }
    case "skill-generate": {
      const name = flag(args, "name");
      const prompt = flag(args, "prompt");
      if (!name || !prompt) throw new HttpError(400, "--name and --prompt are required");
      return emit(await generateSkill(name, prompt, { agentName: flag(args, "model") }));
    }
    case "eval-case-generate":
      return emit(runEvalCaseGenerate(rest));
    case "eval-suites":
      return emit(listEvalSuites());
    case "eval-run": {
      const suite = flag(args, "suite");
      if (!suite) throw new HttpError(400, "--suite is required");
      const result = startEvalRun({
        suite,
        cases: args.flags["case"],
        arms: args.flags["arm"],
      });
      return emit(result);
    }
    case "eval-runs":
      return emit({ harness: listHarnessProcesses(), runs: listEvalRuns() });
    case "optimize-skill": {
      const skill = flag(args, "skill") ?? args.positional[0];
      if (!skill) throw new HttpError(400, "usage: optimize-skill --skill <name>");
      const maxMetricCalls = flag(args, "max-metric-calls");
      return emit(
        startOptimizeRun({
          skill,
          suite: flag(args, "suite"),
          maxMetricCalls: positiveIntegerFlag(maxMetricCalls, "--max-metric-calls"),
          reflectionLm: flag(args, "reflection-lm"),
          arms: args.flags["arm"],
          smoke: flag(args, "smoke") === "true",
          baselineOnly: flag(args, "baseline-only") === "true",
        }),
      );
    }
    case "optimize-runs":
      return emit(listOptimizeRuns());
    case "optimize-propose": {
      const skill = flag(args, "skill") ?? args.positional[0];
      if (!skill) throw new HttpError(400, "usage: optimize-propose --skill <name> [--run-dir <dir>]");
      return emit(proposalFromOptimizeRun({ skill, runDir: flag(args, "run-dir") ?? undefined }));
    }
    case undefined:
      return emit(commandHelp());
    case "help":
      return emit(commandHelp(args.positional[0]));
    case "review-sync":
      return emit({ ok: true, ...syncReviewTraces(project()) });
    case "node-evals":
      return emit(listNodeEvals(project()));
    case "node-eval-insitu": {
      const runId = args.positional[0];
      if (!runId) throw new HttpError(400, "usage: node-eval-insitu <runId>");
      return emit(await evalWorkflowNodes(project(), runId));
    }
    case "node-eval-run": {
      const path = args.positional[0];
      const nodeId = flag(args, "node");
      if (!path || !nodeId) throw new HttpError(400, "usage: node-eval-run <workflowPath> --node <id>");
      return emit(
        await evalNodeStandalone(project(), path, nodeId, {
          trials: positiveIntegerFlag(flag(args, "trials"), "--trials"),
          agentName: flag(args, "model"),
        }),
      );
    }
    default:
      // Unknown command is an ERROR: stderr + exit 2, so agent typos
      // (run vs workflow-run) never read as success. `help` / no command
      // gets USAGE on stdout with exit 0.
      console.error(JSON.stringify({ error: `Unknown command: ${command}`, ...USAGE }));
      process.exit(2);
  }
}

main()
  .then(() => {
    // eval-run leaves a harness child running on purpose; everything else
    // exits naturally. Force-flush and exit so spawned children don't pin us.
    setTimeout(() => process.exit(0), 50);
  })
  .catch((error) => {
    if (error instanceof UnknownCommandError) {
      console.error(JSON.stringify({ error: error.message, ...USAGE }));
      process.exit(2);
    }
    if (error instanceof BenchCommandError) {
      console.error(JSON.stringify(error.body, null, 2));
      process.exit(1);
    }
    const status = error instanceof HttpError ? error.status : 500;
    console.error(JSON.stringify({ error: error.message ?? String(error), status }));
    process.exit(1);
  });
