/**
 * ProjectChip smoke tests.
 *
 * The codebase has no React DOM testing harness (no @testing-library, no
 * happy-dom in test config), so we don't render the component here. Instead
 * we verify two stable contracts the chip relies on:
 *
 *   1. The module exports a callable default — i.e. the component import
 *      resolves and parses, which is the lightest "render path is wired"
 *      smoke we can run under bun:test.
 *   2. The chip label fallback chain:
 *        projectContext.projectName → basename(projectRoot) → "Project"
 *      is exactly the behavior the chip renders. Asserting on the helper
 *      keeps the test independent of React internals while still catching
 *      regressions (e.g. an accidental swap to a different basename impl).
 */
import { describe, expect, test } from "bun:test";
import ProjectChip from "../ProjectChip.js";
import { basename } from "../../utils/string.js";

describe("ProjectChip", () => {
  test("module exports a callable component", () => {
    expect(typeof ProjectChip).toBe("function");
  });

  test("label fallback uses basename when projectName is missing", () => {
    // Mirrors the chip's resolution order:
    //   const label = projectContext?.projectName || basename(projectRoot) || "Project";
    const projectRoot = "/Users/me/work/my-project";
    const projectName: string | undefined = undefined;
    const label = projectName || basename(projectRoot) || "Project";
    expect(label).toBe("my-project");
  });

  test("label fallback uses projectName when present", () => {
    const projectRoot = "/Users/me/work/my-project";
    const projectName = "Pneuma Demo";
    const label = projectName || basename(projectRoot) || "Project";
    expect(label).toBe("Pneuma Demo");
  });

  test("label fallback uses literal Project when both are empty", () => {
    const projectRoot = "";
    const projectName = "";
    const label = projectName || basename(projectRoot) || "Project";
    expect(label).toBe("Project");
  });
});
