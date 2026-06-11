/**
 * Example Smithers workflow whose Tasks are executed by `pool exec` via
 * PoolAgent. Shape: one intro node, then a 2→1 fan-out/fan-in. The repo_map
 * node has the repo-map skill installed in its working dir; the others don't.
 *
 * Run (after `bun scripts/setup.ts`):
 *   ./node_modules/.bin/smithers up example.workflow.tsx --format json
 */

import { join } from "node:path";
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod";
import { PoolAgent } from "./src/PoolAgent.ts";

const ROOT = import.meta.dir;
const WORK = join(ROOT, "work");
const RUNS = join(ROOT, "runs");
// This experiment lives at <skills-repo>/experiments/smithers-pool/.
const SKILLS_REPO = join(ROOT, "..", "..");

const greet = z.object({
  message: z.string().describe("The greeting line written to hello.txt"),
  file: z.string().describe("Name of the file that was written"),
});
const repo_map = z.object({
  summary: z.string().describe("One-sentence description of the repository"),
  artifact: z.string().describe("Relative path of the JSON repo map that was written"),
  used_skill: z.boolean().describe("Whether the repo-map skill was loaded via the skill tool"),
});
const dep_scan = z.object({
  name: z.string().describe("Package name from package.json"),
  dependency_count: z.number().describe("Number of runtime dependencies"),
  dependencies: z.array(z.string()).describe("Sorted runtime dependency names"),
});
const combine = z.object({
  headline: z.string().describe("One-line summary of the combined report"),
  report_file: z.string().describe("Name of the markdown report written"),
  sources: z.number().describe("How many upstream analyses were combined"),
});

const { Workflow, Task, Sequence, Parallel, smithers, outputs } = createSmithers(
  { greet, repo_map, dep_scan, combine },
  { dbPath: ".smithers/smithers.db" },
);

const greetAgent = new PoolAgent({
  cwd: join(WORK, "greet"),
  logDir: RUNS,
  id: "pool:greet",
});
const repoMapAgent = new PoolAgent({
  cwd: join(WORK, "repo-fixture"),
  logDir: RUNS,
  id: "pool:repo-map",
  skill: { name: "repo-map", from: join(SKILLS_REPO, "skills", "repo-map") },
});
const depScanAgent = new PoolAgent({
  cwd: join(WORK, "dep-scan"),
  logDir: RUNS,
  id: "pool:dep-scan",
});
const combineAgent = new PoolAgent({
  cwd: join(WORK, "combine"),
  logDir: RUNS,
  id: "pool:combine",
});

export default smithers((ctx) => {
  // Render-time reads of upstream rows. Undefined until those nodes finish;
  // Smithers re-renders the tree from SQLite every loop, so by the time the
  // combine node is runnable these are the real rows. Using ctx.latest()
  // instead of a deps={} function child keeps the node visible to static
  // `smithers graph` projection (a deps function child is omitted there).
  const repoMapRow = ctx.latest(outputs.repo_map, "repo_map");
  const depScanRow = ctx.latest(outputs.dep_scan, "dep_scan");

  return (
  <Workflow name="pool-spike">
    <Sequence>
      <Task
        id="greet"
        label="Pool says hello"
        output={outputs.greet}
        agent={greetAgent}
        timeoutMs={240_000}
        retries={1}
      >
        {`You are a workflow node executed by the pool CLI inside a Smithers run.
Create a file named hello.txt in the current working directory containing a
single friendly line introducing this Smithers x pool spike. Then report:
message = the exact line you wrote, file = "hello.txt".`}
      </Task>

      <Parallel>
        <Task
          id="repo_map"
          label="Map fixture repo (repo-map skill)"
          output={outputs.repo_map}
          agent={repoMapAgent}
          timeoutMs={600_000}
          retries={1}
        >
          {`Orient in the unfamiliar repository at the current working directory.
A skill named repo-map is installed for this workspace: load it with the skill
tool and follow it to produce the evidence-backed repo map at
.laguna/repo-map.json. Then report: summary = one sentence describing this
repository, artifact = the relative path of the JSON map you wrote,
used_skill = true if you loaded the repo-map skill via the skill tool.`}
        </Task>
        <Task
          id="dep_scan"
          label="Scan dependencies (no skill)"
          output={outputs.dep_scan}
          agent={depScanAgent}
          timeoutMs={300_000}
          retries={1}
        >
          {`Read package.json in the current working directory. Do not modify any
files. Report: name = the package name, dependency_count = the number of
entries under "dependencies", dependencies = the dependency names sorted
alphabetically.`}
        </Task>
      </Parallel>

      <Task
        id="combine"
        label="Combine fan-out results"
        output={outputs.combine}
        agent={combineAgent}
        dependsOn={["repo_map", "dep_scan"]}
        timeoutMs={300_000}
        retries={1}
      >
        {`Two analyses of two different fixture projects ran in parallel before
this step. Their structured results are below as JSON.

Repo map analysis:
${JSON.stringify(repoMapRow ?? "(pending)", null, 2)}

Dependency scan analysis:
${JSON.stringify(depScanRow ?? "(pending)", null, 2)}

Write report.md in the current working directory with a short section for each
analysis (what was analyzed, key findings). Then report: headline = one line
summarizing both analyses, report_file = "report.md", sources = 2.`}
      </Task>
    </Sequence>
  </Workflow>
  );
});
