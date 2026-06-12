import { describe, expect, test } from "bun:test";

const repoRoot = new URL("..", import.meta.url).pathname;

type CommandDetail = { name: string; mirrors?: string[] };

function runBench(command: "commands" | "capabilities"): unknown {
  const result = Bun.spawnSync({
    cmd: ["bun", "ui/bench.ts", command],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  expect(result.exitCode, stderr).toBe(0);
  return JSON.parse(stdout);
}

function mirrorsByCommand(commands: CommandDetail[]): Record<string, string[] | undefined> {
  return Object.fromEntries(commands.map((command) => [command.name, command.mirrors]));
}

describe("bench mirror route metadata", () => {
  const expectedMirrors = {
    runs: ["GET /api/runs"],
    feed: ["GET /api/feed"],
    skills: ["GET /api/skills"],
    "skill-detail": ["GET /api/skill-detail"],
    proposals: ["GET /api/proposals"],
    "node-evals": ["GET /api/node-evals"],
    "node-artifacts": ["GET /api/node-artifacts"],
  };

  test("commands output lists accurate server mirror routes for list commands", () => {
    const output = runBench("commands") as { commands: CommandDetail[] };

    expect(mirrorsByCommand(output.commands)).toMatchObject(expectedMirrors);
  });

  test("capabilities parity map lists accurate server mirror routes for list commands", () => {
    const output = runBench("capabilities") as {
      parity: { known_mirrors: { command: string; mirrors: string[] }[] };
    };

    const knownMirrors = Object.fromEntries(
      output.parity.known_mirrors.map((entry) => [entry.command, entry.mirrors]),
    );
    expect(knownMirrors).toMatchObject(expectedMirrors);
  });
});
