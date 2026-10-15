import type { Hono } from "hono";
import { resolve } from "node:path";
import type { CollaborationSetupStatus } from "../../core/types/collaboration-setup.js";
import { findCloudflaredExecutable } from "./internet-tunnel.js";

/** Read-only setup help for the private launcher and Session, never the authority. */
export function registerCollaborationSetupRoutes(app: Hono, options: { packageRoot: string }): void {
  const packageRoot = resolve(options.packageRoot);
  const guidePath = resolve(packageRoot, "server/collaboration/SETUP.md");

  app.get("/api/collaboration/setup", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const pkg: unknown = await Bun.file(resolve(packageRoot, "package.json")).json();
      if (!pkg || typeof pkg !== "object" || !("version" in pkg) || typeof pkg.version !== "string" || !pkg.version.trim()) {
        throw new Error("Pneuma package metadata has no version.");
      }
      const status: CollaborationSetupStatus = {
        platform: process.platform,
        appVersion: pkg.version,
        cloudflared: { installed: await findCloudflaredExecutable(packageRoot) !== null },
        guidePath,
      };
      return c.json(status);
    } catch {
      return c.json({ error: "Could not read collaboration setup status. Check the Pneuma installation and retry." }, 500);
    }
  });

  app.get("/api/collaboration/setup/guide", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const guide = await Bun.file(guidePath).text();
      c.header("Content-Type", "text/markdown; charset=utf-8");
      return c.body(guide);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return c.json({ error: "Collaboration setup guide is missing. Reinstall or update Pneuma and retry." }, 404);
      }
      return c.json({ error: "Could not read the collaboration setup guide. Check the Pneuma installation and retry." }, 500);
    }
  });
}
