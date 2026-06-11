/**
 * Workbench HTTP server: static pages + JSON routes over ui/lib.ts.
 * The same substrate is scriptable for agents via `bun ui/bench.ts` (CLI).
 *
 *   bun ui/server.ts            # http://127.0.0.1:4319/workflows.html
 */

import { join } from "node:path";
import {
  DEFAULT_AGENT,
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
  REPO_ROOT,
  runDetail,
  skillEvalSummaries,
  startEvalRun,
  startRun,
  syncReviewTraces,
  workflowGraph,
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

const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/skill.html": "skill.html",
  "/workflows.html": "workflows.html",
  "/styles.css": "styles.css",
  "/ui/workflows.js": "ui/workflows.js",
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

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 240,
  async fetch(req) {
    const url = new URL(req.url);
    try {
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
        const runMatch = url.pathname.match(/^\/api\/runs\/([A-Za-z0-9._:-]+)$/);
        if (runMatch) return json(runDetail(project(), runMatch[1]));
        if (url.pathname === "/api/workflows") return json(listWorkflows(project()));
        if (url.pathname === "/api/workflows/graph") {
          const path = url.searchParams.get("path");
          if (!path) throw new HttpError(400, "path query param required");
          return json(await workflowGraph(project(), path));
        }
        if (url.pathname === "/api/skills") {
          const summaries = skillEvalSummaries();
          return json(listSkills().map((s) => ({ ...s, evalSummary: summaries[s.name] ?? null })));
        }
        if (url.pathname === "/api/evals/suites") return json(listEvalSuites());
        if (url.pathname === "/api/evals/runs")
          return json({ harness: listHarnessProcesses(), runs: listEvalRuns() });
        if (url.pathname === "/api/node-evals") return json(listNodeEvals(project()));
        if (url.pathname === "/api/review/status") {
          return json({ url: `http://127.0.0.1:${REVIEW_PORT}/`, running: await reviewRunning() });
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
