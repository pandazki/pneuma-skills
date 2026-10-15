import { expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollaborationSetupStatus } from "../types/index.js";
import { registerCollaborationSetupRoutes } from "../../server/collaboration/setup-routes.js";

test("private setup contract projects only public installation metadata, never package configuration", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "pneuma-setup-contract-"));
  try {
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "3.57.3-contract", token: "private-package-token", credentialsFile: "/private/provider-credentials.json" }));
    const app = new Hono();
    registerCollaborationSetupRoutes(app, { packageRoot });
    const response = await app.request("/api/collaboration/setup");
    expect(response.status).toBe(200);
    const status = await response.json() as CollaborationSetupStatus;
    expect(Object.keys(status).sort()).toEqual(["appVersion", "cloudflared", "guidePath", "platform"]);
    expect(Object.keys(status.cloudflared)).toEqual(["installed"]);
    expect(typeof status.cloudflared.installed).toBe("boolean");
    expect(status.platform).toBe(process.platform);
    expect(status.appVersion).toBe("3.57.3-contract");
    expect(status.guidePath).toBe(join(packageRoot, "server/collaboration/SETUP.md"));
    expect(JSON.stringify(status)).not.toContain("private-package-token");
    expect(JSON.stringify(status)).not.toContain("/private/provider-credentials.json");
  } finally { await rm(packageRoot, { recursive: true, force: true }); }
});
