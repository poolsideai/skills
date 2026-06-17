#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const valueAfter = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

const workspace = valueAfter("--workspace") ?? ".";
const out = valueAfter("--out");
const caseDir = valueAfter("--case");
if (!out) throw new Error("missing --out");

let status: "pass" | "fail" = "fail";
let detail = "artifact missing or invalid";
try {
  const artifact = JSON.parse(readFileSync(join(workspace, ".laguna/ce-plan.json"), "utf8"));
  const evidence = Array.isArray(artifact.evidence) ? artifact.evidence : [];
  if (
    artifact.schema_version === "ce-plan.synthetic-bootstrap.v1" &&
    typeof artifact.summary === "string" &&
    artifact.summary.trim().length > 0 &&
    evidence.length > 0 &&
    evidence.every((item: unknown) => typeof item === "string" && item.trim().length > 0)
  ) {
    status = "pass";
    detail = "synthetic bootstrap artifact satisfies the generated Laguna contract";
  }
} catch {
  // fall through to fail result
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  schema_version: "validator-result.v1",
  case_id: caseDir ? caseDir.split("/").filter(Boolean).pop() : "ce-plan-synthetic-bootstrap",
  status,
  score: status === "pass" ? 1 : 0,
  checks: [{ id: "synthetic-bootstrap-artifact", status, detail }],
  repair_feedback: status === "pass" ? [] : [
    `Write .laguna/ce-plan.json with schema_version ce-plan.synthetic-bootstrap.v1, summary, and evidence.`
  ],
  duration_ms: 0
}, null, 2) + "\n");
