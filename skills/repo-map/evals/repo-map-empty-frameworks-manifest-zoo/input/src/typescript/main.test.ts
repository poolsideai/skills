import { describe, expect, test } from "bun:test";
import { greet } from "./main.ts";

describe("greet", () => {
  test("returns greeting with name", () => {
    expect(greet("Alice")).toBe("Hello from TypeScript, Alice!");
  });
});
