/**
 * Validator for the ci-log-reducer skill (grades `.laguna/ci-log-summary.json`).
 *
 * Argv contract: bun validate_log_summary.ts --case <case_dir> --workspace <workspace_dir> --out <result_path>
 *   --case is optional: omit it when running the validator live inside a
 *   workspace repair loop (no eval case directory exists there).
 *
 * Checks (each independently legible, stable ids):
 *   artifact-exists           .laguna/ci-log-summary.json exists and parses as JSON
 *   schema-valid              artifact matches schemas/ci-log-summary.schema.json
 *   log-file-exists           log_file resolves to a real file inside the workspace
 *   cited-lines-exist         every error_lines[].line exists in the log
 *   error-lines-verbatim      every error_lines[].text matches that log line exactly
 *                             (trailing whitespace insignificant)
 *   failing-command-supported failing_command appears in the log, or matches the
 *                             command in ci-job.json (workspace root, optional)
 *   next-commands-safe        no suggested command is networked or destructive
 *
 * Rules: no network, explicit paths only, bounded inputs, always writes --out
 * (exit 0 when a result was written; nonzero exits are crashes).
 * Runaway-protection model (the grader is synchronous, so the async race in
 * main() cannot interrupt it — it only covers a grader that goes async):
 * every untrusted readFileSync is size-capped (MAX_ARTIFACT_BYTES /
 * MAX_LOG_BYTES below; oversized inputs grade as failing checks, never
 * hangs), schema files are repo-owned and trusted, and the harness's
 * subprocess wall cap (default 120s, process-group kill) is the backstop.
 * Emits validator-result.v1 via skills/_shared/validator-result.ts.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type {
  Check,
  ValidatorResult,
  ValidatorArgs,
} from "../../_shared/validator-result.ts";

const ARTIFACT_REL_PATH = ".laguna/ci-log-summary.json";
const CI_JOB_REL_PATH = "ci-job.json";
const FALLBACK_CASE_ID = "ci-log-reducer-live";
const TIMEOUT_MS = 30_000;
// Input size caps (bounded-input rule, header). A summary artifact is tiny by
// contract; CI logs in fixtures are small — the caps only trip pathological
// inputs that would otherwise stall a synchronous readFileSync.
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_LOG_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helper loading. Canonical source: skills/_shared/validator-result.ts (works
// whenever the validator runs from the repo tree — harness grading and gold
// replay). Materialized workspaces copy only skills/ci-log-reducer/ into
// .poolside/skills/, so the in-run repair loop falls back to this minimal
// mirror of the same conventions. Keep the fallback in sync with _shared.
// ---------------------------------------------------------------------------

interface Helper {
  parseValidatorArgs(argv: string[]): ValidatorArgs;
  readCaseId(caseDir: string | null, fallback: string): string;
  check(id: string, ok: boolean, passDetail: string, failDetail: string): Check;
  makeResult(opts: {
    caseId: string;
    checks: Check[];
    repairFeedback?: string[];
    startedAt: number;
    status?: ValidatorResult["status"];
  }): ValidatorResult;
  errorResult(caseId: string, startedAt: number): ValidatorResult;
  writeResult(outPath: string, result: ValidatorResult): void;
}

const fallbackHelper: Helper = {
  parseValidatorArgs(argv) {
    const get = (flag: string): string | null => {
      const i = argv.indexOf(flag);
      if (i === -1) return null;
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`missing value for ${flag}`);
      return v;
    };
    const workspaceDir = get("--workspace");
    const outPath = get("--out");
    if (!workspaceDir) throw new Error("missing required argument: --workspace <workspace_dir>");
    if (!outPath) throw new Error("missing required argument: --out <result_path>");
    return { caseDir: get("--case"), workspaceDir, outPath };
  },
  readCaseId(caseDir, fallback) {
    if (!caseDir) return fallback;
    try {
      const meta = JSON.parse(readFileSync(`${caseDir}/metadata.json`, "utf8"));
      return typeof meta.id === "string" && meta.id.length > 0 ? meta.id : fallback;
    } catch {
      return fallback;
    }
  },
  check(id, ok, passDetail, failDetail) {
    return { id, status: ok ? "pass" : "fail", detail: ok ? passDetail : failDetail };
  },
  makeResult(opts) {
    const passing = opts.checks.filter((c) => c.status === "pass").length;
    const status =
      opts.status ?? (opts.checks.length > 0 && passing === opts.checks.length ? "pass" : "fail");
    const failedDetails = opts.checks.filter((c) => c.status === "fail").map((c) => c.detail);
    return {
      schema_version: "validator-result.v1",
      case_id: opts.caseId,
      status,
      score: Number((opts.checks.length > 0 ? passing / opts.checks.length : 0).toFixed(4)),
      checks: opts.checks,
      repair_feedback: status === "pass" ? [] : (opts.repairFeedback ?? failedDetails),
      duration_ms: Math.max(0, Math.round(Date.now() - opts.startedAt)),
    };
  },
  errorResult(caseId, startedAt) {
    return {
      schema_version: "validator-result.v1",
      case_id: caseId,
      status: "error",
      score: 0,
      checks: [],
      repair_feedback: [],
      duration_ms: Math.max(0, Math.round(Date.now() - startedAt)),
    };
  },
  writeResult(outPath, result) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  },
};

async function loadHelper(): Promise<Helper> {
  try {
    return (await import("../../_shared/validator-result.ts")) as Helper;
  } catch {
    return fallbackHelper;
  }
}

// ---------------------------------------------------------------------------
// Minimal structural JSON Schema interpreter for the keyword subset used by
// schemas/ci-log-summary.schema.json (zero npm dependencies by design; see
// docs/authoring-guide.md §5). The hand-authored schema file stays the single
// source of truth — this interpreter reads it at runtime.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type SchemaNode = any;

function typeOk(value: unknown, t: string): boolean {
  switch (t) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

function validateAgainstSchema(value: unknown, schema: SchemaNode, path = "$"): string[] {
  const errs: string[] = [];
  if (schema.const !== undefined && value !== schema.const) {
    errs.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errs.push(`${path}: must be one of ${schema.enum.map((v: unknown) => JSON.stringify(v)).join(", ")}`);
  }
  if (typeof schema.type === "string" && !typeOk(value, schema.type)) {
    errs.push(`${path}: expected ${schema.type}, got ${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}`);
    return errs; // type-specific keywords below would only produce noise
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errs.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errs.push(`${path}: string longer than maxLength ${schema.maxLength} (got ${value.length})`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      errs.push(`${path}: does not match pattern ${schema.pattern}`);
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errs.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errs.push(`${path}: ${value} is above maximum ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errs.push(`${path}: array has fewer than minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errs.push(`${path}: array has more than maxItems ${schema.maxItems} (got ${value.length})`);
    }
    if (schema.items) {
      value.forEach((item, i) => errs.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`)));
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (!(req in obj)) errs.push(`${path}: missing required property "${req}"`);
    }
    const props: Record<string, SchemaNode> = schema.properties ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (k in props) {
        errs.push(...validateAgainstSchema(v, props[k], `${path}.${k}`));
      } else if (schema.additionalProperties === false) {
        errs.push(`${path}: unexpected property "${k}"`);
      }
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Safety screening for suggested_next_commands: deny networked and destructive
// operations. Substring/regex screening over each command string.
// ---------------------------------------------------------------------------

const DENY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(curl|wget|ssh|scp|sftp|rsync|nc|netcat|telnet|ping)\b/i, reason: "network tool" },
  { pattern: /\bgit\s+(push|pull|fetch|clone|remote)\b/i, reason: "git network operation" },
  { pattern: /\bgh\b/, reason: "GitHub CLI (network)" },
  { pattern: /\b(pip3?|pipx)\s+install\b/i, reason: "package install (network)" },
  { pattern: /\bnpm\s+(install|ci|i|add|update)\b/i, reason: "package install (network)" },
  { pattern: /\bpnpm\s+(install|add|update)\b/i, reason: "package install (network)" },
  { pattern: /\byarn\s+(add|install|upgrade)\b/i, reason: "package install (network)" },
  { pattern: /\bbun\s+(install|add|update|pm)\b/i, reason: "package install (network)" },
  { pattern: /\bcargo\s+(install|add|update|publish)\b/i, reason: "package install (network)" },
  { pattern: /\bgo\s+(get|install)\b/i, reason: "package install (network)" },
  { pattern: /\buv\s+(add|pip|sync)\b/i, reason: "package install (network)" },
  { pattern: /\b(apt-get|apt|yum|dnf|pacman|brew)\b/i, reason: "system package manager (network)" },
  { pattern: /\bdocker\s+(pull|push|login|run)\b/i, reason: "docker network/exec operation" },
  { pattern: /\brm\b/, reason: "file deletion (destructive)" },
  { pattern: /\bgit\s+(reset\s+--hard|clean|restore)\b/i, reason: "discards changes (destructive)" },
  { pattern: /\bgit\s+checkout\s+(--|\.)/, reason: "discards changes (destructive)" },
  { pattern: /\b(mkfs|shred|truncate)\b/i, reason: "destructive filesystem operation" },
  { pattern: /\bdd\b/, reason: "destructive filesystem operation" },
  { pattern: /\b(sudo|doas)\b/i, reason: "privilege escalation" },
  { pattern: /\b(pkill|killall|shutdown|reboot)\b/i, reason: "process/system control (destructive)" },
  { pattern: /\bkill\b/, reason: "process control (destructive)" },
  { pattern: />\s*\//, reason: "redirect to an absolute path (destructive)" },
];

function unsafeReasons(command: string): string[] {
  return DENY_PATTERNS.filter(({ pattern }) => pattern.test(command)).map(({ reason }) => reason);
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

const truncate = (s: string, n = 140): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const rstrip = (s: string): string => s.replace(/[\s\r]+$/u, "");
/** JSON.parse can yield null/primitives anywhere — guard before property access
 *  so junk model output grades as "fail", never crashes into status "error". */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function grade(helper: Helper, workspaceDir: string): { checks: Check[]; repairFeedback?: string[] } {
  const checks: Check[] = [];
  const feedback: string[] = [];
  const ws = resolve(workspaceDir);
  const artifactPath = resolve(ws, ARTIFACT_REL_PATH);

  // 1. artifact-exists
  if (!existsSync(artifactPath)) {
    checks.push(
      helper.check("artifact-exists", false, "", `artifact not found at workspace path ${ARTIFACT_REL_PATH}`),
    );
    feedback.push(
      `Write the summary JSON to ${ARTIFACT_REL_PATH} at the workspace root (create the .laguna/ directory if needed).`,
    );
    return { checks, repairFeedback: feedback };
  }
  const artifactSize = statSync(artifactPath).size;
  if (artifactSize > MAX_ARTIFACT_BYTES) {
    checks.push(
      helper.check(
        "artifact-exists",
        false,
        "",
        `${ARTIFACT_REL_PATH} is ${artifactSize} bytes, over the ${MAX_ARTIFACT_BYTES}-byte validator input cap`,
      ),
    );
    feedback.push(`${ARTIFACT_REL_PATH} must be a small JSON summary (under ${MAX_ARTIFACT_BYTES} bytes).`);
    return { checks, repairFeedback: feedback };
  }
  let artifact: unknown;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (err) {
    checks.push(
      helper.check(
        "artifact-exists",
        false,
        "",
        `${ARTIFACT_REL_PATH} exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    feedback.push(`${ARTIFACT_REL_PATH} must contain a single valid JSON object.`);
    return { checks, repairFeedback: feedback };
  }
  if (!isObj(artifact)) {
    checks.push(
      helper.check("artifact-exists", false, "", `${ARTIFACT_REL_PATH} is valid JSON but not an object`),
    );
    feedback.push(`${ARTIFACT_REL_PATH} must contain a single JSON object.`);
    return { checks, repairFeedback: feedback };
  }
  checks.push(helper.check("artifact-exists", true, `found and parsed ${ARTIFACT_REL_PATH}`, ""));

  // 2. schema-valid
  const schemaPath = resolve(import.meta.dirname, "../schemas/ci-log-summary.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const schemaErrors = validateAgainstSchema(artifact, schema);
  checks.push(
    helper.check(
      "schema-valid",
      schemaErrors.length === 0,
      "artifact matches ci-log-summary.schema.json",
      `artifact violates ci-log-summary.schema.json: ${schemaErrors.slice(0, 8).join("; ")}${schemaErrors.length > 8 ? ` (+${schemaErrors.length - 8} more)` : ""}`,
    ),
  );
  feedback.push(...schemaErrors.map((e) => `Schema error — ${e}`));

  const a = artifact as Record<string, unknown>;

  // 3. log-file-exists
  let logLines: string[] | null = null;
  let logText: string | null = null;
  if (typeof a.log_file === "string" && a.log_file.length > 0) {
    const logPath = resolve(ws, a.log_file);
    const inside = logPath === ws || logPath.startsWith(ws + sep);
    const isFile = inside && existsSync(logPath) && statSync(logPath).isFile();
    const sizeOk = isFile && statSync(logPath).size <= MAX_LOG_BYTES;
    checks.push(
      helper.check(
        "log-file-exists",
        isFile && sizeOk,
        `log_file "${a.log_file}" exists in the workspace`,
        !inside
          ? `log_file "${a.log_file}" escapes the workspace`
          : !isFile
            ? `log_file "${a.log_file}" does not exist in the workspace`
            : `log_file "${a.log_file}" is over the ${MAX_LOG_BYTES}-byte validator input cap`,
      ),
    );
    if (isFile && sizeOk) {
      logText = readFileSync(logPath, "utf8");
      logLines = logText.split("\n");
      // a trailing newline yields a phantom empty final element; drop it
      if (logLines.length > 0 && logLines[logLines.length - 1] === "") logLines.pop();
    } else {
      feedback.push(`Set log_file to the workspace-relative path of the CI log you analyzed.`);
    }
  } else {
    checks.push(helper.check("log-file-exists", false, "", "log_file is missing or not a non-empty string"));
    feedback.push("Set log_file to the workspace-relative path of the CI log you analyzed.");
  }

  // 4 + 5. cited-lines-exist, error-lines-verbatim
  const entries = Array.isArray(a.error_lines) ? a.error_lines : null;
  if (entries === null || logLines === null) {
    const why = entries === null ? "error_lines is not an array" : "the log file is unavailable";
    checks.push(helper.check("cited-lines-exist", false, "", `not evaluated: ${why}`));
    checks.push(helper.check("error-lines-verbatim", false, "", `not evaluated: ${why}`));
  } else {
    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const entry of entries) {
      if (!isObj(entry)) {
        missing.push(`entry ${truncate(JSON.stringify(entry))} is not {line: integer, text: string}`);
        continue;
      }
      const e = entry;
      if (typeof e.line !== "number" || !Number.isInteger(e.line) || typeof e.text !== "string") {
        missing.push(`entry ${truncate(JSON.stringify(entry))} is not {line: integer, text: string}`);
        continue;
      }
      if (e.line < 1 || e.line > logLines.length) {
        missing.push(`cited line ${e.line} does not exist (log has ${logLines.length} lines)`);
        continue;
      }
      const actual = logLines[e.line - 1];
      if (rstrip(e.text) !== rstrip(actual)) {
        mismatched.push(`line ${e.line}: text differs from the log; log says ${JSON.stringify(truncate(actual))}`);
      }
    }
    checks.push(
      helper.check(
        "cited-lines-exist",
        missing.length === 0,
        `all ${entries.length} cited line numbers exist in the log`,
        missing.join("; "),
      ),
    );
    checks.push(
      helper.check(
        "error-lines-verbatim",
        mismatched.length === 0,
        "all cited error lines match the log verbatim",
        mismatched.join("; "),
      ),
    );
    feedback.push(...missing.map((m) => `Cited line problem — ${m}`));
    feedback.push(...mismatched.map((m) => `Verbatim mismatch — ${m}. Copy the line exactly as it appears.`));
  }

  // 6. failing-command-supported
  if (typeof a.failing_command === "string" && a.failing_command.trim().length > 0) {
    const cmd = a.failing_command.trim();
    let jobCmd: string | null = null;
    const jobPath = resolve(ws, CI_JOB_REL_PATH);
    if (existsSync(jobPath) && statSync(jobPath).isFile() && statSync(jobPath).size <= MAX_ARTIFACT_BYTES) {
      try {
        const job: unknown = JSON.parse(readFileSync(jobPath, "utf8"));
        if (isObj(job) && typeof job.command === "string") jobCmd = job.command.trim();
      } catch {
        /* unreadable metadata simply provides no support */
      }
    }
    const supported =
      (logText !== null && logText.includes(cmd)) ||
      (jobCmd !== null && (jobCmd.includes(cmd) || cmd.includes(jobCmd)));
    checks.push(
      helper.check(
        "failing-command-supported",
        supported,
        `failing_command "${truncate(cmd, 80)}" is supported by the log or ci-job.json`,
        `failing_command "${truncate(cmd, 80)}" appears in neither the log nor ci-job.json — do not invent commands`,
      ),
    );
    if (!supported) {
      feedback.push(
        "Set failing_command to the command actually shown in the log (or in ci-job.json); never invent one.",
      );
    }
  } else {
    checks.push(helper.check("failing-command-supported", false, "", "failing_command is missing or empty"));
    feedback.push("Set failing_command to the command that failed, as evidenced by the log or ci-job.json.");
  }

  // 7. next-commands-safe
  const cmds = Array.isArray(a.suggested_next_commands) ? a.suggested_next_commands : null;
  if (cmds === null) {
    checks.push(helper.check("next-commands-safe", false, "", "suggested_next_commands is not an array"));
  } else {
    const offenders: string[] = [];
    for (const c of cmds) {
      if (typeof c !== "string") {
        offenders.push(`${JSON.stringify(c)} is not a string`);
        continue;
      }
      const reasons = unsafeReasons(c);
      if (reasons.length > 0) offenders.push(`"${truncate(c, 80)}" — ${reasons.join(", ")}`);
    }
    checks.push(
      helper.check(
        "next-commands-safe",
        offenders.length === 0,
        `all ${cmds.length} suggested commands are safe and local`,
        offenders.join("; "),
      ),
    );
    feedback.push(
      ...offenders.map((o) => `Unsafe suggested command — ${o}. Suggest only local, non-destructive commands.`),
    );
  }

  return { checks, repairFeedback: feedback.length > 0 ? feedback : undefined };
}

// ---------------------------------------------------------------------------
// Main (mirrors _shared runValidator semantics; always writes --out, exit 0
// when a result file was written, nonzero exits reserved for crashes).
// ---------------------------------------------------------------------------

async function main(): Promise<never> {
  const startedAt = Date.now();
  const helper = await loadHelper();

  let args: ValidatorArgs;
  try {
    args = helper.parseValidatorArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`validator argv error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      "usage: bun validate_log_summary.ts [--case <case_dir>] --workspace <workspace_dir> --out <result_path>",
    );
    process.exit(2);
  }

  const caseId = helper.readCaseId(args.caseDir, FALLBACK_CASE_ID);
  let result: ValidatorResult;
  try {
    // grade() is synchronous: this race can only catch a grader that goes
    // async in the future. The sync hang classes are bounded inside grade()
    // (size-capped reads); the harness subprocess cap is the backstop.
    const graded = await Promise.race([
      Promise.resolve().then(() => grade(helper, args.workspaceDir)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`validator timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);
    result = helper.makeResult({ caseId, checks: graded.checks, repairFeedback: graded.repairFeedback, startedAt });
  } catch (err) {
    console.error(`validator error: ${err instanceof Error ? err.message : String(err)}`);
    result = helper.errorResult(caseId, startedAt);
  }

  try {
    helper.writeResult(args.outPath, result);
  } catch (err) {
    console.error(`failed to write result to ${args.outPath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  process.exit(0);
}

await main();
