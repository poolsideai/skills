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
 *   bun ui/bench.ts feed [--project <id>]
 *   bun ui/bench.ts run-show <runId> [--project <id>]
 *   bun ui/bench.ts workflows [--project <id>]
 *   bun ui/bench.ts workflow-graph <path> [--project <id>]
 *   bun ui/bench.ts workflow-generate --prompt "..." [--id <name>] [--model <agent>] [--project <id>]
 *   bun ui/bench.ts workflow-run <path> [--input '<json>'] [--project <id>]
 *   bun ui/bench.ts skills
 *   bun ui/bench.ts skill-detail <name>
 *   bun ui/bench.ts proposals --skill <name>
 *   bun ui/bench.ts skill-generate --name <name> --prompt "..." [--model <agent>]
 *   bun ui/bench.ts onboard --source <dir> [--out-dir <dir>]
 *   bun ui/bench.ts eval-case-generate --skill <name> [--n N|--spec "..."]
 *   bun ui/bench.ts eval-case-generate --skill <name> --validate-only <case-dir>
 *   bun ui/bench.ts eval-case-generate --skill <name> --promote <case-dir>
 *   bun ui/bench.ts eval-suites
 *   bun ui/bench.ts eval-run --suite <path> [--case <id>]... [--arm <arm>]...
 *   bun ui/bench.ts eval-runs
 *   bun ui/bench.ts optimize-skill <name>|--skill <name> [--max-metric-calls N] [--smoke|--baseline-only]
 *   bun ui/bench.ts optimize-runs
 *   bun ui/bench.ts optimize-propose <name>|--skill <name> [--run-dir <dir>]
 *   bun ui/bench.ts node-evals [--project <id>]
 *   bun ui/bench.ts node-artifacts --run-id <runId> --node-id <nodeId> [--project <id>]
 *   bun ui/bench.ts node-eval-insitu <runId> [--project <id>]
 *   bun ui/bench.ts node-eval-run <workflowPath> --node <id> [--trials N] [--model <agent>]
 *
 * Flags: only --case, --arm, --spec, --validate-only, and --promote are
 * repeatable (all occurrences used); duplicate non-repeatable flags are rejected.
 * Unknown commands exit 2 with
 * JSON on stderr; `help` (or no command) prints usage on stdout. Use
 * `help <command>` or `<command> --help` for command-specific JSON help.
 */

import {
  buildFeed,
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
  listProposals,
  nodeArtifacts,
  proposalFromOptimizeRun,
  listRuns,
  listSkills,
  listWorkflows,
  runDetail,
  skillDetail,
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
  return values?.[values.length - 1]; // callers validate repeatability before scalar access
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

function safeSegmentFlag(value: string, label: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(value) || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new HttpError(400, `invalid ${label}`);
  }
  return value;
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
    "feed [--project <id>] — run/eval/playground feed plus skill scorecard",
    "run-show <runId> [--project <id>] — node detail, outputs, pool captures",
    "workflows [--project <id>] — workflow .tsx files",
    "workflow-graph <path> [--project <id>] — DAG projection {nodes, edges}",
    'workflow-generate --prompt "..." [--id <name>] [--model <agent>] [--project <id>] — pool authors a workflow (verified)',
    "workflow-run <path> [--input '<json>'] [--project <id>] — start a run, returns runId immediately",
    "skills — skills catalog (frontmatter, validators, eval case counts)",
    "skill-detail <name> — skill detail, eval cases, workflow usage, and recent node evals",
    "proposals --skill <name> — improvement queue proposals and pending suggestion runs for a skill",
    'skill-generate --name <name> --prompt "..." [--model <agent>] — pool authors a skill, gated by check_skill_structure.py',
    "onboard --source <dir> [--out-dir <dir>] — triage foreign skill dirs into runs/onboard/ without LM or pool",
    "eval-case-generate --skill <name> [--n N|--spec '...'] — generate, validate, or promote quarantined eval cases via harness/generate/gen_eval_cases.py",
    "eval-suites — suites + cases from evals/suites/*.json",
    "eval-run --suite evals/suites/<s>.json [--case <id>]... [--arm <arm>]... — launch harness run",
    "eval-runs — harness processes + per-arm results from runs/<suite>/<case>/<arm>/",
    "optimize-skill <skill>|--skill <name> [--suite <path>] [--max-metric-calls N] [--reflection-lm <id>] [--arm <arm>]... [--smoke|--baseline-only] — launch detached GEPA SKILL.md optimization (harness/optimize/gepa_skill.py)",
    "optimize-runs — optimization processes + result.json summaries from runs/optimize/",
    "optimize-propose <skill>|--skill <name> [--run-dir <dir>] — fold a finished GEPA run into the improvement queue (accept = version bump + checks + re-eval)",
    "node-evals [--project <id>] — node-level eval records (in-workflow + standalone)",
    "node-artifacts --run-id <runId> --node-id <nodeId> [--project <id>] — prompt, artifacts, grade, and gold reference for a run node",
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
    name: "feed",
    category: "workflow",
    summary: "List the read-side feed plus skill scorecard.",
    usage: "bun ui/bench.ts feed [--project <id>]",
    output: "{ scorecard, records }",
    flags: [{ name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." }],
    mirrors: ["GET /api/feed"],
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
    name: "skill-detail",
    category: "skills",
    summary: "Show skill detail, eval cases, workflow usage, and recent node evals.",
    usage: "bun ui/bench.ts skill-detail <name>",
    output: "SkillDetail",
    positional: [{ name: "name", description: "Skill directory/frontmatter name." }],
    flags: [{ name: "--skill", value: "name", description: "Skill directory/frontmatter name; overrides positional name." }],
    mirrors: ["GET /api/skill-detail"],
  },
  {
    name: "proposals",
    category: "skills",
    summary: "List improvement queue proposals and pending suggestion runs for a skill.",
    usage: "bun ui/bench.ts proposals --skill <name>",
    output: "{ proposals, pending }",
    flags: [{ name: "--skill", value: "name", description: "Skill directory name. Required." }],
    mirrors: ["GET /api/proposals"],
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
    name: "onboard",
    category: "skills",
    summary: "Triage foreign skill directories without LM or pool.",
    usage: "bun ui/bench.ts onboard --source <dir> [--out-dir <dir>]",
    output: "bench-onboard.v1",
    flags: [
      { name: "--source", value: "dir", description: "Skill dir or directory containing skill dirs. Required." },
      { name: "--out-dir", value: "dir", description: "Report directory under runs/onboard/." },
    ],
    notes: [
      "This is a JSON-normalizing wrapper around `uv run harness/onboard/triage.py --json`.",
      "Triage never synthesizes validators or eval cases; generated material belongs in later quarantined phases.",
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
      { name: "--bootstrap", description: "Allow generation for a skill with zero existing cases; no LM-free promotion." },
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
    summary: "Launch a detached harness run, or run the safe robot dry-run path.",
    usage: "bun ui/bench.ts eval-run --suite evals/suites/<s>.json [--case <id>]... [--arm <arm>]... [--robot-dry-run|--dry-run --json-summary] [--replay]",
    output: "StartEvalRunResult or eval-dry-run-summary.v1",
    flags: [
      { name: "--suite", value: "path", description: "Repo-relative suite path. Required." },
      { name: "--case", value: "id", repeatable: true, description: "Case id filter. Repeatable." },
      { name: "--arm", value: "arm", repeatable: true, description: "Harness arm filter. Repeatable." },
      { name: "--robot-dry-run", description: "Safe alias for --dry-run --json-summary; does not launch a detached harness." },
      { name: "--dry-run", description: "With --json-summary, run the safe machine-readable dry-run path." },
      { name: "--json-summary", description: "With --dry-run, emit eval-dry-run-summary.v1 JSON." },
      { name: "--replay", description: "With a dry-run path, replay validators against expected artifacts." },
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
    usage: "bun ui/bench.ts optimize-skill <skill>|--skill <name> [--suite <path>] [--max-metric-calls N] [--reflection-lm <id>] [--arm <arm>]... [--smoke|--baseline-only]",
    output: "StartOptimizeRunResult",
    positional: [{ name: "skill", description: "Skill directory name; alternative to --skill." }],
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
    usage: "bun ui/bench.ts optimize-propose <skill>|--skill <name> [--run-dir <dir>]",
    output: "OptimizeProposal",
    positional: [{ name: "skill", description: "Skill directory name; alternative to --skill." }],
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
    name: "node-artifacts",
    category: "node evals",
    summary: "Show prompt, artifacts, grade, and gold reference for a workflow run node.",
    usage: "bun ui/bench.ts node-artifacts --run-id <runId> --node-id <nodeId> [--project <id>]",
    output: "NodeArtifacts",
    flags: [
      { name: "--run-id", value: "runId", description: "Workflow run id. Required." },
      { name: "--node-id", value: "nodeId", description: "Workflow node id. Required." },
      { name: "--project", value: "id", description: "Smithers project id; defaults to the primary project." },
    ],
    mirrors: ["GET /api/node-artifacts"],
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
const BESPOKE_ARG_COMMANDS = new Set(["onboard", "eval-case-generate"]);
const GLOBAL_FLAGS = new Set(["help"]);

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

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
  }
  return previous[b.length];
}

function didYouMean(value: string, candidates: string[]): string | undefined {
  const normalized = value.toLowerCase();
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(normalized, candidate.toLowerCase());
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  if (!best) return undefined;
  return best.distance <= 3 || best.candidate.toLowerCase().startsWith(normalized) ? best.candidate : undefined;
}

function unknownFlagError(commandName: string, key: string, allowedFlags: Iterable<string>, usage: string): HttpError {
  const suggestion = didYouMean(`--${key}`, [...allowedFlags].map((flagName) => `--${flagName}`));
  const hint = suggestion ? ` Did you mean ${suggestion}?` : "";
  return new HttpError(400, `Unknown flag for ${commandName}: --${key}.${hint} Usage: ${usage}`);
}

function validateArgsForCommand(commandName: string, args: Flags): void {
  if (BESPOKE_ARG_COMMANDS.has(commandName)) return;
  const command = COMMAND_BY_NAME.get(commandName);
  if (!command) return;

  const flagDefinitions = new Map((command.flags ?? []).map((f) => [f.name.replace(/^--/, ""), f]));
  const allowedFlags = new Set([...flagDefinitions.keys(), ...GLOBAL_FLAGS]);
  for (const key of Object.keys(args.flags)) {
    if (!allowedFlags.has(key)) {
      throw unknownFlagError(commandName, key, allowedFlags, command.usage);
    }
  }

  for (const [key, values] of Object.entries(args.flags)) {
    if (GLOBAL_FLAGS.has(key)) continue;
    const definition = flagDefinitions.get(key);
    if (!definition) continue;
    if (!definition.repeatable && values.length > 1) {
      throw new HttpError(400, `Duplicate flag for ${commandName}: --${key}. ${definition.name} is not repeatable. Usage: ${command.usage}`);
    }
    if (definition.value && values.some((value) => value === "true")) {
      throw new HttpError(400, `${definition.name} requires a value. Usage: ${command.usage}`);
    }
    if (!definition.value && values.some((value) => value !== "true")) {
      throw new HttpError(400, `${definition.name} does not take a value. Usage: ${command.usage}`);
    }
  }

  const maxPositionals = command.positional?.length ?? 0;
  if (args.positional.length > maxPositionals) {
    throw new HttpError(400, `Unexpected positional argument(s): ${args.positional.slice(maxPositionals).join(", ")}. Usage: ${command.usage}`);
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
      flag_precedence: "Non-repeatable duplicate flags are rejected.",
      strict_flags: true,
      intent_hints: "Unknown commands and flags include did-you-mean hints when a close match exists.",
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
      flag_precedence: "Non-repeatable duplicate flags are rejected.",
      strict_flags: true,
      intent_hints: "Unknown commands and flags include did-you-mean hints when a close match exists.",
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
      "bun ui/bench.ts help onboard",
      "bun ui/bench.ts help eval-run",
      "bun ui/bench.ts eval-run --suite evals/suites/smoke.json --robot-dry-run",
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

const ONBOARD_FLAGS = new Set(["source", "out-dir"]);
const ONBOARD_REPEATABLE_FLAGS = new Set<string>();

function parseOnboardArgs(argv: string[]): Flags {
  const out: Flags = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out.positional.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const usage = COMMAND_BY_NAME.get("onboard")?.usage ?? "bun ui/bench.ts onboard --source <dir> [--out-dir <dir>]";
    if (!ONBOARD_FLAGS.has(key)) {
      throw unknownFlagError("onboard", key, ONBOARD_FLAGS, usage);
    }
    if (!ONBOARD_REPEATABLE_FLAGS.has(key) && (out.flags[key]?.length ?? 0) > 0) {
      throw new HttpError(400, `Duplicate flag for onboard: --${key}. --${key} is not repeatable. Usage: ${usage}`);
    }
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : undefined;
    if (value === undefined) {
      throw new HttpError(400, `--${key} requires a value`);
    }
    (out.flags[key] ??= []).push(value);
  }
  return out;
}

function runOnboard(rawArgv: string[]): unknown {
  const args = parseOnboardArgs(rawArgv);
  const source = flag(args, "source");
  if (!source) throw new HttpError(400, "usage: onboard --source <dir> [--out-dir <dir>]");
  if (args.positional.length > 0) {
    throw new HttpError(400, `Unexpected positional argument(s): ${args.positional.join(", ")}`);
  }

  const argv = ["uv", "run", "harness/onboard/triage.py", "--source", source, "--json"];
  pushOptional(argv, "--out-dir", flag(args, "out-dir"));

  const result = Bun.spawnSync({
    cmd: argv,
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = decode(result.stdout).trim();
  const stderr = decode(result.stderr).trim();
  const stdoutJson = parseJsonDocuments(stdout);
  const exitCode = result.exitCode ?? 1;
  const payload = {
    schema_version: "bench-onboard.v1",
    ok: exitCode === 0,
    mode: "triage",
    command: argv,
    exit_code: exitCode,
    stdout_json: stdoutJson.length === 1 ? stdoutJson[0] : stdoutJson,
    stdout_text: stdoutJson.length === 0 && stdout ? stdout : null,
    stderr_text: stderr || null,
  };
  if (exitCode !== 0) throw new BenchCommandError(`onboard failed with exit ${exitCode}`, payload);
  return payload;
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
  "bootstrap",
  "seed-example",
  "validator-timeout",
  "out-dir",
  "validate-only",
  "promote",
]);
const EVAL_CASE_GENERATE_REPEATABLE_FLAGS = new Set(["spec", "validate-only", "promote"]);

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
      const usage = COMMAND_BY_NAME.get("eval-case-generate")?.usage ?? "bun ui/bench.ts eval-case-generate --skill <name>";
      throw unknownFlagError("eval-case-generate", key, EVAL_CASE_GENERATE_FLAGS, usage);
    }
    if (!EVAL_CASE_GENERATE_REPEATABLE_FLAGS.has(key) && (out.flags[key]?.length ?? 0) > 0) {
      const usage = COMMAND_BY_NAME.get("eval-case-generate")?.usage ?? "bun ui/bench.ts eval-case-generate --skill <name>";
      throw new HttpError(400, `Duplicate flag for eval-case-generate: --${key}. --${key} is not repeatable. Usage: ${usage}`);
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

    if (key === "bootstrap") {
      (out.flags[key] ??= []).push("true");
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
  if (flag(args, "bootstrap") === "true") argv.push("--bootstrap");
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

function runEvalRunRobot(args: Flags): unknown {
  const suite = flag(args, "suite");
  if (!suite) throw new HttpError(400, "--suite is required");

  const argv = ["uv", "run", "harness/runner/run_eval.py", "--suite", suite, "--dry-run", "--json-summary"];
  for (const c of args.flags["case"] ?? []) argv.push("--case", c);
  for (const a of args.flags["arm"] ?? []) argv.push("--arm", a);
  if (flag(args, "replay") === "true") argv.push("--replay");

  const result = Bun.spawnSync({
    cmd: argv,
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = decode(result.stdout).trim();
  const stderr = decode(result.stderr).trim();
  const exitCode = result.exitCode ?? 1;
  let stdoutJson: unknown = null;
  if (stdout) {
    try {
      stdoutJson = JSON.parse(stdout);
    } catch {
      stdoutJson = null;
    }
  }
  const payload = {
    schema_version: "bench-eval-run.v1",
    ok: exitCode === 0,
    mode: "robot-dry-run",
    command: argv,
    exit_code: exitCode,
    stdout_json: stdoutJson,
    stdout_text: stdoutJson === null && stdout ? stdout : null,
    stderr_text: stderr || null,
  };
  if (exitCode !== 0) {
    throw new BenchCommandError(`eval-run robot dry-run failed with exit ${exitCode}`, payload);
  }
  return stdoutJson ?? payload;
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
  if (command) validateArgsForCommand(command, args);

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
    case "feed":
      return emit(buildFeed(project()));
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
    case "skill-detail": {
      const skill = flag(args, "skill") ?? args.positional[0];
      if (!skill) throw new HttpError(400, "usage: skill-detail <name>");
      return emit(skillDetail(skill));
    }
    case "proposals": {
      const skill = flag(args, "skill");
      if (!skill) throw new HttpError(400, "usage: proposals --skill <name>");
      return emit(listProposals(skill));
    }
    case "skill-generate": {
      const name = flag(args, "name");
      const prompt = flag(args, "prompt");
      if (!name || !prompt) throw new HttpError(400, "--name and --prompt are required");
      return emit(await generateSkill(name, prompt, { agentName: flag(args, "model") }));
    }
    case "onboard":
      return emit(runOnboard(rest));
    case "eval-case-generate":
      return emit(runEvalCaseGenerate(rest));
    case "eval-suites":
      return emit(listEvalSuites());
    case "eval-run": {
      const suite = flag(args, "suite");
      if (!suite) throw new HttpError(400, "--suite is required");
      const wantsRobotDryRun =
        flag(args, "robot-dry-run") === "true" || flag(args, "dry-run") === "true" || flag(args, "json-summary") === "true" || flag(args, "replay") === "true";
      if (wantsRobotDryRun) {
        if (flag(args, "json-summary") === "true" && flag(args, "dry-run") !== "true" && flag(args, "robot-dry-run") !== "true") {
          throw new HttpError(400, "--json-summary requires --dry-run or --robot-dry-run. Try: bun ui/bench.ts eval-run --suite <suite> --robot-dry-run");
        }
        if (flag(args, "replay") === "true" && flag(args, "dry-run") !== "true" && flag(args, "robot-dry-run") !== "true") {
          throw new HttpError(400, "--replay requires --dry-run or --robot-dry-run. Try: bun ui/bench.ts eval-run --suite <suite> --robot-dry-run --replay");
        }
        return emit(runEvalRunRobot(args));
      }
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
      if (!skill) throw new HttpError(400, "usage: optimize-skill <skill>|--skill <name>");
      const maxMetricCalls = flag(args, "max-metric-calls");
      const smoke = flag(args, "smoke") === "true";
      const baselineOnly = flag(args, "baseline-only") === "true";
      if (smoke && baselineOnly) throw new HttpError(400, "--smoke and --baseline-only are mutually exclusive");
      return emit(
        startOptimizeRun({
          skill,
          suite: flag(args, "suite"),
          maxMetricCalls: positiveIntegerFlag(maxMetricCalls, "--max-metric-calls"),
          reflectionLm: flag(args, "reflection-lm"),
          arms: args.flags["arm"],
          smoke,
          baselineOnly,
        }),
      );
    }
    case "optimize-runs":
      return emit(listOptimizeRuns());
    case "optimize-propose": {
      const skill = flag(args, "skill") ?? args.positional[0];
      if (!skill) throw new HttpError(400, "usage: optimize-propose <skill>|--skill <name> [--run-dir <dir>]");
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
    case "node-artifacts": {
      const runId = flag(args, "run-id");
      const nodeId = flag(args, "node-id");
      if (!runId || !nodeId) {
        throw new HttpError(400, "usage: node-artifacts --run-id <runId> --node-id <nodeId>");
      }
      const safeRunId = safeSegmentFlag(runId, "runId");
      const safeNodeId = safeSegmentFlag(nodeId, "nodeId");
      return emit(nodeArtifacts(project(), safeRunId, safeNodeId));
    }
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
      console.error(JSON.stringify({ error: `Unknown command: ${command}`, did_you_mean: didYouMean(command, COMMAND_DETAILS.map((cmd) => cmd.name)), ...USAGE }));
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
      const unknown = error.message.replace(/^Unknown command: /, "");
      console.error(JSON.stringify({ error: error.message, did_you_mean: didYouMean(unknown, COMMAND_DETAILS.map((cmd) => cmd.name)), ...USAGE }));
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
