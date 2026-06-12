import { renameSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateSkill, generateWorkflow, getProject } from "./lib.ts";

function arg(name: string): string {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || !process.argv[idx + 1]) throw new Error(`${name} is required`);
  return process.argv[idx + 1];
}

function writeAtomic(path: string, value: unknown) {
  const tmp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, path);
}

const out = arg("--out");

try {
  const params = JSON.parse(readFileSync(arg("--params"), "utf8"));
  if (params.smoke === true) {
    writeAtomic(out, { ok: false, error: "smoke run — no model call", attempts: [] });
    process.exit(0);
  }

  let result: unknown;
  if (params.kind === "workflow") {
    result = await generateWorkflow(getProject(params.project ?? null), params.prompt, {
      id: params.id,
      agentName: params.agentName,
    });
  } else if (params.kind === "skill") {
    result = await generateSkill(params.name, params.prompt, { agentName: params.agentName });
  } else {
    throw new Error(`unknown kind: ${params.kind}`);
  }
  writeAtomic(out, result);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeAtomic(out, { ok: false, error: message.slice(0, 1200) });
}
