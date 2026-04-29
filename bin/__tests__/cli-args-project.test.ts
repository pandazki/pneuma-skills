import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../pneuma-cli-helpers.js";

describe("parseCliArgs project flags", () => {
  test("--project flag captured", () => {
    const args = parseCliArgs(["bun", "pneuma", "doc", "--project", "/tmp/p"]);
    expect(args.project).toBe("/tmp/p");
  });

  test("--session-id flag captured", () => {
    const args = parseCliArgs(["bun", "pneuma", "doc", "--session-id", "abc-123"]);
    expect(args.sessionIdOverride).toBe("abc-123");
  });

  test("flags absent → defaults", () => {
    const args = parseCliArgs(["bun", "pneuma", "doc", "--workspace", "/tmp/w"]);
    expect(args.project).toBe("");
    expect(args.sessionIdOverride).toBe("");
  });
});
