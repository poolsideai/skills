/**
 * Validator for the laguna-task-contract skill.
 *
 * Grades exactly one contract artifact at the workspace root:
 *   .laguna/task-contract.json    (task-contract.v1   — Laguna XS.2 bounded worker)
 *   .laguna/router-contract.json  (router-contract.v1 — Laguna M.1 constrained router)
 *
 * Argv contract: bun validate_contract.ts --case <case_dir> --workspace <workspace_dir> --out <result_path>
 *   --case is optional: omit it when running the validator live inside a
 *   workspace repair loop (no eval case directory exists there).
 *
 * Checks (each independently legible, stable ids):
 *   artifact-exists            one of the two contract artifacts exists and parses as JSON
 *   single-artifact            not both artifacts present (one contract per request)
 *   schema-valid               artifact matches its schema (task-contract / router-contract)
 *  task contracts:
 *   goal-single-concern        goal is one sentence naming one concern (no chained tasks)
 *   scope-bounded              scope.paths are explicit/bounded; max_files_to_modify fits task_type
 *   acceptance-checks-local    every acceptance check is concrete, runnable, safe, and local
 *   no-unbounded-verbs         goal carries no unbounded language ("whole repo", "everything", ...)
 *  router contracts:
 *   chosen-skill-in-candidates routing_decision.chosen_skill is in candidate_skills
 *   routing-matches-delegation first delegation's task_type matches the chosen skill (known skills)
 *   delegations-schema-valid   every embedded task_contract validates against task-contract.schema.json
 *   delegation-goals-single-concern / delegation-scopes-bounded /
 *   delegation-acceptance-local / delegation-no-unbounded-verbs
 *                              the four bounded-contract rules applied to every delegation
 *   stop-conditions-sound      stop_conditions include validator_passed AND escalation_required
 *
 * Rules: no network, explicit paths only, bounded inputs, always writes --out
 * (exit 0 when a result was written; nonzero exits are crashes).
 * Runaway-protection model (the grader is synchronous, so the async race in
 * main() cannot interrupt it — it only covers a grader that goes async):
 * the only untrusted readFileSync (the contract artifact) is size-capped
 * (MAX_ARTIFACT_BYTES), schema files are repo-owned and trusted, and the
 * harness's subprocess wall cap (default 120s, process-group kill) is the
 * backstop.
 * Emits validator-result.v1 via skills/_shared/validator-result.ts.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  Check,
  ValidatorResult,
  ValidatorArgs,
} from "../../_shared/validator-result.ts";

const TASK_ARTIFACT_REL_PATH = ".laguna/task-contract.json";
const ROUTER_ARTIFACT_REL_PATH = ".laguna/router-contract.json";
const FALLBACK_CASE_ID = "laguna-task-contract-live";
const TIMEOUT_MS = 30_000;
// Input size cap (bounded-input rule, header): contracts are small by design.
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helper loading. Canonical source: skills/_shared/validator-result.ts (works
// whenever the validator runs from the repo tree — harness grading and gold
// replay). Materialized workspaces copy only skills/laguna-task-contract/ into
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
// the two hand-authored schemas (zero npm dependencies by design; see
// docs/authoring-guide.md §5). The schema files stay the single source of
// truth — this interpreter reads them at runtime. It does not dereference
// $ref, which is why router-contract.schema.json declares embedded task
// contracts as plain objects and this validator applies task-contract.schema.json
// to each of them explicitly.
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
// Bounded-contract rules. These are the checks that make a contract a
// contract rather than a transcribed wish. Documented deny lists; see
// references/anti-patterns.md for the prose version.
// ---------------------------------------------------------------------------

/** Multi-concern / multi-step markers a single-concern goal must not contain. */
const MULTI_CONCERN_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /\n/, what: "contains a line break" },
  { re: /;\s/, what: "chains clauses with ';'" },
  { re: /\band\s+then\b/i, what: "chains steps with 'and then'" },
  { re: /\band\s+also\b/i, what: "chains tasks with 'and also'" },
  { re: /,\s*then\b/i, what: "chains steps with ', then'" },
  { re: /,\s*and\b/i, what: "chains tasks with ', and'" },
  { re: /\bas\s+well\s+as\b/i, what: "chains tasks with 'as well as'" },
  { re: /\bafter\s+that\b/i, what: "chains steps with 'after that'" },
];

/** Unbounded language a worker goal must not contain (Plan A's good-failure set). */
const UNBOUNDED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(whole|entire)\s+(repo|repository|codebase|project)\b/i, reason: "targets the whole repo" },
  { re: /\ball\s+(the\s+)?(files|tests|bugs|issues|todos?|warnings|errors|deps|dependencies|modules|packages)\b/i, reason: "quantifies over everything" },
  { re: /\bevery\s+(file|test|bug|issue|todo|warning|error|dep|dependency|module|package)\b/i, reason: "quantifies over everything" },
  { re: /\beverything\b/i, reason: "unbounded object" },
  { re: /\bany\s+approach\b/i, reason: "unbounded method" },
  { re: /\bas\s+needed\b/i, reason: "open-ended scope" },
  { re: /\bwherever\b/i, reason: "open-ended scope" },
  { re: /\brecursively\b/i, reason: "recursive delegation" },
  { re: /\buntil\s+(it\s+is\s+|it'?s\s+|it\s+)?(works|passes|solved|fixed|done)\b/i, reason: "open-ended stopping condition" },
  { re: /\b(and|or)\s+more\b/i, reason: "open-ended enumeration" },
  { re: /\betc\.?(\s|$)/i, reason: "open-ended enumeration" },
];

/** Placeholders that make an acceptance command non-runnable. */
const PLACEHOLDER_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /\.\.\.|…/, what: "ellipsis" },
  { re: /<[^>]+>/, what: "angle-bracket placeholder" },
  { re: /\bTODO\b/i, what: "TODO marker" },
  { re: /\bTBD\b/i, what: "TBD marker" },
  { re: /\bFIXME\b/i, what: "FIXME marker" },
];

/** Networked / destructive command screening (same list as ci-log-reducer's
 *  next-commands-safe check; duplicated by design so the validator stays
 *  self-contained in materialized workspaces). */
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

const truncate = (s: string, n = 120): string => (s.length > n ? `${s.slice(0, n)}…` : s);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function unsafeReasons(command: string): string[] {
  return DENY_PATTERNS.filter(({ pattern }) => pattern.test(command)).map(({ reason }) => reason);
}

/** goal must be one sentence naming one concern. */
function goalConcernIssues(goal: unknown, label: string): string[] {
  if (typeof goal !== "string" || goal.trim().length === 0) {
    return [`${label} is missing or not a non-empty string`];
  }
  const issues: string[] = [];
  for (const { re, what } of MULTI_CONCERN_PATTERNS) {
    const m = goal.match(re);
    if (m) issues.push(`${label} ${what} ("${truncate(m[0].trim() || "\\n", 40)}") — state exactly one concern`);
  }
  if (/[.!?]\s+\S/.test(goal)) {
    issues.push(`${label} contains more than one sentence — state exactly one concern in one sentence`);
  }
  return issues;
}

/** goal must not contain unbounded language. */
function unboundedVerbIssues(goal: unknown, label: string): string[] {
  if (typeof goal !== "string") return [`${label} is missing or not a string`];
  const issues: string[] = [];
  for (const { re, reason } of UNBOUNDED_PATTERNS) {
    const m = goal.match(re);
    if (m) issues.push(`${label} contains unbounded language "${m[0]}" (${reason})`);
  }
  return issues;
}

/** Workspace-relative path sanity for schema_path / target_path. */
function relPathIssue(p: string): string | null {
  const t = p.trim();
  if (t.length === 0) return "is empty";
  if (t.startsWith("/")) return "is an absolute path — use a workspace-relative path";
  if (/(^|\/)\.\.(\/|$)/.test(t)) return "escapes the workspace via '..'";
  return null;
}

/** Scope paths must be explicit files or bounded globs. */
function scopePathIssue(p: string): string | null {
  const base = relPathIssue(p);
  if (base) return base;
  const t = p.trim();
  if (t === "." || t === "./") return "names the whole workspace — list explicit files or bounded globs";
  const rest = t.startsWith("./") ? t.slice(2) : t;
  if (rest.startsWith("*")) {
    return "starts with a glob — the first path segment must be a literal name (src/**/*.ts is bounded; *, **, **/* are not)";
  }
  return null;
}

/** max_files_to_modify bounds per task_type. */
const MODIFY_BOUNDS: Record<string, [number, number]> = {
  single_file_patch: [1, 1],
  test_generation: [1, 2],
  log_reduction: [0, 0],
  stack_trace_routing: [0, 0],
  repo_map: [0, 0],
};

function scopeBoundIssues(contract: Record<string, unknown>, label: string): string[] {
  const scope = contract.scope;
  if (!isObj(scope)) return [`${label}scope is missing or not an object`];
  const issues: string[] = [];
  const paths = scope.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    issues.push(`${label}scope.paths must be a non-empty array of explicit files or bounded globs`);
  } else {
    for (const p of paths) {
      if (typeof p !== "string") {
        issues.push(`${label}scope.paths entry ${JSON.stringify(p)} is not a string`);
        continue;
      }
      const issue = scopePathIssue(p);
      if (issue) issues.push(`${label}scope.paths entry "${truncate(p, 60)}" ${issue}`);
    }
  }
  const m = scope.max_files_to_modify;
  const taskType = contract.task_type;
  if (typeof m !== "number" || !Number.isInteger(m)) {
    issues.push(`${label}scope.max_files_to_modify must be an integer`);
  } else if (typeof taskType === "string" && taskType in MODIFY_BOUNDS) {
    const [lo, hi] = MODIFY_BOUNDS[taskType];
    if (m < lo || m > hi) {
      issues.push(
        `${label}scope.max_files_to_modify is ${m} but task_type "${taskType}" requires ${lo === hi ? String(lo) : `${lo}-${hi}`}`,
      );
    }
  }
  return issues;
}

function acceptanceIssues(contract: Record<string, unknown>, label: string): string[] {
  const acceptance = contract.acceptance;
  if (!isObj(acceptance)) return [`${label}acceptance is missing or not an object`];
  const checks = acceptance.checks;
  if (!Array.isArray(checks) || checks.length === 0) {
    return [`${label}acceptance.checks must be a non-empty array of mechanical checks`];
  }
  const issues: string[] = [];
  checks.forEach((c, i) => {
    const where = `${label}acceptance.checks[${i}]`;
    if (!isObj(c)) {
      issues.push(`${where} is not an object`);
      return;
    }
    const type = c.type;
    if (type === "command" || type === "test_result") {
      if (typeof c.command !== "string" || c.command.trim().length === 0) {
        issues.push(`${where} (type "${type}") needs a concrete "command" to run`);
        return;
      }
      const cmd = c.command;
      for (const { re, what } of PLACEHOLDER_PATTERNS) {
        if (re.test(cmd)) {
          issues.push(`${where} command "${truncate(cmd, 60)}" contains a ${what} — acceptance commands must be runnable verbatim`);
        }
      }
      const reasons = unsafeReasons(cmd);
      if (reasons.length > 0) {
        issues.push(`${where} command "${truncate(cmd, 60)}" is not safe/local — ${reasons.join(", ")}`);
      }
    } else if (type === "schema") {
      if (typeof c.schema_path !== "string" || c.schema_path.trim().length === 0) {
        issues.push(`${where} (type "schema") needs a "schema_path"`);
      } else {
        const issue = relPathIssue(c.schema_path);
        if (issue) issues.push(`${where} schema_path "${truncate(c.schema_path, 60)}" ${issue}`);
      }
    } else if (type === "patch_apply") {
      if (typeof c.target_path !== "string" || c.target_path.trim().length === 0) {
        issues.push(`${where} (type "patch_apply") needs a "target_path"`);
      } else {
        const issue = relPathIssue(c.target_path);
        if (issue) issues.push(`${where} target_path "${truncate(c.target_path, 60)}" ${issue}`);
      }
    } else {
      issues.push(`${where} has unknown type ${JSON.stringify(type)}`);
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/** Known skill → task_type mapping for routing-matches-delegation. */
const SKILL_TASK_TYPES: Record<string, string> = {
  "ci-log-reducer": "log_reduction",
  "repo-map": "repo_map",
  "stack-trace-router": "stack_trace_routing",
  "single-file-patch": "single_file_patch",
  "regression-test-generator": "test_generation",
};

interface Graded {
  checks: Check[];
  repairFeedback?: string[];
}

function loadSchema(name: string): SchemaNode {
  const schemaPath = resolve(import.meta.dirname, `../schemas/${name}`);
  return JSON.parse(readFileSync(schemaPath, "utf8"));
}

function pushIssueCheck(
  helper: Helper,
  checks: Check[],
  feedback: string[],
  id: string,
  issues: string[],
  passDetail: string,
): void {
  const capped = issues.slice(0, 8);
  const more = issues.length > 8 ? ` (+${issues.length - 8} more)` : "";
  checks.push(helper.check(id, issues.length === 0, passDetail, `${capped.join("; ")}${more}`));
  feedback.push(...issues);
}

function gradeTaskContract(
  helper: Helper,
  checks: Check[],
  feedback: string[],
  contract: Record<string, unknown>,
  taskSchema: SchemaNode,
): void {
  const schemaErrors = validateAgainstSchema(contract, taskSchema);
  checks.push(
    helper.check(
      "schema-valid",
      schemaErrors.length === 0,
      "artifact matches task-contract.schema.json",
      `artifact violates task-contract.schema.json: ${schemaErrors.slice(0, 8).join("; ")}${schemaErrors.length > 8 ? ` (+${schemaErrors.length - 8} more)` : ""}`,
    ),
  );
  feedback.push(...schemaErrors.map((e) => `Schema error — ${e}`));

  pushIssueCheck(helper, checks, feedback, "goal-single-concern", goalConcernIssues(contract.goal, "goal"),
    "goal is a single sentence naming one concern");
  pushIssueCheck(helper, checks, feedback, "scope-bounded", scopeBoundIssues(contract, ""),
    "scope paths are explicit/bounded and max_files_to_modify fits the task_type");
  pushIssueCheck(helper, checks, feedback, "acceptance-checks-local", acceptanceIssues(contract, ""),
    "all acceptance checks are concrete, safe, and local");
  pushIssueCheck(helper, checks, feedback, "no-unbounded-verbs", unboundedVerbIssues(contract.goal, "goal"),
    "goal contains no unbounded language");
}

function gradeRouterContract(
  helper: Helper,
  checks: Check[],
  feedback: string[],
  contract: Record<string, unknown>,
  routerSchema: SchemaNode,
  taskSchema: SchemaNode,
): void {
  const schemaErrors = validateAgainstSchema(contract, routerSchema);
  checks.push(
    helper.check(
      "schema-valid",
      schemaErrors.length === 0,
      "artifact matches router-contract.schema.json",
      `artifact violates router-contract.schema.json: ${schemaErrors.slice(0, 8).join("; ")}${schemaErrors.length > 8 ? ` (+${schemaErrors.length - 8} more)` : ""}`,
    ),
  );
  feedback.push(...schemaErrors.map((e) => `Schema error — ${e}`));

  // chosen-skill-in-candidates
  const decision = isObj(contract.routing_decision) ? contract.routing_decision : null;
  const chosen = decision && typeof decision.chosen_skill === "string" ? decision.chosen_skill : null;
  const candidates = Array.isArray(contract.candidate_skills) ? contract.candidate_skills : null;
  if (chosen === null || candidates === null) {
    const why = chosen === null ? "routing_decision.chosen_skill is missing" : "candidate_skills is not an array";
    checks.push(helper.check("chosen-skill-in-candidates", false, "", `not evaluated: ${why}`));
    feedback.push(`Provide routing_decision.chosen_skill and candidate_skills; the chosen skill must come from the candidate list.`);
  } else {
    const inList = candidates.includes(chosen);
    checks.push(
      helper.check(
        "chosen-skill-in-candidates",
        inList,
        `chosen_skill "${chosen}" is in candidate_skills`,
        `chosen_skill "${chosen}" is not in candidate_skills [${candidates.map((c) => JSON.stringify(c)).join(", ")}] — routing is a choice from the menu, not open space`,
      ),
    );
    if (!inList) feedback.push(`Set routing_decision.chosen_skill to one of candidate_skills; never route to a skill outside the menu.`);
  }

  // delegations: structure + embedded contract grading
  const delegations = Array.isArray(contract.delegations) ? contract.delegations : null;
  const embedded: Array<{ contract: Record<string, unknown>; label: string }> = [];
  if (delegations === null) {
    const why = "delegations is not an array";
    checks.push(helper.check("routing-matches-delegation", false, "", `not evaluated: ${why}`));
    checks.push(helper.check("delegations-schema-valid", false, "", `not evaluated: ${why}`));
    for (const id of [
      "delegation-goals-single-concern",
      "delegation-scopes-bounded",
      "delegation-acceptance-local",
      "delegation-no-unbounded-verbs",
    ]) {
      checks.push(helper.check(id, false, "", `not evaluated: ${why}`));
    }
    feedback.push("Provide delegations: 1-3 entries of {worker_model: \"laguna_xs\", task_contract: {…}}.");
  } else {
    delegations.forEach((d, i) => {
      if (isObj(d) && isObj(d.task_contract)) {
        embedded.push({ contract: d.task_contract, label: `delegations[${i}].task_contract.` });
      }
    });

    // routing-matches-delegation (known skills only; first delegation implements the routing decision)
    if (chosen !== null && chosen in SKILL_TASK_TYPES) {
      const expected = SKILL_TASK_TYPES[chosen];
      const first = delegations.length > 0 && isObj(delegations[0]) && isObj(delegations[0].task_contract)
        ? (delegations[0].task_contract as Record<string, unknown>)
        : null;
      if (first === null) {
        checks.push(helper.check("routing-matches-delegation", false, "", "not evaluated: delegations[0].task_contract is missing or not an object"));
        feedback.push("Make delegations[0] a {worker_model, task_contract} object implementing the chosen skill.");
      } else {
        const ok = first.task_type === expected;
        checks.push(
          helper.check(
            "routing-matches-delegation",
            ok,
            `delegations[0].task_contract.task_type "${expected}" matches chosen_skill "${chosen}"`,
            `chosen_skill "${chosen}" implies task_type "${expected}" but delegations[0].task_contract.task_type is ${JSON.stringify(first.task_type)} — the first delegation must implement the routing decision`,
          ),
        );
        if (!ok) feedback.push(`Set delegations[0].task_contract.task_type to "${expected}" (the task type of chosen_skill "${chosen}"), or change the routing decision.`);
      }
    } else {
      checks.push(
        helper.check(
          "routing-matches-delegation",
          true,
          chosen === null
            ? "not enforced: no chosen skill to map"
            : `not enforced: chosen_skill "${chosen}" has no known task_type mapping`,
          "",
        ),
      );
    }

    // delegations-schema-valid
    const embedErrors: string[] = [];
    delegations.forEach((d, i) => {
      if (!isObj(d) || !isObj(d.task_contract)) {
        embedErrors.push(`delegations[${i}] is not a {worker_model, task_contract} object`);
        return;
      }
      const errs = validateAgainstSchema(d.task_contract, taskSchema, `delegations[${i}].task_contract`);
      embedErrors.push(...errs);
    });
    pushIssueCheck(
      helper, checks, feedback, "delegations-schema-valid",
      embedErrors.map((e) => `Embedded contract schema error — ${e}`),
      `all ${delegations.length} embedded task contracts match task-contract.schema.json`,
    );

    // the four bounded-contract rules over every embedded contract
    const goalIssues: string[] = [];
    const scopeIssues: string[] = [];
    const acceptIssues: string[] = [];
    const verbIssues: string[] = [];
    if (embedded.length === 0) {
      const why = "no parseable embedded task contracts";
      goalIssues.push(`not evaluated: ${why}`);
      scopeIssues.push(`not evaluated: ${why}`);
      acceptIssues.push(`not evaluated: ${why}`);
      verbIssues.push(`not evaluated: ${why}`);
    } else {
      for (const { contract: tc, label } of embedded) {
        goalIssues.push(...goalConcernIssues(tc.goal, `${label}goal`));
        scopeIssues.push(...scopeBoundIssues(tc, label));
        acceptIssues.push(...acceptanceIssues(tc, label));
        verbIssues.push(...unboundedVerbIssues(tc.goal, `${label}goal`));
      }
    }
    pushIssueCheck(helper, checks, feedback, "delegation-goals-single-concern", goalIssues,
      "every delegated goal is a single sentence naming one concern");
    pushIssueCheck(helper, checks, feedback, "delegation-scopes-bounded", scopeIssues,
      "every delegated scope is explicit/bounded with a task_type-consistent modify cap");
    pushIssueCheck(helper, checks, feedback, "delegation-acceptance-local", acceptIssues,
      "every delegated acceptance check is concrete, safe, and local");
    pushIssueCheck(helper, checks, feedback, "delegation-no-unbounded-verbs", verbIssues,
      "no delegated goal contains unbounded language");
  }

  // stop-conditions-sound
  const stops = Array.isArray(contract.stop_conditions) ? contract.stop_conditions : null;
  if (stops === null) {
    checks.push(helper.check("stop-conditions-sound", false, "", "stop_conditions is not an array"));
    feedback.push('Provide stop_conditions including "validator_passed" and "escalation_required".');
  } else {
    const missing = ["validator_passed", "escalation_required"].filter((s) => !stops.includes(s));
    checks.push(
      helper.check(
        "stop-conditions-sound",
        missing.length === 0,
        "stop_conditions include validator_passed and escalation_required",
        `stop_conditions missing ${missing.map((m) => `"${m}"`).join(" and ")} — routed work needs a mechanical success exit and an explicit escalation exit`,
      ),
    );
    if (missing.length > 0) {
      feedback.push(`Add ${missing.map((m) => `"${m}"`).join(" and ")} to stop_conditions.`);
    }
  }
}

function grade(helper: Helper, workspaceDir: string): Graded {
  const checks: Check[] = [];
  const feedback: string[] = [];
  const ws = resolve(workspaceDir);
  const taskPath = resolve(ws, TASK_ARTIFACT_REL_PATH);
  const routerPath = resolve(ws, ROUTER_ARTIFACT_REL_PATH);
  const taskExists = existsSync(taskPath);
  const routerExists = existsSync(routerPath);

  // 1. artifact-exists
  if (!taskExists && !routerExists) {
    checks.push(
      helper.check(
        "artifact-exists",
        false,
        "",
        `no contract artifact found: write ${TASK_ARTIFACT_REL_PATH} (worker contract) or ${ROUTER_ARTIFACT_REL_PATH} (router contract) at the workspace root`,
      ),
    );
    feedback.push(
      `Write the contract JSON to ${TASK_ARTIFACT_REL_PATH} (XS.2 worker contract) or ${ROUTER_ARTIFACT_REL_PATH} (M.1 router contract); create the .laguna/ directory if needed.`,
    );
    return { checks, repairFeedback: feedback };
  }

  const kind: "task" | "router" = taskExists ? "task" : "router";
  const artifactRelPath = kind === "task" ? TASK_ARTIFACT_REL_PATH : ROUTER_ARTIFACT_REL_PATH;
  const artifactAbsPath = kind === "task" ? taskPath : routerPath;
  const artifactSize = statSync(artifactAbsPath).size;
  if (artifactSize > MAX_ARTIFACT_BYTES) {
    checks.push(
      helper.check(
        "artifact-exists",
        false,
        "",
        `${artifactRelPath} is ${artifactSize} bytes, over the ${MAX_ARTIFACT_BYTES}-byte validator input cap`,
      ),
    );
    feedback.push(`${artifactRelPath} must be a small JSON contract (under ${MAX_ARTIFACT_BYTES} bytes).`);
    return { checks, repairFeedback: feedback };
  }
  let artifact: unknown;
  try {
    artifact = JSON.parse(readFileSync(artifactAbsPath, "utf8"));
  } catch (err) {
    checks.push(
      helper.check(
        "artifact-exists",
        false,
        "",
        `${artifactRelPath} exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    feedback.push(`${artifactRelPath} must contain a single valid JSON object.`);
    return { checks, repairFeedback: feedback };
  }
  if (!isObj(artifact)) {
    checks.push(helper.check("artifact-exists", false, "", `${artifactRelPath} is valid JSON but not an object`));
    feedback.push(`${artifactRelPath} must contain a single JSON object.`);
    return { checks, repairFeedback: feedback };
  }
  checks.push(helper.check("artifact-exists", true, `found and parsed ${artifactRelPath}`, ""));

  // 2. single-artifact (when both exist, the task contract is graded; documented precedence)
  checks.push(
    helper.check(
      "single-artifact",
      !(taskExists && routerExists),
      `exactly one contract artifact present (${artifactRelPath})`,
      `both ${TASK_ARTIFACT_REL_PATH} and ${ROUTER_ARTIFACT_REL_PATH} exist — one request produces one contract; delete the one that does not apply`,
    ),
  );
  if (taskExists && routerExists) {
    feedback.push("Write exactly one contract artifact: a task contract for worker requests, a router contract for routing requests.");
  }

  const taskSchema = loadSchema("task-contract.schema.json");
  if (kind === "task") {
    gradeTaskContract(helper, checks, feedback, artifact, taskSchema);
  } else {
    const routerSchema = loadSchema("router-contract.schema.json");
    gradeRouterContract(helper, checks, feedback, artifact, routerSchema, taskSchema);
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
      "usage: bun validate_contract.ts [--case <case_dir>] --workspace <workspace_dir> --out <result_path>",
    );
    process.exit(2);
  }

  const caseId = helper.readCaseId(args.caseDir, FALLBACK_CASE_ID);
  let result: ValidatorResult;
  try {
    // grade() is synchronous: this race can only catch a grader that goes
    // async in the future. The sync hang classes are bounded inside grade()
    // (size-capped artifact read); the harness subprocess cap is the backstop.
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
