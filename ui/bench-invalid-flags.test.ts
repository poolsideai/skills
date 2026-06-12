import { describe, expect, test } from "bun:test";

function runBench(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "ui/bench.ts", ...args],
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });
}

function stderrJson(result: ReturnType<typeof runBench>) {
  const stderr = result.stderr.toString();
  expect(stderr).not.toBe("");
  return JSON.parse(stderr) as { error?: string; status?: number };
}

describe("bench invalid numeric CLI flags", () => {
  test("optimize-skill rejects invalid --max-metric-calls with JSON stderr", () => {
    const result = runBench([
      "optimize-skill",
      "--skill",
      "repo-map",
      "--suite",
      "evals/suites/__missing__.json",
      "--max-metric-calls",
      "not-a-number",
    ]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("--max-metric-calls");
  });

  test("node-eval-run rejects invalid --trials with JSON stderr", () => {
    const result = runBench([
      "node-eval-run",
      "__missing__.workflow.tsx",
      "--node",
      "repo_map",
      "--trials",
      "not-a-number",
    ]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("--trials");
  });
});
