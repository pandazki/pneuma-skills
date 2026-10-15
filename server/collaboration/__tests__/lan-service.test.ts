import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureLanCollaborationService, ensureOwnedLanCollaborationService } from "../lan-service.js";
import { collaborationStateDir } from "../local-state.js";
import { readInternetAccess, setInternetAccess } from "../internet-access.js";
import type { LocalCollaborationBinding, CollaborationAuthorityIdentity } from "../../../core/types/collaboration-workspace.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
interface Record { pid: number; projectId: string; origin: string; controlOrigin: string; controlKey: string }
async function waitStopped(pid: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { try { process.kill(pid, 0); } catch { return; } await Bun.sleep(10); }
  throw new Error("Owned test LAN service did not stop");
}

test("detached service controls require private loopback key and project admin; dead owned service restores LAN with public off", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "pneuma-private-service-")); cleanups.push(() => rm(projectRoot, { force: true, recursive: true }));
  const credentials = { projectId: "service-project", memberToken: "private-owner-credential" };
  const options = { projectRoot, packageRoot: resolve(import.meta.dir, "../../.."), project: { id: credentials.projectId, name: "Service Project" },
    owner: { id: "owner", name: "Owner", role: "admin" as const, token: credentials.memberToken }, frontendDir: projectRoot, publicHostname: "127.0.0.1" };
  const origin = await ensureLanCollaborationService(options);
  const recordPath = join(collaborationStateDir(projectRoot), "service.json");
  let record = JSON.parse(await readFile(recordPath, "utf8")) as Record;
  let pid = record.pid;
  cleanups.push(async () => { try { process.kill(pid, "SIGTERM"); await waitStopped(pid); } catch {} });
  expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
  expect(record.controlOrigin).toStartWith("http://127.0.0.1:"); expect(record.controlKey.length).toBeGreaterThan(60);
  expect((await readInternetAccess(projectRoot, { ...credentials, authorityOrigin: origin }))?.status).toBe("off");
  expect((await setInternetAccess(projectRoot, { enabled: false }, credentials)).status).toBe("off");
  expect(await readInternetAccess(projectRoot, { ...credentials, authorityOrigin: "https://attached-remote.test" })).toBe(null);
  await expect(setInternetAccess(projectRoot, { enabled: true }, { ...credentials, authorityOrigin: "https://attached-remote.test" })).rejects.toThrow("local LAN authority");
  const controlRequest = (key: string, memberToken: string) => fetch(`${record.controlOrigin}/internet-access`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ projectId: credentials.projectId, memberToken }) });
  expect((await controlRequest("wrong-key", credentials.memberToken)).status).toBe(401);
  expect((await controlRequest(record.controlKey, "invalid-member")).status).toBe(403);
  expect((await fetch(`${origin}/internet-access`)).status).toBe(404);
  expect((await fetch(`${record.controlOrigin}/api/state`)).status).toBe(404);
  const identity = await (await fetch(`${origin}/projects/${credentials.projectId}/api/identity`)).json() as CollaborationAuthorityIdentity;
  const binding: LocalCollaborationBinding = { version: 1, projectId: credentials.projectId, authority: { kind: "lan", origin, publicKey: identity.publicKey },
    workspace: { id: "workspace", projectId: credentials.projectId, ownerId: "owner", name: "Workspace", placement: "local" }, memberToken: credentials.memberToken, memberName: "Owner" };
  process.kill(pid, "SIGTERM"); await waitStopped(pid);
  expect(await ensureOwnedLanCollaborationService({ ...options, binding })).toBe(true);
  record = JSON.parse(await readFile(recordPath, "utf8")); pid = record.pid;
  expect((await readInternetAccess(projectRoot, credentials))?.status).toBe("off");
  const restarted = await (await fetch(`${record.origin}/projects/${credentials.projectId}/api/identity`)).json() as CollaborationAuthorityIdentity;
  expect(restarted.publicKey).toBe(identity.publicKey);
  expect(await ensureOwnedLanCollaborationService({ ...options, binding: { ...binding, authority: { ...binding.authority, origin: "https://remote.test" } } })).toBe(false);
}, 10_000);

test("a stale detached build retires only when idle and keeps its authority URL and identity", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "pneuma-service-upgrade-")); cleanups.push(() => rm(projectRoot, { force: true, recursive: true }));
  const options = { projectRoot, packageRoot: resolve(import.meta.dir, "../../.."), project: { id: "upgrade-service", name: "Upgrade Project" },
    owner: { id: "owner", name: "Owner", role: "admin" as const, token: "owner-token" }, frontendDir: projectRoot, publicHostname: "127.0.0.1" };
  await Bun.write(join(projectRoot, "viewer-manifest.json"), JSON.stringify({ coreVersion: "one", modes: [] }));
  const origin = await ensureLanCollaborationService(options);
  const recordPath = join(collaborationStateDir(projectRoot), "service.json");
  let record = JSON.parse(await readFile(recordPath, "utf8")) as Record;
  let pid = record.pid;
  cleanups.push(async () => { try { process.kill(pid, "SIGTERM"); await waitStopped(pid); } catch {} });
  const beforeIdentity = await (await fetch(`${origin}/projects/upgrade-service/api/identity`)).json() as CollaborationAuthorityIdentity;
  const url = new URL(`${origin}/projects/upgrade-service/ws?token=owner-token`); url.protocol = "ws:";
  const socket = new WebSocket(url); cleanups.push(async () => { socket.close(); });
  await new Promise<void>((resolve) => { socket.onmessage = () => resolve(); });
  await Bun.write(join(projectRoot, "viewer-manifest.json"), JSON.stringify({ coreVersion: "two", modes: [] }));
  await expect(ensureLanCollaborationService(options)).rejects.toThrow("active collaboration participants and publishers");
  expect((JSON.parse(await readFile(recordPath, "utf8")) as Record).pid).toBe(pid);
  expect(socket.readyState).toBe(WebSocket.OPEN);
  socket.close();
  await new Promise<void>((resolve) => { if (socket.readyState === WebSocket.CLOSED) resolve(); else socket.addEventListener("close", () => resolve(), { once: true }); });
  await Bun.sleep(10);
  const api = async (path: string, body: unknown) => (await fetch(`${origin}/projects/upgrade-service${path}`, { method: "POST", headers: { Authorization: "Bearer owner-token", "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  await api("/api/workspaces", { id: "workspace", name: "Workspace", placement: "local" });
  const registration = await api("/api/rooms", { workspaceId: "workspace", modeInstanceId: "instance", mode: "test", title: "Test", page: "index.html",
    compatibility: { coreVersion: "one", modeVersion: "1", viewerHash: "a".repeat(64), publicationSchema: "test" } }) as { room: { id: string }; publisherToken: string };
  const publisherUrl = new URL(`${origin}/projects/upgrade-service/publisher/ws?roomId=${registration.room.id}&token=${registration.publisherToken}`); publisherUrl.protocol = "ws:";
  const publisher = new WebSocket(publisherUrl); cleanups.push(async () => { publisher.close(); });
  await new Promise<void>((resolve) => { publisher.onmessage = () => resolve(); });
  await expect(ensureLanCollaborationService(options)).rejects.toThrow("active collaboration participants and publishers");
  expect(publisher.readyState).toBe(WebSocket.OPEN);
  publisher.close();
  await new Promise<void>((resolve) => { if (publisher.readyState === WebSocket.CLOSED) resolve(); else publisher.addEventListener("close", () => resolve(), { once: true }); });
  await Bun.sleep(10);
  expect(await ensureLanCollaborationService(options)).toBe(origin);
  record = JSON.parse(await readFile(recordPath, "utf8")) as Record;
  expect(record.pid).not.toBe(pid); pid = record.pid;
  const afterIdentity = await (await fetch(`${origin}/projects/upgrade-service/api/identity`)).json() as CollaborationAuthorityIdentity;
  expect(afterIdentity.publicKey).toBe(beforeIdentity.publicKey);
  expect((await readInternetAccess(projectRoot, { projectId: options.project.id, memberToken: options.owner.token }))?.status).toBe("off");
}, 15000);

test("an unidentified legacy service never causes a PID signal or a second authority", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "pneuma-service-legacy-")); cleanups.push(() => rm(projectRoot, { force: true, recursive: true }));
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ project: { id: "legacy" } }) });
  cleanups.push(async () => { await server.stop(true); });
  const { writePrivateJson } = await import("../local-state.js");
  const directory = collaborationStateDir(projectRoot);
  await writePrivateJson(join(directory, "service.json"), { pid: process.pid, projectId: "legacy", origin: `http://127.0.0.1:${server.port}` });
  await expect(ensureLanCollaborationService({ projectRoot, packageRoot: resolve(import.meta.dir, "../../.."), project: { id: "legacy", name: "Legacy" },
    owner: { id: "owner", name: "Owner", role: "admin", token: "owner-token" }, frontendDir: projectRoot })).rejects.toThrow("End its original collaboration runtime");
  expect(JSON.parse(await readFile(join(directory, "service.json"), "utf8")).pid).toBe(process.pid);
  expect(await Bun.file(join(directory, "service-config.json")).exists()).toBe(false);
});
