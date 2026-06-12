/**
 * Workbench substrate: one library behind every surface (HTTP server, agent
 * CLI, future MCP). Knows how to:
 *   - discover Smithers workflow projects and list their runs as
 *     TrajectoryRecords (nodes → attempts → outputs → pool captures)
 *   - project workflow graphs, author workflows via pool, start runs
 *   - read the skills catalog and author new skills via pool (validated by
 *     scripts/check_skill_structure.py before they land in skills/)
 *   - list eval suites/cases, launch harness runs
 *     (harness/runner/run_eval.py), and report live status from the
 *     runs/<suite>/<case>/<arm>/ output tree
 *
 * Model selection: every authoring call takes an optional pool agent name
 * (`pool agents list`), so workflows/skills can be written by laguna-m.1,
 * anthropic/claude-opus-4.8, or anything else the tenant exposes.
 */

import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, normalize, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "..");

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function runCommand(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  options: { scrubEnv?: boolean } = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  // scrubEnv: minimal environment for sinks that execute MODEL-GENERATED
  // code (skill validators, smithers graph module imports) so generated code
  // doesn't inherit API tokens. Defense-in-depth, not a sandbox — see
  // ui/README.md security note.
  const env = options.scrubEnv
    ? {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "/tmp",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        LANG: process.env.LANG ?? "en_US.UTF-8",
      }
    : process.env;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new HttpError(504, `command timed out after ${timeoutMs}ms: ${argv.join(" ")}`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      rejectPromise(new HttpError(500, `spawn failed: ${e.message}`));
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

// ===========================================================================
// Projects

export type Project = {
  id: string;
  name: string;
  root: string;
  smithersBin: string | null;
  hasDb: boolean;
};

export function discoverProjects(): Project[] {
  const candidates = new Set<string>();
  const scanRoots = [REPO_ROOT, join(REPO_ROOT, "experiments")];
  for (const scanRoot of scanRoots) {
    if (!existsSync(scanRoot)) continue;
    for (const entry of readdirSync(scanRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const dir = join(scanRoot, entry.name);
      if (existsSync(join(dir, ".smithers"))) candidates.add(dir);
    }
  }
  if (existsSync(join(REPO_ROOT, ".smithers"))) candidates.add(REPO_ROOT);
  return [...candidates].sort().map((root) => {
    const bin = join(root, "node_modules", ".bin", "smithers");
    return {
      id: root === REPO_ROOT ? "." : root.slice(REPO_ROOT.length + 1),
      name: basename(root),
      root,
      smithersBin: existsSync(bin) ? bin : null,
      hasDb: existsSync(join(root, ".smithers", "smithers.db")),
    };
  });
}

export function getProject(id: string | null | undefined): Project {
  const projects = discoverProjects();
  if (!projects.length) throw new HttpError(404, "no Smithers projects found in this repo");
  if (id == null || id === "") return projects[0];
  const project = projects.find((p) => p.id === id);
  if (!project) {
    throw new HttpError(
      404,
      `unknown project: ${id} (available: ${projects.map((p) => p.id).join(", ")})`,
    );
  }
  return project;
}

// ===========================================================================
// Workflow runs → TrajectoryRecords

export type TrajectoryRecord = {
  kind: "workflow-run";
  id: string;
  project: string;
  title: string;
  workflowPath: string | null;
  status: string;
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  nodeCount: number;
  nodesFinished: number;
  error: string | null;
};

function openDb(project: Project): Database {
  const path = join(project.root, ".smithers", "smithers.db");
  if (!existsSync(path)) throw new HttpError(404, `no smithers.db in ${project.id}`);
  return new Database(path, { readonly: true });
}

function errorMessage(errorJson: unknown): string | null {
  if (typeof errorJson !== "string" || !errorJson) return null;
  try {
    const parsed = JSON.parse(errorJson);
    return String(parsed.message ?? errorJson);
  } catch {
    return errorJson;
  }
}

export function listRuns(project: Project): TrajectoryRecord[] {
  if (!project.hasDb) return [];
  const db = openDb(project);
  try {
    const rows = db
      .query(
        `select run_id, workflow_name, workflow_path, status, created_at_ms,
                started_at_ms, finished_at_ms, error_json
         from _smithers_runs order by created_at_ms desc`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((row) => {
      const nodes = db
        .query(`select state from _smithers_nodes where run_id = ?`)
        .all(String(row.run_id)) as { state: string }[];
      return {
        kind: "workflow-run" as const,
        id: String(row.run_id),
        project: project.id,
        title: String(row.workflow_name ?? "workflow"),
        workflowPath: (row.workflow_path as string | null) ?? null,
        status: String(row.status),
        createdAtMs: Number(row.created_at_ms),
        startedAtMs: row.started_at_ms == null ? null : Number(row.started_at_ms),
        finishedAtMs: row.finished_at_ms == null ? null : Number(row.finished_at_ms),
        nodeCount: nodes.length,
        nodesFinished: nodes.filter((n) => n.state === "finished").length,
        error: errorMessage(row.error_json),
      };
    });
  } finally {
    db.close();
  }
}

export type PoolCapture = {
  dir: string;
  cwd: string | null;
  exitCode: number | null;
  durationMs: number | null;
  trajectoryUrl: string | null;
  skillInstalled: string | null;
  skillToolCalls: number;
  toolCallCount: number;
  mtimeMs: number;
  matchedNodeId: string | null;
};

export function listCaptures(project: Project): PoolCapture[] {
  const runsDir = join(project.root, "runs");
  if (!existsSync(runsDir)) return [];
  const captures: PoolCapture[] = [];
  for (const entry of readdirSync(runsDir).sort()) {
    const metaPath = join(runsDir, entry, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      captures.push({
        dir: `runs/${entry}`,
        cwd: meta.cwd ?? null,
        exitCode: meta.exitCode ?? null,
        durationMs: meta.durationMs ?? null,
        trajectoryUrl: meta.trajectoryUrl ?? null,
        skillInstalled: meta.skillInstalled ?? null,
        skillToolCalls: meta.skillToolCalls ?? 0,
        toolCallCount: Array.isArray(meta.toolCalls) ? meta.toolCalls.length : 0,
        mtimeMs: statSync(metaPath).mtimeMs,
        matchedNodeId: null,
      });
    } catch {
      // unreadable capture; skip
    }
  }
  return captures;
}

export function runDetail(project: Project, runId: string) {
  const db = openDb(project);
  try {
    const run = db
      .query(`select * from _smithers_runs where run_id = ?`)
      .get(runId) as Record<string, unknown> | null;
    if (!run) throw new HttpError(404, `run ${runId} not found in ${project.id}`);

    const nodes = db
      .query(
        `select node_id, iteration, state, last_attempt, output_table, label
         from _smithers_nodes where run_id = ? order by rowid`,
      )
      .all(runId) as Record<string, unknown>[];

    const nodeDetails = nodes.map((node) => {
      const attempts = db
        .query(
          `select attempt, state, started_at_ms, finished_at_ms, error_json, response_text
           from _smithers_attempts where run_id = ? and node_id = ? order by attempt`,
        )
        .all(runId, String(node.node_id)) as Record<string, unknown>[];
      const table = String(node.output_table ?? "");
      let output: Record<string, unknown> | null = null;
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
        try {
          output = (db
            .query(
              `select * from "${table}" where run_id = ? and node_id = ? order by iteration desc limit 1`,
            )
            .get(runId, String(node.node_id)) ?? null) as Record<string, unknown> | null;
        } catch {
          output = null;
        }
      }
      const first = attempts[0];
      const last = attempts[attempts.length - 1];
      return {
        nodeId: String(node.node_id),
        label: (node.label as string | null) ?? String(node.node_id),
        state: String(node.state),
        attempts: attempts.map((a) => ({
          attempt: Number(a.attempt),
          state: String(a.state),
          startedAtMs: a.started_at_ms == null ? null : Number(a.started_at_ms),
          finishedAtMs: a.finished_at_ms == null ? null : Number(a.finished_at_ms),
          error: errorMessage(a.error_json),
          responseText: typeof a.response_text === "string" ? a.response_text : null,
        })),
        startedAtMs: first?.started_at_ms == null ? null : Number(first.started_at_ms),
        finishedAtMs: last?.finished_at_ms == null ? null : Number(last.finished_at_ms),
        output,
      };
    });

    // Match pool captures to nodes: the capture's meta.json is written the
    // moment the pool call ends, so among attempts whose [start, finish]
    // window contains the mtime, the attempt whose FINISH is closest owns the
    // call (parallel nodes and schema retries make windows overlap, but a
    // node's own finish always trails its last pool call by milliseconds).
    const runStartMs = run.started_at_ms == null ? Number(run.created_at_ms) : Number(run.started_at_ms);
    const runEndMs = run.finished_at_ms == null ? Date.now() : Number(run.finished_at_ms);
    const captures = listCaptures(project).filter(
      (c) => c.mtimeMs >= runStartMs - 5_000 && c.mtimeMs <= runEndMs + 5_000,
    );
    for (const capture of captures) {
      let bestDistance = Infinity;
      for (const node of nodeDetails) {
        for (const attempt of node.attempts) {
          if (attempt.startedAtMs == null) continue;
          const finish = attempt.finishedAtMs ?? Date.now();
          if (capture.mtimeMs < attempt.startedAtMs - 250 || capture.mtimeMs > finish + 2_000) {
            continue;
          }
          const distance = Math.abs(finish - capture.mtimeMs);
          if (distance < bestDistance) {
            bestDistance = distance;
            capture.matchedNodeId = node.nodeId;
          }
        }
      }
    }

    const agentEvents = db
      .query(
        `select count(*) as n from _smithers_events where run_id = ? and type = 'AgentEvent'`,
      )
      .get(runId) as { n: number };

    return {
      run: {
        kind: "workflow-run" as const,
        id: runId,
        project: project.id,
        title: String(run.workflow_name ?? "workflow"),
        workflowPath: (run.workflow_path as string | null) ?? null,
        status: String(run.status),
        createdAtMs: Number(run.created_at_ms),
        startedAtMs: run.started_at_ms == null ? null : Number(run.started_at_ms),
        finishedAtMs: run.finished_at_ms == null ? null : Number(run.finished_at_ms),
        error: errorMessage(run.error_json),
      },
      nodes: nodeDetails,
      agentEventCount: agentEvents?.n ?? 0,
      captures,
    };
  } finally {
    db.close();
  }
}

// ===========================================================================
// Models (pool agents)

let modelsCache: { at: number; names: string[] } | null = null;

export async function listModels(): Promise<string[]> {
  if (modelsCache && Date.now() - modelsCache.at < 60_000) return modelsCache.names;
  const result = await runCommand(["pool", "agents", "list"], REPO_ROOT, 30_000);
  if (result.exitCode !== 0) {
    throw new HttpError(500, `pool agents list failed: ${result.stderr.slice(0, 400)}`);
  }
  const names = result.stdout
    .split("\n")
    .map((l) => l.trim().replace(/ \(default\)$/, ""))
    .filter(Boolean);
  // Surface the relevant families first: laguna, then anthropic, then the rest.
  const rank = (n: string) => (n.startsWith("laguna") ? 0 : n.startsWith("anthropic/") ? 1 : 2);
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  modelsCache = { at: Date.now(), names };
  return names;
}

export const DEFAULT_AGENT = "laguna-m.1";

// ===========================================================================
// Workflows

export function listWorkflows(project: Project): { path: string; name: string }[] {
  const found: { path: string; name: string }[] = [];
  const wfDir = join(project.root, ".smithers", "workflows");
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir).sort()) {
      if (f.endsWith(".tsx"))
        found.push({ path: `.smithers/workflows/${f}`, name: f.replace(/\.tsx$/, "") });
    }
  }
  for (const f of readdirSync(project.root).sort()) {
    if (f.endsWith(".workflow.tsx"))
      found.push({ path: f, name: f.replace(/\.workflow\.tsx$/, "") });
  }
  return found;
}

export function safeWorkflowPath(project: Project, relPath: string): string {
  const normalizedRel = normalize(relPath).replace(/^\.\/+/, "");
  const workflowShape = /^(?:\.smithers\/workflows\/[^/]+\.tsx|[^/]+\.workflow\.tsx)$/;
  if (!workflowShape.test(normalizedRel)) {
    throw new HttpError(400, "workflow path must be .smithers/workflows/*.tsx or a root *.workflow.tsx file");
  }
  const abs = resolve(project.root, normalizedRel);
  if (!abs.startsWith(project.root + "/")) throw new HttpError(400, "workflow path escapes project");
  return abs;
}

export type GraphNode = { id: string; label: string; kind: "task" | "control"; prompt?: string };
export type GraphEdge = { from: string; to: string };
type XmlNode = {
  kind: "element" | "text";
  tag?: string;
  props?: Record<string, string>;
  children?: XmlNode[];
  text?: string;
};

function projectGraph(xml: XmlNode): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let controlSeq = 0;

  function walk(el: XmlNode): { entries: string[]; exits: string[] } {
    if (el.kind !== "element") return { entries: [], exits: [] };
    const tag = (el.tag ?? "").replace(/^smithers:/, "");
    const children = (el.children ?? []).filter((c) => c.kind === "element");

    if (tag === "task" || tag === "approval" || tag === "humantask") {
      const id = el.props?.id ?? `task-${nodes.length}`;
      const promptText = (el.children ?? [])
        .filter((c) => c.kind === "text")
        .map((c) => c.text ?? "")
        .join("")
        .trim();
      nodes.push({ id, label: el.props?.label ?? id, kind: "task", prompt: promptText || undefined });
      return { entries: [id], exits: [id] };
    }

    if (tag === "parallel") {
      const results = children.map(walk).filter((r) => r.entries.length);
      return {
        entries: results.flatMap((r) => r.entries),
        exits: results.flatMap((r) => r.exits),
      };
    }

    if (tag === "workflow" || tag === "sequence" || tag === "") {
      let prevExits: string[] = [];
      let entries: string[] = [];
      for (const child of children) {
        const result = walk(child);
        if (!result.entries.length) continue;
        if (!entries.length) entries = result.entries;
        for (const from of prevExits) for (const to of result.entries) edges.push({ from, to });
        prevExits = result.exits;
      }
      return { entries, exits: prevExits };
    }

    const ctlId = `${tag}-${++controlSeq}`;
    nodes.push({ id: ctlId, label: tag, kind: "control" });
    let prevExits: string[] = [ctlId];
    for (const child of children) {
      const result = walk(child);
      if (!result.entries.length) continue;
      for (const from of prevExits) for (const to of result.entries) edges.push({ from, to });
      prevExits = result.exits;
    }
    return { entries: [ctlId], exits: prevExits };
  }

  walk(xml);
  return { nodes, edges };
}

export async function workflowGraph(project: Project, relPath: string) {
  if (!project.smithersBin) throw new HttpError(400, `${project.id} has no local smithers install`);
  safeWorkflowPath(project, relPath);
  const result = await runCommand(
    [project.smithersBin, "graph", relPath, "--format", "json"],
    project.root,
    60_000,
    { scrubEnv: true }, // graph imports the (possibly model-authored) module
  );
  if (result.exitCode !== 0) {
    throw new HttpError(500, `smithers graph failed: ${(result.stderr || result.stdout).slice(0, 800)}`);
  }
  const snapshot = JSON.parse(result.stdout) as { xml: XmlNode };
  return { path: relPath, ...projectGraph(snapshot.xml) };
}

// --- workflow authoring -----------------------------------------------------

async function poolGenerate(prompt: string, agentName: string, idTag: string): Promise<string> {
  const { PoolAgent } = await import(
    join(REPO_ROOT, "experiments", "smithers-pool", "src", "PoolAgent.ts")
  );
  const scratch = mkdtempSync(join(tmpdir(), "bench-author-"));
  const agent = new PoolAgent({ cwd: scratch, agentName, id: `pool:author:${idTag}` });
  const result = await agent.generate({ prompt });
  return result.text as string;
}

function extractFence(text: string): string | null {
  const matches = [...text.matchAll(/```(?:tsx|typescript|ts|markdown|md)?\s*\n([\s\S]*?)```/g)];
  if (!matches.length) return null;
  return matches.map((m) => m[1]).sort((a, b) => b.length - a.length)[0].trim() + "\n";
}

function workflowAuthoringPrompt(
  request: string,
  workflowId: string,
  skills: SkillSummary[],
  repair?: string,
): string {
  const template = readFileSync(
    join(REPO_ROOT, "experiments", "smithers-pool", "example.workflow.tsx"),
    "utf8",
  );
  const skillCatalog = skills.length
    ? [
        "Available Poolside skills (install one into a node's workspace with the PoolAgent `skill` option when the node's job matches the skill's purpose):",
        ...skills.map((s) => `- ${s.name}: ${s.description.slice(0, 160)}`),
        'Skill usage: new PoolAgent({ ..., skill: { name: "<skill-name>", from: join(ROOT, "..", "..", "skills", "<skill-name>") } })',
        "",
      ].join("\n")
    : "";
  return [
    "You are generating a Smithers workflow TSX source file.",
    "Return the COMPLETE file inside a single ```tsx code fence and nothing else after it.",
    "",
    "Hard rules:",
    "- Model the file on the WORKING reference below: same imports, same createSmithers usage, same PoolAgent usage.",
    "- The file will be saved at .smithers/workflows/" + workflowId + ".tsx inside the project, so:",
    '  - import { PoolAgent } from "../../src/PoolAgent.ts";',
    '  - const ROOT = join(import.meta.dir, "..", "..");  // project root',
    '  - per-node working dirs under join(ROOT, "work", "<node-id>"), logDir join(ROOT, "runs").',
    '- createSmithers(schemas, { dbPath: ".smithers/smithers.db" }).',
    "- Every Task: stable kebab/underscore id, label, output schema from outputs.<key>, agent = a PoolAgent, timeoutMs, retries={1}.",
    "- Zod schemas: z.object with described fields; keep them small and mechanically checkable.",
    '- Use Sequence / Parallel for structure. To feed upstream outputs into a downstream prompt, use smithers((ctx) => { const row = ctx.latest(outputs.<key>, "<node-id>"); ... }) and interpolate JSON.stringify(row ?? "(pending)") into the plain-string child. NEVER use a deps={} function child (it breaks static graph projection).',
    "- Do NOT invent other agents, providers, or imports. PoolAgent only.",
    "- Prompts must instruct concrete, verifiable work in the node's working directory.",
    "",
    skillCatalog,
    "Reference file (known to run end-to-end):",
    "```tsx",
    template,
    "```",
    "",
    repair ? `A previous attempt failed verification with this error, fix it:\n${repair}\n` : "",
    "User request for the new workflow:",
    request,
  ].join("\n");
}

export async function generateWorkflow(
  project: Project,
  request: string,
  options: { id?: string; agentName?: string } = {},
) {
  if (!project.smithersBin) throw new HttpError(400, `${project.id} has no local smithers install`);
  const agentName = options.agentName || DEFAULT_AGENT;
  const workflowId =
    (options.id || request)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "generated-workflow";
  const wfDir = join(project.root, ".smithers", "workflows");
  mkdirSync(wfDir, { recursive: true });
  const target = join(wfDir, `${workflowId}.tsx`);
  const relPath = `.smithers/workflows/${workflowId}.tsx`;
  const skills = listSkills();

  const attempts: { kind: string; ok: boolean; detail?: string }[] = [];
  let repair: string | undefined;

  for (let round = 1; round <= 2; round++) {
    const text = await poolGenerate(
      workflowAuthoringPrompt(request, workflowId, skills, repair),
      agentName,
      workflowId,
    );
    const source = extractFence(text);
    if (!source) {
      attempts.push({ kind: "generate", ok: false, detail: "no tsx code fence in pool response" });
      repair = "Your response contained no ```tsx code fence. Return the complete file in one fence.";
      continue;
    }
    attempts.push({ kind: "generate", ok: true });
    writeFileSync(target, source, "utf8");

    const verify = await runCommand(
      [project.smithersBin, "graph", relPath, "--format", "json"],
      project.root,
      90_000,
      { scrubEnv: true }, // verification imports freshly generated code
    );
    if (verify.exitCode === 0) {
      attempts.push({ kind: "verify", ok: true });
      return { ok: true, workflowId, path: relPath, agentName, attempts };
    }
    const detail = (verify.stderr || verify.stdout).slice(0, 1200);
    attempts.push({ kind: "verify", ok: false, detail });
    repair = detail;
  }
  // Roll back the unverified candidate — a broken .tsx must not stay listed
  // and runnable (same convention as generateSkill's structure-check gate).
  rmSync(target, { force: true });
  return {
    ok: false,
    workflowId,
    path: relPath,
    agentName,
    attempts,
    error: "verification failed after 2 rounds; nothing installed",
  };
}

function workflowEditingPrompt(
  instruction: string,
  relPath: string,
  before: string,
  skills: SkillSummary[],
  repair?: string,
): string {
  const skillCatalog = skills.length
    ? [
        "Available Poolside skills (install one into a node's workspace with the PoolAgent `skill` option when the node's job matches the skill's purpose):",
        ...skills.map((s) => `- ${s.name}: ${s.description.slice(0, 160)}`),
        'Skill usage: new PoolAgent({ ..., skill: { name: "<skill-name>", from: join(ROOT, "..", "..", "skills", "<skill-name>") } })',
        "",
      ].join("\n")
    : "";
  return [
    "You are editing an existing Smithers workflow TSX source file.",
    "Return the COMPLETE updated file inside a single ```tsx code fence and nothing else after it.",
    "",
    "Hard rules:",
    "- Preserve the current file's imports, createSmithers usage, PoolAgent usage, exported default shape, and project-relative path conventions unless the requested change requires touching them.",
    "- Every Task must keep a stable kebab/underscore id, label, output schema from outputs.<key>, agent = a PoolAgent, timeoutMs, retries={1}.",
    "- Zod schemas must stay small and mechanically checkable.",
    '- Use Sequence / Parallel for structure. To feed upstream outputs into a downstream prompt, use smithers((ctx) => { const row = ctx.latest(outputs.<key>, "<node-id>"); ... }) and interpolate JSON.stringify(row ?? "(pending)") into the plain-string child. NEVER use a deps={} function child (it breaks static graph projection).',
    "- Do NOT invent other agents, providers, or imports. PoolAgent only.",
    "- Prompts must instruct concrete, verifiable work in the node's working directory.",
    "- Apply only the requested change. Do not reformat unrelated code or rename unrelated nodes.",
    "",
    skillCatalog,
    repair ? `A previous attempt failed verification with this error; fix it:\n${repair}\n` : "",
    `File path: ${relPath}`,
    "User change instruction:",
    instruction,
    "",
    "Below is the CURRENT file. Apply this change and return the COMPLETE updated file in one ```tsx fence:",
    "```tsx",
    before,
    "```",
  ].join("\n");
}

export async function editWorkflow(
  project: Project,
  relPath: string,
  instruction: string,
  options: { agentName?: string } = {},
) {
  if (!project.smithersBin) throw new HttpError(400, `${project.id} has no local smithers install`);
  const target = safeWorkflowPath(project, relPath);
  if (!existsSync(target)) throw new HttpError(404, `workflow not found: ${relPath}`);
  const before = readFileSync(target, "utf8");
  const agentName = options.agentName || DEFAULT_AGENT;
  const attempts: { kind: string; ok: boolean; detail?: string }[] = [];
  const tag = Date.now().toString(36);
  const backupPath = `${target}.bak-${tag}`;
  let backedUp = false;
  let repair: string | undefined;
  let lastError = "verification failed after 2 rounds";

  for (let round = 1; round <= 2; round++) {
    const text = await poolGenerate(
      workflowEditingPrompt(instruction, relPath, before, listSkills(), repair),
      agentName,
      `edit:${basename(relPath)}`,
    );
    const source = extractFence(text);
    if (!source) {
      attempts.push({ kind: "generate", ok: false, detail: "no tsx code fence in pool response" });
      repair = "Your response contained no ```tsx code fence. Return the complete file in one fence.";
      lastError = "no tsx code fence in pool response";
      continue;
    }
    attempts.push({ kind: "generate", ok: true });
    if (!backedUp) {
      cpSync(target, backupPath);
      backedUp = true;
    }
    writeFileSync(target, source, "utf8");

    const verify = await runCommand(
      [project.smithersBin, "graph", relPath, "--format", "json"],
      project.root,
      90_000,
      { scrubEnv: true },
    );
    if (verify.exitCode === 0) {
      attempts.push({ kind: "verify", ok: true });
      return { ok: true, path: relPath, backup: tag, before, after: source, attempts };
    }
    const detail = (verify.stderr || verify.stdout).slice(0, 1200);
    attempts.push({ kind: "verify", ok: false, detail });
    repair = detail;
    lastError = detail;
  }

  if (backedUp) {
    cpSync(backupPath, target);
    rmSync(backupPath, { force: true });
  }
  return { ok: false, path: relPath, attempts, error: lastError };
}

export function revertWorkflow(project: Project, relPath: string, backupTag: string) {
  if (!/^[a-z0-9]+$/.test(backupTag)) throw new HttpError(400, "invalid backup tag");
  const target = safeWorkflowPath(project, relPath);
  const backupPath = `${target}.bak-${backupTag}`;
  if (!existsSync(backupPath)) throw new HttpError(404, "workflow backup not found");
  cpSync(backupPath, target);
  rmSync(backupPath, { force: true });
  return { ok: true };
}

export async function startRun(
  project: Project,
  relPath: string,
  input?: Record<string, unknown>,
) {
  if (!project.smithersBin) throw new HttpError(400, `${project.id} has no local smithers install`);
  safeWorkflowPath(project, relPath);
  mkdirSync(join(project.root, ".smithers"), { recursive: true });
  const runId = crypto.randomUUID();
  const argv = [project.smithersBin, "up", relPath, "--run-id", runId, "--format", "json"];
  if (input && Object.keys(input).length) argv.push("--input", JSON.stringify(input));
  const child = spawn(argv[0], argv.slice(1), {
    cwd: project.root,
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  child.unref();
  return { ok: true, runId, project: project.id, path: relPath };
}

// ===========================================================================
// Skills catalog + authoring

export type SkillSummary = {
  name: string;
  description: string;
  version: string | null;
  evalCases: number;
  validators: string[];
  schemas: string[];
  path: string;
};

const SKILLS_ROOT = join(REPO_ROOT, "skills");

/** Minimal frontmatter parse: name, folded description, metadata.version.
 * Description is extracted line-wise (from `description:` until the next
 * top-level key) — regex end-anchors like \Z don't exist in JS. */
function parseFrontmatter(markdown: string): { name?: string; description?: string; version?: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const out: { name?: string; description?: string; version?: string } = {};
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  if (nameMatch) out.name = nameMatch[1].trim();
  const versionMatch = yaml.match(/version:\s*"?([^"\n]+)"?/);
  if (versionMatch) out.version = versionMatch[1].trim();
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^description:/.test(l));
  if (start >= 0) {
    const inline = lines[start].replace(/^description:\s*(>-?\s*)?/, "").trim();
    const block: string[] = inline && inline !== ">-" && inline !== ">" ? [inline] : [];
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break; // next top-level key
      block.push(lines[i].trim());
    }
    const description = block.filter(Boolean).join(" ");
    if (description) out.description = description;
  }
  return out;
}

export function listSkills(): SkillSummary[] {
  if (!existsSync(SKILLS_ROOT)) return [];
  const skills: SkillSummary[] = [];
  for (const entry of readdirSync(SKILLS_ROOT).sort()) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    const dir = join(SKILLS_ROOT, entry);
    const skillMd = join(dir, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const front = parseFrontmatter(readFileSync(skillMd, "utf8"));
    const evalsDir = join(dir, "evals");
    const evalCases = existsSync(evalsDir)
      ? readdirSync(evalsDir).filter((c) => existsSync(join(evalsDir, c, "metadata.json"))).length
      : 0;
    const scriptsDir = join(dir, "scripts");
    const validators = existsSync(scriptsDir)
      ? readdirSync(scriptsDir).filter((f) => f.startsWith("validate_"))
      : [];
    const schemasDir = join(dir, "schemas");
    const schemas = existsSync(schemasDir)
      ? readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"))
      : [];
    skills.push({
      name: front.name ?? entry,
      description: front.description ?? "",
      version: front.version ?? null,
      evalCases,
      validators,
      schemas,
      path: `skills/${entry}`,
    });
  }
  return skills;
}

function skillAuthoringPrompt(name: string, request: string, repair?: string): string {
  return [
    `You are authoring a new Poolside skill named "${name}" for this repo's validator-first skill library.`,
    "Your working directory contains:",
    "- authoring-guide.md — the BINDING authoring standard. Read it first and follow it exactly.",
    "- reference-skill/ — an existing high-quality skill (repo-map) to model structure and tone on.",
    "",
    `Create the complete skill under out/${name}/ in your working directory:`,
    `- out/${name}/SKILL.md — YAML frontmatter (name: ${name}; description: folded >- block describing when to use it; metadata.version: "0.1.0"; NO allowed-tools key), then the body following the authoring guide's section template — it MUST include a "Do not use when" (non-goals) section.`,
    `- out/${name}/schemas/<artifact>.schema.json — JSON Schema for the skill's output artifact (the skill must define a deterministic output contract path, e.g. .laguna/<something>.json).`,
    `- out/${name}/scripts/validate_<artifact>.ts — an executable bun validator. Contract: invoked as \`bun validate_<artifact>.ts --case <case_dir> --workspace <workspace_dir> --out <result_path>\`; it writes a validator-result.v1 JSON to --out: {"schema_version":"validator-result.v1","case_id":...,"status":"pass"|"fail","score":0..1,"checks":[{"id":...,"status":...,"detail":...}],"repair_feedback":[],"duration_ms":...}. Every check must be mechanical (file exists, schema valid, paths exist in the workspace) — no LLM judging.`,
    "",
    "Work step by step: read the guide, read the reference skill, then write the files. When done, reply with a one-line summary listing the files you created.",
    repair ? `\nA previous attempt failed the repo structure check with these violations — fix them:\n${repair}` : "",
    "",
    "What the skill should do (user request):",
    request,
  ].join("\n");
}

export async function generateSkill(
  name: string,
  request: string,
  options: { agentName?: string } = {},
) {
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!safeName) throw new HttpError(400, "invalid skill name");
  const target = join(SKILLS_ROOT, safeName);
  if (existsSync(target)) throw new HttpError(409, `skills/${safeName} already exists`);
  const agentName = options.agentName || DEFAULT_AGENT;

  const { PoolAgent } = await import(
    join(REPO_ROOT, "experiments", "smithers-pool", "src", "PoolAgent.ts")
  );

  const attempts: { kind: string; ok: boolean; detail?: string }[] = [];
  let repair: string | undefined;

  for (let round = 1; round <= 2; round++) {
    // Fresh scratch per round, seeded with the binding guide + an exemplar.
    const scratch = mkdtempSync(join(tmpdir(), "skill-author-"));
    cpSync(join(REPO_ROOT, "docs", "authoring-guide.md"), join(scratch, "authoring-guide.md"));
    cpSync(join(SKILLS_ROOT, "repo-map"), join(scratch, "reference-skill"), {
      recursive: true,
      filter: (src) => basename(src) !== "evals",
    });

    const agent = new PoolAgent({ cwd: scratch, agentName, id: `pool:skill:${safeName}` });
    await agent.generate({ prompt: skillAuthoringPrompt(safeName, request, repair) });

    const produced = join(scratch, "out", safeName);
    if (!existsSync(join(produced, "SKILL.md"))) {
      attempts.push({ kind: "generate", ok: false, detail: `pool did not write out/${safeName}/SKILL.md` });
      repair = `You did not create out/${safeName}/SKILL.md. Create the full skill directory as instructed.`;
      continue;
    }
    attempts.push({ kind: "generate", ok: true });

    // Install, then gate on the repo's structure checker; roll back on failure.
    cpSync(produced, target, { recursive: true });
    const check = await runCommand(
      ["uv", "run", "scripts/check_skill_structure.py"],
      REPO_ROOT,
      120_000,
    );
    if (check.exitCode === 0) {
      attempts.push({ kind: "structure-check", ok: true });
      return { ok: true, name: safeName, path: `skills/${safeName}`, agentName, attempts };
    }
    rmSync(target, { recursive: true, force: true });
    const detail = (check.stdout + check.stderr).slice(0, 1500);
    attempts.push({ kind: "structure-check", ok: false, detail });
    repair = detail;
  }
  return {
    ok: false,
    name: safeName,
    agentName,
    attempts,
    error: "structure check failed after 2 rounds; nothing installed",
  };
}

// ===========================================================================
// Improvement queue: proposal store + detached suggestions + accept gate

export type SkillProposal = {
  id: string;
  skill: string;
  createdAtMs: number;
  status: "open" | "accepted" | "dismissed";
  source: string;
  model: string;
  summary: string;
  baseVersion: string | null;
  proposedContent: string;
  evidence: { kind: string; ref: string; detail?: string }[];
  acceptedAtMs?: number;
  newVersion?: string;
};

type SuggestProcess = {
  pid: number;
  tag: string;
  skill: string;
  source: string;
  model: string;
  argv: string[];
  paramsPath: string;
  outPath: string;
  logPath: string;
  startedAtMs: number;
  running: boolean;
};

const PROPOSALS_ROOT = join(REPO_ROOT, "runs", "proposals");
const PROPOSAL_STATE_DIR = join(PROPOSALS_ROOT, ".state");

type ProposalEvidence = { kind: string; ref: string; detail?: string };

function assertSkillExists(skill: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(skill)) throw new HttpError(400, `invalid skill: ${skill}`);
  const skillMd = join(SKILLS_ROOT, skill, "SKILL.md");
  if (!existsSync(skillMd)) throw new HttpError(404, `skill not found: ${skill}`);
  return skillMd;
}

function proposalPath(skill: string, id: string): string {
  assertSkillExists(skill);
  if (!/^proposal-[a-z0-9-]+$/.test(id)) throw new HttpError(400, `invalid proposal id: ${id}`);
  return join(PROPOSALS_ROOT, skill, `${id}.json`);
}

function readProposal(skill: string, id: string): SkillProposal {
  const path = proposalPath(skill, id);
  if (!existsSync(path)) throw new HttpError(404, `proposal not found: ${id}`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SkillProposal;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(500, `proposal unreadable: ${message}`);
  }
}

function writeProposalAtomic(path: string, proposal: SkillProposal): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(proposal, null, 2));
  renameSync(tmp, path);
}

function checkDetails(checks: { id?: string; status?: string; detail?: string }[]): string {
  return checks
    .filter((c) => c.status && c.status !== "pass")
    .map((c) => [c.id, c.status, c.detail].filter(Boolean).join(": "))
    .join("\n")
    .slice(0, 2000);
}

function lastJsonLines(path: string, n: number): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-n)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

function collectProposalEvidence(skill: string): ProposalEvidence[] {
  const evidence: ProposalEvidence[] = [];
  const nodeEvals = discoverProjects()
    .flatMap((project) => {
      try {
        return listNodeEvals(project);
      } catch {
        return [];
      }
    })
    .filter((r) => r.skill === skill && (r.status === "fail" || r.status === "error"))
    .sort((a, b) => b.gradedAtMs - a.gradedAtMs)
    .slice(0, 5);
  for (const record of nodeEvals) {
    evidence.push({
      kind: "node-eval",
      ref: record.id,
      detail: checkDetails(record.checks) || record.note || record.status,
    });
  }

  const evalRuns = listEvalRuns()
    .filter((run) => run.skill === skill && (run.status === "fail" || run.status === "error"))
    .slice(0, 5);
  for (const run of evalRuns) {
    evidence.push({
      kind: "eval-run",
      ref: run.id,
      detail: checkDetails(run.checks) || run.status,
    });
  }

  const evidencePath = join(PROPOSALS_ROOT, skill, "evidence.jsonl");
  for (const line of lastJsonLines(evidencePath, 10)) {
    evidence.push({
      kind: "human-note",
      ref: String(line.traceId ?? line.atMs ?? "manual"),
      detail: [line.source ? `source=${line.source}` : null, line.note ? String(line.note) : null]
        .filter(Boolean)
        .join("\n"),
    });
  }
  return evidence;
}

export function listProposals(skill: string): { proposals: SkillProposal[]; pending: SuggestProcess[] } {
  assertSkillExists(skill);
  const dir = join(PROPOSALS_ROOT, skill);
  const proposals: SkillProposal[] = [];
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).sort().reverse()) {
      if (!file.endsWith(".json")) continue;
      try {
        proposals.push(JSON.parse(readFileSync(join(dir, file), "utf8")) as SkillProposal);
      } catch {
        // skip unreadable proposal
      }
    }
  }
  proposals.sort((a, b) => b.createdAtMs - a.createdAtMs);

  const pending: SuggestProcess[] = [];
  if (existsSync(PROPOSAL_STATE_DIR)) {
    for (const file of readdirSync(PROPOSAL_STATE_DIR).sort().reverse()) {
      if (!file.startsWith("suggest-") || !file.endsWith(".json") || file.endsWith(".params.json")) continue;
      try {
        const sidecar = JSON.parse(readFileSync(join(PROPOSAL_STATE_DIR, file), "utf8"));
        if (sidecar.skill === skill) pending.push({ ...sidecar, running: pidAlive(sidecar.pid) });
      } catch {
        // skip unreadable sidecar
      }
    }
  }
  return { proposals, pending };
}

export function appendEvidence(
  skill: string,
  item: { source?: string; traceId?: string; note?: string; refs?: unknown },
) {
  assertSkillExists(skill);
  const dir = join(PROPOSALS_ROOT, skill);
  mkdirSync(dir, { recursive: true });
  const line = {
    atMs: Date.now(),
    skill,
    source: item.source ?? "manual",
    ...(item.traceId ? { traceId: item.traceId } : {}),
    ...(item.note ? { note: item.note } : {}),
    ...(item.refs !== undefined ? { refs: item.refs } : {}),
  };
  appendFileSync(join(dir, "evidence.jsonl"), `${JSON.stringify(line)}\n`, "utf8");
  return { ok: true, evidence: line };
}

export function startSuggest(options: {
  skill: string;
  source?: string;
  model?: string;
  refs?: unknown;
  note?: string;
  smoke?: boolean;
}) {
  assertSkillExists(options.skill);
  const source = options.source ?? "manual";
  const model = options.model ?? DEFAULT_AGENT;
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const proposalDir = join(PROPOSALS_ROOT, options.skill);
  mkdirSync(proposalDir, { recursive: true });
  mkdirSync(PROPOSAL_STATE_DIR, { recursive: true });

  const evidence = collectProposalEvidence(options.skill);
  if (options.note || options.refs !== undefined) {
    evidence.push({
      kind: "request-note",
      ref: source,
      detail: [options.note, options.refs !== undefined ? JSON.stringify(options.refs).slice(0, 2000) : null]
        .filter(Boolean)
        .join("\n"),
    });
  }
  const paramsPath = join(PROPOSAL_STATE_DIR, `suggest-${tag}.params.json`);
  const outPath = join(proposalDir, `proposal-${tag}.json`);
  writeFileSync(
    paramsPath,
    JSON.stringify({ skill: options.skill, source, model, refs: options.refs, note: options.note, evidence }, null, 2),
  );

  const argv = ["bun", "ui/propose.ts", "--skill", options.skill, "--params", paramsPath, "--out", outPath];
  if (options.smoke) argv.push("--smoke");
  const logPath = join(PROPOSAL_STATE_DIR, `suggest-${tag}.log`);
  const fd = openSync(logPath, "a");
  const child = spawn(argv[0], argv.slice(1), {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  closeSync(fd);
  const sidecar = {
    pid: child.pid ?? -1,
    tag,
    skill: options.skill,
    source,
    model,
    argv,
    paramsPath: paramsPath.slice(REPO_ROOT.length + 1),
    outPath: outPath.slice(REPO_ROOT.length + 1),
    logPath: logPath.slice(REPO_ROOT.length + 1),
    startedAtMs: Date.now(),
  };
  writeFileSync(join(PROPOSAL_STATE_DIR, `suggest-${tag}.json`), JSON.stringify(sidecar, null, 2));
  return { ok: true, tag, sidecar: { ...sidecar, running: pidAlive(sidecar.pid) } };
}

function nextPatchVersion(version: string | null): string {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new HttpError(409, `unparseable skill version: ${version ?? "null"}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function normalizeYamlScalar(value: string | undefined): string | undefined {
  return value?.trim().replace(/^["']|["']$/g, "");
}

export async function acceptProposal(skill: string, id: string) {
  const skillMd = assertSkillExists(skill);
  const path = proposalPath(skill, id);
  const proposal = readProposal(skill, id);
  if (proposal.status !== "open") throw new HttpError(409, `proposal is ${proposal.status}`);

  const original = readFileSync(skillMd, "utf8");
  const liveVersion = parseFrontmatter(original).version ?? null;
  if (liveVersion !== proposal.baseVersion) {
    throw new HttpError(
      409,
      `skill changed since proposal was computed (${liveVersion ?? "null"} vs ${proposal.baseVersion ?? "null"}) — dismiss and re-suggest`,
    );
  }
  const newVersion = nextPatchVersion(proposal.baseVersion);
  if (!/version:\s*"?[^"\n]+"?/.test(proposal.proposedContent)) {
    throw new HttpError(422, "proposedContent is missing metadata.version");
  }
  const content = proposal.proposedContent.replace(
    /version:\s*"?[^"\n]+"?/,
    `version: "${newVersion}"`,
  );
  const proposedName = normalizeYamlScalar(parseFrontmatter(content).name);
  if (proposedName !== skill) {
    throw new HttpError(422, `proposedContent frontmatter name ${proposedName ?? "<missing>"} differs from ${skill}`);
  }

  writeFileSync(skillMd, content, "utf8");
  let check: { exitCode: number | null; stdout: string; stderr: string };
  try {
    check = await runCommand(["uv", "run", "scripts/check_skill_structure.py"], REPO_ROOT, 120_000);
  } catch (error) {
    writeFileSync(skillMd, original, "utf8");
    throw error;
  }
  if (check.exitCode !== 0) {
    writeFileSync(skillMd, original, "utf8");
    return { ok: false, error: (check.stdout + check.stderr).slice(0, 1500) };
  }

  const accepted: SkillProposal = { ...proposal, status: "accepted", acceptedAtMs: Date.now(), newVersion };
  writeProposalAtomic(path, accepted);
  const suite = `evals/suites/skill-${skill}.json`;
  const evalRun = existsSync(join(REPO_ROOT, suite)) ? startEvalRun({ suite }) : null;
  return { ok: true, id, skill, newVersion, evalRun };
}

/** Fold a finished GEPA optimize run (runs/optimize/<skill>/<dir>) into the
 * improvement queue as an open proposal. Accepting it reuses the normal gates:
 * base-version 409 guard, structure check + rollback, auto version bump, and
 * an eval-suite re-run. The strongest skill author (GEPA, eval-validated)
 * flows through the same human accept button as every other proposal. */
export function proposalFromOptimizeRun(options: { skill: string; runDir?: string }): SkillProposal {
  const { skill } = options;
  const skillMd = assertSkillExists(skill);
  const optimizeRoot = join(REPO_ROOT, "runs", "optimize", skill);
  let runDir = options.runDir ? resolve(REPO_ROOT, options.runDir) : null;
  if (!runDir) {
    const finished = existsSync(optimizeRoot)
      ? readdirSync(optimizeRoot)
          .map((name) => join(optimizeRoot, name))
          .filter((dir) => existsSync(join(dir, "result.json")))
          .sort((a, b) => statSync(join(b, "result.json")).mtimeMs - statSync(join(a, "result.json")).mtimeMs)
      : [];
    runDir = finished[0] ?? null;
  }
  if (!runDir || !existsSync(join(runDir, "result.json"))) {
    throw new HttpError(404, `no finished optimize run (result.json) for ${skill} — pass --run-dir`);
  }
  let result: Record<string, unknown>;
  let config: Record<string, unknown> = {};
  try {
    result = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"));
  } catch (error) {
    throw new HttpError(500, `result.json unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    config = JSON.parse(readFileSync(join(runDir, "config.json"), "utf8"));
  } catch {
    // config.json is informational (reflection model name); tolerate absence
  }
  if (result.best_changed === false) {
    throw new HttpError(409, "best candidate equals the seed — nothing to propose");
  }
  const bestPath = join(runDir, "best", "SKILL.md");
  if (!existsSync(bestPath)) throw new HttpError(404, `optimize run has no best/SKILL.md: ${runDir}`);
  const proposedContent = readFileSync(bestPath, "utf8");

  const seed = typeof result.seed_val_score === "number" ? result.seed_val_score : null;
  const best = typeof result.best_val_score === "number" ? result.best_val_score : null;
  const fmt = (x: number | null) => (x === null ? "n/a" : x.toFixed(3));
  const lift = seed !== null && best !== null ? best - seed : null;
  const valCases = Array.isArray(result.val_cases) ? (result.val_cases as string[]) : [];
  const arms = Array.isArray(result.arms) ? (result.arms as string[]).join(",") : "xs_with_skill";

  const id = `proposal-gepa-${basename(runDir).toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  const path = proposalPath(skill, id);
  if (existsSync(path)) throw new HttpError(409, `proposal already exists: ${id}`);

  const proposal: SkillProposal = {
    id,
    skill,
    createdAtMs: Date.now(),
    status: "open",
    source: "gepa-optimize",
    model: String(config.reflection_lm ?? "unknown"),
    summary:
      `GEPA-optimized SKILL.md: val ${fmt(seed)} -> ${fmt(best)}` +
      (lift !== null ? ` (${lift >= 0 ? "+" : ""}${lift.toFixed(3)})` : "") +
      ` on ${valCases.length} held-out case(s); ${result.total_metric_calls ?? "?"} rollouts (${arms}).` +
      " EVIDENCE LEVEL: search val split only — run the full eval suite and check the scoreboard before accepting." +
      " Numbers are internal/directional (eval-methodology §7).",
    baseVersion: parseFrontmatter(readFileSync(skillMd, "utf8")).version ?? null,
    proposedContent,
    evidence: [
      {
        kind: "gepa-optimize",
        ref: runDir.startsWith(REPO_ROOT + "/") ? runDir.slice(REPO_ROOT.length + 1) : runDir,
        detail:
          `seed_val=${fmt(seed)} best_val=${fmt(best)} metric_calls=${result.total_metric_calls ?? "?"}\n` +
          `val_cases: ${valCases.join(", ")}\nreview best.diff in the run dir for the exact prose change`,
      },
    ],
  };
  writeProposalAtomic(path, proposal);
  return proposal;
}

export function dismissProposal(skill: string, id: string) {
  const path = proposalPath(skill, id);
  const proposal = readProposal(skill, id);
  if (proposal.status !== "open") throw new HttpError(409, `proposal is ${proposal.status}`);
  const dismissed: SkillProposal = { ...proposal, status: "dismissed" };
  writeProposalAtomic(path, dismissed);
  return { ok: true, id, skill, status: "dismissed" };
}

// ===========================================================================
// Evals: suites, harness runs, live status

const EVAL_RUNS_ROOT = join(REPO_ROOT, "runs");
const SUITES_DIR = join(REPO_ROOT, "evals", "suites");

export type EvalCase = {
  id: string;
  skill: string;
  bucket: string | null;
  difficulty: string | null;
  arms: string[];
  dir: string;
};

export type EvalSuite = { name: string; path: string; cases: EvalCase[] };

export function listEvalSuites(): EvalSuite[] {
  if (!existsSync(SUITES_DIR)) return [];
  const suites: EvalSuite[] = [];
  for (const file of readdirSync(SUITES_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    try {
      const suite = JSON.parse(readFileSync(join(SUITES_DIR, file), "utf8"));
      const cases: EvalCase[] = [];
      for (const caseDir of suite.cases ?? []) {
        const abs = resolve(REPO_ROOT, caseDir);
        const metaPath = join(abs, "metadata.json");
        if (!existsSync(metaPath)) continue;
        let meta: Record<string, unknown>;
        try {
          meta = JSON.parse(readFileSync(metaPath, "utf8"));
        } catch {
          continue; // one corrupt case must not drop the whole suite
        }
        cases.push({
          id: (meta.id as string) ?? basename(abs),
          skill: (meta.skill as string) ?? "unknown",
          bucket: (meta.bucket as string) ?? null,
          difficulty: (meta.difficulty as string) ?? null,
          arms: (meta.arms as string[]) ?? [],
          dir: caseDir,
        });
      }
      suites.push({ name: suite.name ?? file.replace(/\.json$/, ""), path: `evals/suites/${file}`, cases });
    } catch {
      // unreadable suite; skip
    }
  }
  return suites;
}

export type EvalRunRecord = {
  kind: "eval-run";
  id: string; // suite/case/arm
  suite: string;
  caseId: string;
  /** Owning skill, resolved from skills/<skill>/evals/<caseId>/ — the join
   * key that groups eval runs with the catalog and with workflow nodes. */
  skill: string | null;
  arm: string;
  status: "running" | "pass" | "fail" | "error" | "incomplete";
  gradedPass: boolean | null;
  score: number | null;
  expectedStatus: string | null;
  agentName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  checks: { id: string; status: string; detail?: string }[];
};

export type GenerateStartOptions = {
  kind?: string;
  prompt?: string;
  project?: string | null;
  id?: string;
  name?: string;
  agentName?: string;
  smoke?: boolean;
};

type GenerateDestination =
  | { route: string; path: string }
  | { route: string; name: string };

type GenerateSidecar = {
  pid: number;
  kind: "workflow" | "skill";
  params: GenerateStartOptions & { project: string | null };
  destination: GenerateDestination;
  logPath: string;
  resultPath: string;
  startedAtMs: number;
};

const GENERATE_STATE_DIR = join(EVAL_RUNS_ROOT, ".generate");

function workflowSlug(input: string | undefined, fallback: string): string {
  return (
    (input || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "generated-workflow"
  );
}

function skillSlug(input: string | undefined): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function startGenerate(options: GenerateStartOptions) {
  const kind = options.kind;
  if (kind !== "workflow" && kind !== "skill") throw new HttpError(400, "kind must be workflow or skill");
  const prompt = options.prompt?.trim();
  if (!prompt) throw new HttpError(400, "prompt is required");

  const project = kind === "workflow" ? getProject(options.project ?? null).id : (options.project ?? null);
  let destination: GenerateDestination;
  if (kind === "workflow") {
    const id = workflowSlug(options.id, prompt);
    const path = `.smithers/workflows/${id}.tsx`;
    destination = { route: `#/workflows/${encodeURIComponent(path)}`, path };
  } else {
    const name = skillSlug(options.name);
    if (!name) throw new HttpError(400, "name is required");
    if (existsSync(join(SKILLS_ROOT, name))) throw new HttpError(409, `skills/${name} already exists`);
    destination = { route: `#/skills/${encodeURIComponent(name)}`, name };
  }

  mkdirSync(GENERATE_STATE_DIR, { recursive: true });
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const paramsPath = join(GENERATE_STATE_DIR, `gen-${tag}.params.json`);
  const resultPath = join(GENERATE_STATE_DIR, `gen-${tag}.result.json`);
  const logPath = join(GENERATE_STATE_DIR, `gen-${tag}.log`);
  const params = { ...options, kind, prompt, project };
  writeFileSync(paramsPath, JSON.stringify(params, null, 2), "utf8");

  const argv = ["bun", "ui/generate.ts", "--params", paramsPath, "--out", resultPath];
  const fd = openSync(logPath, "a");
  const child = spawn(argv[0], argv.slice(1), {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  closeSync(fd);

  const sidecar: GenerateSidecar = {
    pid: child.pid ?? -1,
    kind,
    params,
    destination,
    logPath: logPath.slice(REPO_ROOT.length + 1),
    resultPath: resultPath.slice(REPO_ROOT.length + 1),
    startedAtMs: Date.now(),
  };
  writeFileSync(join(GENERATE_STATE_DIR, `gen-${tag}.json`), JSON.stringify(sidecar, null, 2), "utf8");
  return { ok: true, tag, kind, destination };
}

export function generateStatus(tag: string) {
  if (!/^[a-z0-9]+$/.test(tag)) throw new HttpError(400, "invalid tag");
  const sidecarPath = join(GENERATE_STATE_DIR, `gen-${tag}.json`);
  if (!existsSync(sidecarPath)) throw new HttpError(404, `generate job not found: ${tag}`);
  const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as GenerateSidecar;
  let result: unknown = null;
  const resultPath = join(REPO_ROOT, sidecar.resultPath);
  if (existsSync(resultPath)) {
    try {
      result = JSON.parse(readFileSync(resultPath, "utf8"));
    } catch {
      // partial write; next poll will pick it up
    }
  }
  const alive = pidAlive(sidecar.pid);
  if (!alive && !result) {
    result = { ok: false, error: `worker died — see ${sidecar.logPath}` };
  }
  return { tag, ...sidecar, running: alive && !result, result };
}

type HarnessProcess = {
  pid: number;
  suite: string;
  argv: string[];
  logPath: string;
  startedAtMs: number;
  running: boolean;
};

const HARNESS_STATE_DIR = join(EVAL_RUNS_ROOT, ".harness");
const NON_EVAL_RUN_DIRS = new Set(["generate", "optimize", "playground", "proposals", "review"]);

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Harness invocations are tracked on disk (runs/.harness/*.json sidecars +
 * pid liveness), so the server, the CLI, and any agent see the same state
 * regardless of which process launched the run. */
export function listHarnessProcesses(): HarnessProcess[] {
  if (!existsSync(HARNESS_STATE_DIR)) return [];
  const procs: HarnessProcess[] = [];
  for (const file of readdirSync(HARNESS_STATE_DIR).sort().reverse()) {
    if (!file.endsWith(".json")) continue;
    try {
      const sidecar = JSON.parse(readFileSync(join(HARNESS_STATE_DIR, file), "utf8"));
      procs.push({ ...sidecar, running: pidAlive(sidecar.pid) });
    } catch {
      // unreadable sidecar; skip
    }
  }
  return procs;
}

export function startEvalRun(options: { suite: string; cases?: string[]; arms?: string[] }) {
  const suitePath = resolve(REPO_ROOT, options.suite);
  if (!suitePath.startsWith(SUITES_DIR + "/") || !existsSync(suitePath)) {
    throw new HttpError(400, `suite not found: ${options.suite}`);
  }
  const argv = ["uv", "run", "harness/runner/run_eval.py", "--suite", options.suite];
  for (const c of options.cases ?? []) argv.push("--case", c);
  for (const a of options.arms ?? []) argv.push("--arm", a);

  mkdirSync(HARNESS_STATE_DIR, { recursive: true });
  const tag = Date.now().toString(36);
  const logPath = join(HARNESS_STATE_DIR, `harness-${tag}.log`);
  // Output goes straight to the log file fd: the harness must survive the
  // launching process (CLI invocations exit immediately).
  const fd = openSync(logPath, "a");
  const child = spawn(argv[0], argv.slice(1), {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  closeSync(fd);
  const sidecar = {
    pid: child.pid ?? -1,
    suite: options.suite,
    argv,
    logPath: logPath.slice(REPO_ROOT.length + 1),
    startedAtMs: Date.now(),
  };
  writeFileSync(join(HARNESS_STATE_DIR, `harness-${tag}.json`), JSON.stringify(sidecar, null, 2));
  return { ok: true, ...sidecar };
}


type OptimizeProcess = {
  pid: number | null;
  skill: string;
  mode: string;
  argv: string[];
  logPath: string | null;
  outDir: string | null;
  startedAtMs: number;
  running: boolean;
  result?: unknown;
  progress?: OptimizeProgress | null;
  source?: "sidecar" | "scan";
};

type OptimizeProgress = {
  rolloutsDone: number | null;
  rolloutsTotal: number | null;
  secPerRollout: number | null;
  nCandidates: number | null;
  reflectionLm: string | null;
  lastLogAtMs: number | null;
};

const OPTIMIZE_STATE_DIR = join(EVAL_RUNS_ROOT, "optimize", ".state");

/** Launch harness/optimize/gepa_skill.py detached (same pattern as
 * startEvalRun): output to a log-file fd, pid sidecar on disk so the CLI,
 * the server, and any agent see the same state. The driver self-gates
 * candidates (frozen_paths_gate.py + structure checks) before pool spend. */
export function startOptimizeRun(options: {
  skill: string;
  suite?: string;
  maxMetricCalls?: number;
  reflectionLm?: string;
  arms?: string[];
  workers?: number;
  smoke?: boolean;
  baselineOnly?: boolean;
}) {
  if (options.smoke && options.baselineOnly) {
    throw new HttpError(400, "--smoke and --baseline-only are mutually exclusive");
  }

  const skillDir = join(REPO_ROOT, "skills", options.skill);
  if (!existsSync(join(skillDir, "SKILL.md"))) {
    throw new HttpError(400, `skill not found: ${options.skill}`);
  }
  const argv = ["uv", "run", "harness/optimize/gepa_skill.py", "--skill", options.skill];
  if (options.suite) {
    const suitePath = resolve(REPO_ROOT, options.suite);
    if (!suitePath.startsWith(SUITES_DIR + "/") || !existsSync(suitePath)) {
      throw new HttpError(400, `suite not found: ${options.suite}`);
    }
    argv.push("--suite", options.suite);
  }
  if (options.maxMetricCalls) argv.push("--max-metric-calls", String(options.maxMetricCalls));
  if (options.reflectionLm) argv.push("--reflection-lm", options.reflectionLm);
  if (options.workers) argv.push("--workers", String(Math.max(1, Math.min(8, options.workers))));
  for (const a of options.arms ?? []) argv.push("--arm", a);
  if (options.smoke) argv.push("--smoke");
  if (options.baselineOnly) argv.push("--baseline-only");

  const tag = Date.now().toString(36);
  const outDir = join("runs", "optimize", options.skill, `wb-${tag}`);
  argv.push("--out-dir", outDir);

  mkdirSync(OPTIMIZE_STATE_DIR, { recursive: true });
  const logPath = join(OPTIMIZE_STATE_DIR, `optimize-${tag}.log`);
  const fd = openSync(logPath, "a");
  const child = spawn(argv[0], argv.slice(1), {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  closeSync(fd);
  const sidecar = {
    pid: child.pid ?? -1,
    skill: options.skill,
    mode: options.smoke ? "smoke" : options.baselineOnly ? "baseline" : "optimize",
    argv,
    logPath: logPath.slice(REPO_ROOT.length + 1),
    outDir,
    startedAtMs: Date.now(),
  };
  writeFileSync(join(OPTIMIZE_STATE_DIR, `optimize-${tag}.json`), JSON.stringify(sidecar, null, 2));
  return { ok: true, ...sidecar };
}

/** Parse live progress straight from a GEPA run dir — the engine journals
 * to disk every rollout, so "real-time" is just reading what's already there.
 * Tolerant of partial writes; every field is best-effort nullable. */
function optimizeProgress(outDirAbs: string): OptimizeProgress | null {
  const gepaDir = join(outDirAbs, "gepa");
  const progress: OptimizeProgress = {
    rolloutsDone: null,
    rolloutsTotal: null,
    secPerRollout: null,
    nCandidates: null,
    reflectionLm: null,
    lastLogAtMs: null,
  };
  let sawAnything = false;
  for (const logName of ["run_log_stderr.txt", "run_log.txt"]) {
    const logPath = join(gepaDir, logName);
    if (!existsSync(logPath)) continue;
    try {
      const stat = statSync(logPath);
      progress.lastLogAtMs = Math.max(progress.lastLogAtMs ?? 0, stat.mtimeMs);
      const raw = readFileSync(logPath, "utf8");
      const tail = raw.slice(-8192).replace(/\r/g, "\n");
      const bars = [...tail.matchAll(/(\d+)\/(\d+) \[[0-9:?]+<[0-9:?]+, ([0-9.]+)s\/rollouts?\]/g)];
      const last = bars[bars.length - 1];
      if (last) {
        progress.rolloutsDone = Number(last[1]);
        progress.rolloutsTotal = Number(last[2]);
        progress.secPerRollout = Number(last[3]);
        sawAnything = true;
      }
    } catch {
      // unreadable log tail; keep whatever we have
    }
  }
  try {
    const candidates = JSON.parse(readFileSync(join(gepaDir, "candidates.json"), "utf8"));
    if (Array.isArray(candidates)) {
      progress.nCandidates = candidates.length;
      sawAnything = true;
    }
  } catch {
    // not written yet
  }
  try {
    const config = JSON.parse(readFileSync(join(outDirAbs, "config.json"), "utf8"));
    if (typeof config.reflection_lm === "string") progress.reflectionLm = config.reflection_lm;
    if (progress.rolloutsTotal === null && typeof config.max_metric_calls === "number") {
      progress.rolloutsTotal = config.max_metric_calls;
    }
    sawAnything = true;
  } catch {
    // no config yet
  }
  return sawAnything ? progress : null;
}

//: a run dir's engine log going quiet for this long means the process died.
//: generous: under pool contention a single rollout can take many minutes
//: without the progress bar (and thus the log file's mtime) ticking.
const OPTIMIZE_STALE_MS = 15 * 60_000;

/** Optimization runs: pid sidecars + liveness for workbench-launched runs,
 * merged with a directory scan so CLI-launched runs (uv run gepa_skill.py)
 * are visible too, all enriched with live progress parsed from the GEPA
 * run dir and with the driver's result.json once it lands. */
export function listOptimizeRuns(): OptimizeProcess[] {
  const procs: OptimizeProcess[] = [];
  const seenOutDirs = new Set<string>();

  const readResult = (outDir: string | null): unknown => {
    if (!outDir) return null;
    const resultPath = join(REPO_ROOT, outDir, "result.json");
    if (!existsSync(resultPath)) return null;
    try {
      return JSON.parse(readFileSync(resultPath, "utf8"));
    } catch {
      return null; // partial write; next poll picks it up
    }
  };

  if (existsSync(OPTIMIZE_STATE_DIR)) {
    for (const file of readdirSync(OPTIMIZE_STATE_DIR).sort().reverse()) {
      if (!file.endsWith(".json")) continue;
      try {
        const sidecar = JSON.parse(readFileSync(join(OPTIMIZE_STATE_DIR, file), "utf8"));
        if (sidecar.outDir) seenOutDirs.add(String(sidecar.outDir));
        const result = readResult(sidecar.outDir);
        const progress = sidecar.outDir && !result ? optimizeProgress(join(REPO_ROOT, sidecar.outDir)) : null;
        procs.push({ ...sidecar, running: pidAlive(sidecar.pid), result, progress, source: "sidecar" });
      } catch {
        // unreadable sidecar; skip
      }
    }
  }

  // Sidecar-less runs (launched straight from the CLI): the run dir itself is
  // the registration. Liveness is inferred from engine-log freshness.
  const optimizeRoot = join(EVAL_RUNS_ROOT, "optimize");
  if (existsSync(optimizeRoot)) {
    for (const skill of readdirSync(optimizeRoot)) {
      if (skill.startsWith(".")) continue;
      const skillRoot = join(optimizeRoot, skill);
      let entries: string[] = [];
      try {
        entries = readdirSync(skillRoot);
      } catch {
        continue;
      }
      for (const dir of entries.sort().reverse()) {
        const outDirRel = join("runs", "optimize", skill, dir);
        if (seenOutDirs.has(outDirRel)) continue;
        const outDirAbs = join(skillRoot, dir);
        if (!existsSync(join(outDirAbs, "config.json"))) continue;
        const result = readResult(outDirRel);
        const progress = result ? null : optimizeProgress(outDirAbs);
        const fresh = progress?.lastLogAtMs != null && Date.now() - progress.lastLogAtMs < OPTIMIZE_STALE_MS;
        let startedAtMs = Date.now();
        try {
          startedAtMs = statSync(join(outDirAbs, "config.json")).mtimeMs;
        } catch {
          // keep fallback
        }
        procs.push({
          pid: null,
          skill,
          mode: "optimize",
          argv: [],
          logPath: null,
          outDir: outDirRel,
          startedAtMs,
          running: !result && fresh,
          result,
          progress,
          source: "scan",
        });
      }
    }
  }
  return procs.sort((a, b) => b.startedAtMs - a.startedAtMs);
}

export function listEvalRuns(): EvalRunRecord[] {
  if (!existsSync(EVAL_RUNS_ROOT)) return [];
  const records: EvalRunRecord[] = [];
  // "running" is scoped per suite (sidecars record the suite file; the
  // output dir is its basename by convention), so a live harness for one
  // suite doesn't mark stale manifest-less dirs of other suites as running.
  const runningSuites = new Set(
    listHarnessProcesses()
      .filter((p) => p.running)
      .map((p) => basename(p.suite).replace(/\.json$/, "")),
  );
  for (const suite of readdirSync(EVAL_RUNS_ROOT, { withFileTypes: true })) {
    if (!suite.isDirectory() || suite.name.startsWith(".") || NON_EVAL_RUN_DIRS.has(suite.name)) continue;
    const suiteDir = join(EVAL_RUNS_ROOT, suite.name);
    for (const caseEntry of readdirSync(suiteDir, { withFileTypes: true })) {
      if (!caseEntry.isDirectory()) continue;
      const caseDir = join(suiteDir, caseEntry.name);
      for (const armEntry of readdirSync(caseDir, { withFileTypes: true })) {
        if (!armEntry.isDirectory()) continue;
        const armDir = join(caseDir, armEntry.name);
        const record: EvalRunRecord = {
          kind: "eval-run",
          id: `${suite.name}/${caseEntry.name}/${armEntry.name}`,
          suite: suite.name,
          caseId: caseEntry.name,
          skill: skillForCase(caseEntry.name),
          arm: armEntry.name,
          status: runningSuites.has(suite.name) ? "running" : "incomplete",
          gradedPass: null,
          score: null,
          expectedStatus: null,
          agentName: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          inputTokens: null,
          outputTokens: null,
          checks: [],
        };
        const manifestPath = join(armDir, "manifest.json");
        if (existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
            record.agentName = manifest.agent_name ?? null;
            record.startedAt = manifest.timing?.started_at ?? null;
            record.finishedAt = manifest.timing?.finished_at ?? null;
            record.durationMs = manifest.timing?.duration_ms ?? null;
            const vr = manifest.validator_result;
            if (vr) {
              record.status = vr.status === "pass" ? "pass" : vr.status === "fail" ? "fail" : "error";
              record.score = typeof vr.score === "number" ? vr.score : null;
              record.checks = Array.isArray(vr.checks) ? vr.checks : [];
            }
          } catch {
            record.status = "error";
          }
        }
        const factsPath = join(armDir, "run-facts.json");
        if (existsSync(factsPath)) {
          try {
            const facts = JSON.parse(readFileSync(factsPath, "utf8"));
            record.gradedPass = facts.graded_pass ?? null;
            record.expectedStatus = facts.expected_status ?? null;
            record.inputTokens = facts.trajectory_facts?.totals?.input_tokens ?? null;
            record.outputTokens = facts.trajectory_facts?.totals?.output_tokens ?? null;
          } catch {
            // facts unreadable; manifest data stands
          }
        }
        records.push(record);
      }
    }
  }
  records.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return records;
}

let caseSkillCache: { at: number; map: Map<string, string> } | null = null;

/** caseId → owning skill, from the skills/<skill>/evals/<caseId>/ layout.
 * Short TTL instead of forever-memo: the long-running server itself installs
 * new skills/cases, and a stale map would report skill:null for them. */
function skillForCase(caseId: string): string | null {
  if (!caseSkillCache || Date.now() - caseSkillCache.at > 5_000) {
    const map = new Map<string, string>();
    if (existsSync(SKILLS_ROOT)) {
      for (const skill of readdirSync(SKILLS_ROOT)) {
        const evalsDir = join(SKILLS_ROOT, skill, "evals");
        if (skill.startsWith("_") || !existsSync(evalsDir)) continue;
        for (const caseDir of readdirSync(evalsDir)) map.set(caseDir, skill);
      }
    }
    caseSkillCache = { at: Date.now(), map };
  }
  return caseSkillCache.map.get(caseId) ?? null;
}

export type SkillEvalSummary = {
  withSkill: { pass: number; total: number; avgScore: number | null };
  withoutSkill: { pass: number; total: number; avgScore: number | null };
};

/** Per-skill aggregation of all eval arm-runs on disk: the with/without
 * split is the skill-lift signal. */
export function skillEvalSummaries(): Record<string, SkillEvalSummary> {
  const grouped: Record<string, { with: EvalRunRecord[]; without: EvalRunRecord[] }> = {};
  for (const run of listEvalRuns()) {
    if (!run.skill || run.gradedPass == null) continue;
    const g = (grouped[run.skill] ??= { with: [], without: [] });
    (run.arm.includes("_with_skill") ? g.with : g.without).push(run);
  }
  const summarize = (runs: EvalRunRecord[]) => {
    const scores = runs.map((r) => r.score).filter((s): s is number => s != null);
    return {
      pass: runs.filter((r) => r.gradedPass).length,
      total: runs.length,
      avgScore: scores.length
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000
        : null,
    };
  };
  return Object.fromEntries(
    Object.entries(grouped).map(([skill, g]) => [
      skill,
      { withSkill: summarize(g.with), withoutSkill: summarize(g.without) },
    ]),
  );
}

// ===========================================================================
// Skill detail + playground

export type SkillDetail = {
  skill: SkillSummary & { evalSummary: SkillEvalSummary | null };
  skillMd: string;
  inWorkflow: { pass: number; total: number };
  cases: { id: string; bucket: string | null; difficulty: string | null; expectedStatus: string | null }[];
  usedIn: { project: string; path: string; name: string }[];
};

export type PlaygroundRecord = {
  kind: "playground";
  id: string;
  skill: string;
  prompt: string;
  agentName: string;
  fixtureCase?: string;
  status: "pass" | "fail" | "error";
  score: number | null;
  checks: { id: string; status: string; detail?: string }[];
  grader: "skill-validator" | "exit-code";
  durationMs: number | null;
  trajectoryUrl: string | null;
  workspace: string | null;
  createdAtMs: number;
  note?: string;
};

type PlaygroundProcess = {
  pid: number;
  tag: string;
  skill: string;
  model: string;
  fixtureCase?: string;
  argv: string[];
  paramsPath: string;
  outPath: string;
  logPath: string;
  startedAtMs: number;
  running: boolean;
};

const PLAYGROUND_ROOT = join(REPO_ROOT, "runs", "playground");
const PLAYGROUND_STATE_DIR = join(PLAYGROUND_ROOT, ".state");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSkillCaseMetadata(skill: string, caseName: string) {
  const metaPath = join(SKILLS_ROOT, skill, "evals", caseName, "metadata.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const validator = meta.validator && typeof meta.validator === "object" ? meta.validator : {};
  return {
    id: typeof meta.id === "string" ? meta.id : caseName,
    bucket: typeof meta.bucket === "string" ? meta.bucket : null,
    difficulty: typeof meta.difficulty === "string" ? meta.difficulty : null,
    expectedStatus: typeof validator.expected_status === "string" ? validator.expected_status : null,
  };
}

function safeFixtureCaseName(value: string): string {
  if (!value || value.includes("/") || value.includes("..")) {
    throw new HttpError(400, `invalid fixture case: ${value}`);
  }
  return value;
}

function assertNoSymlinks(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (lstatSync(abs).isSymbolicLink()) throw new HttpError(400, `fixture input contains symlink: ${abs}`);
    if (entry.isDirectory()) assertNoSymlinks(abs);
  }
}

function playgroundRecordPath(skill: string, id: string): string {
  assertSkillExists(skill);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new HttpError(400, `invalid playground id: ${id}`);
  return join(PLAYGROUND_ROOT, skill, `${id}.json`);
}

function readPlaygroundRecord(skill: string, id: string): PlaygroundRecord {
  const path = playgroundRecordPath(skill, id);
  if (!existsSync(path)) throw new HttpError(404, `playground record not found: ${id}`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PlaygroundRecord;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(500, `playground record unreadable: ${message}`);
  }
}

export function skillDetail(name: string): SkillDetail {
  const skillMdPath = assertSkillExists(name);
  const summaries = skillEvalSummaries();
  const summary = listSkills().find((s) => s.name === name || basename(s.path) === name);
  if (!summary) throw new HttpError(404, `skill not found: ${name}`);

  const nodeEvals = discoverProjects().flatMap((project) => {
    try {
      return listNodeEvals(project);
    } catch {
      return [];
    }
  });
  const inWorkflowRecords = nodeEvals.filter((r) => r.skill === name && r.mode === "in-workflow" && r.status !== "error");

  const cases: SkillDetail["cases"] = [];
  const evalsDir = join(SKILLS_ROOT, name, "evals");
  if (existsSync(evalsDir)) {
    for (const entry of readdirSync(evalsDir).sort()) {
      const metaPath = join(evalsDir, entry, "metadata.json");
      if (!existsSync(metaPath)) continue;
      try {
        cases.push(readSkillCaseMetadata(name, entry));
      } catch {
        cases.push({ id: entry, bucket: null, difficulty: null, expectedStatus: null });
      }
    }
  }

  const usedIn: SkillDetail["usedIn"] = [];
  const skillPattern = new RegExp(`skill:\\s*\\{[^}]*name:\\s*"${escapeRegExp(name)}"`);
  for (const project of discoverProjects()) {
    for (const workflow of listWorkflows(project)) {
      try {
        const abs = safeWorkflowPath(project, workflow.path);
        if (!existsSync(abs) || statSync(abs).size > 200_000) continue;
        if (skillPattern.test(readFileSync(abs, "utf8"))) {
          usedIn.push({ project: project.id, path: workflow.path, name: workflow.name });
        }
      } catch {
        // One broken workflow should not break the skill page.
      }
    }
  }

  return {
    skill: { ...summary, evalSummary: summaries[name] ?? null },
    skillMd: readFileSync(skillMdPath, "utf8").slice(0, 40_000),
    inWorkflow: {
      pass: inWorkflowRecords.filter((r) => r.status === "pass").length,
      total: inWorkflowRecords.length,
    },
    cases,
    usedIn,
  };
}

export function listPlayground(skill: string): { records: PlaygroundRecord[]; pending: PlaygroundProcess[] } {
  assertSkillExists(skill);
  const records: PlaygroundRecord[] = [];
  const dir = join(PLAYGROUND_ROOT, skill);
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).sort().reverse()) {
      if (!file.endsWith(".json")) continue;
      try {
        const record = JSON.parse(readFileSync(join(dir, file), "utf8")) as PlaygroundRecord;
        if (record.skill === skill) records.push(record);
      } catch {
        // skip unreadable records
      }
    }
  }
  records.sort((a, b) => b.createdAtMs - a.createdAtMs);

  const pending: PlaygroundProcess[] = [];
  if (existsSync(PLAYGROUND_STATE_DIR)) {
    for (const file of readdirSync(PLAYGROUND_STATE_DIR).sort().reverse()) {
      if (!file.startsWith("playground-") || !file.endsWith(".json") || file.endsWith(".params.json")) continue;
      try {
        const sidecar = JSON.parse(readFileSync(join(PLAYGROUND_STATE_DIR, file), "utf8"));
        if (sidecar.skill === skill) pending.push({ ...sidecar, running: pidAlive(sidecar.pid) });
      } catch {
        // skip unreadable sidecars
      }
    }
  }
  return { records, pending };
}

export function startPlayground(options: { skill?: string; prompt?: string; model?: string; fixtureCase?: string; smoke?: boolean }) {
  const skill = options.skill ?? "";
  assertSkillExists(skill);
  const prompt = options.prompt?.trim();
  if (!prompt) throw new HttpError(400, "prompt is required");
  const model = options.model || DEFAULT_AGENT;
  let fixtureCase: string | undefined;
  if (options.fixtureCase) {
    fixtureCase = safeFixtureCaseName(options.fixtureCase);
    const inputDir = join(SKILLS_ROOT, skill, "evals", fixtureCase, "input");
    if (!existsSync(inputDir)) throw new HttpError(404, `fixture input not found: ${fixtureCase}`);
  }

  mkdirSync(join(PLAYGROUND_ROOT, skill), { recursive: true });
  mkdirSync(PLAYGROUND_STATE_DIR, { recursive: true });
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const paramsPath = join(PLAYGROUND_STATE_DIR, `playground-${tag}.params.json`);
  const outPath = join(PLAYGROUND_ROOT, skill, `${tag}.json`);
  const logPath = join(PLAYGROUND_STATE_DIR, `playground-${tag}.log`);
  writeFileSync(paramsPath, JSON.stringify({ skill, prompt, model, fixtureCase, smoke: Boolean(options.smoke) }, null, 2));

  const argv = ["bun", "ui/playground.ts", "--params", paramsPath, "--out", outPath];
  const fd = openSync(logPath, "a");
  const child = spawn(argv[0], argv.slice(1), {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  closeSync(fd);

  const sidecar = {
    pid: child.pid ?? -1,
    tag,
    skill,
    model,
    ...(fixtureCase ? { fixtureCase } : {}),
    argv,
    paramsPath: paramsPath.slice(REPO_ROOT.length + 1),
    outPath: outPath.slice(REPO_ROOT.length + 1),
    logPath: logPath.slice(REPO_ROOT.length + 1),
    startedAtMs: Date.now(),
  };
  writeFileSync(join(PLAYGROUND_STATE_DIR, `playground-${tag}.json`), JSON.stringify(sidecar, null, 2));
  return { ok: true, tag, sidecar: { ...sidecar, running: pidAlive(sidecar.pid) } };
}

export function promotePlayground(skill: string, id: string) {
  assertSkillExists(skill);
  const record = readPlaygroundRecord(skill, id);
  if (!record.workspace || !existsSync(record.workspace)) {
    throw new HttpError(410, `playground workspace is gone for ${id}`);
  }
  const validator = findSkillValidator(skill);
  if (!validator) throw new HttpError(409, `skill has no validator: ${skill}`);

  const candidateRel = join("runs", "generate", skill, `playground-${id}`);
  const candidate = join(REPO_ROOT, candidateRel);
  if (existsSync(candidate)) throw new HttpError(409, `candidate already exists: ${candidateRel}`);
  mkdirSync(candidate, { recursive: true });
  writeFileSync(join(candidate, "prompt.md"), record.prompt, "utf8");

  const inputDir = join(candidate, "input");
  mkdirSync(inputDir, { recursive: true });
  if (record.fixtureCase) {
    const sourceInput = join(SKILLS_ROOT, skill, "evals", safeFixtureCaseName(record.fixtureCase), "input");
    if (existsSync(sourceInput)) {
      assertNoSymlinks(sourceInput);
      cpSync(sourceInput, inputDir, { recursive: true });
    }
  }

  const expectedDir = join(candidate, "expected");
  mkdirSync(expectedDir, { recursive: true });
  const lagunaDir = join(record.workspace, ".laguna");
  if (existsSync(lagunaDir)) cpSync(lagunaDir, join(expectedDir, ".laguna"), { recursive: true });

  const metadata = {
    id: `playground-${id}`,
    skill,
    bucket: "candidate",
    arms: ["xs_without_skill", "xs_with_skill"],
    validator: {
      command: ["bun", `skills/${skill}/scripts/${basename(validator)}`],
      expected_status: "pass",
    },
    notes: `promoted from playground run ${id} — review before gen_eval_cases.py --promote`,
  };
  writeFileSync(join(candidate, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  const command = `uv run harness/generate/gen_eval_cases.py --skill ${skill} --validate-only ${candidateRel}`;
  return { ok: true, path: candidateRel, command };
}

// ===========================================================================
// Node-level evals
//
// Two modes, one record shape:
//   in-workflow — grade a node's REAL output inside a finished workflow run:
//     run the node's installed skill validator against the node's workspace.
//   standalone  — lift the node out: re-run its prompt N times in fresh
//     copies of its workspace (skill reinstalled), grade each trial.
// This is how you see whether a node (often: a single skill + prompt)
// performs differently inside the workflow vs. on its own.

export type NodeEvalRecord = {
  kind: "node-eval";
  id: string;
  project: string;
  workflowPath: string | null;
  nodeId: string;
  mode: "in-workflow" | "standalone";
  runId: string | null;
  trial: number | null;
  skill: string | null;
  grader: "skill-validator" | "exit-code";
  status: "pass" | "fail" | "error";
  score: number | null;
  checks: { id: string; status: string; detail?: string }[];
  durationMs: number | null;
  trajectoryUrl: string | null;
  workspace: string | null;
  agentName: string | null;
  gradedAtMs: number;
  note?: string;
};

function nodeEvalsDir(project: Project): string {
  return join(project.root, "node-evals");
}

function saveNodeEval(project: Project, record: NodeEvalRecord): void {
  const dir = join(nodeEvalsDir(project), "records");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2));
}

export function listNodeEvals(project: Project): NodeEvalRecord[] {
  const dir = join(nodeEvalsDir(project), "records");
  if (!existsSync(dir)) return [];
  const records: NodeEvalRecord[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      records.push(JSON.parse(readFileSync(join(dir, file), "utf8")));
    } catch {
      // unreadable record; skip
    }
  }
  records.sort((a, b) => b.gradedAtMs - a.gradedAtMs);
  return records;
}

function findSkillValidator(skill: string): string | null {
  const scriptsDir = join(SKILLS_ROOT, skill, "scripts");
  if (!existsSync(scriptsDir)) return null;
  const validator = readdirSync(scriptsDir).find((f) => f.startsWith("validate_") && f.endsWith(".ts"));
  return validator ? join(scriptsDir, validator) : null;
}

export async function gradeWorkspace(
  skill: string | null,
  workspace: string,
  fallbackExitCode: number | null,
): Promise<Pick<NodeEvalRecord, "grader" | "status" | "score" | "checks">> {
  const validator = skill ? findSkillValidator(skill) : null;
  if (validator) {
    const outPath = join(mkdtempSync(join(tmpdir(), "node-eval-")), "result.json");
    const result = await runCommand(
      ["bun", validator, "--workspace", workspace, "--out", outPath],
      REPO_ROOT,
      120_000,
      { scrubEnv: true }, // validators may be model-authored; no tokens
    );
    try {
      const parsed = JSON.parse(readFileSync(outPath, "utf8"));
      return {
        grader: "skill-validator",
        status: parsed.status === "pass" ? "pass" : parsed.status === "fail" ? "fail" : "error",
        score: typeof parsed.score === "number" ? parsed.score : null,
        checks: Array.isArray(parsed.checks) ? parsed.checks : [],
      };
    } catch {
      return {
        grader: "skill-validator",
        status: "error",
        score: null,
        checks: [
          {
            id: "validator-ran",
            status: "error",
            detail: `validator exited ${result.exitCode} without a readable result`,
          },
        ],
      };
    }
  }
  return {
    grader: "exit-code",
    status: fallbackExitCode === 0 ? "pass" : "fail",
    score: fallbackExitCode === 0 ? 1 : 0,
    checks: [{ id: "pool-exit-code", status: fallbackExitCode === 0 ? "pass" : "fail", detail: `exit ${fallbackExitCode}` }],
  };
}

/** Grade every node of a finished workflow run in place. Caveat recorded on
 * each record: node workspaces are shared across runs, so the grade reflects
 * the workspace as it exists NOW. */
export async function evalWorkflowNodes(project: Project, runId: string): Promise<NodeEvalRecord[]> {
  const detail = runDetail(project, runId);
  const tagBase = Date.now().toString(36);
  const records: NodeEvalRecord[] = [];
  for (const node of detail.nodes) {
    const capture = detail.captures
      .filter((c) => c.matchedNodeId === node.nodeId && c.cwd)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!capture?.cwd) {
      const record: NodeEvalRecord = {
        kind: "node-eval",
        id: `${tagBase}-insitu-${node.nodeId}`,
        project: project.id,
        workflowPath: detail.run.workflowPath,
        nodeId: node.nodeId,
        mode: "in-workflow",
        runId,
        trial: null,
        skill: null,
        grader: "exit-code",
        status: "error",
        score: null,
        checks: [],
        durationMs: null,
        trajectoryUrl: null,
        workspace: null,
        agentName: null,
        gradedAtMs: Date.now(),
        note: "no pool capture matched this node (capture overwritten or run predates capture tagging); cannot locate its workspace",
      };
      saveNodeEval(project, record);
      records.push(record);
      continue;
    }
    const skill = capture.skillInstalled ? basename(capture.skillInstalled) : null;
    const graded = await gradeWorkspace(skill, capture.cwd, capture.exitCode);
    const record: NodeEvalRecord = {
      kind: "node-eval",
      id: `${tagBase}-insitu-${node.nodeId}`,
      project: project.id,
      workflowPath: detail.run.workflowPath,
      nodeId: node.nodeId,
      mode: "in-workflow",
      runId,
      trial: null,
      skill,
      ...graded,
      durationMs: capture.durationMs,
      trajectoryUrl: capture.trajectoryUrl,
      workspace: capture.cwd,
      agentName: null,
      gradedAtMs: Date.now(),
      note: "workspace is shared across runs; grade reflects its current contents",
    };
    saveNodeEval(project, record);
    records.push(record);
  }
  return records;
}

/** Find the node's most recent workspace + skill from prior run captures. */
function latestNodeCapture(project: Project, workflowPath: string, nodeId: string): PoolCapture | null {
  for (const run of listRuns(project)) {
    if (run.workflowPath && !run.workflowPath.endsWith(workflowPath.replace(/^\.\//, ""))) continue;
    try {
      const detail = runDetail(project, run.id);
      const capture = detail.captures
        .filter((c) => c.matchedNodeId === nodeId && c.cwd)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      if (capture) return capture;
    } catch {
      // run unreadable; keep looking
    }
  }
  return null;
}

export type NodeFacts = {
  nodeId: string;
  skill: string | null;
  agentName: string | null;
  lastEvals: NodeEvalRecord[];
};

/** Per-node enrichment for the canvas inspector: skill + model recovered
 * from the node's most recent pool capture, grades from node-evals.
 * Scans at most the 10 most recent runs of this workflow. */
export function workflowNodeFacts(project: Project, relPath: string, nodeIds: string[]): NodeFacts[] {
  const evals = listNodeEvals(project);
  const wanted = new Set(nodeIds);
  const captureByNode = new Map<string, PoolCapture>();
  let scanned = 0;
  for (const run of listRuns(project)) {
    if (scanned >= 10 || captureByNode.size === wanted.size) break;
    if (run.workflowPath && !run.workflowPath.endsWith(relPath.replace(/^\.\//, ""))) continue;
    scanned++;
    try {
      const detail = runDetail(project, run.id);
      for (const c of [...detail.captures].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
        if (c.matchedNodeId && wanted.has(c.matchedNodeId) && !captureByNode.has(c.matchedNodeId)) {
          captureByNode.set(c.matchedNodeId, c);
        }
      }
    } catch {
      // unreadable run; keep looking
    }
  }
  return nodeIds.map((nodeId) => {
    const capture = captureByNode.get(nodeId) ?? null;
    let agentName: string | null = null;
    if (capture) {
      try {
        const meta = JSON.parse(readFileSync(join(project.root, capture.dir, "meta.json"), "utf8"));
        const argv = Array.isArray(meta.argv) ? (meta.argv as string[]) : [];
        const i = argv.indexOf("--agent-name");
        agentName = i >= 0 ? argv[i + 1] : null;
      } catch {
        // capture meta unreadable
      }
    }
    return {
      nodeId,
      skill: capture?.skillInstalled ? basename(capture.skillInstalled) : null,
      agentName,
      lastEvals: evals
        .filter(
          (r) =>
            r.nodeId === nodeId &&
            (!r.workflowPath || r.workflowPath.endsWith(relPath.replace(/^\.\//, ""))),
        )
        .slice(0, 5),
    };
  });
}

// ===========================================================================
// Review-app integration: fold workbench records into the annotation tool.
//
// harness/review/serve.py serves harness/review/app over runs/review/
// traces.json + labels.json. syncReviewTraces adds "workbench/*" traces —
// one per matched workflow-node pool call, one per standalone node-eval
// trial — in the same trace shape extract_traces.py emits, replacing only
// previously-synced workbench traces (harness traces and labels untouched).

const REVIEW_TRACES_PATH = join(REPO_ROOT, "runs", "review", "traces.json");

function lastThought(stdoutNdjson: string): string | null {
  let last: string | null = null;
  for (const line of stdoutNdjson.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "thought" && typeof event.thought === "string" && event.thought.trim()) {
        last = event.thought.trim();
      }
    } catch {
      // non-JSON line
    }
  }
  return last;
}

function nljsonSteps(stdoutNdjson: string): { kind: string; title: string; detail: string }[] {
  const steps: { kind: string; title: string; detail: string }[] = [];
  for (const line of stdoutNdjson.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (!event?.type) continue;
      const title =
        event.type === "toolCall" ? `toolCall · ${event.name ?? "tool"}` : String(event.type);
      steps.push({ kind: String(event.type), title, detail: line.slice(0, 2000) });
    } catch {
      // non-JSON line
    }
    if (steps.length >= 200) break;
  }
  return steps;
}

export function lagunaArtifacts(workspace: string | null): { path: string; content: string; missing: boolean }[] {
  if (!workspace) return [];
  const dir = join(workspace, ".laguna");
  if (!existsSync(dir)) return [];
  const files: { path: string; content: string; missing: boolean }[] = [];
  for (const f of readdirSync(dir)) {
    try {
      files.push({
        path: `.laguna/${f}`,
        content: readFileSync(join(dir, f), "utf8").slice(0, 20_000),
        missing: false,
      });
    } catch {
      files.push({ path: `.laguna/${f}`, content: "", missing: true });
    }
  }
  return files;
}

export type NodeArtifacts = {
  prompt: string | null;
  skill: string | null;
  traceId: string | null;
  files: {
    path: string;
    model: { content: string; missing: boolean };
    gold: { content: string; case: string } | null;
  }[];
  checks: { id: string; status: string; detail?: string }[];
  status: "pass" | "fail" | "error" | "ungraded";
};

/** Everything the expanded node row needs: the node's prompt (capture
 * prompt.md), its model artifacts (workspace .laguna/), the latest
 * in-workflow grade, and — when the grading skill ships eval cases — a gold
 * reference example matched by workspace-relative artifact path. The gold
 * is labeled a reference EXAMPLE: one acceptable answer from
 * skills/<skill>/evals/<case>/expected/, not this node's own gold. */
export function nodeArtifacts(project: Project, runId: string, nodeId: string): NodeArtifacts {
  const detail = runDetail(project, runId);
  const capture = detail.captures
    .filter((c) => c.matchedNodeId === nodeId && c.cwd)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
  const latestEval =
    listNodeEvals(project).find((r) => r.mode === "in-workflow" && r.runId === runId && r.nodeId === nodeId) ??
    null;
  const skill = capture?.skillInstalled ? basename(capture.skillInstalled) : (latestEval?.skill ?? null);
  let prompt: string | null = null;
  if (capture) {
    try {
      prompt = readFileSync(join(project.root, capture.dir, "prompt.md"), "utf8");
    } catch {
      // partial capture; keep null prompt
    }
  }
  const modelFiles = capture?.cwd ? lagunaArtifacts(capture.cwd) : [];
  const files = modelFiles.map((f) => ({
    path: f.path,
    model: { content: f.content, missing: f.missing },
    gold: goldReference(skill, f.path),
  }));
  return {
    prompt,
    skill,
    traceId: capture ? `workbench/${runId.slice(0, 8)}/${nodeId}/${basename(capture.dir)}` : null,
    files,
    checks: latestEval?.checks ?? [],
    status: latestEval ? latestEval.status : "ungraded",
  };
}

/** First gold file at the same workspace-relative path across the skill's
 * eval cases (expected/ mirrors the workspace layout — e.g.
 * expected/.laguna/ci-log-summary.json). */
function goldReference(skill: string | null, relPath: string): { content: string; case: string } | null {
  if (!skill) return null;
  const evalsDir = join(SKILLS_ROOT, skill, "evals");
  if (!existsSync(evalsDir)) return null;
  for (const caseDir of readdirSync(evalsDir).sort()) {
    const goldPath = join(evalsDir, caseDir, "expected", relPath);
    if (existsSync(goldPath)) {
      try {
        return { content: readFileSync(goldPath, "utf8").slice(0, 20_000), case: caseDir };
      } catch {
        // unreadable gold; keep searching
      }
    }
  }
  return null;
}

function validatorResultFromNodeEval(record: NodeEvalRecord | null) {
  if (!record) return null;
  return {
    schema_version: "validator-result.v1",
    case_id: record.nodeId,
    status: record.status,
    score: record.score,
    checks: record.checks,
    repair_feedback: [],
    duration_ms: record.durationMs,
  };
}

export function syncReviewTraces(project: Project): { added: number; total: number } {
  const traces: Record<string, unknown>[] = [];

  const latestInWorkflowEval = new Map<string, NodeEvalRecord>();
  const nodeEvals = listNodeEvals(project);
  for (const r of nodeEvals) {
    if (r.mode === "in-workflow" && r.runId) {
      const key = `${r.runId}:${r.nodeId}`;
      if (!latestInWorkflowEval.has(key)) latestInWorkflowEval.set(key, r); // sorted desc
    }
  }

  for (const run of listRuns(project)) {
    let detail: ReturnType<typeof runDetail>;
    try {
      detail = runDetail(project, run.id);
    } catch {
      continue;
    }
    for (const capture of detail.captures) {
      if (!capture.matchedNodeId) continue;
      const dirAbs = join(project.root, capture.dir);
      let meta: Record<string, unknown> = {};
      let prompt: string | null = null;
      let stdout = "";
      let stderrTail: string | null = null;
      try {
        meta = JSON.parse(readFileSync(join(dirAbs, "meta.json"), "utf8"));
        prompt = readFileSync(join(dirAbs, "prompt.md"), "utf8");
        stdout = readFileSync(join(dirAbs, "stdout.ndjson"), "utf8");
        stderrTail = readFileSync(join(dirAbs, "stderr.txt"), "utf8").slice(-4000);
      } catch {
        // partial captures still get a trace from what's readable
      }
      const argv = Array.isArray(meta.argv) ? (meta.argv as string[]) : [];
      const agentIdx = argv.indexOf("--agent-name");
      const nodeEval = latestInWorkflowEval.get(`${run.id}:${capture.matchedNodeId}`) ?? null;
      const skill = capture.skillInstalled ? basename(capture.skillInstalled) : null;
      traces.push({
        trace_id: `workbench/${run.id.slice(0, 8)}/${capture.matchedNodeId}/${basename(capture.dir)}`,
        demo: false,
        suite: "workbench",
        case_id: `${run.title} · ${capture.matchedNodeId}`,
        arm: "in-workflow",
        skill,
        agent_name: agentIdx >= 0 ? argv[agentIdx + 1] : null,
        pool_version: null,
        run_id: run.id,
        bucket: null,
        difficulty: null,
        expected_status: nodeEval ? "pass" : null,
        case_notes: `Smithers workflow node "${capture.matchedNodeId}" of ${run.title} (${run.id}); workspace ${capture.cwd ?? "?"}`,
        validator: validatorResultFromNodeEval(nodeEval),
        graded_pass: nodeEval ? nodeEval.status === "pass" : null,
        exit_code: capture.exitCode,
        duration_ms: capture.durationMs,
        timed_out: meta.timedOut ?? false,
        activation: capture.skillToolCalls > 0 ? "yes" : skill ? "no (installed, not invoked)" : "n/a (no skill)",
        model_facts: null,
        prompt,
        final_message: lastThought(stdout),
        output_files: lagunaArtifacts(capture.cwd),
        gold_files: [],
        trajectory: nljsonSteps(stdout),
        stderr_tail: stderrTail,
        harness_debt: [],
        command: argv,
        judge: null,
      });
    }
  }

  for (const record of nodeEvals) {
    if (record.mode !== "standalone") continue;
    traces.push({
      trace_id: `workbench/standalone/${record.id}`,
      demo: false,
      suite: "workbench",
      case_id: `${(record.workflowPath ?? "workflow").split("/").pop()} · ${record.nodeId}`,
      arm: `standalone #${record.trial ?? 1}`,
      skill: record.skill,
      agent_name: record.agentName,
      pool_version: null,
      run_id: record.id,
      bucket: null,
      difficulty: null,
      expected_status: "pass",
      case_notes: `Standalone node-eval trial; fresh workspace copy at ${record.workspace ?? "?"}${record.note ? `; ${record.note}` : ""}`,
      validator: validatorResultFromNodeEval(record),
      graded_pass: record.status === "pass",
      exit_code: null,
      duration_ms: record.durationMs,
      timed_out: false,
      activation: record.skill ? "yes (skill reinstalled per trial)" : "n/a (no skill)",
      model_facts: null,
      prompt: null,
      final_message: record.trajectoryUrl ? `Trajectory: ${record.trajectoryUrl}` : null,
      output_files: lagunaArtifacts(record.workspace),
      gold_files: [],
      trajectory: [],
      stderr_tail: null,
      harness_debt: [],
      command: null,
      judge: null,
    });
  }

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(REVIEW_TRACES_PATH, "utf8"));
  } catch {
    // no traces.json yet; start fresh
  }
  const kept = (Array.isArray(existing.traces) ? existing.traces : []).filter(
    (t: { trace_id?: unknown }) => !String(t?.trace_id ?? "").startsWith("workbench/"),
  );
  const all = [...kept, ...traces].sort((a, b) =>
    String(a.trace_id).localeCompare(String(b.trace_id)),
  );
  mkdirSync(join(REPO_ROOT, "runs", "review"), { recursive: true });
  const payload = {
    schema_version: existing.schema_version ?? "review-traces.v0",
    demo: false,
    trace_count: all.length,
    traces: all,
  };
  const tmpPath = `${REVIEW_TRACES_PATH}.tmp-${Date.now().toString(36)}`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 1) + "\n");
  renameSync(tmpPath, REVIEW_TRACES_PATH);
  return { added: traces.length, total: all.length };
}

// ===========================================================================
// Unified runs feed

export type FeedRecord = {
  type: "workflow" | "eval" | "node" | "playground";
  id: string;
  title: string;
  skill: string | null;
  workflow: string | null;
  arm: string | null;
  model: string | null;
  atMs: number | null;
  durationMs: number | null;
  verdict: "pass" | "fail" | "error" | "running" | "ungraded";
  score: number | null;
  label: "pass" | "fail" | "defer" | null;
  traceId: string | null;
  children?: FeedRecord[];
};

export type SkillScorecardRow = {
  skill: string;
  lift: number | null;
  withSkill: { pass: number; total: number; avgScore: number | null };
  withoutSkill: { pass: number; total: number; avgScore: number | null };
  inWorkflow: { pass: number; total: number };
  unlabeledFails: number;
};

const REVIEW_LABELS_PATH = join(REPO_ROOT, "runs", "review", "labels.json");

type ReviewLabelEntry = { label?: unknown; updated_at?: unknown };
type ReviewLabels = Record<string, ReviewLabelEntry>;

function parseTimeMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function loadReviewLabels(): ReviewLabels {
  try {
    const parsed = JSON.parse(readFileSync(REVIEW_LABELS_PATH, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Missing or corrupt labels.json must not break the read-only feed.
    return {};
  }
}

function normalizeReviewLabel(entry: ReviewLabelEntry | undefined): FeedRecord["label"] {
  return entry?.label === "pass" || entry?.label === "fail" || entry?.label === "defer"
    ? entry.label
    : null;
}

function newestLabelKeyWithPrefix(labels: ReviewLabels, prefix: string): string | null {
  const matches = Object.keys(labels).filter((key) => key.startsWith(prefix));
  if (!matches.length) return null;
  // Deliberate approximation: capture-dir suffixes are not present on node
  // eval records, so choose the lexicographically newest matching trace key.
  matches.sort((a, b) => a.localeCompare(b));
  return matches[matches.length - 1];
}

function labelForTrace(labels: ReviewLabels, traceId: string | null, prefix?: string): FeedRecord["label"] {
  if (traceId) {
    const exact = normalizeReviewLabel(labels[traceId]);
    if (exact) return exact;
  }
  if (prefix) return normalizeReviewLabel(labels[newestLabelKeyWithPrefix(labels, prefix) ?? ""]);
  return null;
}

function evalVerdict(run: EvalRunRecord): FeedRecord["verdict"] {
  if (run.status === "running") return "running";
  if (run.gradedPass === true) return "pass";
  if (run.gradedPass === false) return "fail";
  if (run.status === "error") return "error";
  if (run.status === "fail") return "fail";
  return "ungraded";
}

function nodeVerdict(status: NodeEvalRecord["status"]): FeedRecord["verdict"] {
  return status === "pass" ? "pass" : status === "fail" ? "fail" : "error";
}

function workflowVerdict(run: TrajectoryRecord, nodeEvals: NodeEvalRecord[]): FeedRecord["verdict"] {
  if (["running", "pending", "started"].includes(run.status)) return "running";
  if (["failed", "cancelled", "error"].includes(run.status)) return "error";
  if (nodeEvals.length > 0) return nodeEvals.every((r) => r.status === "pass") ? "pass" : "fail";
  return "ungraded";
}

function liftFromSummary(summary: SkillEvalSummary): number | null {
  if (summary.withSkill.total === 0 || summary.withoutSkill.total === 0) return null;
  const withRate = summary.withSkill.pass / summary.withSkill.total;
  const withoutRate = summary.withoutSkill.pass / summary.withoutSkill.total;
  return Math.round((withRate - withoutRate) * 1000) / 10;
}

function flattenFeed(records: FeedRecord[]): FeedRecord[] {
  const out: FeedRecord[] = [];
  for (const record of records) {
    out.push(record);
    if (record.children?.length) out.push(...flattenFeed(record.children));
  }
  return out;
}

/** Build the Runs page's one-feed view. Workflow details are capped to the
 * 30 newest workflow runs to keep the landing page responsive; if this grows
 * slow, add a short TTL cache rather than expanding the cap. */
export function buildFeed(project: Project): { scorecard: SkillScorecardRow[]; records: FeedRecord[] } {
  const labels = loadReviewLabels();
  const records: FeedRecord[] = [];
  const nodeEvals = listNodeEvals(project);
  const inWorkflowByRun = new Map<string, NodeEvalRecord[]>();
  for (const record of nodeEvals) {
    if (record.mode === "in-workflow" && record.runId) {
      const group = inWorkflowByRun.get(record.runId) ?? [];
      group.push(record);
      inWorkflowByRun.set(record.runId, group);
    }
  }

  const exactTraceByRunNode = new Map<string, string>();
  for (const run of listRuns(project).slice(0, 30)) {
    let skills: string[] = [];
    try {
      const detail = runDetail(project, run.id);
      skills = [...new Set(detail.captures
        .map((capture) => capture.skillInstalled ? basename(capture.skillInstalled) : null)
        .filter((skill): skill is string => Boolean(skill)))];
      for (const capture of detail.captures) {
        if (!capture.matchedNodeId) continue;
        exactTraceByRunNode.set(
          `${run.id}:${capture.matchedNodeId}`,
          `workbench/${run.id.slice(0, 8)}/${capture.matchedNodeId}/${basename(capture.dir)}`,
        );
      }
    } catch {
      // Unreadable historical runs still appear; they just lack skill joins.
    }
    const runNodeEvals = inWorkflowByRun.get(run.id) ?? [];
    const suffix = skills.length ? ` · skills: ${skills.join(", ")}` : "";
    records.push({
      type: "workflow",
      id: run.id,
      title: `${run.title}${suffix}`,
      skill: skills[0] ?? null,
      workflow: run.workflowPath,
      arm: null,
      model: null,
      atMs: run.finishedAtMs ?? run.startedAtMs ?? run.createdAtMs,
      durationMs: run.startedAtMs && run.finishedAtMs ? Math.max(0, run.finishedAtMs - run.startedAtMs) : null,
      verdict: workflowVerdict(run, runNodeEvals),
      score: null,
      label: null,
      traceId: null,
    });
  }

  const evalGroups = new Map<string, EvalRunRecord[]>();
  for (const run of listEvalRuns()) {
    const key = `${run.suite}/${run.caseId}`;
    const group = evalGroups.get(key) ?? [];
    group.push(run);
    evalGroups.set(key, group);
  }
  for (const [id, arms] of evalGroups) {
    arms.sort((a, b) => a.arm.localeCompare(b.arm));
    const children = arms.map((armRun): FeedRecord => {
      const traceId = `${armRun.suite}/${armRun.caseId}/${armRun.arm}`; // extract_traces.py exact format
      return {
        type: "eval",
        id: armRun.id,
        title: armRun.caseId,
        skill: armRun.skill,
        workflow: null,
        arm: armRun.arm,
        model: armRun.agentName,
        atMs: parseTimeMs(armRun.finishedAt) ?? parseTimeMs(armRun.startedAt),
        durationMs: armRun.durationMs,
        verdict: evalVerdict(armRun),
        score: armRun.score,
        label: labelForTrace(labels, traceId),
        traceId,
      };
    });
    const running = children.some((child) => child.verdict === "running");
    const errored = children.some((child) => child.verdict === "error");
    const graded = arms.filter((arm) => arm.gradedPass != null);
    const verdict: FeedRecord["verdict"] = running
      ? "running"
      : graded.length
        ? (graded.every((arm) => arm.gradedPass) ? "pass" : "fail")
        : (errored ? "error" : "ungraded");
    records.push({
      type: "eval",
      id,
      title: `${arms[0]?.caseId ?? id} · ${arms.length} arm${arms.length === 1 ? "" : "s"}`,
      skill: arms.find((arm) => arm.skill)?.skill ?? null,
      workflow: null,
      arm: null,
      model: null,
      atMs: Math.max(...children.map((child) => child.atMs ?? 0)) || null,
      durationMs: children.reduce((sum, child) => sum + (child.durationMs ?? 0), 0) || null,
      verdict,
      score: null,
      label: null,
      traceId: null,
      children,
    });
  }

  const standaloneGroups = new Map<string, NodeEvalRecord[]>();
  for (const record of nodeEvals) {
    if (record.mode === "in-workflow") {
      const prefix = record.runId ? `workbench/${record.runId.slice(0, 8)}/${record.nodeId}/` : undefined;
      const exactTraceId = record.runId ? exactTraceByRunNode.get(`${record.runId}:${record.nodeId}`) ?? null : null;
      records.push({
        type: "node",
        id: record.id,
        title: `${record.workflowPath ?? "workflow"} · ${record.nodeId}`,
        skill: record.skill,
        workflow: record.workflowPath,
        arm: "in-workflow",
        model: record.agentName,
        atMs: record.gradedAtMs,
        durationMs: record.durationMs,
        verdict: nodeVerdict(record.status),
        score: record.score,
        label: labelForTrace(labels, exactTraceId, prefix),
        traceId: exactTraceId,
      });
      continue;
    }
    const groupId = record.id.replace(/-\d+$/, "");
    const group = standaloneGroups.get(groupId) ?? [];
    group.push(record);
    standaloneGroups.set(groupId, group);
  }
  for (const [groupId, group] of standaloneGroups) {
    group.sort((a, b) => (a.trial ?? 0) - (b.trial ?? 0));
    const pass = group.filter((r) => r.status === "pass").length;
    const children = group.map((record): FeedRecord => {
      const traceId = `workbench/standalone/${record.id}`;
      return {
        type: "node",
        id: record.id,
        title: `trial ${record.trial ?? "?"} · ${record.nodeId}`,
        skill: record.skill,
        workflow: record.workflowPath,
        arm: `standalone #${record.trial ?? "?"}`,
        model: record.agentName,
        atMs: record.gradedAtMs,
        durationMs: record.durationMs,
        verdict: nodeVerdict(record.status),
        score: record.score,
        label: labelForTrace(labels, traceId),
        traceId,
      };
    });
    records.push({
      type: "node",
      id: groupId,
      title: `${group[0]?.workflowPath ?? "workflow"} · ${group[0]?.nodeId ?? "node"} · ${pass}/${group.length} pass`,
      skill: group.find((r) => r.skill)?.skill ?? null,
      workflow: group[0]?.workflowPath ?? null,
      arm: "standalone",
      model: group.find((r) => r.agentName)?.agentName ?? null,
      atMs: Math.max(...group.map((r) => r.gradedAtMs ?? 0)) || null,
      durationMs: group.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) || null,
      verdict: group.every((r) => r.status === "pass") ? "pass" : group.some((r) => r.status === "error") ? "error" : "fail",
      score: null,
      label: null,
      traceId: null,
      children,
    });
  }

  for (const skill of listSkills()) {
    try {
      for (const record of listPlayground(skill.name).records) {
        records.push({
          type: "playground",
          id: record.id,
          title: `playground · ${record.prompt.slice(0, 80) || skill.name}`,
          skill: record.skill,
          workflow: null,
          arm: record.fixtureCase ? `fixture ${record.fixtureCase}` : "empty workspace",
          model: record.agentName,
          atMs: record.createdAtMs,
          durationMs: record.durationMs,
          verdict: nodeVerdict(record.status),
          score: record.score,
          label: null,
          traceId: null,
        });
      }
    } catch {
      // Playground is additive; one corrupt record should not break the feed.
    }
  }

  records.sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0));

  const summaries = skillEvalSummaries();
  const skills = new Set<string>(Object.keys(summaries));
  for (const record of flattenFeed(records)) if (record.skill) skills.add(record.skill);

  const flat = flattenFeed(records);
  const scorecard: SkillScorecardRow[] = [...skills].sort().map((skill) => {
    const withSkill = summaries[skill]?.withSkill ?? { pass: 0, total: 0, avgScore: null };
    const withoutSkill = summaries[skill]?.withoutSkill ?? { pass: 0, total: 0, avgScore: null };
    const inWorkflowRecords = nodeEvals.filter((record) => record.mode === "in-workflow" && record.skill === skill);
    return {
      skill,
      lift: liftFromSummary({ withSkill, withoutSkill }),
      withSkill,
      withoutSkill,
      inWorkflow: {
        pass: inWorkflowRecords.filter((record) => record.status === "pass").length,
        total: inWorkflowRecords.length,
      },
      unlabeledFails: flat.filter((record) => record.skill === skill && record.verdict === "fail" && record.label == null).length,
    };
  });
  scorecard.sort((a, b) => {
    if (a.lift == null && b.lift == null) return a.skill.localeCompare(b.skill);
    if (a.lift == null) return 1;
    if (b.lift == null) return -1;
    return a.lift - b.lift || a.skill.localeCompare(b.skill);
  });

  return { scorecard, records };
}

/** Re-run one node's prompt in fresh workspace copies and grade each trial.
 * The fixture is the node's latest real workspace with prior outputs
 * (.laguna/) and skill installs (.poolside/) stripped, so every trial starts
 * clean; the node's skill is reinstalled from skills/. */
export async function evalNodeStandalone(
  project: Project,
  workflowPath: string,
  nodeId: string,
  options: { trials?: number; agentName?: string } = {},
): Promise<NodeEvalRecord[]> {
  const trials = Math.min(Math.max(options.trials ?? 1, 1), 10);
  const agentName = options.agentName || DEFAULT_AGENT;
  const graph = await workflowGraph(project, workflowPath);
  const node = graph.nodes.find((n) => n.id === nodeId && n.kind === "task");
  if (!node) throw new HttpError(404, `task node ${nodeId} not found in ${workflowPath}`);
  if (!node.prompt) {
    throw new HttpError(
      400,
      `node ${nodeId} has no static prompt in the graph projection (deps-function children are not standalone-evalable)`,
    );
  }

  const fixture = latestNodeCapture(project, workflowPath, nodeId);
  const skill = fixture?.skillInstalled ? basename(fixture.skillInstalled) : null;
  const { PoolAgent } = await import(
    join(REPO_ROOT, "experiments", "smithers-pool", "src", "PoolAgent.ts")
  );

  const tagBase = Date.now().toString(36);
  const records: NodeEvalRecord[] = [];
  for (let trial = 1; trial <= trials; trial++) {
    const trialDir = mkdtempSync(join(tmpdir(), `node-eval-${nodeId}-`));
    if (fixture?.cwd && existsSync(fixture.cwd)) {
      cpSync(fixture.cwd, trialDir, {
        recursive: true,
        filter: (src) => {
          const name = basename(src);
          return name !== ".laguna" && name !== ".poolside" && name !== "node_modules";
        },
      });
    }
    const agent = new PoolAgent({
      cwd: trialDir,
      agentName,
      id: `pool:node-eval:${nodeId}`,
      logDir: join(nodeEvalsDir(project), "captures"),
      ...(skill ? { skill: { name: skill, from: join(SKILLS_ROOT, skill) } } : {}),
    });
    const startedAt = Date.now();
    let exitOk = true;
    let note: string | undefined;
    try {
      await agent.generate({ prompt: node.prompt });
    } catch (error) {
      exitOk = false;
      note = error instanceof Error ? error.message.slice(0, 300) : String(error);
    }
    const call = agent.calls[agent.calls.length - 1];
    const graded = await gradeWorkspace(skill, trialDir, exitOk ? 0 : (call?.exitCode ?? 1));
    const record: NodeEvalRecord = {
      kind: "node-eval",
      id: `${tagBase}-solo-${nodeId}-${trial}`,
      project: project.id,
      workflowPath,
      nodeId,
      mode: "standalone",
      runId: null,
      trial,
      skill,
      ...graded,
      durationMs: Date.now() - startedAt,
      trajectoryUrl: call?.trajectoryUrl ?? null,
      workspace: trialDir,
      agentName,
      gradedAtMs: Date.now(),
      ...(note ? { note } : {}),
    };
    saveNodeEval(project, record);
    records.push(record);
  }
  return records;
}
