/**
 * Path Resolver (Pneuma 3.0 Projects) tests
 *
 * Validates session path resolution for quick and project sessions:
 * - Quick session: state at workspace/.pneuma/, agent CWD = workspace
 * - Project session: state at projectRoot/.pneuma/sessions/{id}/, agent CWD = same
 */

import { describe, expect, test } from "bun:test";
import { resolveSessionPaths } from "../path-resolver-pneuma.js";

describe("resolveSessionPaths", () => {
  // ── Quick Session ──────────────────────────────────────────────────

  test("quick session: sessionDir = workspace, stateDir = workspace/.pneuma", () => {
    const p = resolveSessionPaths({
      kind: "quick",
      workspace: "/ws",
    });
    expect(p.kind).toBe("quick");
    expect(p.sessionDir).toBe("/ws");
    expect(p.stateDir).toBe("/ws/.pneuma");
    expect(p.homeRoot).toBe("/ws");
    expect(p.projectRoot).toBeNull();
  });

  test("quick session has no project shared paths", () => {
    const p = resolveSessionPaths({
      kind: "quick",
      workspace: "/ws",
    });
    expect(p.projectPreferencesDir).toBeNull();
    expect(p.projectHandoffsDir).toBeNull();
    expect(p.projectManifestPath).toBeNull();
  });

  // ── Project Session ───────────────────────────────────────────────

  test("project session: sessionDir under sessions/{id}, stateDir flat", () => {
    const p = resolveSessionPaths({
      kind: "project",
      projectRoot: "/proj",
      sessionId: "abc-123",
    });
    expect(p.kind).toBe("project");
    expect(p.sessionDir).toBe("/proj/.pneuma/sessions/abc-123");
    expect(p.stateDir).toBe("/proj/.pneuma/sessions/abc-123");
    expect(p.homeRoot).toBe("/proj");
    expect(p.projectRoot).toBe("/proj");
  });

  test("project session also exposes shared paths", () => {
    const p = resolveSessionPaths({
      kind: "project",
      projectRoot: "/proj",
      sessionId: "x",
    });
    expect(p.projectPreferencesDir).toBe("/proj/.pneuma/preferences");
    expect(p.projectHandoffsDir).toBe("/proj/.pneuma/handoffs");
    expect(p.projectManifestPath).toBe("/proj/.pneuma/project.json");
  });

  test("project session with complex projectRoot", () => {
    const p = resolveSessionPaths({
      kind: "project",
      projectRoot: "/home/user/myproject",
      sessionId: "sess-001",
    });
    expect(p.sessionDir).toBe("/home/user/myproject/.pneuma/sessions/sess-001");
    expect(p.stateDir).toBe("/home/user/myproject/.pneuma/sessions/sess-001");
    expect(p.projectPreferencesDir).toBe("/home/user/myproject/.pneuma/preferences");
    expect(p.projectHandoffsDir).toBe("/home/user/myproject/.pneuma/handoffs");
    expect(p.projectManifestPath).toBe("/home/user/myproject/.pneuma/project.json");
  });
});
