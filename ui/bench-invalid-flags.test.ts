import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runBench(args: string[], options: { env?: Record<string, string> } = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "ui/bench.ts", ...args],
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
    env: options.env,
  });
}

function envWithPathPrefix(pathPrefix: string): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  env.PATH = `${pathPrefix}:${env.PATH ?? ""}`;
  return env;
}

function collectTreePaths(root: string): Set<string> {
  const paths = new Set<string>();
  if (!existsSync(root)) return paths;

  const visit = (path: string) => {
    paths.add(path);
    const stat = statSync(path);
    if (!stat.isDirectory()) return;
    for (const entry of readdirSync(path)) visit(join(path, entry));
  };

  visit(root);
  return paths;
}

function optimizeArtifactFiles(skill = "ci-log-reducer"): Set<string> {
  const roots = [join(import.meta.dir, "..", "runs", "optimize", ".state"), join(import.meta.dir, "..", "runs", "optimize", skill)];
  return new Set(roots.flatMap((root) => [...collectTreePaths(root)]));
}

function stderrJson(result: ReturnType<typeof runBench>) {
  const stderr = result.stderr.toString();
  expect(stderr).not.toBe("");
  return JSON.parse(stderr) as { error?: string; status?: number };
}

describe("bench invalid numeric CLI flags", () => {
  test("eval-run rejects unknown flags before launching the harness", () => {
    const result = runBench(["eval-run", "--suite", "evals/suites/smoke.json", "--jsno"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("Unknown flag for eval-run: --jsno");
  });

  test("eval-run suggests the closest known flag for a typo", () => {
    const result = runBench(["eval-run", "--sutie", "evals/suites/smoke.json"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("Unknown flag for eval-run: --sutie");
    expect(body.error).toContain("Did you mean --suite?");
  });

  test.each([
    ["onboard", ["onboard", "--sorce", "skills/ci-log-reducer"], "--sorce", "--source"],
    ["eval-case-generate skill", ["eval-case-generate", "--skil", "repo-map", "--n", "1"], "--skil", "--skill"],
    [
      "eval-case-generate validate-only",
      ["eval-case-generate", "--skill", "repo-map", "--validate-ony", "skills/repo-map/evals/repo-map-bun-cli-workspace"],
      "--validate-ony",
      "--validate-only",
    ],
  ])("bespoke parser suggests the closest known flag for %s", (_label, args, badFlag, suggestion) => {
    const fakeBin = mkdtempSync(join(tmpdir(), "bench-fake-bespoke-uv-"));
    const marker = join(fakeBin, "uv-invoked");
    const fakeUv = join(fakeBin, "uv");
    writeFileSync(fakeUv, `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nexit 42\n`);
    chmodSync(fakeUv, 0o755);

    let result: ReturnType<typeof runBench> | undefined;
    let launchedFakeUv = false;
    try {
      result = runBench(args, { env: envWithPathPrefix(fakeBin) });
      launchedFakeUv = existsSync(marker);
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }

    expect(result).toBeDefined();
    expect(result!.exitCode).not.toBe(0);
    expect(result!.stdout.toString()).toBe("");
    const body = stderrJson(result!);
    expect(body.status).toBe(400);
    expect(body.error).toContain(badFlag);
    expect(body.error).toContain(`Did you mean ${suggestion}?`);
    expect(launchedFakeUv).toBe(false);
  });

  test("eval-run rejects missing required flag values", () => {
    const result = runBench(["eval-run", "--suite"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("--suite requires a value");
  });

  test("eval-run rejects duplicate scalar flags", () => {
    const result = runBench(["eval-run", "--suite", "evals/suites/smoke.json", "--suite", "evals/suites/smoke.json"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("Duplicate flag for eval-run: --suite");
  });

  test("eval-run rejects values for boolean flags", () => {
    const result = runBench(["eval-run", "--suite", "evals/suites/smoke.json", "--robot-dry-run", "false"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("--robot-dry-run does not take a value");
  });

  test("read-side commands reject unexpected positionals", () => {
    const result = runBench(["skills", "extra"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("Unexpected positional argument(s): extra");
  });

  test("optimize-skill rejects unknown flags before launching the optimizer", () => {
    const result = runBench(["optimize-skill", "--skill", "ci-log-reducer", "--badflag", "--smoke"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("Unknown flag for optimize-skill: --badflag");
  });

  test.each([
    ["--skill form", ["optimize-skill", "--skill", "ci-log-reducer", "--smoke", "--baseline-only"]],
    ["positional form", ["optimize-skill", "ci-log-reducer", "--smoke", "--baseline-only"]],
  ])("optimize-skill rejects smoke with baseline-only before side effects (%s)", (_label, args) => {
    const fakeBin = mkdtempSync(join(tmpdir(), "bench-fake-uv-"));
    const marker = join(fakeBin, "uv-invoked");
    const fakeUv = join(fakeBin, "uv");
    writeFileSync(fakeUv, `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nexit 42\n`);
    chmodSync(fakeUv, 0o755);

    const beforeArtifacts = optimizeArtifactFiles();
    let result: ReturnType<typeof runBench> | undefined;
    let launchedFakeUv = false;
    let newArtifacts: string[] = [];

    try {
      result = runBench(args, {
        env: envWithPathPrefix(fakeBin),
      });
      launchedFakeUv = existsSync(marker);
      newArtifacts = [...optimizeArtifactFiles()].filter((path) => !beforeArtifacts.has(path));
    } finally {
      for (const path of newArtifacts.sort((a, b) => b.length - a.length)) rmSync(path, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }

    expect(result).toBeDefined();
    expect(result!.exitCode).not.toBe(0);
    expect(result!.stdout.toString()).toBe("");
    const body = stderrJson(result!);
    expect(body.status).toBe(400);
    expect(body.error).toBe("--smoke and --baseline-only are mutually exclusive");
    expect(launchedFakeUv).toBe(false);
    expect(newArtifacts).toEqual([]);
  });

  test("eval-run exposes a safe robot dry-run path", () => {
    const result = runBench(["eval-run", "--suite", "evals/suites/smoke.json", "--robot-dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    const body = JSON.parse(result.stdout.toString()) as { schema_version: string; ok: boolean; counts: { runs_planned: number } };
    expect(body.schema_version).toBe("eval-dry-run-summary.v1");
    expect(body.ok).toBe(true);
    expect(body.counts.runs_planned).toBeGreaterThan(0);
  });

  test("eval-runs supports bounded running status view", () => {
    const result = runBench(["eval-runs", "--running", "--limit", "1"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    const body = JSON.parse(result.stdout.toString()) as { runs: { status: string }[] };
    expect(body.runs.length).toBeLessThanOrEqual(1);
    expect(body.runs.every((run) => run.status === "running")).toBe(true);
  });

  test("eval-runs rejects invalid status with JSON stderr", () => {
    const result = runBench(["eval-runs", "--status", "wat"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("--status must be one of");
  });

  test.each([
    ["--run-id", "../bad", "runId"],
    ["--run-id", "bad/path", "runId"],
    ["--node-id", "..", "nodeId"],
    ["--node-id", "bad\\path", "nodeId"],
  ])("node-artifacts rejects unsafe %s with JSON stderr", (flagName, unsafeValue, label) => {
    const args = ["node-artifacts", "--run-id", "run-1", "--node-id", "node-1"];
    const replaceAt = args.indexOf(flagName) + 1;
    args[replaceAt] = unsafeValue;

    const result = runBench(args);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain(`invalid ${label}`);
  });

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

  test("eval-case-generate rejects duplicate scalar flags before launching the generator", () => {
    const result = runBench(["eval-case-generate", "--skill", "repo-map", "--n", "1", "--n", "3"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("Duplicate flag for eval-case-generate: --n");
    expect(body.error).toContain("--n is not repeatable");
  });

  test.each([
    ["--validate-only", ["eval-case-generate", "--skill", "x", "--validate-only", "a", "--validate-only", "b"]],
    ["--promote", ["eval-case-generate", "--skill", "x", "--promote", "a", "--promote", "b"]],
  ])("eval-case-generate accepts repeated %s values in argv order", (flagName, args) => {
    const fakeBin = mkdtempSync(join(tmpdir(), "bench-fake-generate-uv-"));
    const argvPath = join(fakeBin, "uv-argv.json");
    const fakeUv = join(fakeBin, "uv");
    writeFileSync(
      fakeUv,
      `#!/bin/sh\nnode -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' ${JSON.stringify(argvPath)} "$@"\nexit 42\n`,
    );
    chmodSync(fakeUv, 0o755);

    let result: ReturnType<typeof runBench> | undefined;
    let forwardedArgs: string[] = [];
    try {
      result = runBench(args, { env: envWithPathPrefix(fakeBin) });
      forwardedArgs = existsSync(argvPath) ? (JSON.parse(readFileSync(argvPath, "utf8")) as string[]) : [];
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }

    expect(result).toBeDefined();
    expect(result!.stdout.toString()).toBe("");
    expect(result!.stderr.toString()).not.toContain("Duplicate flag for eval-case-generate");
    const flagIndex = forwardedArgs.indexOf(flagName);
    expect(flagIndex).not.toBe(-1);
    expect(forwardedArgs.slice(flagIndex, flagIndex + 3)).toEqual([flagName, "a", "b"]);
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
  test("onboard rejects missing --source with JSON stderr", () => {
    const result = runBench(["onboard"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("onboard --source");
  });

  test("onboard rejects unknown flags with JSON stderr", () => {
    const result = runBench(["onboard", "--source", "skills/ci-log-reducer", "--definitely-unknown"]);

    expect(result.exitCode).not.toBe(0);
    const body = stderrJson(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("--definitely-unknown");
  });

  test.each([
    ["--source", ["onboard", "--source", "skills/ci-log-reducer", "--source", "skills/repo-map"]],
    [
      "--out-dir",
      [
        "onboard",
        "--source",
        "skills/ci-log-reducer",
        "--out-dir",
        "runs/onboard/first",
        "--out-dir",
        "runs/onboard/second",
      ],
    ],
  ])("onboard rejects duplicate scalar flag %s before launching triage", (flagName, args) => {
    const fakeBin = mkdtempSync(join(tmpdir(), "bench-fake-onboard-uv-"));
    const marker = join(fakeBin, "uv-invoked");
    const fakeUv = join(fakeBin, "uv");
    writeFileSync(fakeUv, `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nexit 42\n`);
    chmodSync(fakeUv, 0o755);

    let result: ReturnType<typeof runBench> | undefined;
    let launchedFakeUv = false;
    try {
      result = runBench(args, { env: envWithPathPrefix(fakeBin) });
      launchedFakeUv = existsSync(marker);
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }

    expect(result).toBeDefined();
    expect(result!.exitCode).not.toBe(0);
    expect(result!.stdout.toString()).toBe("");
    const body = stderrJson(result!);
    expect(body.status).toBe(400);
    expect(body.error).toContain(`Duplicate flag for onboard: ${flagName}`);
    expect(body.error).toContain(`${flagName} is not repeatable`);
    expect(launchedFakeUv).toBe(false);
  });

});
