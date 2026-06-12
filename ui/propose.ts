import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");

type Params = {
  skill: string;
  source?: string;
  model?: string;
  refs?: unknown;
  note?: string;
  evidence?: { kind: string; ref: string; detail?: string }[];
};

type SkillProposal = {
  id: string;
  skill: string;
  createdAtMs: number;
  status: "open" | "accepted" | "dismissed";
  source: string;
  model: string;
  summary: string;
  baseVersion: string | null;
  proposedContent: string;
  evidence: { kind: string; ref: string; detail?: string }[];
};

function usage(): never {
  console.error("usage: bun ui/propose.ts --skill <name> --params <abs params.json> --out <abs proposal.json> [--smoke]");
  process.exit(2);
}

function arg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? usage();
}

function parseFrontmatter(markdown: string): { name?: string; version?: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const versionMatch = yaml.match(/version:\s*"?([^"\n]+)"?/);
  return {
    name: nameMatch?.[1]?.trim().replace(/^["']|["']$/g, ""),
    version: versionMatch?.[1]?.trim() ?? undefined,
  };
}

function extractFence(text: string): string | null {
  const matches = [...text.matchAll(/```(?:markdown|md)?\s*\n([\s\S]*?)```/g)];
  if (!matches.length) return null;
  return matches.map((m) => m[1]).sort((a, b) => b.length - a.length)[0].trim() + "\n";
}

function evidenceBlocks(evidence: { kind: string; ref: string; detail?: string }[]): string {
  let total = 0;
  const blocks: string[] = [];
  for (const item of evidence) {
    const detail = (item.detail ?? "").slice(0, 800);
    const block = [`kind: ${item.kind}`, `ref: ${item.ref}`, detail ? `detail:\n${detail}` : null]
      .filter(Boolean)
      .join("\n");
    if (total + block.length > 16_000) break;
    total += block.length;
    blocks.push(block);
  }
  return blocks.join("\n\n---\n\n");
}

function buildPrompt(skill: string, current: string, evidence: { kind: string; ref: string; detail?: string }[]): string {
  return [
    `You are improving the Poolside skill "${skill}". Below is its current`,
    "SKILL.md, followed by evidence from failing runs (validator checks that",
    "failed, reviewer notes, missing artifacts).",
    "",
    "Rules:",
    "- Propose a revision of SKILL.md PROSE ONLY. Keep the YAML frontmatter keys",
    "  and the ten-section structure intact. Do NOT change the output contract",
    "  path, the schema, or any file references — validators, schemas, and eval",
    "  cases are frozen.",
    "- Target the failure pattern in the evidence. Smallest change that",
    "  plausibly fixes it.",
    "- Reply with exactly: one line starting \"SUMMARY: \" describing what you",
    "  found across the failing trajectories and what you changed, then the",
    "  complete revised SKILL.md in a single ```markdown fence.",
    "",
    "--- CURRENT SKILL.md ---",
    current,
    `--- EVIDENCE (${evidence.length} items) ---`,
    evidenceBlocks(evidence),
  ].join("\n");
}

async function main() {
  const skill = arg("--skill") ?? usage();
  const paramsPath = arg("--params") ?? usage();
  const outPath = arg("--out") ?? usage();
  const smoke = process.argv.includes("--smoke");

  if (!/^[a-z0-9][a-z0-9-]*$/.test(skill)) throw new Error(`invalid skill: ${skill}`);
  const params = JSON.parse(readFileSync(paramsPath, "utf8")) as Params;
  if (params.skill !== skill) throw new Error(`params skill ${params.skill} does not match --skill ${skill}`);
  const skillMd = join(REPO_ROOT, "skills", skill, "SKILL.md");
  if (!existsSync(skillMd)) throw new Error(`missing ${skillMd}`);
  const current = readFileSync(skillMd, "utf8");
  const baseVersion = parseFrontmatter(current).version ?? null;
  const evidence = params.evidence ?? [];

  let summary: string;
  let proposedContent: string;
  if (smoke) {
    summary = "SMOKE: no model call";
    proposedContent = current.replace(/\s*$/, "\n<!-- smoke-proposal -->\n");
  } else {
    const { PoolAgent } = await import(join(REPO_ROOT, "experiments", "smithers-pool", "src", "PoolAgent.ts"));
    const scratch = mkdtempSync(join(tmpdir(), "skill-propose-"));
    const agent = new PoolAgent({
      cwd: scratch,
      agentName: params.model ?? "laguna-m.1",
      id: `pool:propose:${skill}`,
    });
    const result = await agent.generate({ prompt: buildPrompt(skill, current, evidence) });
    const text = String(result.text ?? "");
    const summaryLine = text.split("\n").find((line) => line.startsWith("SUMMARY: "));
    if (!summaryLine) throw new Error('pool response missing "SUMMARY: " line');
    summary = summaryLine.replace(/^SUMMARY:\s*/, "").trim();
    const fenced = extractFence(text);
    if (!fenced) throw new Error("pool response missing markdown code fence with proposed SKILL.md");
    proposedContent = fenced;
  }

  const idMatch = outPath.match(/(?:^|\/)proposal-([^/]+)\.json$/);
  const id = idMatch ? `proposal-${idMatch[1]}` : `proposal-${Date.now().toString(36)}`;
  const proposal: SkillProposal = {
    id,
    skill,
    createdAtMs: Date.now(),
    status: "open",
    source: params.source ?? "manual",
    model: params.model ?? "laguna-m.1",
    summary,
    baseVersion,
    proposedContent,
    evidence,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  const tmp = `${outPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(proposal, null, 2));
  renameSync(tmp, outPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
