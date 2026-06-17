#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

type Status = "pass" | "fail" | "error";
type Check = { id: string; status: Status; detail: string };

const ARTIFACT = ".laguna/ce-plan.json";
const SCHEMA_VERSION = "ce-plan.quality-plan.v1";

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing ${flag}`);
  return value;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function lowerText(value: unknown): string {
  return text(value).toLowerCase();
}

function containsAny(haystack: string, needles: unknown[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.map(text).filter(Boolean).some((needle) => lower.includes(needle.toLowerCase()));
}

function containsCount(haystack: string, needles: unknown[]): number {
  const lower = haystack.toLowerCase();
  return needles.map(text).filter(Boolean).filter((needle) => lower.includes(needle.toLowerCase())).length;
}

function relativePath(value: unknown): boolean {
  const candidate = text(value);
  return (
    candidate.length > 0 &&
    !isAbsolute(candidate) &&
    !candidate.startsWith("~") &&
    !candidate.includes("\\") &&
    !candidate.includes("..")
  );
}

function pass(id: string, ok: boolean, passDetail: string, failDetail: string): Check {
  return { id, status: ok ? "pass" : "fail", detail: ok ? passDetail : failDetail };
}

function writeResult(outPath: string, caseId: string, checks: Check[], started: number): void {
  const passing = checks.filter((check) => check.status === "pass").length;
  const status: Status = checks.length > 0 && passing === checks.length ? "pass" : "fail";
  const repair = checks
    .filter((check) => check.status !== "pass")
    .map((check) => `${check.id}: ${check.detail}`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        schema_version: "validator-result.v1",
        case_id: caseId,
        status,
        score: checks.length > 0 ? Number((passing / checks.length).toFixed(4)) : 0,
        checks,
        repair_feedback: status === "pass" ? [] : repair,
        duration_ms: Math.max(0, Math.round(Date.now() - started)),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function main(): void {
  const started = Date.now();
  const workspace = valueAfter("--workspace") ?? ".";
  const out = valueAfter("--out");
  const caseDir = valueAfter("--case");
  if (!out) throw new Error("missing --out");
  const caseId = caseDir ? caseDir.split("/").filter(Boolean).pop() ?? "ce-plan-quality" : "ce-plan-quality";
  const artifactPath = join(workspace, ARTIFACT);
  const expected = caseDir && existsSync(join(caseDir, "input", "quality-expectations.json"))
    ? object(JSON.parse(readFileSync(join(caseDir, "input", "quality-expectations.json"), "utf8")))
    : {};

  if (!existsSync(artifactPath)) {
    writeResult(out, caseId, [pass("artifact-exists", false, "artifact exists", `write ${ARTIFACT}`)], started);
    return;
  }

  let data: Record<string, unknown>;
  try {
    data = object(JSON.parse(readFileSync(artifactPath, "utf8")));
  } catch (error) {
    writeResult(
      out,
      caseId,
      [pass("artifact-json", false, "artifact parses", `artifact must be valid JSON: ${String(error)}`)],
      started,
    );
    return;
  }

  const titleTerms = asArray(expected.title_terms);
  const topicTerms = asArray(expected.topic_terms);
  const requirementTerms = asArray(expected.requirement_terms);
  const pathTerms = asArray(expected.path_terms);
  const riskTerms = asArray(expected.risk_terms);
  const forbiddenTerms = asArray(expected.forbidden_terms);

  const title = text(data.title);
  const problemFrame = text(data.problem_frame);
  const scope = object(data.scope);
  const requirements = asArray(data.requirements).map(text);
  const decisions = asArray(data.decisions).map(text);
  const units = asArray(data.implementation_units).map(object);
  const testScenarios = asArray(data.test_scenarios).map(text);
  const risks = asArray(data.risks).map(text);
  const evidenceSources = asArray(data.evidence_sources).map(text);
  const allUnitFiles = units.flatMap((unit) => asArray(unit.files).map(text));
  const allTestFiles = units.flatMap((unit) => asArray(unit.test_files).map(text));
  const combined = [
    title,
    problemFrame,
    ...asArray(scope.in_scope).map(text),
    ...asArray(scope.non_goals).map(text),
    ...requirements,
    ...decisions,
    ...units.flatMap((unit) => [text(unit.name), text(unit.work), ...asArray(unit.files).map(text), ...asArray(unit.test_files).map(text)]),
    ...testScenarios,
    ...risks,
    ...evidenceSources,
  ].join("\n");

  const checks: Check[] = [];
  checks.push(pass(
    "schema-version",
    data.schema_version === SCHEMA_VERSION,
    "schema_version is the ce-plan quality contract",
    `set schema_version to ${SCHEMA_VERSION}`,
  ));
  checks.push(pass(
    "title-specific",
    title.length >= 4 && containsAny(title, titleTerms),
    "title names the requested feature",
    `title should name one of: ${titleTerms.map(text).join(", ")}`,
  ));
  checks.push(pass(
    "problem-frame",
    problemFrame.length >= 120 && containsCount(problemFrame, topicTerms) >= Math.min(2, topicTerms.length),
    "problem frame explains the case-specific problem",
    `problem_frame should explain the requested topic using terms such as: ${topicTerms.map(text).join(", ")}`,
  ));
  checks.push(pass(
    "scope-boundary",
    asArray(scope.in_scope).length >= 3 && asArray(scope.non_goals).length >= 2,
    "scope separates in-scope work from non-goals",
    "scope needs >=3 in_scope items and >=2 non_goals",
  ));
  checks.push(pass(
    "requirements-traceability",
    requirements.length >= 5 && containsCount(requirements.join("\n"), requirementTerms) >= Math.min(3, requirementTerms.length),
    "requirements trace to the case brief",
    `requirements should cover at least three of: ${requirementTerms.map(text).join(", ")}`,
  ));
  checks.push(pass(
    "decisions",
    decisions.length >= 3 && decisions.filter((decision) => /because|so that|trade|rationale|prefer|avoid/i.test(decision)).length >= 2,
    "decisions include rationale",
    "include >=3 decisions and rationale/tradeoff language in at least two",
  ));
  checks.push(pass(
    "implementation-units",
    units.length >= 3 &&
      allUnitFiles.length >= 3 &&
      allTestFiles.length >= 2 &&
      containsCount([...allUnitFiles, ...allTestFiles].join("\n"), pathTerms) >= Math.min(2, pathTerms.length),
    "implementation units name relevant files and tests",
    `implementation_units should include repo paths related to: ${pathTerms.map(text).join(", ")}`,
  ));
  checks.push(pass(
    "repo-relative-paths",
    [...allUnitFiles, ...allTestFiles].length >= 5 && [...allUnitFiles, ...allTestFiles].every(relativePath),
    "all file and test paths are repo-relative",
    "all implementation/test paths must be repo-relative; do not use absolute paths",
  ));
  checks.push(pass(
    "test-scenarios",
    testScenarios.length >= 5 && containsCount(testScenarios.join("\n"), requirementTerms) >= Math.min(2, requirementTerms.length),
    "test scenarios cover the core requested behavior",
    "test_scenarios needs >=5 concrete cases tied to the requested behavior",
  ));
  checks.push(pass(
    "risks",
    risks.length >= 2 && (riskTerms.length === 0 || containsAny(risks.join("\n"), riskTerms)),
    "risks capture case-specific failure modes",
    `risks should mention at least one of: ${riskTerms.map(text).join(", ")}`,
  ));
  checks.push(pass(
    "evidence-sources",
    evidenceSources.includes("input/source-plan.md") && evidenceSources.includes("input/repo-context.md"),
    "evidence_sources cite the local source plan and repo context",
    "evidence_sources must include input/source-plan.md and input/repo-context.md",
  ));
  checks.push(pass(
    "forbidden-stale-context",
    forbiddenTerms.length === 0 || !forbiddenTerms.some((term) => lowerText(term) && combined.toLowerCase().includes(lowerText(term))),
    "artifact avoids stale or forbidden context",
    `artifact must avoid stale/forbidden terms: ${forbiddenTerms.map(text).join(", ")}`,
  ));

  writeResult(out, caseId, checks, started);
}

try {
  main();
} catch (error) {
  const out = valueAfter("--out");
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      JSON.stringify(
        {
          schema_version: "validator-result.v1",
          case_id: "ce-plan-quality",
          status: "error",
          score: 0,
          checks: [],
          repair_feedback: [String(error)],
          duration_ms: 0,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }
  process.exit(out ? 0 : 1);
}
