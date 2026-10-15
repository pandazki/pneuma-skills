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
