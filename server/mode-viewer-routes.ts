import type { Hono } from "hono";
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { modeViewerAssetUrl, type ModeViewerBuildState } from "../core/types/mode-viewer.js";
import { buildModeViewer, prebuiltViewer, HOST_ABI_VENDOR_SHIMS } from "../snapshot/mode-build.js";
import { isContained } from "./utils.js";

/** One build per session at a time; requests can only rebuild this session's mode. */
export function registerModeViewerRoutes(app: Hono, options: {
  modeDir?: string;
  projectRoot?: string;
  bundleDir?: string;
  build?: typeof buildModeViewer;
}) {
  let bundleDir = options.bundleDir;
  let state: ModeViewerBuildState = { status: "building" };
  let pending: Promise<void> | undefined;

  function ready(dir: string) {
    if (!existsSync(join(dir, "pneuma-mode.js"))) {
      throw new Error("The mode has no compiled viewer entry (pneuma-mode.js).");
    }
    const revision = crypto.randomUUID();
    const stylesheets = readdirSync(dir).filter((file) => file.endsWith(".css"))
      .map((file) => modeViewerAssetUrl(file, revision));
    bundleDir = dir;
    state = { status: "ready", revision, stylesheets };
  }

  function startBuild(repairDependencies = false) {
    if (pending || state.status === "ready") return;
    state = { status: "building" };
    pending = Promise.resolve().then(async () => {
      if (!options.modeDir) throw new Error("The mode source directory is unavailable.");
      const result = await (options.build ?? buildModeViewer)(options.modeDir, {
        projectRoot: options.projectRoot,
        repairDependencies,
      });
      if (!result.success) throw new Error(result.errors.join("\n") || "The viewer build did not complete.");
      ready(result.buildDir);
    }).catch((error) => {
      state = { status: "failed", error: error instanceof Error ? error.message : String(error) };
      console.error(`[mode-viewer] ${state.error}`);
    }).finally(() => { pending = undefined; });
  }

  try {
    if (bundleDir) ready(bundleDir);
    else if (options.modeDir && prebuiltViewer(options.modeDir, { projectRoot: options.projectRoot }).reuse) {
      ready(join(options.modeDir, ".build"));
    } else startBuild();
  } catch (error) {
    state = { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }

  // A POST starts work and returns immediately; GET mode-info reports progress.
  // A second tab joins the pending build, and retrying a ready viewer is a no-op.
  app.post("/api/mode-viewer/retry", (c) => {
    startBuild(true);
    c.header("Cache-Control", "no-store");
    return c.json(state, state.status === "building" ? 202 : 200);
  });

  // These must exist even when the initial dependency installation failed.
  for (const [url, source] of Object.entries(HOST_ABI_VENDOR_SHIMS)) {
    app.get(url, () => new Response(source, { headers: { "Content-Type": "application/javascript" } }));
  }
  app.get("/mode-assets/*", async (c) => {
    c.header("Cache-Control", "no-store");
    if (state.status !== "ready" || !bundleDir) return c.json(state, 503);
    let relPath: string;
    try { relPath = decodeURIComponent(c.req.path.replace("/mode-assets/", "")); }
    catch { return c.json({ error: "Invalid viewer asset path" }, 400); }
    const filePath = join(bundleDir, relPath);
    if (!isContained(filePath, bundleDir)) return c.notFound();
    const file = Bun.file(filePath);
    if (!await file.exists()) return c.notFound();
    const contentType = filePath.endsWith(".css") ? "text/css"
      : filePath.endsWith(".wasm") ? "application/wasm" : "application/javascript";
    return new Response(file, { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
  });

  return { getState: (): ModeViewerBuildState => state };
}
