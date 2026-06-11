/**
 * Deterministic preprocessor for the ci-log-reducer skill: pulls failure
 * windows out of a raw CI log so the model reads hundreds of lines, not
 * hundreds of thousands — with true 1-based line numbers attached, so cited
 * lines can be copied verbatim without hallucinating positions.
 *
 * Usage:
 *   bun extract_failure_windows.ts --log <path> [--context N] [--out <path>]
 *
 *   --log      path to the CI log (required)
 *   --context  lines of context around each match (default 20)
 *   --out      write the JSON here instead of stdout
 *
 * Deterministic by construction: fixed pattern list, no clocks, no
 * randomness, no network; same input always yields byte-identical output.
 * Matching is intentionally greedy — windows are *hints*, and over-capturing
 * (e.g. a decoy "ERROR" printed by a passing test) is expected. Deciding
 * which window holds the authoritative failure is the model's job (see
 * SKILL.md Procedure).
 *
 * Output shape (ci-failure-windows.v1):
 * {
 *   "schema_version": "ci-failure-windows.v1",
 *   "log_file": "<as given>",
 *   "total_lines": 1234,
 *   "match_count": 7,
 *   "windows": [
 *     { "start_line": 100, "end_line": 141, "matched_lines": [120, 121],
 *       "lines": [ { "line": 100, "text": "..." }, ... ] }
 *   ]
 * }
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAX_LOG_BYTES = 64 * 1024 * 1024; // refuse logs over 64 MiB

/** Failure indicators across common CI flavors (pytest, bun test, cargo,
 *  go test, generic runners). Order is irrelevant; the list is fixed. */
const FAILURE_PATTERNS: RegExp[] = [
  /\bFAILED\b/, //                     pytest "FAILED tests/..." / cargo "test result: FAILED"
  /^(=+ )?(FAILURES|ERRORS)( =+)?$/, // pytest section headers
  /\b[1-9]\d* (failed|errors?)\b/, //  "3 failed, 41 passed" summaries (excludes "0 failed")
  /^E {3,}/, //                        pytest assertion detail lines
  /Traceback \(most recent call last\)/,
  /\bAssertionError\b/,
  /✗/u, //                             bun test failing-test marker
  /\(fail\)/, //                       bun test (older output flavor)
  /\b[1-9]\d* fail\b/, //              bun test "1 fail" summary (excludes "0 fail")
  /\bpanicked at\b/, //                rust panic
  /^\s*error(\[E\d+\])?:/, //          cargo/rustc error lines
  /\berror: test failed\b/, //         cargo test epilogue
  /test result: FAILED/, //            cargo test summary
  /^FAIL\b/, //                        go test / generic
  /^\s*fatal:/,
  /\bError:\b/,
  /^\s*ERROR\b/, //                    log-level ERROR lines (may include decoys from passing tests)
  /Process completed with exit code [1-9]/, // GitHub-Actions-style runner epilogue
  /exit(ed)? (with )?(code|status):? [1-9]/i,
];

interface NumberedLine {
  line: number;
  text: string;
}

interface FailureWindow {
  start_line: number;
  end_line: number;
  matched_lines: number[];
  lines: NumberedLine[];
}

function parseArgs(argv: string[]): { log: string; context: number; out: string | null } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`missing value for ${flag}`);
    }
    return v;
  };
  const log = get("--log");
  if (!log) throw new Error("missing required argument: --log <path>");
  const contextRaw = get("--context");
  const context = contextRaw === null ? 20 : Number.parseInt(contextRaw, 10);
  if (!Number.isInteger(context) || context < 0 || context > 500) {
    throw new Error(`--context must be an integer in [0, 500], got "${contextRaw}"`);
  }
  return { log, context, out: get("--out") };
}

export function extractWindows(lines: string[], context: number): { windows: FailureWindow[]; matchCount: number } {
  const matched: number[] = []; // 1-based line numbers
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (FAILURE_PATTERNS.some((p) => p.test(text))) matched.push(i + 1);
  }

  // Merge per-match context ranges into non-overlapping, non-adjacent windows.
  const windows: FailureWindow[] = [];
  for (const m of matched) {
    const start = Math.max(1, m - context);
    const end = Math.min(lines.length, m + context);
    const last = windows[windows.length - 1];
    if (last && start <= last.end_line + 1) {
      last.end_line = Math.max(last.end_line, end);
      last.matched_lines.push(m);
    } else {
      windows.push({ start_line: start, end_line: end, matched_lines: [m], lines: [] });
    }
  }
  for (const w of windows) {
    for (let n = w.start_line; n <= w.end_line; n++) {
      w.lines.push({ line: n, text: lines[n - 1] });
    }
  }
  return { windows, matchCount: matched.length };
}

function main(): void {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    console.error("usage: bun extract_failure_windows.ts --log <path> [--context N] [--out <path>]");
    process.exit(2);
  }

  if (!existsSync(args.log) || !statSync(args.log).isFile()) {
    console.error(`error: log file not found: ${args.log}`);
    process.exit(1);
  }
  if (statSync(args.log).size > MAX_LOG_BYTES) {
    console.error(`error: log file exceeds ${MAX_LOG_BYTES} bytes; split it first`);
    process.exit(1);
  }

  const raw = readFileSync(args.log, "utf8");
  const lines = raw.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop(); // trailing newline

  const { windows, matchCount } = extractWindows(lines, args.context);
  const output = {
    schema_version: "ci-failure-windows.v1",
    log_file: args.log,
    total_lines: lines.length,
    match_count: matchCount,
    windows,
  };
  const json = JSON.stringify(output, null, 2) + "\n";
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, json, "utf8");
  } else {
    process.stdout.write(json);
  }
  process.exit(0);
}

main();
