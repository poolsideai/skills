import { afterEach, describe, expect, test } from "bun:test";

const repoRoot = new URL("..", import.meta.url).pathname;

let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let reviewServer: ReturnType<typeof Bun.serve> | undefined;

function freePort(): number {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response("ok");
    },
  });
  const port = server.port;
  server.stop(true);
  return port;
}

async function startServer(): Promise<string> {
  const reviewPort = freePort();
  reviewServer = Bun.serve({
    port: reviewPort,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/traces") return Response.json([]);
      return Response.json({ ok: true });
    },
  });

  const uiPort = freePort();
  serverProcess = Bun.spawn({
    cmd: ["bun", "ui/server.ts"],
    cwd: repoRoot,
    env: {
      ...process.env,
      UI_PORT: String(uiPort),
      REVIEW_PORT: String(reviewPort),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const baseUrl = `http://127.0.0.1:${uiPort}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const res = await fetch(`${baseUrl}/api/projects`);
      if (res.ok) return baseUrl;
    } catch {
      // Server is still starting.
    }
    await Bun.sleep(50);
  }

  throw new Error("timed out waiting for ui/server.ts to start");
}

async function stopServer() {
  const proc = serverProcess;
  serverProcess = undefined;
  if (proc) {
    proc.kill();
    await proc.exited.catch(() => {});
  }
  reviewServer?.stop(true);
  reviewServer = undefined;
}

afterEach(async () => {
  await stopServer();
});

describe("node-artifacts server route validation", () => {
  test.each([
    ["runId", "runId=..&nodeId=node-1", "invalid runId"],
    ["nodeId", "runId=run-1&nodeId=..", "invalid nodeId"],
  ])("rejects unsafe %s before artifact lookup", async (_label, query, expectedError) => {
    const baseUrl = await startServer();

    const res = await fetch(`${baseUrl}/api/node-artifacts?${query}`);
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain(expectedError);
  });
});
