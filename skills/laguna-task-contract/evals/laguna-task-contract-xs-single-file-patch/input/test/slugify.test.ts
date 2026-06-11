import { describe, expect, test } from "bun:test";
import { slugify } from "../src/slugify.ts";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("collapses consecutive separators", () => {
    expect(slugify("Deep  Dive  2024")).toBe("deep-dive-2024");
  });

  test("trims leading and trailing separators", () => {
    expect(slugify("  spaced out  ")).toBe("spaced-out");
  });
});
