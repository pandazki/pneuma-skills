import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { Hono } from "hono";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CollaborationSetupStatus } from "../../../core/types/index.js";
import { registerCollaborationSetupRoutes } from "../setup-routes.js";
import { startCollaborationHost } from "../host.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const packageRoot = await mkdtemp(join(tmpdir(), "pneuma-setup-test-"));
  directories.push(packageRoot);
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "3.57.3-test" }));
  const guidePath = join(packageRoot, "server/collaboration/SETUP.md");
  await mkdir(dirname(guidePath), { recursive: true });
  await writeFile(guidePath, "# Collaboration setup\nRead these shipped instructions.\n");
  const binaryPath = join(packageRoot, "vendor/cloudflared", `${process.platform}-${process.arch}`, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  await mkdir(dirname(binaryPath), { recursive: true });
  // Executing this detector fixture would leave a visible side effect.
  const marker = join(packageRoot, "executed");
  await writeFile(binaryPath, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  await chmod(binaryPath, 0o700);
  const app = new Hono();
  registerCollaborationSetupRoutes(app, { packageRoot });
  return { app, packageRoot, guidePath, binaryPath, marker };
}

describe("private collaboration setup", () => {
  test("reports installed executable without invoking it and serves only the shipped guide", async () => {
    const f = await fixture();
    const response = await f.app.request("/api/collaboration/setup");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const status = await response.json() as CollaborationSetupStatus;
    expect(status).toEqual({ platform: process.platform, appVersion: "3.57.3-test", cloudflared: { installed: true }, guidePath: f.guidePath });
    expect(await Bun.file(f.marker).exists()).toBe(false);
    const guide = await f.app.request("/api/collaboration/setup/guide?path=/etc/passwd");
    expect(guide.status).toBe(200);
    expect(guide.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(await guide.text()).toBe("# Collaboration setup\nRead these shipped instructions.\n");
    for (const path of ["/api/collaboration/setup", "/api/collaboration/setup/guide"]) {
      expect((await f.app.request(path, { method: "POST" })).status).toBe(404);
    }
  });

  test("detects newly installed executables on the next request and distinguishes missing from failures", async () => {
    const f = await fixture();
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    const which = spyOn(Bun, "which").mockReturnValue(null);
    Object.defineProperty(process, "platform", { value: "setup-test", configurable: true });
    try {
      expect((await (await f.app.request("/api/collaboration/setup")).json()).cloudflared.installed).toBe(false);
      const binary = join(f.packageRoot, "vendor/cloudflared", `setup-test-${process.arch}`, "cloudflared");
      await mkdir(dirname(binary), { recursive: true });
      await writeFile(binary, "not launched", { mode: 0o700 });
      await chmod(binary, 0o700);
      expect((await (await f.app.request("/api/collaboration/setup")).json()).cloudflared.installed).toBe(true);
      which.mockImplementation(() => { throw new Error("private detector details"); });
      const detectorFailure = await f.app.request("/api/collaboration/setup");
      expect(detectorFailure.status).toBe(500);
      expect(await detectorFailure.text()).not.toContain("private detector details");
      which.mockReturnValue(null);
      await writeFile(join(f.packageRoot, "package.json"), "malformed");
      const failed = await f.app.request("/api/collaboration/setup");
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: "Could not read collaboration setup status. Check the Pneuma installation and retry." });
    } finally {
      Object.defineProperty(process, "platform", platform);
      which.mockRestore();
    }
  });

  test("missing guide is actionable and unexpected read errors stay visible", async () => {
    const f = await fixture();
    await rm(f.guidePath);
    const missing = await f.app.request("/api/collaboration/setup/guide");
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toContain("Reinstall or update Pneuma");
    await mkdir(f.guidePath);
    expect((await f.app.request("/api/collaboration/setup/guide")).status).toBe(500);
  });

  test("both private server flavours mount setup before branching", async () => {
    const f = await fixture();
    const source = resolve(import.meta.dir, "../../index.ts");
    const child = Bun.spawn([process.execPath, "--eval", `
      import { startServer } from ${JSON.stringify(source)};
      for (const launcherMode of [true, false]) {
        const running = await startServer({ port: 0, workspace: ${JSON.stringify(f.packageRoot)}, projectRoot: ${JSON.stringify(f.packageRoot)}, launcherMode });
        try {
          const response = await fetch('http://127.0.0.1:' + running.server.port + '/api/collaboration/setup');
          const guide = await fetch('http://127.0.0.1:' + running.server.port + '/api/collaboration/setup/guide');
          console.log('SETUP_RESULT ' + JSON.stringify({ launcherMode, status: response.status, body: await response.json(), guideStatus: guide.status }));
        } finally { await running.cleanup?.(); running.server.stop(true); }
      }
      process.exit(0);
    `], { cwd: f.packageRoot, env: { ...process.env, HOME: f.packageRoot, USERPROFILE: f.packageRoot }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    const results = stdout.split("\n").filter((line) => line.startsWith("SETUP_RESULT ")).map((line) => JSON.parse(line.slice(13)));
    expect(results.length).toBe(2);
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.guideStatus).toBe(200);
      expect(result.body.guidePath).toBe(f.guidePath);
    }
  }, 15000);

  test("LAN and public authority listeners never expose setup metadata or guide", async () => {
    const f = await fixture();
    const host = await startCollaborationHost({ project: { id: "setup-project", name: "Setup isolation" }, stateDir: join(f.packageRoot, "authority"), rooms: [], members: [{ id: "owner", name: "Owner", role: "admin", token: "setup-test-owner" }], frontendDir: f.packageRoot, frameScript: "", hostname: "127.0.0.1", port: 0 });
    try {
      const ingress = host.startPublicIngress({ beforeActivity: () => true, onConnectionsChanged: () => {} });
      for (const origin of [host.url, ingress]) {
        for (const path of ["/api/collaboration/setup", "/api/collaboration/setup/guide", "/projects/setup-project/api/collaboration/setup", "/projects/setup-project/api/collaboration/setup/guide"]) {
          const response = await fetch(new URL(path, origin), { headers: { Authorization: "Bearer setup-test-owner" } });
          expect(response.status).toBe(404);
          expect(await response.text()).not.toContain(f.guidePath);
        }
      }
    } finally { await host.close(); }
  });
});
