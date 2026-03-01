/**
 * File watcher tests
 *
 * Tests for pure functions: extractWatchExtensions() and matchesWatchPatterns().
 * Does NOT test startFileWatcher() (requires chokidar / real filesystem watching).
 */

import { describe, test, expect } from "bun:test";

// These functions are not exported, so we need to test them indirectly
// or re-export them. For now, we duplicate the pure logic for unit testing.
// If these were exported, we'd import directly.

// ── Inline copies of pure functions for testing ─────────────────────────────
// (Matches file-watcher.ts exactly — tests validate the logic)

function extractWatchExtensions(patterns: string[]): Set<string> | null {
  const exts = new Set<string>();
  for (const pattern of patterns) {
    const globMatch = pattern.match(/\*\.(\w+)$/);
    if (globMatch) {
      exts.add(`.${globMatch[1]}`);
      continue;
    }
    const literalMatch = pattern.match(/\.(\w+)$/);
    if (literalMatch && !pattern.includes("*")) {
      exts.add(`.${literalMatch[1]}`);
    }
  }
  return exts.size > 0 ? exts : null;
}

function matchesWatchPatterns(relPath: string, watchExtensions: Set<string> | null): boolean {
  if (!watchExtensions) return true;
  const lastDot = relPath.lastIndexOf(".");
  if (lastDot === -1) return false;
  return watchExtensions.has(relPath.slice(lastDot).toLowerCase());
}

// ── extractWatchExtensions ──────────────────────────────────────────────────

describe("extractWatchExtensions", () => {
  test("extracts .md from **/*.md", () => {
    const result = extractWatchExtensions(["**/*.md"]);
    expect(result).toEqual(new Set([".md"]));
  });

  test("extracts .html from slides/*.html", () => {
    const result = extractWatchExtensions(["slides/*.html"]);
    expect(result).toEqual(new Set([".html"]));
  });

  test("extracts .json from literal filename manifest.json", () => {
    const result = extractWatchExtensions(["manifest.json"]);
    expect(result).toEqual(new Set([".json"]));
  });

  test("extracts .css from literal filename theme.css", () => {
    const result = extractWatchExtensions(["theme.css"]);
    expect(result).toEqual(new Set([".css"]));
  });

  test("extracts multiple extensions from mixed patterns", () => {
    const result = extractWatchExtensions(["**/*.md", "slides/*.html", "theme.css"]);
    expect(result).toEqual(new Set([".md", ".html", ".css"]));
  });

  test("returns null for wildcard-only pattern assets/**/*", () => {
    const result = extractWatchExtensions(["assets/**/*"]);
    expect(result).toBeNull();
  });

  test("returns null for empty array", () => {
    const result = extractWatchExtensions([]);
    expect(result).toBeNull();
  });

  test("extracts extensions from mixed patterns with some wildcards", () => {
    // assets/**/* contributes nothing, but **/*.md does
    const result = extractWatchExtensions(["assets/**/*", "**/*.md"]);
    expect(result).toEqual(new Set([".md"]));
  });

  test("deduplicates same extension from multiple patterns", () => {
    const result = extractWatchExtensions(["**/*.md", "docs/*.md"]);
    expect(result).toEqual(new Set([".md"]));
    expect(result!.size).toBe(1);
  });
});

// ── matchesWatchPatterns ────────────────────────────────────────────────────

describe("matchesWatchPatterns", () => {
  test("matches .md extension", () => {
    const exts = new Set([".md"]);
    expect(matchesWatchPatterns("README.md", exts)).toBe(true);
  });

  test("matches nested path with correct extension", () => {
    const exts = new Set([".md"]);
    expect(matchesWatchPatterns("docs/guide/intro.md", exts)).toBe(true);
  });

  test("case-insensitive matching", () => {
    const exts = new Set([".md"]);
    expect(matchesWatchPatterns("README.MD", exts)).toBe(true);
  });

  test("returns false for non-matching extension", () => {
    const exts = new Set([".md"]);
    expect(matchesWatchPatterns("style.css", exts)).toBe(false);
  });

  test("returns false for file without extension", () => {
    const exts = new Set([".md"]);
    expect(matchesWatchPatterns("Makefile", exts)).toBe(false);
  });

  test("returns true for any file when watchExtensions is null (watch everything)", () => {
    expect(matchesWatchPatterns("anything.xyz", null)).toBe(true);
    expect(matchesWatchPatterns("no-ext", null)).toBe(true);
  });
});
