import { describe, expect, test } from "bun:test";

import { parseCsv, writeCsv } from "./parse.ts";

describe("csv roundtrip", () => {
  test("quoted fields with commas survive write/parse", async () => {
    const path = `${import.meta.dir}/.tmp-roundtrip.csv`;
    const rows = [
      ["name", "note"],
      ["ada", "likes, commas"],
      ["grace", 'said "nanoseconds"'],
    ];
    await writeCsv(path, rows);
    expect(await parseCsv(path)).toEqual(rows);
  });
});
