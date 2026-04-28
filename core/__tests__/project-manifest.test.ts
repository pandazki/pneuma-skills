/**
 * ProjectManifest contract tests
 *
 * Validates ProjectManifest type constraints:
 * - Required field completeness
 * - Optional field default value semantics
 * - Runtime guard validation
 */

import { describe, expect, test } from "bun:test";
import {
  isProjectManifest,
  type ProjectManifest,
  type ProjectSummary,
} from "../types/project-manifest.js";

describe("ProjectManifest", () => {
  test("isProjectManifest accepts a valid object", () => {
    const m: ProjectManifest = {
      version: 1,
      name: "my-startup",
      displayName: "My Startup",
      description: "AI tools demo site",
      createdAt: 1714200000000,
      founderSessionId: "abc-123",
    };
    expect(isProjectManifest(m)).toBe(true);
  });

  test("isProjectManifest rejects missing required fields", () => {
    expect(isProjectManifest({})).toBe(false);
    expect(isProjectManifest({ name: "x" })).toBe(false);
    expect(isProjectManifest({ version: 1, name: "x" })).toBe(false);
  });

  test("isProjectManifest tolerates omitted optional fields", () => {
    const m = {
      version: 1,
      name: "minimal",
      displayName: "minimal",
      createdAt: 1,
    };
    expect(isProjectManifest(m)).toBe(true);
  });

  test("ProjectSummary keeps lastAccessed and root", () => {
    const s: ProjectSummary = {
      root: "/Users/x/proj",
      name: "proj",
      displayName: "Proj",
      lastAccessed: 1,
      sessionCount: 3,
    };
    expect(s.sessionCount).toBe(3);
  });
});
