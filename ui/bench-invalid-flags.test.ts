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

  test("eval-case-generate rejects invalid --n with JSON stderr", () => {
    const result = runBench(["eval-case-generate", "--skill", "repo-map", "--n", "0"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("--n");
  });

  test("eval-case-generate rejects mixed validate and promote modes with JSON stderr", () => {
    const result = runBench([
      "eval-case-generate",
      "--skill",
      "repo-map",
      "--validate-only",
      "skills/repo-map/evals/repo-map-bun-cli-workspace",
      "--promote",
      "runs/generate/repo-map/example",
    ]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("mutually exclusive");
  });
});
