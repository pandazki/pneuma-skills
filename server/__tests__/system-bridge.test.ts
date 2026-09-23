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

  test("rejects a sibling directory sharing the workspace name as a prefix", () => {
    expect(() => resolveAndValidate(workspace, "../test-workspace-neighbor/x")).toThrow("Path escapes workspace");
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

describe("resolveAndValidate — symlinks", () => {
  test("rejects a workspace symlink whose target is outside, accepts one that stays inside", async () => {
    const { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const base = realpathSync(mkdtempSync(join(tmpdir(), "pneuma-bridge-")));
    try {
      const ws = join(base, "ws");
      mkdirSync(join(ws, "real"), { recursive: true });
      mkdirSync(join(base, "outside"), { recursive: true });
      symlinkSync(join(base, "outside"), join(ws, "out"));
      symlinkSync(join(ws, "real"), join(ws, "in"));
      expect(() => resolveAndValidate(ws, "out/file.txt")).toThrow("Path escapes workspace");
      expect(resolveAndValidate(ws, "in/file.txt")).toBe(join(ws, "in", "file.txt"));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
