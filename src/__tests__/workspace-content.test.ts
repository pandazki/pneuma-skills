import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../server/index.js";
import webcraft from "../../modes/webcraft/manifest.js";
import { countUserWorkspaceFiles } from "../utils/workspace-content.js";

for (const project of [true, false]) {
  test(`${project ? "Project" : "Quick"} Session cold snapshot distinguishes runtime state from user config`, async () => {
    const root = mkdtempSync(join(tmpdir(), "pneuma-gallery-content-"));
    const workspace = project ? join(root, ".pneuma", "sessions", "fresh") : root;
    const stateDir = project ? workspace : join(workspace, ".pneuma");
    mkdirSync(stateDir, { recursive: true });
    for (const name of ["session.json", "config.json", "history.json", "skill-version.json"]) writeFileSync(join(stateDir, name), "{}");
    writeFileSync(join(stateDir, "thumbnail.png"), "");
    const running = await startServer({ port: 0, workspace, stateDir, modeName: "webcraft", modeManifest: webcraft,
      watchPatterns: webcraft.viewer.watchPatterns, editing: false,
      ...(project ? { pneumaProjectRoot: root, sessionId: "fresh" } : {}) });
    const origin = `http://127.0.0.1:${running.server.port}`;
    try {
      const info = await fetch(`${origin}/api/session`).then((r) => r.json());
      const placement = !!info.project && info.project.sessionDir === info.workspace;
      const snapshot = () => fetch(`${origin}/api/files`).then((r) => r.json());
      const initial = (await snapshot()).files;
      if (project) expect(initial.map((f: { path: string }) => f.path)).toContain("config.json");
      expect(countUserWorkspaceFiles(initial, null)).toBeNull(); // Unknown placement cannot mount a misleading empty viewer.
      expect(countUserWorkspaceFiles(initial, placement)).toBe(0);
      if (!project) {
        writeFileSync(join(workspace, "config.json"), '{"user":"content"}');
        expect(countUserWorkspaceFiles((await snapshot()).files, placement)).toBe(1);
        const tree = await fetch(`${origin}/api/files/tree`).then((r) => r.json());
        expect(tree.tree.some((node: { name: string }) => node.name === "config.json")).toBe(true);
      }
      mkdirSync(join(workspace, "site"));
      writeFileSync(join(workspace, "site", "config.json"), "{}");
      writeFileSync(join(workspace, "site", "index.html"), "<!doctype html><h1>User page</h1>");
      expect(countUserWorkspaceFiles((await snapshot()).files, placement)).toBe(project ? 2 : 3);
      const tree = await fetch(`${origin}/api/files/tree`).then((r) => r.json());
      expect(tree.tree.find((node: { name: string }) => node.name === "site").children.map((node: { name: string }) => node.name)).toContain("config.json");
      if (project) expect(tree.tree.some((node: { name: string }) => node.name === "config.json")).toBe(false);
    } finally { await running.server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });
}
