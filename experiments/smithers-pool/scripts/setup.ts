/**
 * Seed the per-node working directories the example workflow runs pool in.
 * Idempotent: wipes and recreates work/ (never touches runs/ or .smithers/).
 *
 *   work/greet/        empty dir; the greet node writes hello.txt here
 *   work/repo-fixture/ tiny git repo the repo_map node maps (repo-map skill)
 *   work/dep-scan/     package.json the dep_scan node reads
 *   work/combine/      empty dir; the combine node writes report.md here
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WORK = join(ROOT, "work");

rmSync(WORK, { recursive: true, force: true });
for (const dir of ["greet", "repo-fixture", "dep-scan", "combine"]) {
  mkdirSync(join(WORK, dir), { recursive: true });
}

// --- work/repo-fixture: a minimal but real bun/TypeScript repo for repo-map ---
const fixture = join(WORK, "repo-fixture");
mkdirSync(join(fixture, "src"), { recursive: true });
mkdirSync(join(fixture, "test"), { recursive: true });

writeFileSync(
  join(fixture, "package.json"),
  JSON.stringify(
    {
      name: "fixture-calc",
      version: "0.1.0",
      description: "Tiny calculator CLI used as a repo-map fixture",
      type: "module",
      scripts: { test: "bun test" },
      devDependencies: { typescript: "^5.9.0" },
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  join(fixture, "src", "math.ts"),
  `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
);
writeFileSync(
  join(fixture, "src", "index.ts"),
  `import { add, multiply } from "./math.ts";

const [op, a, b] = process.argv.slice(2);
const x = Number(a);
const y = Number(b);
console.log(op === "mul" ? multiply(x, y) : add(x, y));
`,
);
writeFileSync(
  join(fixture, "test", "math.test.ts"),
  `import { expect, test } from "bun:test";
import { add, multiply } from "../src/math.ts";

test("add", () => {
  expect(add(2, 3)).toBe(5);
});

test("multiply", () => {
  expect(multiply(2, 3)).toBe(6);
});
`,
);
writeFileSync(
  join(fixture, "README.md"),
  `# fixture-calc

Tiny calculator CLI. Run tests with \`bun test\`. Entry point: \`src/index.ts\`.
`,
);
const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: fixture, stdio: "pipe" });
git("init -q");
git("add -A");
git(
  '-c user.email=spike@example.com -c user.name="Smithers Pool Spike" commit -qm "fixture: calculator repo"',
);

// --- work/dep-scan: just a package.json with a handful of dependencies ---
const depScan = join(WORK, "dep-scan");
writeFileSync(
  join(depScan, "package.json"),
  JSON.stringify(
    {
      name: "fixture-web",
      version: "0.2.0",
      type: "module",
      dependencies: {
        react: "^19.2.5",
        zod: "^4.3.6",
        "drizzle-orm": "^0.45.2",
        effect: "^3.21.1",
        hono: "^4.7.0",
      },
      devDependencies: { typescript: "^5.9.0" },
    },
    null,
    2,
  ) + "\n",
);

console.log(`seeded ${WORK}`);
