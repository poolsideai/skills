import { describe, expect, test } from "bun:test";

const repoRoot = new URL("..", import.meta.url).pathname;

function runBench(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "ui/bench.ts", ...args],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function parseJsonStderr(result: ReturnType<typeof runBench>) {
  const stderr = result.stderr.toString();
  expect(stderr).not.toBe("");
  return JSON.parse(stderr) as { error?: string; status?: number };
}

describe("bench unknown command-specific help", () => {
  test("help for an unknown command reports the unknown-command contract", () => {
    const result = runBench(["help", "nope"]);

    expect(result.exitCode).toBe(2);
    const body = parseJsonStderr(result);
    expect(body.error).toContain("Unknown command");
  });

  test("--help on an unknown command reports the unknown-command contract", () => {
    const result = runBench(["nope", "--help"]);

    expect(result.exitCode).toBe(2);
    const body = parseJsonStderr(result);
    expect(body.error).toContain("Unknown command");
  });
});
