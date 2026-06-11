#!/usr/bin/env bun
/** tidy-csv CLI entrypoint (package.json bin "tidy-csv"). */

import { dedupe } from "./commands/dedupe.ts";
import { stats } from "./commands/stats.ts";

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "dedupe":
    await dedupe(rest);
    break;
  case "stats":
    await stats(rest);
    break;
  default:
    console.error("usage: tidy-csv <dedupe|stats> <file.csv>");
    process.exit(2);
}
