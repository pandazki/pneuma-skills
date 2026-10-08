import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerModeViewerRoutes } from "../mode-viewer-routes.js";
import type { ModeBuildResult } from "../../snapshot/mode-build.js";
import { startServer } from "../index.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "viewer-recovery-"));
  dirs.push(dir);
  return dir;
}

test("failed builds remain observable and concurrent retries join one build", async () => {
  const modeDir = fixture();
  const app = new Hono();
  let complete!: (result: ModeBuildResult) => void;
  let builds = 0;
  const viewer = registerModeViewerRoutes(app, {
    modeDir,
    build: async () => { builds++; return new Promise((resolve) => { complete = resolve; }); },
  });
  app.get("*", (c) => c.html("<html>SPA fallback</html>"));
  await Bun.sleep(0);
  expect(builds).toBe(1);
  complete({ success: false, buildDir: "", errors: ["UNKNOWN_CERTIFICATE_VERIFICATION_ERROR"] });
  await Bun.sleep(0);
  expect(viewer.getState()).toEqual({ status: "failed", error: "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR" });
  const failedAsset = await app.request("/mode-assets/pneuma-mode.js");
  expect(failedAsset.status).toBe(503);
  expect(await failedAsset.text()).toContain("UNKNOWN_CERTIFICATE_VERIFICATION_ERROR");
  expect((await app.request("/vendor/react.js")).headers.get("content-type")).toBe("application/javascript");

  const retries = await Promise.all([1, 2, 3].map(() => app.request("/api/mode-viewer/retry", { method: "POST" })));
  expect(retries.map((r) => r.status)).toEqual([202, 202, 202]);
  expect(builds).toBe(2);
  const buildDir = join(modeDir, ".build");
  mkdirSync(buildDir);
  writeFileSync(join(buildDir, "pneuma-mode.js"), "export default {};");
  writeFileSync(join(buildDir, "pneuma-mode.css"), ".viewer { color: red; }");
  complete({ success: true, buildDir, errors: [] });
  await Bun.sleep(0);
  const ready = viewer.getState();
  expect(ready.status).toBe("ready");
  if (ready.status !== "ready") throw new Error("Viewer was not recovered");
  expect(ready.stylesheets).toHaveLength(1);
  expect(new URL(ready.stylesheets[0], "http://localhost").searchParams.get("v")).toBe(ready.revision);
  expect((await app.request(ready.stylesheets[0])).headers.get("content-type")).toBe("text/css");
  const asset = await app.request("/mode-assets/pneuma-mode.js?v=retry");
  expect(asset.status).toBe(200);
  expect(await asset.text()).toBe("export default {};");
  expect((await app.request("/mode-assets/missing.js")).status).toBe(404);
  await app.request("/api/mode-viewer/retry", { method: "POST" });
  expect(builds).toBe(2);
});

test("a thrown build error is reported and can be retried", async () => {
  const app = new Hono();
  let builds = 0;
  const runtime = registerModeViewerRoutes(app, { modeDir: fixture(), build: async () => {
    builds++;
    throw new Error("source is unreadable");
  } });
  await Bun.sleep(0);
  expect(runtime.getState()).toEqual({ status: "failed", error: "source is unreadable" });
  await app.request("/api/mode-viewer/retry", { method: "POST" });
  await Bun.sleep(0);
  expect(builds).toBe(2);
  expect(runtime.getState().status).toBe("failed");
});

test("a manifest-only output is a failed viewer, not a ready bundle", async () => {
  const bundleDir = fixture();
  writeFileSync(join(bundleDir, "manifest.js"), "export default {};");
  const viewer = registerModeViewerRoutes(new Hono(), { bundleDir });
  const state = viewer.getState();
  expect(state.status).toBe("failed");
  if (state.status === "failed") expect(state.error).toContain("pneuma-mode.js");
});

test("the production shell keeps the host import map and never serves HTML as a missing viewer", async () => {
  const root = fixture();
  const modeDir = join(root, "mode");
  const distDir = join(root, "dist");
  mkdirSync(modeDir);
  mkdirSync(distDir);
  writeFileSync(join(distDir, "index.html"), "<!doctype html><html><head></head><body>shell</body></html>");
  // A real build failure, with no package.json and no network or agent.
  writeFileSync(join(modeDir, "pneuma-mode.ts"), 'import "./missing-viewer.js";');
  const running = await startServer({
    port: 0,
    workspace: root,
    distDir,
    externalMode: { name: "broken-viewer", path: modeDir, type: "local" },
  });
  const url = `http://localhost:${running.server.port}`;
  try {
    const html = await fetch(url).then((r) => r.text());
    expect(html).toContain('type="importmap"');
    expect(html).toContain("/vendor/react.js");
    const asset = await fetch(`${url}/mode-assets/pneuma-mode.js`);
    expect(asset.status).toBe(503);
    expect(asset.headers.get("content-type")).toContain("application/json");
    let info = await fetch(`${url}/api/mode-info`).then((r) => r.json());
    for (let attempt = 0; info.viewerBuild.status === "building" && attempt < 50; attempt++) {
      await Bun.sleep(10);
      info = await fetch(`${url}/api/mode-info`).then((r) => r.json());
    }
    expect(info.external).toBe(true);
    expect(info.viewerBuild.status).toBe("failed");
  } finally {
    running.server.stop(true);
  }
});
