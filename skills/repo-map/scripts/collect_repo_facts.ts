/**
 * Deterministic fact collector for the repo-map skill: walks a repository and
 * emits the mechanically observable facts a repo map must be grounded in —
 * languages by file count, dependency manifests, framework mentions inside
 * those manifests, candidate entrypoints, test evidence, and top-level
 * directories. The model reads these facts instead of guessing, so every
 * claim in the final map can cite real evidence.
 *
 * Usage:
 *   bun collect_repo_facts.ts --root <path> [--out <path>]
 *
 *   --root  repository root to walk (required)
 *   --out   write the JSON here instead of stdout
 *
 * Deterministic by construction: sorted traversal, fixed pattern tables, no
 * clocks, no randomness, no network; same input always yields byte-identical
 * output. Facts are *hints*, deliberately over-inclusive: a framework mention
 * may be a dev tool, a candidate entrypoint may be dead code. Deciding what
 * belongs in the map is the model's job (see SKILL.md Procedure). The
 * collector never reads prose (README etc.) — documentation claims are not
 * facts.
 *
 * Output shape (repo-facts.v1):
 * {
 *   "schema_version": "repo-facts.v1",
 *   "root": "<as given>",
 *   "file_count": 42, "dir_count": 9, "truncated": false,
 *   "languages": [ { "name": "python", "file_count": 12, "sample": "src/app/main.py" } ],
 *   "manifests": [ "pyproject.toml" ],
 *   "framework_mentions": [ { "name": "fastapi", "manifest": "pyproject.toml" } ],
 *   "candidate_entrypoints": [ { "path": "src/app/main.py", "reason": "well-known entrypoint filename" } ],
 *   "test_evidence": { "pytest": [...], "js_test_files": [...], "cargo_toml": [...],
 *                      "go_test_files": [...], "package_json_test_script": null },
 *   "suggested_test_commands": [ "pytest" ],
 *   "top_level_dirs": [ { "path": "src", "file_count": 14 } ]
 * }
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const MAX_FILES = 20_000;

/** Keep these tables consistent with scripts/validate_repo_map.ts. */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ".py": "python",
  ".pyi": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".sql": "sql",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".lua": "lua",
  ".zig": "zig",
  ".ex": "elixir",
  ".exs": "elixir",
  ".hs": "haskell",
  ".scala": "scala",
  ".pl": "perl",
  ".pm": "perl",
  ".r": "r",
  ".R": "r",
};

const BASENAME_TO_LANGUAGE: Record<string, string> = {
  Dockerfile: "dockerfile",
  Containerfile: "dockerfile",
  Makefile: "makefile",
  makefile: "makefile",
  GNUmakefile: "makefile",
};

const MANIFEST_PATTERNS: RegExp[] = [
  /^package\.json$/,
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
  /.+\.config\.(js|ts|mjs|cjs)$/,
];

/** Fixed list of frameworks/major libraries worth surfacing when a manifest
 *  names them. Matching is word-boundary-ish to avoid prose noise. */
const KNOWN_FRAMEWORKS: string[] = [
  "django",
  "flask",
  "fastapi",
  "starlette",
  "pydantic",
  "react",
  "next",
  "vue",
  "nuxt",
  "svelte",
  "angular",
  "express",
  "hono",
  "fastify",
  "koa",
  "nestjs",
  "rails",
  "sinatra",
  "laravel",
  "symfony",
  "spring",
  "actix-web",
  "serde",
  "axum",
  "rocket",
  "warp",
  "clap",
  "gin",
  "echo",
  "fiber",
  "chi",
  "phoenix",
];

const ENTRYPOINT_BASENAMES = new Set([
  "main.py",
  "__main__.py",
  "app.py",
  "cli.py",
  "manage.py",
  "main.rs",
  "main.go",
  "index.ts",
  "index.js",
  "cli.ts",
  "cli.js",
  "server.ts",
  "server.js",
  "main.ts",
  "main.js",
]);

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

interface LanguageFact {
  name: string;
  file_count: number;
  sample: string;
}

interface RepoFacts {
  schema_version: "repo-facts.v1";
  root: string;
  file_count: number;
  dir_count: number;
  truncated: boolean;
  languages: LanguageFact[];
  manifests: string[];
  framework_mentions: Array<{ name: string; manifest: string }>;
  candidate_entrypoints: Array<{ path: string; reason: string }>;
  test_evidence: {
    pytest: string[];
    js_test_files: string[];
    cargo_toml: string[];
    go_test_files: string[];
    package_json_test_script: string | null;
  };
  suggested_test_commands: string[];
  top_level_dirs: Array<{ path: string; file_count: number }>;
}

function parseArgs(argv: string[]): { root: string; out: string | null } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`missing value for ${flag}`);
    }
    return v;
  };
  const root = get("--root");
  if (!root) throw new Error("missing required argument: --root <path>");
  return { root, out: get("--out") };
}

function collect(rootArg: string): RepoFacts {
  const root = resolve(rootArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`--root ${rootArg} is not a directory`);
  }

  const files: string[] = [];
  let dirCount = 0;
  let truncated = false;
  const walk = (dir: string, rel: string): void => {
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const abs = join(dir, entry);
      const relPath = rel === "" ? entry : `${rel}/${entry}`;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!IGNORED_DIRS.has(entry)) {
          dirCount += 1;
          walk(abs, relPath);
        }
      } else if (st.isFile()) {
        files.push(relPath);
      }
    }
  };
  walk(root, "");

  const readText = (rel: string): string | null => {
    try {
      return readFileSync(resolve(root, rel), "utf8");
    } catch {
      return null;
    }
  };

  // Languages: count files per language; sample = lexicographically first path.
  const langFiles = new Map<string, string[]>();
  for (const f of files) {
    const lang = BASENAME_TO_LANGUAGE[basename(f)] ?? EXT_TO_LANGUAGE[extname(f)];
    if (!lang) continue;
    if (!langFiles.has(lang)) langFiles.set(lang, []);
    langFiles.get(lang)!.push(f);
  }
  const languages: LanguageFact[] = [...langFiles.entries()]
    .map(([name, paths]) => ({ name, file_count: paths.length, sample: paths[0] }))
    .sort((a, b) => b.file_count - a.file_count || a.name.localeCompare(b.name));

  // Manifests + framework mentions (manifest contents only; prose is not a fact).
  const manifests = files.filter((f) => MANIFEST_PATTERNS.some((p) => p.test(basename(f)))).sort();
  const frameworkMentions: Array<{ name: string; manifest: string }> = [];
  for (const m of manifests) {
    const text = (readText(m) ?? "").toLowerCase();
    for (const fw of KNOWN_FRAMEWORKS) {
      const re = new RegExp(`(^|[^a-z0-9])${fw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^a-z0-9]|$)`);
      if (re.test(text)) frameworkMentions.push({ name: fw, manifest: m });
    }
  }
  frameworkMentions.sort((a, b) => a.name.localeCompare(b.name) || a.manifest.localeCompare(b.manifest));

  // Candidate entrypoints: well-known filenames plus package.json bin/main.
  const candidates = new Map<string, string>();
  for (const f of files) {
    if (ENTRYPOINT_BASENAMES.has(basename(f))) {
      candidates.set(f, "well-known entrypoint filename");
    }
  }
  const pkgText = readText("package.json");
  if (pkgText !== null) {
    try {
      const pkg = JSON.parse(pkgText);
      const binEntries: string[] =
        typeof pkg.bin === "string"
          ? [pkg.bin]
          : typeof pkg.bin === "object" && pkg.bin !== null
            ? Object.values(pkg.bin).filter((v): v is string => typeof v === "string")
            : [];
      for (const bin of binEntries) {
        const rel = bin.replace(/^\.\//, "");
        if (files.includes(rel)) candidates.set(rel, "package.json bin entry");
      }
      for (const field of ["main", "module"]) {
        const v = pkg[field];
        if (typeof v === "string") {
          const rel = v.replace(/^\.\//, "");
          if (files.includes(rel)) candidates.set(rel, `package.json ${field} field`);
        }
      }
    } catch {
      /* unparseable package.json contributes no candidates */
    }
  }
  const candidateEntrypoints = [...candidates.entries()]
    .map(([path, reason]) => ({ path, reason }))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Test evidence.
  const pytestEvidence: string[] = [];
  for (const cfg of ["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini"]) {
    const text = readText(cfg);
    if (text !== null && /pytest/i.test(text)) pytestEvidence.push(cfg);
  }
  pytestEvidence.push(...files.filter((f) => /(^|\/)test_[^/]*\.py$/.test(f) || /_test\.py$/.test(f)));
  const jsTestFiles = files.filter((f) => /\.(test|spec)\.(ts|tsx|js|jsx|mts|cjs|mjs)$/.test(f)).sort();
  const cargoTomls = files.filter((f) => basename(f) === "Cargo.toml").sort();
  const goTestFiles = files.filter((f) => /_test\.go$/.test(f)).sort();
  let pkgTestScript: string | null = null;
  if (pkgText !== null) {
    try {
      const pkg = JSON.parse(pkgText);
      if (typeof pkg?.scripts?.test === "string") pkgTestScript = pkg.scripts.test;
    } catch {
      /* ignore */
    }
  }

  // Mechanically derived hints; the model adapts them (e.g. "uv run pytest -q").
  const suggested: string[] = [];
  if (pytestEvidence.length > 0) suggested.push("pytest");
  if (pkgTestScript !== null && /\bbun\s+test\b/.test(pkgTestScript)) suggested.push("bun test");
  else if (pkgTestScript !== null) suggested.push("npm test");
  else if (jsTestFiles.length > 0) suggested.push("bun test");
  if (cargoTomls.length > 0) suggested.push("cargo test");
  if (goTestFiles.length > 0 || files.includes("go.mod")) {
    if (goTestFiles.length > 0) suggested.push("go test ./...");
  }

  // Top-level directories with recursive file counts.
  const topCounts = new Map<string, number>();
  for (const f of files) {
    const slash = f.indexOf("/");
    if (slash === -1) continue;
    const top = f.slice(0, slash);
    topCounts.set(top, (topCounts.get(top) ?? 0) + 1);
  }
  const topLevelDirs = [...topCounts.entries()]
    .map(([path, file_count]) => ({ path, file_count }))
    .sort((a, b) => b.file_count - a.file_count || a.path.localeCompare(b.path));

  return {
    schema_version: "repo-facts.v1",
    root: rootArg,
    file_count: files.length,
    dir_count: dirCount,
    truncated,
    languages,
    manifests,
    framework_mentions: frameworkMentions,
    candidate_entrypoints: candidateEntrypoints,
    test_evidence: {
      pytest: pytestEvidence.sort(),
      js_test_files: jsTestFiles,
      cargo_toml: cargoTomls,
      go_test_files: goTestFiles,
      package_json_test_script: pkgTestScript,
    },
    suggested_test_commands: suggested,
    top_level_dirs: topLevelDirs,
  };
}

function main(): void {
  let args: { root: string; out: string | null };
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`argument error: ${err instanceof Error ? err.message : String(err)}`);
    console.error("usage: bun collect_repo_facts.ts --root <path> [--out <path>]");
    process.exit(2);
  }

  let facts: RepoFacts;
  try {
    facts = collect(args.root);
  } catch (err) {
    console.error(`collect error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const json = JSON.stringify(facts, null, 2) + "\n";
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(args.out, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}

main();
