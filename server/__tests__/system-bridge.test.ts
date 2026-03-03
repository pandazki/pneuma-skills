/**
 * System Bridge tests
 *
 * Tests path/URL validation logic. Does NOT actually execute open/reveal commands.
 */

import { describe, test, expect } from "bun:test";
import { resolveAndValidate, validateUrl } from "../system-bridge.js";
import { resolve } from "node:path";

// ── resolveAndValidate ───────────────────────────────────────────────────────

describe("resolveAndValidate", () => {
  const workspace = "/tmp/test-workspace";

  test("resolves a relative path within workspace", () => {
    const result = resolveAndValidate(workspace, "docs/readme.md");
    expect(result).toBe(resolve(workspace, "docs/readme.md"));
  });

  test("resolves '.' to workspace root", () => {
    const result = resolveAndValidate(workspace, ".");
    expect(result).toBe(workspace);
  });

  test("rejects path traversal with ../", () => {
    expect(() => resolveAndValidate(workspace, "../../etc/passwd")).toThrow("Path escapes workspace");
  });

  test("rejects absolute path outside workspace", () => {
    expect(() => resolveAndValidate(workspace, "/etc/passwd")).toThrow("Path escapes workspace");
  });

  test("allows absolute path inside workspace", () => {
    const result = resolveAndValidate(workspace, "/tmp/test-workspace/file.txt");
    expect(result).toBe("/tmp/test-workspace/file.txt");
  });

  test("rejects sneaky traversal like foo/../../..", () => {
    expect(() => resolveAndValidate(workspace, "foo/../../../etc")).toThrow("Path escapes workspace");
  });
});

// ── validateUrl ──────────────────────────────────────────────────────────────

describe("validateUrl", () => {
  test("allows http:// URL", () => {
    expect(() => validateUrl("http://example.com")).not.toThrow();
  });

  test("allows https:// URL", () => {
    expect(() => validateUrl("https://example.com/path?q=1")).not.toThrow();
  });

  test("rejects file:// URL", () => {
    expect(() => validateUrl("file:///etc/passwd")).toThrow("Only http:// and https://");
  });

  test("rejects javascript: URL", () => {
    expect(() => validateUrl("javascript:alert(1)")).toThrow("Only http:// and https://");
  });

  test("rejects empty string", () => {
    expect(() => validateUrl("")).toThrow("Only http:// and https://");
  });

  test("rejects ftp:// URL", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow("Only http:// and https://");
  });
});
