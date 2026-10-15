import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { startServer } from "../index.js";
import { startCollaborationHost } from "../collaboration/host.js";

const interfaces = Object.values(networkInterfaces()).flatMap((items) => items ?? []);
const physicalIp = interfaces.find((address) => address.family === "IPv4" && !address.internal)?.address;
const networkTest = physicalIp ? test : test.skip;

networkTest("Project private API and Vite proxy stay on loopback while its LAN authority remains reachable", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "pneuma-private-project-network-"));
  const packageRoot = resolve(import.meta.dir, "../..");
  const sessionId = crypto.randomUUID();
  const backend = await startServer({ port: 20000 + Math.floor(Math.random() * 1000), workspace: fixture, stateDir: join(fixture, "state"), pneumaProjectRoot: fixture, sessionId });
  const authority = await startCollaborationHost({ project: { id: "network-project", name: "Network fixture" }, stateDir: join(fixture, "authority"), rooms: [], members: [{ id: "owner", name: "Owner", role: "admin", token: "fixture-authority-token" }], frontendDir: fixture, frameScript: "", hostname: "0.0.0.0", port: 0 });
  const oldPrivate = process.env.PNEUMA_PRIVATE_PROJECT_SESSION;
  const oldPort = process.env.VITE_API_PORT;
  process.env.PNEUMA_PRIVATE_PROJECT_SESSION = "1";
  process.env.VITE_API_PORT = String(backend.port);
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    vite = await createServer({ root: packageRoot, configFile: join(packageRoot, "vite.config.ts"), optimizeDeps: { noDiscovery: true, include: [] }, server: { port: 0 }, logLevel: "error" });
    await vite.listen();
    const address = vite.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Vite did not bind a TCP socket");
    expect(address.address).toBe("127.0.0.1");
    const vitePort = address.port;
    for (const port of [backend.port, vitePort]) {
      for (const path of ["/api/session", "/api/collaboration"]) {
        expect((await fetch(`http://127.0.0.1:${port}${path}`)).status).toBe(200);
        await expect(fetch(`http://${physicalIp}:${port}${path}`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
      }
    }
    const localWs = new WebSocket(`ws://127.0.0.1:${backend.port}/ws/browser/${sessionId}`);
    await new Promise<void>((resolve, reject) => { localWs.onopen = () => resolve(); localWs.onerror = () => reject(new Error("Loopback WebSocket failed")); });
    localWs.close();
    await expect(fetch(`http://${physicalIp}:${backend.port}/ws/browser/${sessionId}`, { headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" }, signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    const publicPort = new URL(authority.url).port;
    const publicState = await fetch(`http://${physicalIp}:${publicPort}/projects/network-project/api/state`, { headers: { Authorization: "Bearer fixture-authority-token" } });
    expect(publicState.status).toBe(200);
    expect((await publicState.json() as { project: { id: string } }).project.id).toBe("network-project");
  } finally {
    await vite?.close();
    if (oldPrivate === undefined) delete process.env.PNEUMA_PRIVATE_PROJECT_SESSION; else process.env.PNEUMA_PRIVATE_PROJECT_SESSION = oldPrivate;
    if (oldPort === undefined) delete process.env.VITE_API_PORT; else process.env.VITE_API_PORT = oldPort;
    await authority.close(); await backend.cleanup?.(); backend.server.stop(true);
    await rm(fixture, { recursive: true, force: true });
  }
}, 30000);

networkTest("legacy quick Session listeners remain reachable on the physical interface", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "pneuma-quick-network-"));
  const running = await startServer({ port: 21000 + Math.floor(Math.random() * 1000), workspace: fixture, stateDir: join(fixture, "state") });
  try {
    expect((await fetch(`http://${physicalIp}:${running.port}/api/session`)).status).toBe(200);
  } finally {
    await running.cleanup?.(); running.server.stop(true); await rm(fixture, { recursive: true, force: true });
  }
}, 30000);
