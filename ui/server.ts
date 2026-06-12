/**
 * Workbench HTTP server: static pages + JSON routes over ui/lib.ts.
 * The same substrate is scriptable for agents via `bun ui/bench.ts` (CLI).
 *
 *   bun ui/server.ts            # http://127.0.0.1:4319/workflows.html
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  acceptProposal,
  listOptimizeRuns,
  appendEvidence,
  DEFAULT_AGENT,
  buildFeed,
  discoverProjects,
  dismissProposal,
  editWorkflow,
  evalNodeStandalone,
  evalWorkflowNodes,
  generateSkill,
  generateStatus,
  generateWorkflow,
  getProject,
  HttpError,
  listEvalRuns,
  listEvalSuites,
  listHarnessProcesses,
  listModels,
  listNodeEvals,
  listPlayground,
  nodeArtifacts,
  listProposals,
  listRuns,
  listSkills,
  listWorkflows,
  promotePlayground,
  REPO_ROOT,
  revertWorkflow,
  runDetail,
  safeWorkflowPath,
  skillDetail,
  skillEvalSummaries,
  startEvalRun,
  startGenerate,
  startPlayground,
  startRun,
  startSuggest,
  syncReviewTraces,
  workflowGraph,
  workflowNodeFacts,
} from "./lib.ts";
import { spawn } from "node:child_process";

const PORT = Number(process.env.UI_PORT ?? 4319);
const REVIEW_PORT = Number(process.env.REVIEW_PORT ?? 8901);

// --- harness/review companion server (the trace annotation app) -----------

async function reviewRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${REVIEW_PORT}/api/traces`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureReviewServer(): Promise<void> {
  if (await reviewRunning()) return;
  const child = spawn(
    "uv",
    ["run", "harness/review/serve.py", "--port", String(REVIEW_PORT)],
    { cwd: REPO_ROOT, env: process.env, stdio: ["ignore", "ignore", "ignore"], detached: true },
  );
  child.unref();
}

async function proxyReview(path: string, init?: RequestInit): Promise<Response> {
  const target = `http://127.0.0.1:${REVIEW_PORT}${path}`;
  try {
    const res = await fetch(target, { ...init, signal: AbortSignal.timeout(10_000) });
    return new Response(await res.arrayBuffer(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    void ensureReviewServer();
    return json({ error: "review server not reachable; starting it — retry in a few seconds" }, 503);
  }
}

const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/skill.html": "skill.html",
  "/workflows.html": "workflows.html",
  "/styles.css": "styles.css",
};

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requireSafeSegment(value: string | undefined, label: string): string {
  if (!value || !/^[A-Za-z0-9._:-]+$/.test(value) || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new HttpError(400, `invalid ${label}`);
  }
  return value;
}

function requireSkillName(value: string | undefined): string {
  if (!value || !/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new HttpError(400, "invalid skill");
  return value;
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 240,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      // Generic static for the workbench frontend: ui/**.js|css only, no traversal.
      if (req.method === "GET" && /^\/ui\/[A-Za-z0-9_\/-]+\.(js|css)$/.test(url.pathname)) {
        const abs = join(REPO_ROOT, url.pathname.slice(1));
        if (abs.startsWith(join(REPO_ROOT, "ui") + "/") && existsSync(abs)) {
          const uiRoot = realpathSync(join(REPO_ROOT, "ui"));
          const realAbs = realpathSync(abs);
          if (realAbs.startsWith(uiRoot + "/")) {
            return new Response(Bun.file(realAbs), { headers: { "content-type": contentType(realAbs) } });
          }
        }
      }

      const staticFile = STATIC_FILES[url.pathname];
      if (staticFile && req.method === "GET") {
        return new Response(Bun.file(join(REPO_ROOT, staticFile)), {
          headers: { "content-type": contentType(staticFile) },
        });
      }

      const project = () => getProject(url.searchParams.get("project"));

      if (req.method === "GET") {
        if (url.pathname === "/api/projects")
          return json(discoverProjects().map(({ root: _root, ...p }) => p));
        if (url.pathname === "/api/models") return json(await listModels());
        if (url.pathname === "/api/runs") return json(listRuns(project()));
        if (url.pathname === "/api/feed") return json(buildFeed(project()));
        if (url.pathname === "/api/optimize/runs") return json(listOptimizeRuns());
        const runMatch = url.pathname.match(/^\/api\/runs\/([A-Za-z0-9._:-]+)$/);
        if (runMatch) return json(runDetail(project(), runMatch[1]));
        if (url.pathname === "/api/workflows") return json(listWorkflows(project()));
        if (url.pathname === "/api/workflows/graph") {
          const path = url.searchParams.get("path");
          if (!path) throw new HttpError(400, "path query param required");
          return json(await workflowGraph(project(), path));
        }
        if (url.pathname === "/api/workflows/nodes") {
          const path = url.searchParams.get("path");
          if (!path) throw new HttpError(400, "path query param required");
          const graph = await workflowGraph(project(), path);
          const taskIds = graph.nodes.filter((n) => n.kind === "task").map((n) => n.id);
          return json(workflowNodeFacts(project(), path, taskIds));
        }
        if (url.pathname === "/api/workflows/source") {
          const path = url.searchParams.get("path");
          if (!path) throw new HttpError(400, "path query param required");
          const abs = safeWorkflowPath(project(), path);
          if (!existsSync(abs)) throw new HttpError(404, `workflow not found: ${path}`);
          return new Response(readFileSync(abs, "utf8"), {
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        if (url.pathname === "/api/skills") {
          const summaries = skillEvalSummaries();
          return json(listSkills().map((s) => ({ ...s, evalSummary: summaries[s.name] ?? null })));
        }
        if (url.pathname === "/api/skill-detail") {
          return json(skillDetail(requireSkillName(url.searchParams.get("name") ?? undefined)));
        }
        if (url.pathname === "/api/playground") {
          return json(listPlayground(requireSkillName(url.searchParams.get("skill") ?? undefined)));
        }
        if (url.pathname === "/api/proposals") {
          const skill = url.searchParams.get("skill");
          if (!skill) throw new HttpError(400, "skill query param required");
          return json(listProposals(skill));
        }
        if (url.pathname === "/api/evals/suites") return json(listEvalSuites());
        if (url.pathname === "/api/evals/runs")
          return json({ harness: listHarnessProcesses(), runs: listEvalRuns() });
        if (url.pathname === "/api/node-evals") return json(listNodeEvals(project()));
        if (url.pathname === "/api/node-artifacts") {
          const runId = url.searchParams.get("runId");
          const nodeId = url.searchParams.get("nodeId");
          if (!runId || !nodeId) throw new HttpError(400, "runId and nodeId are required");
          if (!/^[A-Za-z0-9._:-]+$/.test(runId)) throw new HttpError(400, "invalid runId");
          if (!/^[A-Za-z0-9._:-]+$/.test(nodeId)) throw new HttpError(400, "invalid nodeId");
          return json(nodeArtifacts(project(), runId, nodeId));
        }
        if (url.pathname === "/api/review/status") {
          return json({ url: `http://127.0.0.1:${REVIEW_PORT}/`, running: await reviewRunning() });
        }
        if (url.pathname === "/api/review/traces") return proxyReview(`/api/traces${url.search}`);
        if (url.pathname === "/api/review/labels") return proxyReview(`/api/labels${url.search}`);
        if (url.pathname === "/api/review/version") return proxyReview(`/api/version${url.search}`);
        if (url.pathname === "/api/generate/status") {
          const tag = url.searchParams.get("tag");
          if (!tag) throw new HttpError(400, "tag query param required");
          return json(generateStatus(tag));
        }
      }

      if (req.method === "POST") {
        // Same-origin gate: browsers attach Origin to every POST; a foreign
        // origin means a cross-site request against this local server (the
        // classic localhost-dev-server CSRF). No Origin = curl/CLI, allowed.
        const origin = req.headers.get("origin");
        if (origin) {
          let host = "";
          try {
            host = new URL(origin).host;
          } catch {
            throw new HttpError(403, `malformed Origin: ${origin}`);
          }
          if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) {
            throw new HttpError(403, `cross-origin POST rejected (origin ${origin})`);
          }
        }
        if (url.pathname === "/api/review/labels") {
          return proxyReview("/api/labels", {
            method: "POST",
            body: await req.text(),
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === "/api/generate/start") {
          const body = (await req.json()) as {
            kind?: string;
            prompt?: string;
            project?: string;
            id?: string;
            name?: string;
            agentName?: string;
            smoke?: boolean;
          };
          return json(startGenerate(body));
        }
        if (url.pathname === "/api/workflows/generate") {
          const body = (await req.json()) as {
            project?: string;
            prompt?: string;
            id?: string;
            agentName?: string;
          };
          if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");
          return json(
            await generateWorkflow(getProject(body.project ?? null), body.prompt, {
              id: body.id,
              agentName: body.agentName || DEFAULT_AGENT,
            }),
          );
        }
        if (url.pathname === "/api/workflows/run") {
          const body = (await req.json()) as {
            project?: string;
            path?: string;
            input?: Record<string, unknown>;
          };
          if (!body.path) throw new HttpError(400, "path is required");
          return json(await startRun(getProject(body.project ?? null), body.path, body.input));
        }
        if (url.pathname === "/api/workflows/edit") {
          const body = (await req.json()) as {
            project?: string;
            path?: string;
            instruction?: string;
            agentName?: string;
          };
          if (!body.path) throw new HttpError(400, "path is required");
          if (!body.instruction?.trim()) throw new HttpError(400, "instruction is required");
          return json(
            await editWorkflow(getProject(body.project ?? null), body.path, body.instruction, {
              agentName: body.agentName || DEFAULT_AGENT,
            }),
          );
        }
        if (url.pathname === "/api/workflows/revert") {
          const body = (await req.json()) as { project?: string; path?: string; backup?: string };
          if (!body.path) throw new HttpError(400, "path is required");
          if (!body.backup) throw new HttpError(400, "backup is required");
          return json(revertWorkflow(getProject(body.project ?? null), body.path, body.backup));
        }
        if (url.pathname === "/api/skills/generate") {
          const body = (await req.json()) as { name?: string; prompt?: string; agentName?: string };
          if (!body.name?.trim()) throw new HttpError(400, "name is required");
          if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");
          return json(await generateSkill(body.name, body.prompt, { agentName: body.agentName }));
        }
        if (url.pathname === "/api/evals/run") {
          const body = (await req.json()) as { suite?: string; cases?: string[]; arms?: string[] };
          if (!body.suite) throw new HttpError(400, "suite is required");
          return json(startEvalRun({ suite: body.suite, cases: body.cases, arms: body.arms }));
        }
        if (url.pathname === "/api/playground/run") {
          const body = (await req.json()) as {
            skill?: string;
            prompt?: string;
            model?: string;
            fixtureCase?: string;
            smoke?: boolean;
          };
          const skill = requireSkillName(body.skill);
          if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");
          const fixtureCase = body.fixtureCase ? requireSafeSegment(body.fixtureCase, "fixtureCase") : undefined;
          return json(startPlayground({ ...body, skill, fixtureCase }));
        }
        if (url.pathname === "/api/playground/promote") {
          const body = (await req.json()) as { skill?: string; id?: string };
          return json(promotePlayground(requireSkillName(body.skill), requireSafeSegment(body.id, "id")));
        }
        if (url.pathname === "/api/proposals/suggest") {
          const body = (await req.json()) as {
            skill?: string;
            source?: string;
            model?: string;
            refs?: unknown;
            note?: string;
            smoke?: boolean;
          };
          if (!body.skill) throw new HttpError(400, "skill is required");
          return json(startSuggest({
            skill: body.skill,
            source: body.source,
            model: body.model,
            refs: body.refs,
            note: body.note,
            smoke: body.smoke,
          }));
        }
        if (url.pathname === "/api/proposals/evidence") {
          const body = (await req.json()) as {
            skill?: string;
            source?: string;
            traceId?: string;
            note?: string;
            refs?: unknown;
          };
          if (!body.skill) throw new HttpError(400, "skill is required");
          return json(appendEvidence(body.skill, {
            source: body.source,
            traceId: body.traceId,
            note: body.note,
            refs: body.refs,
          }));
        }
        if (url.pathname === "/api/proposals/accept") {
          const body = (await req.json()) as { skill?: string; id?: string };
          if (!body.skill || !body.id) throw new HttpError(400, "skill and id are required");
          return json(await acceptProposal(body.skill, body.id));
        }
        if (url.pathname === "/api/proposals/dismiss") {
          const body = (await req.json()) as { skill?: string; id?: string };
          if (!body.skill || !body.id) throw new HttpError(400, "skill and id are required");
          return json(dismissProposal(body.skill, body.id));
        }
        if (url.pathname === "/api/node-evals/insitu") {
          const body = (await req.json()) as { project?: string; runId?: string };
          if (!body.runId) throw new HttpError(400, "runId is required");
          return json(await evalWorkflowNodes(getProject(body.project ?? null), body.runId));
        }
        if (url.pathname === "/api/review/sync") {
          const body = (await req.json().catch(() => ({}))) as { project?: string };
          const result = syncReviewTraces(getProject(body.project ?? null));
          return json({ ok: true, ...result, url: `http://127.0.0.1:${REVIEW_PORT}/` });
        }
        if (url.pathname === "/api/node-evals/standalone") {
          const body = (await req.json()) as {
            project?: string;
            path?: string;
            nodeId?: string;
            trials?: number;
            agentName?: string;
          };
          if (!body.path || !body.nodeId) throw new HttpError(400, "path and nodeId are required");
          return json(
            await evalNodeStandalone(getProject(body.project ?? null), body.path, body.nodeId, {
              trials: body.trials,
              agentName: body.agentName,
            }),
          );
        }
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, 500);
    }
  },
});

console.log(`poolside skills workbench: http://127.0.0.1:${server.port}/workflows.html`);
void ensureReviewServer().then(async () => {
  console.log(
    `eval review app: http://127.0.0.1:${REVIEW_PORT}/ (${(await reviewRunning()) ? "running" : "starting…"})`,
  );
});
