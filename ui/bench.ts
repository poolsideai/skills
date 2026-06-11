#!/usr/bin/env bun
/**
 * bench — agent-facing CLI over the workbench substrate (ui/lib.ts).
 * Everything the web UI can do, scriptable from natural language by any
 * agent that can run shell commands. All output is JSON on stdout; errors
 * are JSON on stderr with a non-zero exit code. No server needed.
 *
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
 *   bun ui/bench.ts eval-suites
 *   bun ui/bench.ts eval-run --suite <path> [--case <id>]... [--arm <arm>]...
 *   bun ui/bench.ts eval-runs
 *   bun ui/bench.ts node-evals [--project <id>]
 *   bun ui/bench.ts node-eval-insitu <runId> [--project <id>]
 *   bun ui/bench.ts node-eval-run <workflowPath> --node <id> [--trials N] [--model <agent>]
 *
 * Flags: only --case and --arm are repeatable (all occurrences used); for
 * every other flag the LAST occurrence wins. Unknown commands exit 2 with
 * JSON on stderr; `help` (or no command) prints usage on stdout.
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
  listRuns,
  listSkills,
  listWorkflows,
  runDetail,
  skillEvalSummaries,
  startEvalRun,
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

function emit(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const USAGE = {
  usage: "bun ui/bench.ts <command>",
  commands: [
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
    "eval-suites — suites + cases from evals/suites/*.json",
    "eval-run --suite evals/suites/<s>.json [--case <id>]... [--arm <arm>]... — launch harness run",
    "eval-runs — harness processes + per-arm results from runs/<suite>/<case>/<arm>/",
    "node-evals [--project <id>] — node-level eval records (in-workflow + standalone)",
    "node-eval-insitu <runId> [--project <id>] — grade every node of a finished run via its skill validator",
    "node-eval-run <workflowPath> --node <id> [--trials N] [--model <agent>] [--project <id>] — re-run a node standalone and grade each trial",
    "review-sync [--project <id>] — fold workflow node captures + node evals into runs/review/traces.json for the annotation app",
  ],
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const project = () => getProject(flag(args, "project") ?? null);

  switch (command) {
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
    case undefined:
    case "help":
      return emit(USAGE);
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
          trials: flag(args, "trials") ? Number(flag(args, "trials")) : undefined,
          agentName: flag(args, "model"),
        }),
      );
    }
    default:
      // Unknown command is an ERROR: stderr + exit 2, so agent typos
      // (run vs workflow-run) never read as success. `help` / no command
      // gets USAGE on stdout with exit 0.
      console.error(JSON.stringify({ error: `unknown command: ${command}`, ...USAGE }));
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
    const status = error instanceof HttpError ? error.status : 500;
    console.error(JSON.stringify({ error: error.message ?? String(error), status }));
    process.exit(1);
  });
