import { describe, expect, test } from "bun:test";
import {
  CLAUDE_CODE_BREAK_VERSION,
  isClaudeCodeCompatible,
  semverCmp,
} from "../version.js";

describe("claude-code version compatibility", () => {
  test("CLAUDE_CODE_BREAK_VERSION points at the --sdk-url removal", () => {
    expect(CLAUDE_CODE_BREAK_VERSION).toBe("2.1.118");
  });

  test("semverCmp orders by numeric components, not lexicographic", () => {
    expect(semverCmp("2.1.118", "2.1.117")).toBeGreaterThan(0);
    expect(semverCmp("2.1.9", "2.1.10")).toBeLessThan(0); // would be > 0 lexically
    expect(semverCmp("2.1.118", "2.1.118")).toBe(0);
    expect(semverCmp("3.0.0", "2.99.99")).toBeGreaterThan(0);
  });

  test("isClaudeCodeCompatible accepts versions strictly below the break point", () => {
    expect(isClaudeCodeCompatible("2.1.117")).toBe(true);
    expect(isClaudeCodeCompatible("2.0.999")).toBe(true);
    expect(isClaudeCodeCompatible("1.99.0")).toBe(true);
  });

  test("isClaudeCodeCompatible rejects the break point and anything above", () => {
    expect(isClaudeCodeCompatible("2.1.118")).toBe(false);
    expect(isClaudeCodeCompatible("2.1.121")).toBe(false);
    expect(isClaudeCodeCompatible("2.2.0")).toBe(false);
    expect(isClaudeCodeCompatible("3.0.0")).toBe(false);
  });

  test("isClaudeCodeCompatible defaults to true on probe failure", () => {
    // null = probe couldn't read a version; allow rather than block on
    // ambiguous environments (custom build, exotic install path, etc.).
    expect(isClaudeCodeCompatible(null)).toBe(true);
  });
});
