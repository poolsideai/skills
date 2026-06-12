import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DEFAULT_AGENT, gradeWorkspace, REPO_ROOT } from "./lib.ts";

type Params = {
  skill: string;
  prompt: string;
  model?: string;
  fixtureCase?: string;
  smoke?: boolean;
};

function usage(): never {
  console.error("usage: bun ui/playground.ts --params <abs params.json> --out <abs record.json>");
  process.exit(2);
}

function arg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? usage();
}

function validName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function validFixture(value: string): boolean {
  return Boolean(value) && !value.includes("/") && !value.includes("..");
}

function assertNoSymlinks(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (lstatSync(abs).isSymbolicLink()) throw new Error(`fixture input contains symlink: ${abs}`);
    if (entry.isDirectory()) assertNoSymlinks(abs);
  }
}

async function main() {
  const paramsPath = arg("--params") ?? usage();
  const outPath = arg("--out") ?? usage();
  const params = JSON.parse(readFileSync(paramsPath, "utf8")) as Params;
  if (!validName(params.skill)) throw new Error(`invalid skill: ${params.skill}`);
  if (!params.prompt?.trim()) throw new Error("prompt is required");
  if (params.fixtureCase && !validFixture(params.fixtureCase)) throw new Error(`invalid fixture: ${params.fixtureCase}`);

  const skillDir = join(REPO_ROOT, "skills", params.skill);
  if (!existsSync(join(skillDir, "SKILL.md"))) throw new Error(`missing skill: ${params.skill}`);

  const workspace = mkdtempSync(join(tmpdir(), `playground-${params.skill}-`));
  if (params.fixtureCase) {
    const inputDir = join(skillDir, "evals", params.fixtureCase, "input");
    if (!existsSync(inputDir)) throw new Error(`fixture input not found: ${params.fixtureCase}`);
    assertNoSymlinks(inputDir);
    cpSync(inputDir, workspace, { recursive: true });
  }

  const agentName = params.model || DEFAULT_AGENT;
  const startedAt = Date.now();
  let exitOk = true;
  let note: string | undefined;
  let call: { exitCode?: number | null; trajectoryUrl?: string | null } | undefined;

  if (!params.smoke) {
    const { PoolAgent } = await import(join(REPO_ROOT, "experiments", "smithers-pool", "src", "PoolAgent.ts"));
    const agent = new PoolAgent({
      cwd: workspace,
      agentName,
      id: `pool:playground:${params.skill}`,
      logDir: join(REPO_ROOT, "runs", "playground", ".captures"),
      skill: { name: params.skill, from: skillDir },
    });
    try {
      await agent.generate({ prompt: params.prompt });
    } catch (error) {
      exitOk = false;
      note = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    }
    call = agent.calls.at(-1);
  }

  let graded: Awaited<ReturnType<typeof gradeWorkspace>>;
  try {
    graded = await gradeWorkspace(params.skill, workspace, exitOk ? 0 : (call?.exitCode ?? 1));
  } catch (error) {
    graded = {
      grader: "skill-validator",
      status: "error",
      score: null,
      checks: [
        {
          id: "validator-ran",
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const id = basename(outPath).replace(/\.json$/, "");
  const record = {
    kind: "playground" as const,
    id,
    skill: params.skill,
    prompt: params.prompt,
    agentName,
    ...(params.fixtureCase ? { fixtureCase: params.fixtureCase } : {}),
    ...graded,
    durationMs: Date.now() - startedAt,
    trajectoryUrl: call?.trajectoryUrl ?? null,
    workspace,
    createdAtMs: Date.now(),
    ...(note ? { note } : {}),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  const tmp = `${outPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2));
  renameSync(tmp, outPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
