/**
 * Shared helper for skill validators: emit well-formed `validator-result.v1` JSON.
 *
 * Contract: schemas/common/validator-result.v1.schema.json
 * Argv contract (fixed, language-agnostic):
 *   <cmd> --case <case_dir> --workspace <workspace_dir> --out <result_path>
 *
 * Conventions encoded here (from docs/authoring-guide.md §6):
 * - Always write the result JSON to --out, pass or fail alike, then exit 0.
 * - Nonzero exits are reserved for crashes where not even a result could be
 *   written; the harness records those as status "error".
 * - status "pass"/"fail" are graded verdicts; "error" means the validator
 *   itself could not grade (crash, timeout, unreadable inputs).
 * - score defaults to the fraction of passing checks.
 * - repair_feedback is derived only from failed checks and schema errors.
 *
 * Zero npm dependencies: bun/node builtins only, so validators run inside
 * materialized fixture workspaces with no node_modules.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type CheckStatus = "pass" | "fail";
export type ValidatorStatus = "pass" | "fail" | "error";

export interface Check {
  id: string;
  status: CheckStatus;
  detail: string;
}

export interface ValidatorResult {
  schema_version: "validator-result.v1";
  case_id: string;
  status: ValidatorStatus;
  score: number;
  checks: Check[];
  repair_feedback: string[];
  duration_ms: number;
}

export interface ValidatorArgs {
  /** Eval case directory (gold under expected/, metadata.json). Null when the
   *  validator is run live in a workspace repair loop with no case dir. */
  caseDir: string | null;
  workspaceDir: string;
  outPath: string;
}

/**
 * Parse the fixed argv contract. `--workspace` and `--out` are required;
 * `--case` is optional so the model can run the validator in its in-workspace
 * repair loop, where no eval case directory exists. Throws on missing args.
 */
export function parseValidatorArgs(argv: string[]): ValidatorArgs {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`missing value for ${flag}`);
    }
    return v;
  };
  const workspaceDir = get("--workspace");
  const outPath = get("--out");
  if (!workspaceDir) throw new Error("missing required argument: --workspace <workspace_dir>");
  if (!outPath) throw new Error("missing required argument: --out <result_path>");
  return { caseDir: get("--case"), workspaceDir, outPath };
}

/** Build a single check entry. */
export function check(id: string, ok: boolean, passDetail: string, failDetail: string): Check {
  return { id, status: ok ? "pass" : "fail", detail: ok ? passDetail : failDetail };
}

/**
 * Read the case id from `<caseDir>/metadata.json`; fall back when the case dir
 * is absent (live repair-loop invocation) or unreadable.
 */
export function readCaseId(caseDir: string | null, fallback: string): string {
  if (!caseDir) return fallback;
  try {
    const meta = JSON.parse(readFileSync(`${caseDir}/metadata.json`, "utf8"));
    return typeof meta.id === "string" && meta.id.length > 0 ? meta.id : fallback;
  } catch {
    return fallback;
  }
}

export interface MakeResultOptions {
  caseId: string;
  checks: Check[];
  /** Override the default feedback (failed-check details). */
  repairFeedback?: string[];
  /** Date.now() captured when the validator started. */
  startedAt: number;
  /** Override the computed status (rarely needed). */
  status?: ValidatorStatus;
}

/** Assemble a validator-result.v1 object from graded checks. */
export function makeResult(opts: MakeResultOptions): ValidatorResult {
  const passing = opts.checks.filter((c) => c.status === "pass").length;
  const status: ValidatorStatus =
    opts.status ?? (opts.checks.length > 0 && passing === opts.checks.length ? "pass" : "fail");
  const score = opts.checks.length > 0 ? passing / opts.checks.length : 0;
  const failedDetails = opts.checks.filter((c) => c.status === "fail").map((c) => c.detail);
  return {
    schema_version: "validator-result.v1",
    case_id: opts.caseId,
    status,
    score: Number(score.toFixed(4)),
    checks: opts.checks,
    repair_feedback: status === "pass" ? [] : (opts.repairFeedback ?? failedDetails),
    duration_ms: Math.max(0, Math.round(Date.now() - opts.startedAt)),
  };
}

/** Result for when the validator itself broke (crash, timeout, bad inputs). */
export function errorResult(caseId: string, startedAt: number): ValidatorResult {
  return {
    schema_version: "validator-result.v1",
    case_id: caseId,
    status: "error",
    score: 0,
    checks: [],
    repair_feedback: [],
    duration_ms: Math.max(0, Math.round(Date.now() - startedAt)),
  };
}

/** Write the result JSON to --out, creating parent directories. */
export function writeResult(outPath: string, result: ValidatorResult): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
}

export interface RunValidatorOptions {
  /** case_id used when --case is absent or unreadable (live repair loop). */
  fallbackCaseId: string;
  /**
   * Internal timeout for ASYNC graders: a grade() that awaits (subprocesses,
   * fs promises, ...) is raced against this and becomes a status "error"
   * result on expiry. It CANNOT interrupt a fully synchronous grade() — a
   * sync function blocks the event loop, so the timer only fires after it
   * returns. Synchronous graders must bound their own work instead
   * (size-capped reads, file/depth caps, no symlink-following recursion);
   * when the harness drives the validator, its subprocess wall cap
   * (process-group kill) is the final backstop. In the model's in-workspace
   * repair loop there is no harness backstop — bounded inputs are the
   * protection.
   */
  timeoutMs?: number;
  /** The actual grading logic. Return the checks (and optional feedback). */
  grade: (args: {
    caseDir: string | null;
    workspaceDir: string;
    caseId: string;
  }) => Promise<{ checks: Check[]; repairFeedback?: string[] }>;
}

/**
 * Standard validator main loop: parse argv, run the grader (raced against the
 * async-grader timeout — see RunValidatorOptions.timeoutMs for what that does
 * and does not cover), always write --out, exit 0 whenever a result file was
 * written. Exit 2 = unusable argv (cannot know where to write); exit 1 =
 * could not write the result file. Both are "crash" exits the harness maps
 * to "error".
 */
export async function runValidator(opts: RunValidatorOptions): Promise<never> {
  const startedAt = Date.now();
  let args: ValidatorArgs;
  try {
    args = parseValidatorArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`validator argv error: ${err instanceof Error ? err.message : String(err)}`);
    console.error("usage: <cmd> --case <case_dir> --workspace <workspace_dir> --out <result_path>");
    process.exit(2);
  }

  const caseId = readCaseId(args.caseDir, opts.fallbackCaseId);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  let result: ValidatorResult;
  try {
    const graded = await Promise.race([
      opts.grade({ caseDir: args.caseDir, workspaceDir: args.workspaceDir, caseId }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`validator timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    result = makeResult({ caseId, checks: graded.checks, repairFeedback: graded.repairFeedback, startedAt });
  } catch (err) {
    console.error(`validator error: ${err instanceof Error ? err.message : String(err)}`);
    result = errorResult(caseId, startedAt);
  }

  try {
    writeResult(args.outPath, result);
  } catch (err) {
    console.error(`failed to write result to ${args.outPath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  process.exit(0);
}
