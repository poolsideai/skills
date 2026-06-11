/**
 * Validator for the workspace-inventory skill (grades `.laguna/workspace-inventory.json`).
 *
 * Argv contract:
 *   bun validate_workspace_inventory.ts --case <case_dir> --workspace <workspace_dir> --out <result_path>
 *   --case is optional: omit it when running the validator live inside a
 *   workspace repair loop (no eval case directory exists there).
 *
 * Checks (each independently legible, stable ids):
 *   artifact-exists        .laguna/workspace-inventory.json exists and parses as JSON
 *   schema-valid           artifact matches schemas/workspace-inventory.schema.json
 *   entries-match-tree     every name in entries[] exists at the workspace root,
 *                          with the correct kind (file vs directory); no top-level
 *                          entry (excluding .laguna/) is missing from entries[]
 *   file-counts-accurate   every directory entry's file_count matches the real
 *                          recursive file count in the workspace
 *   total-files-accurate   total_files equals the sum of all directory file_counts
 *                          plus the count of top-level file entries
 *
 * Rules: no network, explicit paths only, bounded inputs, always writes --out
 * (exit 0 when a result was written; nonzero exits are crashes).
 * Runaway-protection model: the grader is synchronous. Bounded by:
 *   - size cap on artifact reads (MAX_ARTIFACT_BYTES)
 *   - lstat (never stat/follow symlinks) during directory walks
 *   - MAX_FILES_SCANNED and MAX_SCAN_DEPTH caps
 *   - the harness subprocess wall cap is the backstop
 * Emits validator-result.v1 JSON via the inline fallbackHelper (mirrors
 * skills/_shared/validator-result.ts conventions).
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// validator-result.v1 types (mirrors skills/_shared/validator-result.ts)
// ---------------------------------------------------------------------------

interface Check {
  id: string;
  status: "pass" | "fail" | "error";
  detail: string;
}

interface ValidatorResult {
  schema_version: "validator-result.v1";
  case_id: string;
  status: "pass" | "fail" | "error";
  score: number;
  checks: Check[];
  repair_feedback: string[];
  duration_ms: number;
}

interface ValidatorArgs {
  caseDir: string | null;
  workspaceDir: string;
  outPath: string;
}

// ---------------------------------------------------------------------------
// Inline helper (fallback when skills/_shared/ is not present in a materialized
// workspace). Keep in sync with _shared/validator-result.ts semantics.
// ---------------------------------------------------------------------------

const fallbackHelper = {
  parseValidatorArgs(argv: string[]): ValidatorArgs {
    const get = (flag: string): string | null => {
      const i = argv.indexOf(flag);
      if (i === -1) return null;
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--"))
        throw new Error(`missing value for ${flag}`);
      return v;
    };
    const workspaceDir = get("--workspace");
    const outPath = get("--out");
    if (!workspaceDir)
      throw new Error("missing required argument: --workspace <workspace_dir>");
    if (!outPath)
      throw new Error("missing required argument: --out <result_path>");
    return { caseDir: get("--case"), workspaceDir, outPath };
  },

  readCaseId(caseDir: string | null, fallback: string): string {
    if (!caseDir) return fallback;
    try {
      const meta = JSON.parse(
        readFileSync(`${caseDir}/metadata.json`, "utf8")
      );
      return typeof meta.id === "string" && meta.id.length > 0
        ? meta.id
        : fallback;
    } catch {
      return fallback;
    }
  },

  check(
    id: string,
    ok: boolean,
    passDetail: string,
    failDetail: string
  ): Check {
    return { id, status: ok ? "pass" : "fail", detail: ok ? passDetail : failDetail };
  },

  makeResult(opts: {
    caseId: string;
    checks: Check[];
    repairFeedback?: string[];
    startedAt: number;
    status?: ValidatorResult["status"];
  }): ValidatorResult {
    const passing = opts.checks.filter((c) => c.status === "pass").length;
    const status =
      opts.status ??
      (opts.checks.length > 0 && passing === opts.checks.length
        ? "pass"
        : "fail");
    const failedDetails = opts.checks
      .filter((c) => c.status === "fail")
      .map((c) => c.detail);
    return {
      schema_version: "validator-result.v1",
      case_id: opts.caseId,
      status,
      score: Number(
        (opts.checks.length > 0 ? passing / opts.checks.length : 0).toFixed(4)
      ),
      checks: opts.checks,
      repair_feedback:
        status === "pass" ? [] : (opts.repairFeedback ?? failedDetails),
      duration_ms: Math.max(0, Math.round(Date.now() - opts.startedAt)),
    };
  },

  errorResult(caseId: string, startedAt: number): ValidatorResult {
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

  writeResult(outPath: string, result: ValidatorResult): void {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  },
};

async function loadHelper(): Promise<typeof fallbackHelper> {
  try {
    return (await import("../../_shared/validator-result.ts")) as typeof fallbackHelper;
  } catch {
    return fallbackHelper;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARTIFACT_REL_PATH = ".laguna/workspace-inventory.json";
const FALLBACK_CASE_ID = "workspace-inventory-live";
const TIMEOUT_MS = 30_000;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024; // 2 MB — inventories are small JSON
const MAX_FILES_SCANNED = 50_000;
const MAX_SCAN_DEPTH = 64;

// Top-level names excluded from entries[] (the artifact itself lives here)
const EXCLUDED_TOP_LEVEL = new Set([".laguna"]);

// ---------------------------------------------------------------------------
// Minimal structural JSON Schema interpreter (zero npm dependencies).
// Handles the keyword subset used by workspace-inventory.schema.json.
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

function validateAgainstSchema(
  value: unknown,
  schema: SchemaNode,
  path = "$"
): string[] {
  const errs: string[] = [];
  if (schema.const !== undefined && value !== schema.const) {
    errs.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errs.push(
      `${path}: must be one of ${schema.enum
        .map((v: unknown) => JSON.stringify(v))
        .join(", ")}`
    );
  }
  if (typeof schema.type === "string" && !typeOk(value, schema.type)) {
    errs.push(
      `${path}: expected ${schema.type}, got ${
        Array.isArray(value) ? "array" : value === null ? "null" : typeof value
      }`
    );
    return errs;
  }
  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      errs.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (
      typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    ) {
      errs.push(
        `${path}: string longer than maxLength ${schema.maxLength} (got ${value.length})`
      );
    }
    if (
      typeof schema.pattern === "string" &&
      !new RegExp(schema.pattern).test(value)
    ) {
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
    if (
      typeof schema.minItems === "number" &&
      value.length < schema.minItems
    ) {
      errs.push(
        `${path}: array has fewer than minItems ${schema.minItems}`
      );
    }
    if (
      typeof schema.maxItems === "number" &&
      value.length > schema.maxItems
    ) {
      errs.push(
        `${path}: array has more than maxItems ${schema.maxItems} (got ${value.length})`
      );
    }
    if (schema.items) {
      value.forEach((item, i) =>
        errs.push(
          ...validateAgainstSchema(item, schema.items, `${path}[${i}]`)
        )
      );
    }
  }
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>;
    // Evaluate "if/then" before required/properties so directory entries are
    // checked for file_count presence.
    if (schema.if && schema.then) {
      const ifErrors = validateAgainstSchema(value, schema.if, path);
      if (ifErrors.length === 0) {
        errs.push(...validateAgainstSchema(value, schema.then, path));
      }
    }
    for (const req of schema.required ?? []) {
      if (!(req in obj))
        errs.push(`${path}: missing required property "${req}"`);
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
// Workspace scanning utilities
// ---------------------------------------------------------------------------

/** Recursively count regular files under a directory. Never follows symlinks.
 *  Bounded by MAX_FILES_SCANNED and MAX_SCAN_DEPTH (shared counters). */
function countFilesRecursive(
  dir: string,
  scannedSoFar: { n: number },
  depth: number
): number {
  if (depth > MAX_SCAN_DEPTH || scannedSoFar.n >= MAX_FILES_SCANNED) return 0;
  let count = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (scannedSoFar.n >= MAX_FILES_SCANNED) break;
    const abs = join(dir, entry);
    let st;
    try {
      st = lstatSync(abs); // lstat: never follow symlinks
    } catch {
      continue;
    }
    scannedSoFar.n += 1;
    if (st.isDirectory()) {
      count += countFilesRecursive(abs, scannedSoFar, depth + 1);
    } else if (st.isFile()) {
      count += 1;
    }
    // symlinks and other special types are not counted
  }
  return count;
}

/** Returns the sorted list of top-level entry names actually present at `wsRoot`,
 *  excluding symlinks and entries in EXCLUDED_TOP_LEVEL. */
function realTopLevelEntries(
  wsRoot: string
): Array<{ name: string; kind: "file" | "directory" }> {
  let entries: string[];
  try {
    entries = readdirSync(wsRoot).sort();
  } catch {
    return [];
  }
  const result: Array<{ name: string; kind: "file" | "directory" }> = [];
  for (const name of entries) {
    if (EXCLUDED_TOP_LEVEL.has(name)) continue;
    const abs = join(wsRoot, name);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isFile()) {
      result.push({ name, kind: "file" });
    } else if (st.isDirectory()) {
      result.push({ name, kind: "directory" });
    }
    // skip symlinks and other special types
  }
  return result;
}

// ---------------------------------------------------------------------------
// Guard utilities
// ---------------------------------------------------------------------------

const truncate = (s: string, n = 120): string =>
  s.length > n ? `${s.slice(0, n)}…` : s;

/** JSON.parse can yield null/primitives anywhere — guard before property access
 *  so junk model output grades as "fail", never crashes into status "error". */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

function grade(
  helper: typeof fallbackHelper,
  workspaceDir: string
): { checks: Check[]; repairFeedback?: string[] } {
  const checks: Check[] = [];
  const feedback: string[] = [];
  const ws = resolve(workspaceDir);
  const artifactPath = resolve(ws, ARTIFACT_REL_PATH);

  const insideWs = (p: string): boolean =>
    p === ws || p.startsWith(ws + sep);

  // 1. artifact-exists
  if (!existsSync(artifactPath)) {
    checks.push(
      helper.check(
        "artifact-exists",
        false,
        "",
        `artifact not found at workspace path ${ARTIFACT_REL_PATH}`
      )
    );
    feedback.push(
      `Write the workspace inventory JSON to ${ARTIFACT_REL_PATH} at the workspace root (create the .laguna/ directory if needed).`
    );
    return { checks, repairFeedback: feedback };
  }

  let artifactSize: number;
  try {
    artifactSize = lstatSync(artifactPath).size;
  } catch {
    checks.push(
      helper.check(
        "artifact-exists",
        false,
        "",
        `could not stat ${ARTIFACT_REL_PATH}`
      )
    );
    feedback.push(`${ARTIFACT_REL_PATH} could not be read from disk.`);
    return { checks, repairFeedback: feedback };
  }

  if (artifactSize > MAX_ARTIFACT_BYTES) {
    checks.push(
      helper.check(
        "artifact-exists",
        false,
        "",
        `${ARTIFACT_REL_PATH} is ${artifactSize} bytes, over the ${MAX_ARTIFACT_BYTES}-byte validator input cap`
      )
    );
    feedback.push(
      `${ARTIFACT_REL_PATH} must be a small JSON inventory (under ${MAX_ARTIFACT_BYTES} bytes).`
    );
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
        `${ARTIFACT_REL_PATH} exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    feedback.push(`${ARTIFACT_REL_PATH} must contain a single valid JSON object.`);
    return { checks, repairFeedback: feedback };
  }

  if (!isObj(artifact)) {
    checks.push(
      helper.check(
        "artifact-exists",
        false,
        "",
        `${ARTIFACT_REL_PATH} is valid JSON but not an object (got ${Array.isArray(artifact) ? "array" : typeof artifact})`
      )
    );
    feedback.push(`${ARTIFACT_REL_PATH} must contain a single JSON object.`);
    return { checks, repairFeedback: feedback };
  }

  checks.push(
    helper.check(
      "artifact-exists",
      true,
      `found and parsed ${ARTIFACT_REL_PATH}`,
      ""
    )
  );

  // 2. schema-valid
  const schemaPath = resolve(
    import.meta.dirname,
    "../schemas/workspace-inventory.schema.json"
  );
  let schema: SchemaNode;
  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  } catch (err) {
    // Schema file is repo-owned; a read failure is a validator bug, not a
    // model bug — but we must still write a result rather than crash.
    checks.push(
      helper.check(
        "schema-valid",
        false,
        "",
        `could not load schema at ${schemaPath}: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    feedback.push("Internal validator error: could not load schema file.");
    return { checks, repairFeedback: feedback };
  }

  const schemaErrors = validateAgainstSchema(artifact, schema);
  checks.push(
    helper.check(
      "schema-valid",
      schemaErrors.length === 0,
      "artifact matches workspace-inventory.schema.json",
      `artifact violates workspace-inventory.schema.json: ${schemaErrors.slice(0, 8).join("; ")}${schemaErrors.length > 8 ? ` (+${schemaErrors.length - 8} more)` : ""}`
    )
  );
  feedback.push(...schemaErrors.map((e) => `Schema error — ${e}`));

  const a = artifact as Record<string, unknown>;

  // 3. entries-match-tree
  // Compare the entries[] array against the real top-level directory listing.
  const claimedEntries = Array.isArray(a.entries) ? a.entries : null;

  if (claimedEntries === null) {
    checks.push(
      helper.check(
        "entries-match-tree",
        false,
        "",
        "not evaluated: entries is not an array"
      )
    );
  } else {
    const realEntries = realTopLevelEntries(ws);
    // Guard: insideWs check for the workspace root itself
    if (!insideWs(ws) && ws !== resolve(ws)) {
      checks.push(
        helper.check(
          "entries-match-tree",
          false,
          "",
          "workspace path resolution error"
        )
      );
    } else {
      const realByName = new Map<string, "file" | "directory">(
        realEntries.map((e) => [e.name, e.kind])
      );
      const claimedByName = new Map<string, "file" | "directory">();
      const entryProblems: string[] = [];

      for (const entry of claimedEntries) {
        if (!isObj(entry)) {
          entryProblems.push(
            `entry ${truncate(JSON.stringify(entry))} is not an object`
          );
          continue;
        }
        const name = entry.name;
        const kind = entry.kind;
        if (typeof name !== "string" || name.length === 0) {
          entryProblems.push(
            `entry ${truncate(JSON.stringify(entry))} has no valid string name`
          );
          continue;
        }
        if (kind !== "file" && kind !== "directory") {
          entryProblems.push(
            `entry "${name}" has invalid kind "${kind}" (must be "file" or "directory")`
          );
          continue;
        }
        if (name.includes("/") || name.includes(sep)) {
          entryProblems.push(
            `entry name "${name}" contains a path separator — entries[] must be top-level names only`
          );
          continue;
        }
        if (EXCLUDED_TOP_LEVEL.has(name)) {
          entryProblems.push(
            `entry "${name}" is in the excluded set (${[...EXCLUDED_TOP_LEVEL].join(", ")}) and must not appear in entries[]`
          );
          continue;
        }
        claimedByName.set(name, kind as "file" | "directory");
        const realKind = realByName.get(name);
        if (realKind === undefined) {
          entryProblems.push(
            `entry "${name}" does not exist at the workspace root`
          );
        } else if (realKind !== kind) {
          entryProblems.push(
            `entry "${name}" has kind="${kind}" but the workspace says it is a ${realKind}`
          );
        }
      }

      // Check for missing top-level entries
      for (const { name, kind } of realEntries) {
        if (!claimedByName.has(name)) {
          entryProblems.push(
            `top-level ${kind} "${name}" exists in the workspace but is missing from entries[]`
          );
        }
      }

      checks.push(
        helper.check(
          "entries-match-tree",
          entryProblems.length === 0,
          `all ${realEntries.length} top-level entries are correctly listed`,
          entryProblems.join("; ")
        )
      );
      feedback.push(
        ...entryProblems.map(
          (p) => `Entry mismatch — ${p}. List every top-level entry (excluding .laguna/) with the correct kind.`
        )
      );
    }
  }

  // 4. file-counts-accurate
  // For each directory entry, verify the claimed file_count against the real count.
  if (claimedEntries === null) {
    checks.push(
      helper.check(
        "file-counts-accurate",
        false,
        "",
        "not evaluated: entries is not an array"
      )
    );
  } else {
    const countProblems: string[] = [];
    const scannedSoFar = { n: 0 };

    for (const entry of claimedEntries) {
      if (!isObj(entry)) continue;
      const name = entry.name;
      const kind = entry.kind;
      if (typeof name !== "string" || kind !== "directory") continue;

      const absDir = resolve(ws, name);
      // Sanity: must be inside workspace and not a symlink
      if (!insideWs(absDir)) {
        countProblems.push(
          `directory "${name}" resolves outside the workspace — skipping count check`
        );
        continue;
      }
      let st;
      try {
        st = lstatSync(absDir);
      } catch {
        // Already flagged by entries-match-tree; skip silently
        continue;
      }
      if (!st.isDirectory()) continue; // not really a dir; entries check already flags it

      const realCount = countFilesRecursive(absDir, scannedSoFar, 0);
      const claimedCount = entry.file_count;

      if (typeof claimedCount !== "number" || !Number.isInteger(claimedCount)) {
        countProblems.push(
          `directory "${name}": file_count is not an integer (got ${JSON.stringify(claimedCount)})`
        );
      } else if (claimedCount !== realCount) {
        countProblems.push(
          `directory "${name}": claimed file_count=${claimedCount} but real count is ${realCount}`
        );
      }
    }

    checks.push(
      helper.check(
        "file-counts-accurate",
        countProblems.length === 0,
        "all directory file_count values match the real filesystem",
        countProblems.join("; ")
      )
    );
    feedback.push(
      ...countProblems.map(
        (p) =>
          `File count error — ${p}. Count every regular file recursively inside the directory (excluding symlinks).`
      )
    );
  }

  // 5. total-files-accurate
  // total_files must equal sum of directory file_counts + count of file-kind entries.
  if (claimedEntries === null) {
    checks.push(
      helper.check(
        "total-files-accurate",
        false,
        "",
        "not evaluated: entries is not an array"
      )
    );
  } else {
    const claimedTotal = a.total_files;
    if (typeof claimedTotal !== "number" || !Number.isInteger(claimedTotal)) {
      checks.push(
        helper.check(
          "total-files-accurate",
          false,
          "",
          `total_files is not an integer (got ${JSON.stringify(claimedTotal)})`
        )
      );
      feedback.push(
        "total_files must be an integer equal to the sum of all top-level file entries plus all directory file_counts."
      );
    } else {
      // Recompute expected total from claimed entries (accepts the claimed
      // file_counts so this check is independent of file-counts-accurate).
      // We also compute the actual total from the real workspace for the
      // feedback message.
      let expectedFromClaims = 0;
      let canCompute = true;
      for (const entry of claimedEntries) {
        if (!isObj(entry)) { canCompute = false; break; }
        const kind = entry.kind;
        if (kind === "file") {
          expectedFromClaims += 1;
        } else if (kind === "directory") {
          const fc = entry.file_count;
          if (typeof fc !== "number" || !Number.isInteger(fc)) {
            canCompute = false;
            break;
          }
          expectedFromClaims += fc;
        }
      }

      if (!canCompute) {
        // Can't compute expected total due to malformed entries; skip this check.
        checks.push(
          helper.check(
            "total-files-accurate",
            false,
            "",
            "not evaluated: one or more entries have invalid structure preventing total computation"
          )
        );
        feedback.push(
          "Fix entry structure (name, kind, file_count) before rechecking total_files."
        );
      } else if (claimedTotal !== expectedFromClaims) {
        checks.push(
          helper.check(
            "total-files-accurate",
            false,
            "",
            `total_files=${claimedTotal} does not match sum of entry file counts (${expectedFromClaims})`
          )
        );
        feedback.push(
          `total_files should be ${expectedFromClaims} (sum of file-kind entries + all directory file_counts), not ${claimedTotal}.`
        );
      } else {
        checks.push(
          helper.check(
            "total-files-accurate",
            true,
            `total_files=${claimedTotal} matches the sum of entry file counts`,
            ""
          )
        );
      }
    }
  }

  return { checks, repairFeedback: feedback.length > 0 ? feedback : undefined };
}

// ---------------------------------------------------------------------------
// Main (always writes --out, exits 0 when a result was written)
// ---------------------------------------------------------------------------

async function main(): Promise<never> {
  const startedAt = Date.now();
  const helper = await loadHelper();

  let args: ValidatorArgs;
  try {
    args = helper.parseValidatorArgs(process.argv.slice(2));
  } catch (err) {
    console.error(
      `validator argv error: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error(
      "usage: bun validate_workspace_inventory.ts [--case <case_dir>] --workspace <workspace_dir> --out <result_path>"
    );
    process.exit(2);
  }

  const caseId = helper.readCaseId(args.caseDir, FALLBACK_CASE_ID);
  let result: ValidatorResult;
  try {
    // grade() is synchronous; the race catches only future async paths.
    // Synchronous hang classes are bounded by size caps and scan caps inside grade().
    const graded = await Promise.race([
      Promise.resolve().then(() => grade(helper, args.workspaceDir)),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`validator timed out after ${TIMEOUT_MS}ms`)),
          TIMEOUT_MS
        )
      ),
    ]);
    result = helper.makeResult({
      caseId,
      checks: graded.checks,
      repairFeedback: graded.repairFeedback,
      startedAt,
    });
  } catch (err) {
    console.error(
      `validator error: ${err instanceof Error ? err.message : String(err)}`
    );
    result = helper.errorResult(caseId, startedAt);
  }

  try {
    helper.writeResult(args.outPath, result);
  } catch (err) {
    console.error(
      `failed to write result to ${args.outPath}: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
  process.exit(0);
}

await main();
