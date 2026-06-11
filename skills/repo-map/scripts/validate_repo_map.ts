/**
 * Validator for the repo-map skill (grades `.laguna/repo-map.json`).
 *
 * Argv contract: bun validate_repo_map.ts --case <case_dir> --workspace <workspace_dir> --out <result_path>
 *   --case is optional: omit it when running the validator live inside a
 *   workspace repair loop (no eval case directory exists there).
 *
 * Checks (each independently legible, stable ids):
 *   artifact-exists          .laguna/repo-map.json exists and parses as JSON
 *   schema-valid             artifact matches schemas/repo-map.schema.json
 *   languages-evidenced      every languages[].evidence is a real workspace file
 *                            whose extension/basename matches the named language
 *   frameworks-evidenced     every frameworks[].evidence is a recognized
 *                            dependency manifest/config file (never prose) that
 *                            exists and names the framework — no hallucinated
 *                            frameworks
 *   entrypoints-exist        every entrypoints[].path is a file in the workspace
 *   key-directories-exist    every key_directories[].path is a directory in the
 *                            workspace
 *   test-commands-supported  every test command is supported by repo files
 *                            (pytest needs pytest config/tests, "cargo test"
 *                            needs Cargo.toml, "bun test" needs *.test.* files
 *                            or a package.json test script, ...)
 *   test-evidence-covered    if the tree contains test evidence, test_commands
 *                            must not be empty
 *
 * Rules: no network, explicit paths only, bounded inputs, always writes --out
 * (exit 0 when a result was written; nonzero exits are crashes).
 * Runaway-protection model (the grader is synchronous, so the async race in
 * main() cannot interrupt it — it only covers a grader that goes async):
 * untrusted readFileSync calls are size-capped (MAX_ARTIFACT_BYTES /
 * MAX_TEXT_BYTES), the workspace scan never follows symlinks (lstat) and is
 * capped by MAX_FILES_SCANNED + MAX_SCAN_DEPTH, schema files are repo-owned
 * and trusted, and the harness's subprocess wall cap (default 120s,
 * process-group kill) is the backstop.
 * Emits validator-result.v1 via skills/_shared/validator-result.ts.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type {
  Check,
  ValidatorResult,
  ValidatorArgs,
} from "../../_shared/validator-result.ts";

const ARTIFACT_REL_PATH = ".laguna/repo-map.json";
const FALLBACK_CASE_ID = "repo-map-live";
const TIMEOUT_MS = 30_000;
const MAX_FILES_SCANNED = 20_000;
const MAX_SCAN_DEPTH = 48;
// Input size caps (bounded-input rule, header): the artifact is a small JSON
// map by contract; evidence files read for content checks are manifests and
// runner files, never bulk data.
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helper loading. Canonical source: skills/_shared/validator-result.ts (works
// whenever the validator runs from the repo tree — harness grading and gold
// replay). Materialized workspaces copy only skills/repo-map/ into
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
// schemas/repo-map.schema.json (zero npm dependencies by design; see
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
// Evidence tables (fixed, documented in SKILL.md):
//  - KNOWN_LANGUAGES maps language names to the extensions/basenames that may
//    serve as evidence. Claiming a language outside this table fails
//    languages-evidenced (anti-hallucination: the validator cannot verify what
//    it does not know).
//  - MANIFEST_PATTERNS define which files count as framework evidence:
//    dependency manifests and framework config files only — prose (README,
//    docs) is never admissible, so stale documentation cannot launder
//    hallucinated frameworks.
// ---------------------------------------------------------------------------

const KNOWN_LANGUAGES: Record<string, { exts: string[]; basenames?: string[] }> = {
  python: { exts: [".py", ".pyi"] },
  typescript: { exts: [".ts", ".tsx", ".mts", ".cts"] },
  javascript: { exts: [".js", ".jsx", ".mjs", ".cjs"] },
  rust: { exts: [".rs"] },
  go: { exts: [".go"] },
  ruby: { exts: [".rb"] },
  java: { exts: [".java"] },
  kotlin: { exts: [".kt", ".kts"] },
  swift: { exts: [".swift"] },
  c: { exts: [".c", ".h"] },
  cpp: { exts: [".cc", ".cpp", ".cxx", ".hpp", ".hh"] },
  csharp: { exts: [".cs"] },
  php: { exts: [".php"] },
  shell: { exts: [".sh", ".bash", ".zsh"] },
  sql: { exts: [".sql"] },
  html: { exts: [".html", ".htm"] },
  css: { exts: [".css"] },
  scss: { exts: [".scss"] },
  lua: { exts: [".lua"] },
  zig: { exts: [".zig"] },
  elixir: { exts: [".ex", ".exs"] },
  haskell: { exts: [".hs"] },
  scala: { exts: [".scala"] },
  perl: { exts: [".pl", ".pm"] },
  r: { exts: [".r", ".R"] },
  markdown: { exts: [".md", ".markdown"] },
  yaml: { exts: [".yml", ".yaml"] },
  toml: { exts: [".toml"] },
  json: { exts: [".json"] },
  dockerfile: { exts: [], basenames: ["Dockerfile", "Containerfile"] },
  makefile: { exts: [".mk"], basenames: ["Makefile", "makefile", "GNUmakefile"] },
};

const MANIFEST_PATTERNS: RegExp[] = [
  /^package\.json$/, //                  npm/bun/pnpm/yarn (lockfiles excluded: transitive deps are not a claim)
  /^deno\.jsonc?$/,
  /^pyproject\.toml$/,
  /^setup\.(py|cfg)$/,
  /^requirements[^/]*\.txt$/,
  /^Pipfile$/,
  /^environment\.ya?ml$/,
  /^Cargo\.toml$/,
  /^go\.mod$/,
  /^Gemfile$/,
  /.+\.gemspec$/,
  /^composer\.json$/,
  /^pom\.xml$/,
  /^build\.gradle(\.kts)?$/,
  /^CMakeLists\.txt$/,
  /^mix\.exs$/,
  /.+\.config\.(js|ts|mjs|cjs)$/, //     next.config.js, vite.config.ts, jest.config.cjs, ...
];

function isManifestFile(relPath: string): boolean {
  const base = basename(relPath);
  return MANIFEST_PATTERNS.some((p) => p.test(base));
}

// ---------------------------------------------------------------------------
// Bounded workspace scan. Fixed ignore list, sorted traversal, hard file cap —
// deterministic and cheap. Produces the relative file list the test-command
// rules consume.
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".next",
  ".turbo",
  "coverage",
  "vendor",
  ".laguna",
  ".poolside",
  ".agents",
]);

function scanWorkspaceFiles(ws: string): string[] {
  const files: string[] = [];
  // lstat, never stat: following directory symlinks lets a symlink cycle
  // (adversarial or accidental) recurse forever before the file cap counts
  // anything, hanging a synchronous grader nothing can interrupt. Symlinked
  // entries are simply not evidence. MAX_SCAN_DEPTH is the belt to that
  // suspenders for pathologically deep real trees.
  const walk = (dir: string, rel: string, depth: number): void => {
    if (files.length >= MAX_FILES_SCANNED || depth > MAX_SCAN_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES_SCANNED) return;
      const abs = join(dir, entry);
      const relPath = rel === "" ? entry : `${rel}/${entry}`;
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!IGNORED_DIRS.has(entry)) walk(abs, relPath, depth + 1);
      } else if (st.isFile()) {
        files.push(relPath);
      }
    }
  };
  walk(ws, "", 0);
  return files;
}

// ---------------------------------------------------------------------------
// Test-command support rules. A command is supported when a rule recognizes
// its runner and the workspace carries that runner's evidence, or — generic
// fallback — when the trimmed command appears verbatim in package.json
// scripts, a Makefile target file, or a justfile. Unknown, unevidenced
// commands fail: never claim a test command the repo files do not support.
// ---------------------------------------------------------------------------

interface RepoEvidence {
  files: string[];
  readText(relPath: string): string | null;
}

function buildEvidence(ws: string): RepoEvidence {
  const files = scanWorkspaceFiles(ws);
  const cache = new Map<string, string | null>();
  return {
    files,
    readText(relPath: string): string | null {
      if (cache.has(relPath)) return cache.get(relPath)!;
      let text: string | null = null;
      try {
        const abs = resolve(ws, relPath);
        // size-capped: evidence files are manifests/runner files (bounded-input rule)
        if (existsSync(abs) && statSync(abs).isFile() && statSync(abs).size <= MAX_TEXT_BYTES) {
          text = readFileSync(abs, "utf8");
        }
      } catch {
        text = null;
      }
      cache.set(relPath, text);
      return text;
    },
  };
}

function packageJsonScripts(ev: RepoEvidence): Record<string, string> {
  const text = ev.readText("package.json");
  if (text === null) return {};
  try {
    const pkg = JSON.parse(text);
    const scripts = pkg?.scripts;
    if (typeof scripts !== "object" || scripts === null) return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(scripts)) {
      if (typeof v === "string") result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

function hasPytestEvidence(ev: RepoEvidence): boolean {
  for (const cfg of ["pyproject.toml", "setup.cfg", "tox.ini", "pytest.ini"]) {
    const text = ev.readText(cfg);
    if (text !== null && /pytest/i.test(text)) return true;
  }
  return ev.files.some((f) => /(^|\/)test_[^/]*\.py$/.test(f) || /_test\.py$/.test(f));
}

function hasJsTestFiles(ev: RepoEvidence): boolean {
  return ev.files.some((f) => /\.(test|spec)\.(ts|tsx|js|jsx|mts|cjs|mjs)$/.test(f));
}

function hasTestEvidence(ev: RepoEvidence): boolean {
  return (
    hasPytestEvidence(ev) ||
    hasJsTestFiles(ev) ||
    ev.files.some((f) => /_test\.go$/.test(f)) ||
    ev.files.some((f) => /(^|\/)tests\/[^/]+/.test(f))
  );
}

/** Returns null when supported, else a human-readable reason. */
function unsupportedReason(command: string, ev: RepoEvidence): string | null {
  const cmd = command.trim();
  const scripts = packageJsonScripts(ev);
  const hasFile = (basenameOrPath: string): boolean =>
    ev.files.some((f) => f === basenameOrPath || f.endsWith(`/${basenameOrPath}`));

  if (/\bpytest\b/.test(cmd)) {
    return hasPytestEvidence(ev)
      ? null
      : "pytest command claimed but the repo has no pytest config or test_*.py / *_test.py files";
  }
  if (/\bbun\s+test\b/.test(cmd)) {
    return hasJsTestFiles(ev) || /\bbun\s+test\b/.test(scripts["test"] ?? "")
      ? null
      : "bun test claimed but the repo has no *.test.*/*.spec.* files and no package.json test script using bun";
  }
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?test\b/.test(cmd)) {
    return "test" in scripts ? null : 'npm-style test command claimed but package.json has no "test" script';
  }
  if (/\bcargo\s+(test|nextest)\b/.test(cmd)) {
    return hasFile("Cargo.toml") ? null : "cargo test claimed but the repo has no Cargo.toml";
  }
  if (/\bgo\s+test\b/.test(cmd)) {
    return hasFile("go.mod") || ev.files.some((f) => /_test\.go$/.test(f))
      ? null
      : "go test claimed but the repo has no go.mod and no *_test.go files";
  }
  for (const runner of ["vitest", "jest", "mocha"]) {
    if (new RegExp(`\\b${runner}\\b`).test(cmd)) {
      const pkgText = ev.readText("package.json") ?? "";
      const hasConfig = ev.files.some((f) => basename(f).startsWith(`${runner}.config.`));
      return pkgText.includes(runner) || hasConfig
        ? null
        : `${runner} claimed but it appears in neither package.json nor a ${runner}.config.* file`;
    }
  }
  const make = cmd.match(/^make\s+([A-Za-z0-9_.-]+)/);
  if (make) {
    for (const mk of ["Makefile", "makefile", "GNUmakefile"]) {
      const text = ev.readText(mk);
      if (text !== null && new RegExp(`^${make[1]}\\s*:`, "m").test(text)) return null;
    }
    return `make target "${make[1]}" not found in any Makefile`;
  }
  // Generic fallback: the verbatim command is written down in a runnable spot.
  if (Object.values(scripts).some((s) => s.includes(cmd))) return null;
  for (const runnerFile of ["Makefile", "makefile", "GNUmakefile", "justfile", "Justfile"]) {
    const text = ev.readText(runnerFile);
    if (text !== null && text.includes(cmd)) return null;
  }
  return "command is not a recognized test runner with repo evidence and appears verbatim in no package.json script, Makefile, or justfile";
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

const truncate = (s: string, n = 120): string => (s.length > n ? `${s.slice(0, n)}…` : s);
/** JSON.parse can yield null/primitives anywhere — guard before property access
 *  so junk model output grades as "fail", never crashes into status "error". */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function grade(helper: Helper, workspaceDir: string): { checks: Check[]; repairFeedback?: string[] } {
  const checks: Check[] = [];
  const feedback: string[] = [];
  const ws = resolve(workspaceDir);
  const artifactPath = resolve(ws, ARTIFACT_REL_PATH);

  const insideWs = (p: string): boolean => p === ws || p.startsWith(ws + sep);
  const fileInWs = (rel: string): boolean => {
    const abs = resolve(ws, rel);
    return insideWs(abs) && existsSync(abs) && statSync(abs).isFile();
  };
  const dirInWs = (rel: string): boolean => {
    const abs = resolve(ws, rel);
    return insideWs(abs) && existsSync(abs) && statSync(abs).isDirectory();
  };

  // 1. artifact-exists
  if (!existsSync(artifactPath)) {
    checks.push(
      helper.check("artifact-exists", false, "", `artifact not found at workspace path ${ARTIFACT_REL_PATH}`),
    );
    feedback.push(
      `Write the repo map JSON to ${ARTIFACT_REL_PATH} at the workspace root (create the .laguna/ directory if needed).`,
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
    feedback.push(`${ARTIFACT_REL_PATH} must be a small JSON repo map (under ${MAX_ARTIFACT_BYTES} bytes).`);
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
  const schemaPath = resolve(import.meta.dirname, "../schemas/repo-map.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const schemaErrors = validateAgainstSchema(artifact, schema);
  checks.push(
    helper.check(
      "schema-valid",
      schemaErrors.length === 0,
      "artifact matches repo-map.schema.json",
      `artifact violates repo-map.schema.json: ${schemaErrors.slice(0, 8).join("; ")}${schemaErrors.length > 8 ? ` (+${schemaErrors.length - 8} more)` : ""}`,
    ),
  );
  feedback.push(...schemaErrors.map((e) => `Schema error — ${e}`));

  const a = artifact as Record<string, unknown>;
  const evidence = buildEvidence(ws);

  // 3. languages-evidenced
  const languages = Array.isArray(a.languages) ? a.languages : null;
  if (languages === null) {
    checks.push(helper.check("languages-evidenced", false, "", "not evaluated: languages is not an array"));
  } else {
    const problems: string[] = [];
    for (const entry of languages) {
      if (!isObj(entry)) {
        problems.push(`entry ${truncate(JSON.stringify(entry))} is not {name: string, evidence: string}`);
        continue;
      }
      const e = entry;
      if (typeof e.name !== "string" || typeof e.evidence !== "string") {
        problems.push(`entry ${truncate(JSON.stringify(entry))} is not {name: string, evidence: string}`);
        continue;
      }
      const known = KNOWN_LANGUAGES[e.name];
      if (!known) {
        problems.push(
          `language "${e.name}" is not in the validator's known-language table — use a canonical lowercase name (e.g. python, typescript, rust, go, shell)`,
        );
        continue;
      }
      if (!fileInWs(e.evidence)) {
        problems.push(`language "${e.name}": evidence file "${e.evidence}" does not exist in the workspace`);
        continue;
      }
      const ext = extname(e.evidence);
      const base = basename(e.evidence);
      const extMatches = known.exts.includes(ext) || (known.basenames ?? []).includes(base);
      if (!extMatches) {
        problems.push(
          `language "${e.name}": evidence file "${e.evidence}" does not look like ${e.name} (expected extension ${known.exts.join("/") || (known.basenames ?? []).join("/")})`,
        );
      }
    }
    checks.push(
      helper.check(
        "languages-evidenced",
        problems.length === 0,
        `all ${languages.length} language claims cite an existing, extension-consistent evidence file`,
        problems.join("; "),
      ),
    );
    feedback.push(...problems.map((p) => `Language claim problem — ${p}.`));
  }

  // 4. frameworks-evidenced
  const frameworks = Array.isArray(a.frameworks) ? a.frameworks : null;
  if (frameworks === null) {
    checks.push(helper.check("frameworks-evidenced", false, "", "not evaluated: frameworks is not an array"));
  } else {
    const problems: string[] = [];
    for (const entry of frameworks) {
      if (!isObj(entry)) {
        problems.push(`entry ${truncate(JSON.stringify(entry))} is not {name: string, evidence: string}`);
        continue;
      }
      const e = entry;
      if (typeof e.name !== "string" || typeof e.evidence !== "string") {
        problems.push(`entry ${truncate(JSON.stringify(entry))} is not {name: string, evidence: string}`);
        continue;
      }
      if (!fileInWs(e.evidence)) {
        problems.push(`framework "${e.name}": evidence file "${e.evidence}" does not exist in the workspace`);
        continue;
      }
      if (!isManifestFile(e.evidence)) {
        problems.push(
          `framework "${e.name}": evidence "${e.evidence}" is not a dependency manifest or framework config file — prose/docs are not admissible evidence`,
        );
        continue;
      }
      const text = evidence.readText(e.evidence) ?? "";
      if (!text.toLowerCase().includes(e.name.toLowerCase())) {
        problems.push(`framework "${e.name}" does not appear in evidence file "${e.evidence}" — never invent frameworks`);
      }
    }
    checks.push(
      helper.check(
        "frameworks-evidenced",
        problems.length === 0,
        frameworks.length === 0
          ? "no frameworks claimed (admissible for framework-free repos)"
          : `all ${frameworks.length} framework claims are named in an existing dependency manifest`,
        problems.join("; "),
      ),
    );
    feedback.push(...problems.map((p) => `Framework claim problem — ${p}.`));
  }

  // 5. entrypoints-exist
  const entrypoints = Array.isArray(a.entrypoints) ? a.entrypoints : null;
  if (entrypoints === null) {
    checks.push(helper.check("entrypoints-exist", false, "", "not evaluated: entrypoints is not an array"));
  } else {
    const problems: string[] = [];
    for (const entry of entrypoints) {
      if (!isObj(entry) || typeof entry.path !== "string") {
        problems.push(`entry ${truncate(JSON.stringify(entry))} has no string path`);
        continue;
      }
      if (!fileInWs(entry.path)) {
        problems.push(`entrypoint "${entry.path}" does not exist as a file in the workspace`);
      }
    }
    checks.push(
      helper.check(
        "entrypoints-exist",
        problems.length === 0,
        `all ${entrypoints.length} entrypoint paths exist in the workspace`,
        problems.join("; "),
      ),
    );
    feedback.push(...problems.map((p) => `Entrypoint problem — ${p}. Name only files that exist in the tree.`));
  }

  // 6. key-directories-exist
  const keyDirs = Array.isArray(a.key_directories) ? a.key_directories : null;
  if (keyDirs === null) {
    checks.push(helper.check("key-directories-exist", false, "", "not evaluated: key_directories is not an array"));
  } else {
    const problems: string[] = [];
    for (const entry of keyDirs) {
      if (!isObj(entry) || typeof entry.path !== "string") {
        problems.push(`entry ${truncate(JSON.stringify(entry))} has no string path`);
        continue;
      }
      if (!dirInWs(entry.path)) {
        problems.push(`key directory "${entry.path}" does not exist as a directory in the workspace`);
      }
    }
    checks.push(
      helper.check(
        "key-directories-exist",
        problems.length === 0,
        `all ${keyDirs.length} key directories exist in the workspace`,
        problems.join("; "),
      ),
    );
    feedback.push(...problems.map((p) => `Key directory problem — ${p}. Name only directories that exist in the tree.`));
  }

  // 7. test-commands-supported
  const testCommands = Array.isArray(a.test_commands) ? a.test_commands : null;
  if (testCommands === null) {
    checks.push(helper.check("test-commands-supported", false, "", "not evaluated: test_commands is not an array"));
  } else {
    const problems: string[] = [];
    for (const c of testCommands) {
      if (typeof c !== "string") {
        problems.push(`${truncate(JSON.stringify(c))} is not a string`);
        continue;
      }
      const reason = unsupportedReason(c, evidence);
      if (reason !== null) problems.push(`"${truncate(c, 80)}" — ${reason}`);
    }
    checks.push(
      helper.check(
        "test-commands-supported",
        problems.length === 0,
        testCommands.length === 0
          ? "no test commands claimed"
          : `all ${testCommands.length} test commands are supported by repo files`,
        problems.join("; "),
      ),
    );
    feedback.push(
      ...problems.map((p) => `Unsupported test command — ${p}. Claim only commands the repo files support.`),
    );
  }

  // 8. test-evidence-covered
  if (testCommands === null) {
    checks.push(helper.check("test-evidence-covered", false, "", "not evaluated: test_commands is not an array"));
  } else {
    const repoHasTests = hasTestEvidence(evidence);
    const covered = !repoHasTests || testCommands.length > 0;
    checks.push(
      helper.check(
        "test-evidence-covered",
        covered,
        repoHasTests
          ? "the repo has test evidence and test_commands is non-empty"
          : "the repo shows no test evidence; an empty test_commands is consistent",
        "the workspace contains test files/config but test_commands is empty — name how the tests run",
      ),
    );
    if (!covered) {
      feedback.push(
        "The repo contains test evidence (test files or test config); add at least one supported test command to test_commands.",
      );
    }
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
      "usage: bun validate_repo_map.ts [--case <case_dir>] --workspace <workspace_dir> --out <result_path>",
    );
    process.exit(2);
  }

  const caseId = helper.readCaseId(args.caseDir, FALLBACK_CASE_ID);
  let result: ValidatorResult;
  try {
    // grade() is synchronous: this race can only catch a grader that goes
    // async in the future. The sync hang classes are bounded inside grade()
    // (size caps, lstat scan, depth/file caps); the harness cap is the backstop.
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
