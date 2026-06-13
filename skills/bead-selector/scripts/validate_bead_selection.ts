import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Check = { id: string; status: "pass" | "fail"; detail: string };

const ARTIFACT_REL = ".laguna/bead-selection.json";
const FALLBACK_CASE_ID = "bead-selector-live";
const MAX_ARTIFACT_BYTES = 1024 * 1024;

function argvValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
  return value;
}

function makeCheck(id: string, ok: boolean, pass: string, fail: string): Check {
  return { id, status: ok ? "pass" : "fail", detail: ok ? pass : fail };
}

function readJson(path: string): unknown {
  const bytes = existsSync(path) ? readFileSync(path) : null;
  if (!bytes) throw new Error(`missing file: ${path}`);
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error(`${path} exceeds ${MAX_ARTIFACT_BYTES} bytes`);
  return JSON.parse(bytes.toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(obj: Record<string, unknown>, key: string): string | null {
  return typeof obj[key] === "string" ? (obj[key] as string) : null;
}

function arrayAt(obj: Record<string, unknown>, key: string): unknown[] {
  return Array.isArray(obj[key]) ? (obj[key] as unknown[]) : [];
}

function commands(artifact: Record<string, unknown>): string[] {
  return arrayAt(artifact, "commands_used")
    .filter(isRecord)
    .map((entry) => stringAt(entry, "command") ?? "")
    .filter(Boolean);
}

function selectedId(artifact: Record<string, unknown>): string | null {
  const selected = artifact.selected_bead;
  return isRecord(selected) ? stringAt(selected, "id") : null;
}

function expectedArtifact(caseDir: string | null): Record<string, unknown> | null {
  if (!caseDir) return null;
  const expectedPath = join(caseDir, "expected", ARTIFACT_REL);
  if (!existsSync(expectedPath)) return null;
  const parsed = readJson(expectedPath);
  return isRecord(parsed) ? parsed : null;
}

function caseId(caseDir: string | null): string {
  if (!caseDir) return FALLBACK_CASE_ID;
  try {
    const parsed = readJson(join(caseDir, "metadata.json"));
    return isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : FALLBACK_CASE_ID;
  } catch {
    return FALLBACK_CASE_ID;
  }
}

function expectedRejectedIds(expected: Record<string, unknown> | null): string[] {
  if (!expected) return [];
  const evidence = expected.graph_evidence;
  if (!isRecord(evidence)) return [];
  return arrayAt(evidence, "rejected_candidates")
    .filter(isRecord)
    .map((entry) => stringAt(entry, "id") ?? "")
    .filter(Boolean);
}

function artifactRejectedIds(artifact: Record<string, unknown>): string[] {
  const evidence = artifact.graph_evidence;
  if (!isRecord(evidence)) return [];
  return arrayAt(evidence, "rejected_candidates")
    .filter(isRecord)
    .map((entry) => stringAt(entry, "id") ?? "")
    .filter(Boolean);
}

function signalBeadIds(artifact: Record<string, unknown>): string[] {
  const evidence = artifact.graph_evidence;
  if (!isRecord(evidence)) return [];
  return arrayAt(evidence, "signals")
    .filter(isRecord)
    .map((entry) => stringAt(entry, "bead_id") ?? "")
    .filter(Boolean);
}

function validateShape(artifact: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (artifact.schema_version !== "bead-selection.v1") errors.push("schema_version must be bead-selection.v1");
  const request = stringAt(artifact, "request");
  if (!request || request.length < 5) errors.push("request must be a short non-empty string");
  const mode = stringAt(artifact, "mode");
  if (!mode || !["next", "triage", "plan", "search", "cycle_break", "label_focus", "none"].includes(mode)) {
    errors.push("mode must be a supported selection mode");
  }
  const selected = artifact.selected_bead;
  if (!isRecord(selected)) {
    errors.push("selected_bead must be an object");
  } else {
    const id = stringAt(selected, "id");
    if (!id || !/^(bd-[A-Za-z0-9._:-]+|none)$/.test(id)) errors.push("selected_bead.id must be a Bead id or none");
    for (const key of ["title", "status", "reason"]) {
      const value = stringAt(selected, key);
      if (!value || value.length < (key === "reason" ? 20 : 1)) errors.push(`selected_bead.${key} is missing or too short`);
    }
  }
  if (commands(artifact).length === 0) errors.push("commands_used must contain at least one command");
  const evidence = artifact.graph_evidence;
  if (!isRecord(evidence)) {
    errors.push("graph_evidence must be an object");
  } else {
    if (!stringAt(evidence, "primary_signal")) errors.push("graph_evidence.primary_signal is required");
    if (arrayAt(evidence, "signals").length === 0) errors.push("graph_evidence.signals must not be empty");
    if (!Array.isArray(evidence.blockers)) errors.push("graph_evidence.blockers must be an array");
    if (!Array.isArray(evidence.rejected_candidates)) errors.push("graph_evidence.rejected_candidates must be an array");
  }
  const next = artifact.next_action;
  if (!isRecord(next)) {
    errors.push("next_action must be an object");
  } else {
    if (!stringAt(next, "command")) errors.push("next_action.command is required");
    if (typeof next.destructive !== "boolean") errors.push("next_action.destructive must be boolean");
  }
  if (!Array.isArray(artifact.caveats)) errors.push("caveats must be an array");
  return errors;
}

function grade(workspaceDir: string, caseDir: string | null): { checks: Check[]; feedback: string[] } {
  const artifactPath = join(workspaceDir, ARTIFACT_REL);
  const checks: Check[] = [];
  const feedback: string[] = [];

  const exists = existsSync(artifactPath);
  checks.push(makeCheck("artifact-exists", exists, `${ARTIFACT_REL} exists`, `missing ${ARTIFACT_REL}`));
  if (!exists) return { checks, feedback: [`Write ${ARTIFACT_REL}.`] };

  let artifactUnknown: unknown;
  try {
    artifactUnknown = readJson(artifactPath);
  } catch (err) {
    checks.push(makeCheck("artifact-json", false, "artifact parses as JSON", `artifact JSON error: ${err instanceof Error ? err.message : String(err)}`));
    return { checks, feedback: ["Repair .laguna/bead-selection.json so it is valid JSON."] };
  }

  const artifact = isRecord(artifactUnknown) ? artifactUnknown : {};
  const shapeErrors = isRecord(artifactUnknown) ? validateShape(artifact) : ["artifact must be a JSON object"];
  checks.push(makeCheck("schema-valid", shapeErrors.length === 0, "artifact matches bead-selection.v1 shape", shapeErrors.join("; ")));
  feedback.push(...shapeErrors);

  const usedCommands = commands(artifact);
  const hasRobotBv = usedCommands.some((cmd) => /\bbv\s+--robot-[A-Za-z0-9-]+/.test(cmd));
  const hasBareBv = usedCommands.some((cmd) => /^\s*(PATH=[^ ]+\s+)?bv\s*$/.test(cmd));
  checks.push(makeCheck("robot-bv-used", hasRobotBv, "commands_used includes a bv --robot-* command", "commands_used must include at least one bv --robot-* command"));
  checks.push(makeCheck("no-bare-bv", !hasBareBv, "commands_used does not include bare bv", "never record or run bare bv; use bv --robot-*"));

  const id = selectedId(artifact);
  const signalIds = signalBeadIds(artifact);
  checks.push(makeCheck("selected-has-evidence", !!id && (id === "none" || signalIds.includes(id)), "selected Bead appears in graph_evidence.signals", "selected_bead.id must appear in graph_evidence.signals"));

  const next = isRecord(artifact.next_action) ? artifact.next_action : {};
  const nextCommand = stringAt(next, "command") ?? "";
  const nextOk = id === "none" ? nextCommand.toLowerCase().includes("none") : nextCommand.includes(id ?? "") && /^br\s+update\s+/.test(nextCommand);
  checks.push(makeCheck("next-action-safe", nextOk && next.destructive === false, "next_action is a non-destructive br update for the selected Bead", "next_action should be a non-destructive br update for the selected Bead"));

  const expected = expectedArtifact(caseDir);
  if (expected) {
    const expectedId = selectedId(expected);
    checks.push(makeCheck("selected-id-matches-gold", id === expectedId, `selected ${id} matches gold`, `selected ${id ?? "<missing>"} but expected ${expectedId}`));

    const requiredCommands = commands(expected);
    const missingCommands = requiredCommands.filter((required) => !usedCommands.some((cmd) => cmd.includes(required)));
    checks.push(makeCheck("expected-commands-used", missingCommands.length === 0, "all expected robot commands are reflected", `missing expected command(s): ${missingCommands.join(", ")}`));

    const missingRejected = expectedRejectedIds(expected).filter((rejected) => !artifactRejectedIds(artifact).includes(rejected));
    checks.push(makeCheck("expected-rejections-recorded", missingRejected.length === 0, "expected rejected candidates are recorded", `missing rejected candidate(s): ${missingRejected.join(", ")}`));
  }

  return { checks, feedback };
}

function writeResult(outPath: string, result: unknown): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
}

function main(): number {
  const started = Date.now();
  let workspaceDir: string;
  let outPath: string;
  let caseDir: string | null;
  try {
    workspaceDir = argvValue("--workspace") ?? "";
    outPath = argvValue("--out") ?? "";
    caseDir = argvValue("--case");
    if (!workspaceDir || !outPath) throw new Error("missing --workspace or --out");
  } catch (err) {
    console.error(`validator argv error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const id = caseId(caseDir);
  let result;
  try {
    const graded = grade(workspaceDir, caseDir);
    const passing = graded.checks.filter((c) => c.status === "pass").length;
    const status = graded.checks.length > 0 && passing === graded.checks.length ? "pass" : "fail";
    result = {
      schema_version: "validator-result.v1",
      case_id: id,
      status,
      score: Number((graded.checks.length > 0 ? passing / graded.checks.length : 0).toFixed(4)),
      checks: graded.checks,
      repair_feedback: status === "pass" ? [] : graded.checks.filter((c) => c.status === "fail").map((c) => c.detail).concat(graded.feedback),
      duration_ms: Math.max(0, Math.round(Date.now() - started))
    };
  } catch (err) {
    result = {
      schema_version: "validator-result.v1",
      case_id: id,
      status: "error",
      score: 0,
      checks: [],
      repair_feedback: [err instanceof Error ? err.message : String(err)],
      duration_ms: Math.max(0, Math.round(Date.now() - started))
    };
  }

  try {
    writeResult(outPath, result);
  } catch (err) {
    console.error(`failed to write validator result: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  return 0;
}

process.exit(main());
