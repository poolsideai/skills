import { describe, expect, test } from "bun:test";

const repoRoot = new URL("..", import.meta.url).pathname;

type BenchResult = ReturnType<typeof Bun.spawnSync>;

function runBench(args: string[]): BenchResult {
  return Bun.spawnSync({
    cmd: ["bun", "ui/bench.ts", ...args],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function expectJsonStdout<T = Record<string, unknown>>(result: BenchResult): T {
  const stdout = text(result.stdout);
  const stderr = text(result.stderr);
  expect(result.exitCode, stderr).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).not.toBe("");
  return JSON.parse(stdout) as T;
}

function expectJsonStderr<T = Record<string, unknown>>(result: BenchResult): T {
  const stdout = text(result.stdout);
  const stderr = text(result.stderr);
  expect(stdout).toBe("");
  expect(stderr).not.toBe("");
  return JSON.parse(stderr) as T;
}

function commandNames(commands: { name: string }[]): string[] {
  return commands.map((command) => command.name);
}

describe("bench discovery CLI contract", () => {
  test("capabilities emits the machine-readable CLI contract", () => {
    const output = expectJsonStdout<{
      schema_version: string;
      contract: {
        invocation: string;
        stdout: string;
        stderr: string;
        exit_codes: Record<string, string>;
        strict_flags: boolean;
        flag_precedence: string;
        intent_hints: string;
      };
      environment: { server_required: boolean; runtime: string };
      commands: { name: string }[];
      next_commands: string[];
    }>(runBench(["capabilities"]));

    expect(output.schema_version).toBe("bench-capabilities.v1");
    expect(output.contract.invocation).toBe("bun ui/bench.ts <command>");
    expect(output.contract.stdout).toContain("JSON");
    expect(output.contract.stderr).toContain("JSON");
    expect(output.contract.exit_codes["2"]).toContain("unknown command");
    expect(output.contract.strict_flags).toBe(true);
    expect(output.contract.flag_precedence).toContain("Non-repeatable duplicate flags are rejected");
    expect(output.contract.flag_precedence).not.toContain("last occurrence wins");
    expect(output.contract.intent_hints).toContain("did-you-mean");
    expect(output.environment).toMatchObject({ server_required: false, runtime: "bun" });
    expect(commandNames(output.commands)).toEqual(
      expect.arrayContaining([
        "capabilities",
        "commands",
        "doctor",
        "feed",
        "skill-detail",
        "proposals",
        "node-artifacts",
        "onboard",
        "onboard-prepare",
        "eval-case-generate",
        "eval-run",
      ]),
    );
    expect(output.next_commands).toContain("bun ui/bench.ts help eval-run");
    expect(output.next_commands).toContain("bun ui/bench.ts eval-run --suite evals/suites/smoke.json --robot-dry-run");
    expect(output.next_commands).toContain("bun ui/bench.ts help eval-case-generate");
  });

  test("commands emits a catalog with discovery command entries", () => {
    const output = expectJsonStdout<{
      schema_version: string;
      commands: { name: string; usage: string; output: string; summary: string }[];
    }>(runBench(["commands"]));

    expect(output.schema_version).toBe("bench-command-catalog.v1");
    const byName = Object.fromEntries(output.commands.map((command) => [command.name, command]));
    expect(byName.capabilities).toMatchObject({ usage: "bun ui/bench.ts capabilities", output: "bench-capabilities.v1" });
    expect(byName.commands).toMatchObject({ usage: "bun ui/bench.ts commands", output: "bench-command-catalog.v1" });
    expect(byName.doctor).toMatchObject({ usage: "bun ui/bench.ts doctor", output: "bench-doctor.v1" });
    expect(byName.feed).toMatchObject({
      usage: "bun ui/bench.ts feed [--project <id>]",
      output: "{ scorecard, records }",
      mirrors: ["GET /api/feed"],
    });
    expect(byName["skill-detail"]).toMatchObject({
      usage: "bun ui/bench.ts skill-detail <name>",
      output: "SkillDetail",
      mirrors: ["GET /api/skill-detail"],
    });
    expect(byName.proposals).toMatchObject({
      usage: "bun ui/bench.ts proposals --skill <name>",
      output: "{ proposals, pending }",
      mirrors: ["GET /api/proposals"],
    });
    expect(byName["node-artifacts"]).toMatchObject({
      usage: "bun ui/bench.ts node-artifacts --run-id <runId> --node-id <nodeId> [--project <id>]",
      output: "NodeArtifacts",
      mirrors: ["GET /api/node-artifacts"],
    });
    expect(byName["onboard-prepare"]).toMatchObject({
      usage: "bun ui/bench.ts onboard-prepare --source <dir> [--skill <name>] [--skip-cases]",
      output: "bench-onboard-prepare.v1",
    });
    expect(byName["eval-case-generate"]).toMatchObject({
      usage: 'bun ui/bench.ts eval-case-generate --skill <name> [--n N|--spec "..."] [--validate-only <case-dir>] [--promote <case-dir>]',
      output: "bench-eval-case-generate.v1",
    });
  });

  test("doctor emits a readiness payload without requiring the web server", () => {
    const output = expectJsonStdout<{
      schema_version: string;
      status: string;
      prerequisites: { name: string; status: string; path: string | null }[];
      checks: { id: string; status: string; detail: string }[];
      catalog: Record<string, unknown>;
      runtime_state: Record<string, unknown>;
      next_commands: string[];
    }>(runBench(["doctor"]));

    expect(output.schema_version).toBe("bench-doctor.v1");
    expect(["ok", "warn", "fail"]).toContain(output.status);
    expect(output.prerequisites.map((tool) => tool.name)).toEqual(expect.arrayContaining(["bun", "uv", "python3", "git"]));
    expect(output.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(["prerequisites", "skills-present", "skill-contracts", "eval-case-coverage", "eval-suites"]),
    );
    expect(output.catalog).toEqual(expect.any(Object));
    expect(output.runtime_state).toEqual(expect.any(Object));
    expect(output.next_commands).toEqual(expect.arrayContaining(["uv run scripts/check_skill_structure.py --json"]));
  });

  test("help eval-run emits command-specific JSON help", () => {
    const output = expectJsonStdout<{
      schema_version: string;
      command: { name: string; usage: string; output: string; flags?: { name: string; repeatable?: boolean }[] };
      conventions: { stdout: string; stderr: string; repeatable_flags: string[]; flag_precedence: string };
    }>(runBench(["help", "eval-run"]));

    expect(output.schema_version).toBe("bench-command-help.v1");
    expect(output.command).toMatchObject({
      name: "eval-run",
      usage: "bun ui/bench.ts eval-run --suite evals/suites/<s>.json [--case <id>]... [--arm <arm>]... [--robot-dry-run|--dry-run --json-summary] [--replay]",
      output: "StartEvalRunResult or eval-dry-run-summary.v1",
    });
    expect(output.command.flags?.map((flag) => flag.name)).toEqual(expect.arrayContaining(["--suite", "--case", "--arm", "--robot-dry-run", "--dry-run", "--json-summary"]));
    expect(output.command.flags?.filter((flag) => flag.repeatable).map((flag) => flag.name)).toEqual(
      expect.arrayContaining(["--case", "--arm"]),
    );
    expect(output.conventions.stdout).toContain("JSON");
    expect(output.conventions.stderr).toContain("JSON");
    expect(output.conventions.repeatable_flags).toEqual(expect.arrayContaining(["--case", "--arm"]));
    expect(output.conventions.flag_precedence).toContain("Non-repeatable duplicate flags are rejected");
    expect(output.conventions.flag_precedence).not.toContain("last occurrence wins");
  });

  test.each([
    ["optimize-skill", "bun ui/bench.ts optimize-skill <skill>|--skill <name> [--suite <path>] [--max-metric-calls N] [--reflection-lm <id>] [--arm <arm>]... [--smoke|--baseline-only]"],
    ["optimize-propose", "bun ui/bench.ts optimize-propose <skill>|--skill <name> [--run-dir <dir>]"],
  ])("help %s exposes positional skill metadata", (commandName, usage) => {
    const output = expectJsonStdout<{
      schema_version: string;
      command: {
        name: string;
        usage: string;
        positional?: { name: string; description: string }[];
        flags?: { name: string }[];
      };
    }>(runBench(["help", commandName]));

    expect(output.schema_version).toBe("bench-command-help.v1");
    expect(output.command.usage).toBe(usage);
    expect(output.command.positional).toEqual([{ name: "skill", description: "Skill directory name; alternative to --skill." }]);
    expect(output.command.flags?.map((flag) => flag.name)).toContain("--skill");
  });

  test("capabilities exposes optimizer positional skill metadata", () => {
    const output = expectJsonStdout<{
      commands: { name: string; positional?: { name: string; description: string }[] }[];
    }>(runBench(["capabilities"]));

    const byName = Object.fromEntries(output.commands.map((command) => [command.name, command]));
    expect(byName["optimize-skill"].positional).toEqual([{ name: "skill", description: "Skill directory name; alternative to --skill." }]);
    expect(byName["optimize-propose"].positional).toEqual([{ name: "skill", description: "Skill directory name; alternative to --skill." }]);
  });

  test.each([
    ["feed", "bun ui/bench.ts feed [--project <id>]", "{ scorecard, records }", ["--project"]],
    ["skill-detail", "bun ui/bench.ts skill-detail <name>", "SkillDetail", ["--skill"]],
    ["proposals", "bun ui/bench.ts proposals --skill <name>", "{ proposals, pending }", ["--skill"]],
    [
      "node-artifacts",
      "bun ui/bench.ts node-artifacts --run-id <runId> --node-id <nodeId> [--project <id>]",
      "NodeArtifacts",
      ["--run-id", "--node-id", "--project"],
    ],
  ])("help %s emits command-specific JSON help", (commandName, usage, output, expectedFlags) => {
    const outputBody = expectJsonStdout<{
      schema_version: string;
      command: { name: string; usage: string; output: string; flags?: { name: string }[]; mirrors?: string[] };
      conventions: { stdout: string; stderr: string };
    }>(runBench(["help", commandName]));

    expect(outputBody.schema_version).toBe("bench-command-help.v1");
    expect(outputBody.command).toMatchObject({ name: commandName, usage, output });
    expect(outputBody.command.flags?.map((flag) => flag.name)).toEqual(expect.arrayContaining(expectedFlags));
    expect(outputBody.command.mirrors?.[0]).toMatch(/^GET \/api\//);
    expect(outputBody.conventions.stdout).toContain("JSON");
    expect(outputBody.conventions.stderr).toContain("JSON");
  });

  test("help onboard-prepare emits command-specific JSON help", () => {
    const output = expectJsonStdout<{
      schema_version: string;
      command: { name: string; output: string; flags?: { name: string }[] };
    }>(runBench(["help", "onboard-prepare"]));

    expect(output.schema_version).toBe("bench-command-help.v1");
    expect(output.command).toMatchObject({ name: "onboard-prepare", output: "bench-onboard-prepare.v1" });
    expect(output.command.flags?.map((flag) => flag.name)).toEqual(
      expect.arrayContaining(["--source", "--skill", "--model", "--skip-cases"]),
    );
  });

  test("help eval-case-generate emits command-specific JSON help", () => {
    const output = expectJsonStdout<{
      schema_version: string;
      command: { name: string; output: string; flags?: { name: string; repeatable?: boolean }[] };
      conventions: { repeatable_flags: string[]; flag_precedence: string };
    }>(runBench(["help", "eval-case-generate"]));

    expect(output.schema_version).toBe("bench-command-help.v1");
    expect(output.command).toMatchObject({
      name: "eval-case-generate",
      output: "bench-eval-case-generate.v1",
    });
    expect(output.command.flags?.map((flag) => flag.name)).toEqual(
      expect.arrayContaining(["--skill", "--n", "--spec", "--bootstrap", "--validate-only", "--promote"]),
    );
    expect(output.command.flags?.filter((flag) => flag.repeatable).map((flag) => flag.name)).toEqual(
      expect.arrayContaining(["--spec", "--validate-only", "--promote"]),
    );
    expect(output.conventions.repeatable_flags).toEqual(
      expect.arrayContaining(["--case", "--arm", "--spec", "--validate-only", "--promote"]),
    );
    expect(output.conventions.flag_precedence).toContain("Non-repeatable duplicate flags are rejected");
    expect(output.conventions.flag_precedence).not.toContain("last occurrence wins");
  });

  test.each([
    ["skill-detail", [], "usage: skill-detail <name>"],
    ["proposals", [], "usage: proposals --skill <name>"],
    ["node-artifacts", ["--run-id", "run-1"], "usage: node-artifacts --run-id <runId> --node-id <nodeId>"],
  ])("%s rejects missing required arguments with JSON stderr", (commandName, args, expectedMessage) => {
    const result = runBench([commandName, ...args]);

    expect(result.exitCode).toBe(1);
    const body = expectJsonStderr<{ error: string; status: number }>(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain(expectedMessage);
  });

  test("onboard-prepare smoke path writes a quarantined review bundle", () => {
    const result = runBench([
      "onboard-prepare",
      "--source",
      "skills/ci-log-reducer",
      "--out-dir",
      "runs/onboard/bench-cli-contract-prepare-test",
      "--skip-cases",
      "--smoke",
    ]);

    expect(result.exitCode).toBe(0);
    const body = expectJsonStdout<{
      schema_version: string;
      ok: boolean;
      mode: string;
      stdout_json: { schema_version: string; ok: boolean; review_queue: string[] };
    }>(result);
    expect(body).toMatchObject({ schema_version: "bench-onboard-prepare.v1", ok: true, mode: "prepare" });
    expect(body.stdout_json).toMatchObject({ schema_version: "onboard-prepare.v1", ok: true });
    expect(body.stdout_json.review_queue[0]).toContain("runs/onboard/bench-cli-contract-prepare-test/skill/ci-log-reducer");
  });

  test("onboard-prepare rejects missing source with JSON stderr", () => {
    const result = runBench(["onboard-prepare"]);
    expect(result.exitCode).toBe(1);
    expect(expectJsonStderr<{ error: string }>(result).error).toContain("onboard-prepare --source");
  });

  test("eval-case-generate rejects unknown flags before invoking the generator", () => {
    const result = runBench([
      "eval-case-generate",
      "--skill",
      "__missing_skill__",
      "--validate-only",
      "__missing_case__",
      "--definitely-unknown",
    ]);

    expect(result.exitCode).not.toBe(0);
    const body = expectJsonStderr<{ error: string; status: number; schema_version?: string }>(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("--definitely-unknown");
    expect(body.schema_version).toBeUndefined();
  });

  test("eval-case-generate normalizes generator failures into JSON stderr", () => {
    const result = runBench(["eval-case-generate", "--skill", "__missing_skill__", "--validate-only", "__missing_case__"]);

    expect(result.exitCode).toBe(1);
    const body = expectJsonStderr<{
      schema_version: string;
      ok: boolean;
      mode: string;
      command: string[];
      exit_code: number;
      stderr_text: string;
    }>(result);
    expect(body).toMatchObject({
      schema_version: "bench-eval-case-generate.v1",
      ok: false,
      mode: "validate-only",
    });
    expect(body.command).toEqual(
      expect.arrayContaining(["uv", "harness/generate/gen_eval_cases.py", "--skill", "__missing_skill__", "--validate-only", "__missing_case__"]),
    );
    expect(body.exit_code).not.toBe(0);
    expect(body.stderr_text).toContain("no such skill");
  });

  test("eval-case-generate forwards bootstrap mode", () => {
    const result = runBench(["eval-case-generate", "--skill", "__missing_skill__", "--bootstrap", "--n", "1"]);

    expect(result.exitCode).toBe(1);
    const body = expectJsonStderr<{ mode: string; command: string[]; stderr_text: string }>(result);
    expect(body.mode).toBe("generate");
    expect(body.command).toEqual([
      "uv",
      "run",
      "harness/generate/gen_eval_cases.py",
      "--skill",
      "__missing_skill__",
      "--n",
      "1",
      "--bootstrap",
    ]);
    expect(body.stderr_text).toContain("no such skill");
  });

  test("eval-case-generate forwards repeated spec flags in order", () => {
    const result = runBench([
      "eval-case-generate",
      "--skill",
      "__missing_skill__",
      "--spec",
      "first spec",
      "--spec",
      "second spec",
    ]);

    expect(result.exitCode).toBe(1);
    const body = expectJsonStderr<{
      schema_version: string;
      ok: boolean;
      mode: string;
      command: string[];
      stderr_text: string;
    }>(result);
    expect(body).toMatchObject({
      schema_version: "bench-eval-case-generate.v1",
      ok: false,
      mode: "generate",
    });
    expect(body.command).toEqual([
      "uv",
      "run",
      "harness/generate/gen_eval_cases.py",
      "--skill",
      "__missing_skill__",
      "--spec",
      "first spec",
      "--spec",
      "second spec",
    ]);
    expect(body.stderr_text).toContain("no such skill");
  });

  test("eval-case-generate rejects duplicate scalar flags before invoking the generator", () => {
    const result = runBench(["eval-case-generate", "--skill", "__missing_skill__", "--n", "1", "--n", "3"]);

    expect(result.exitCode).not.toBe(0);
    const body = expectJsonStderr<{ error: string; status: number; schema_version?: string; command?: string[] }>(result);
    expect(body.status).toBe(400);
    expect(body.error).toContain("Duplicate flag for eval-case-generate: --n");
    expect(body.error).toContain("--n is not repeatable");
    expect(body.schema_version).toBeUndefined();
    expect(body.command).toBeUndefined();
  });

  test("eval-case-generate forwards all validate-only case dirs", () => {
    const result = runBench([
      "eval-case-generate",
      "--skill",
      "__missing_skill__",
      "--validate-only",
      "__missing_case_a__",
      "__missing_case_b__",
    ]);

    expect(result.exitCode).toBe(1);
    const body = expectJsonStderr<{ mode: string; command: string[] }>(result);
    expect(body.mode).toBe("validate-only");
    expect(body.command).toEqual([
      "uv",
      "run",
      "harness/generate/gen_eval_cases.py",
      "--skill",
      "__missing_skill__",
      "--validate-only",
      "__missing_case_a__",
      "__missing_case_b__",
    ]);
  });

  test("eval-case-generate forwards all promote case dirs", () => {
    const result = runBench([
      "eval-case-generate",
      "--skill",
      "__missing_skill__",
      "--promote",
      "__missing_candidate_a__",
      "__missing_candidate_b__",
    ]);

    expect(result.exitCode).toBe(1);
    const body = expectJsonStderr<{ mode: string; command: string[] }>(result);
    expect(body.mode).toBe("promote");
    expect(body.command).toEqual([
      "uv",
      "run",
      "harness/generate/gen_eval_cases.py",
      "--skill",
      "__missing_skill__",
      "--promote",
      "__missing_candidate_a__",
      "__missing_candidate_b__",
    ]);
  });

  test("unknown command emits JSON on stderr and exits 2", () => {
    const result = runBench(["__definitely_unknown_command__"]);

    expect(result.exitCode).toBe(2);
    const body = expectJsonStderr<{ error: string; usage: string; commands: string[]; did_you_mean?: string }>(result);
    expect(body.error).toContain("Unknown command: __definitely_unknown_command__");
    expect(body.usage).toBe("bun ui/bench.ts <command>");
    expect(body.did_you_mean).toBeUndefined();
    expect(body.commands).toEqual(expect.arrayContaining([expect.stringContaining("capabilities"), expect.stringContaining("commands")]));
  });

  test("unknown command includes a did-you-mean hint when the typo is close", () => {
    const result = runBench(["evalrun", "--suite", "evals/suites/smoke.json"]);

    expect(result.exitCode).toBe(2);
    const body = expectJsonStderr<{ error: string; did_you_mean?: string }>(result);
    expect(body.error).toContain("Unknown command: evalrun");
    expect(body.did_you_mean).toBe("eval-run");
  });
});
