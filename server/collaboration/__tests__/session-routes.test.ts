import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadProjectManifest, writeProjectManifest } from "../../../core/project-loader.js";
import type { SessionCollaborationStatus } from "../../../core/types/collaboration-session.js";
import type { CollaborationProjectState, CollaborationRoomState } from "../../../core/types/collaboration.js";
import type { CollaborationReference } from "../../../core/types/collaboration-reference.js";
import type { CollaborationReferenceImportReceipt } from "../../../core/types/collaboration-reference-import.js";
import manifest from "../../../modes/webcraft/manifest.js";
import { mountSessionCollaborationRoutes } from "../session-routes.js";
import { collaborationStateDir, readLocalCollaborationRoom, readLocalCollaborationBinding } from "../local-state.js";
import { ensureLanCollaborationService } from "../lan-service.js";

const fixtures: { root: string; controllers: ReturnType<typeof mountSessionCollaborationRoutes>[]; sockets: WebSocket[] }[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    for (const socket of fixture.sockets) socket.close();
    for (const controller of fixture.controllers) await controller.stop();
    const record = Bun.file(join(collaborationStateDir(fixture.root), "service.json"));
    if (await record.exists()) {
      const { pid } = await record.json() as { pid: number };
      try { process.kill(pid, "SIGTERM"); } catch { /* The authority may already have stopped. */ }
      for (let attempt = 0; attempt < 100 && await record.exists(); attempt++) await Bun.sleep(10);
    }
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pneuma-session-collaboration-"));
  const stateDir = join(root, ".pneuma", "sessions", "instance-a");
  const workspace = join(stateDir, "workspace");
  const frontendDir = join(root, "public-viewer");
  mkdirSync(join(workspace, "site-a"), { recursive: true });
  mkdirSync(frontendDir);
  writeFileSync(join(workspace, "site-a", "index.html"), "<h1>First published page</h1>");
  writeFileSync(join(workspace, "site-a", "second.html"), "<h1>Second page</h1>");
  writeFileSync(join(workspace, "history.json"), "private Agent transcript");
  writeFileSync(join(frontendDir, "index.html"), "<!doctype html><title>Public viewer</title>");
  writeFileSync(join(frontendDir, "viewer-manifest.json"), JSON.stringify({ coreVersion: "3.57.3", modes: [{
    mode: manifest.name, coreVersion: "3.57.3", modeVersion: manifest.version,
    viewerHash: "a".repeat(64), publicationSchema: manifest.viewerApi!.collaboration!.publication.schema,
    entry: "/mode-assets/webcraft.js", styles: [],
  }] }));
  await writeProjectManifest(root, { version: 1, name: "local-slug", displayName: "Lifecycle project", createdAt: 1 });
  const tracked = { root, controllers: [] as ReturnType<typeof mountSessionCollaborationRoutes>[], sockets: [] as WebSocket[] };
  fixtures.push(tracked);
  const mount = (selectedManifest = manifest) => {
    const app = new Hono();
    tracked.controllers.push(mountSessionCollaborationRoutes(app, { projectRoot: root,
      packageRoot: resolve(import.meta.dir, "../../.."), workspace, stateDir, sessionId: "instance-a",
      manifest: selectedManifest, modeDir: resolve(import.meta.dir, "../../../modes/webcraft"), frontendDir }));
    return app;
  };
  return { ...tracked, workspace, stateDir, frontendDir, mount };
}
async function post(app: Hono, path: string, body: unknown) {
  return app.request(`/api/collaboration/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function getStatus(app: Hono) { return await (await app.request("/api/collaboration")).json() as SessionCollaborationStatus; }
async function state(status: SessionCollaborationStatus) {
  const connection = status.connection!;
  return await (await fetch(`${connection.authorityBaseUrl}/api/state`, { headers: { Authorization: `Bearer ${connection.token}` } })).json() as CollaborationProjectState;
}
async function waitUntil(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) { if (await check()) return; await Bun.sleep(10); }
  throw new Error("Collaboration lifecycle did not reach the expected state");
}

describe("normal private Session collaboration lifecycle", () => {
  test("public access controls report custom failure without falling back or changing the LAN authority", async () => {
    const f = await fixture(); const app = f.mount();
    const created = await (await post(app, "create", { name: "Host administrator" })).json() as SessionCollaborationStatus;
    expect(created.canManageInternetAccess).toBe(true);
    expect(created.internetAccess?.status).toBe("off");
    const provider = { kind: "named", tunnelId: "11111111-2222-3333-4444-555555555555", credentialsFile: join(f.root, "missing-credentials.json"), publicOrigin: "https://fixed.example.com" };
    const failed = await post(app, "internet-access", { enabled: true, provider });
    expect(failed.ok).toBe(false);
    const afterFailure = await getStatus(app);
    expect(afterFailure.internetAccess?.status).toBe("failed");
    expect(afterFailure.internetAccess?.provider.kind).toBe("named");
    expect(afterFailure.internetAccess?.publicOrigin).toBeNull();
    expect(afterFailure.connection?.authorityBaseUrl).toBe(created.connection?.authorityBaseUrl);
    expect(afterFailure.entries?.map((entry) => entry.kind)).toEqual(["lan"]);
    expect((await state(afterFailure)).project.id).toBe(created.connection!.projectId);
    const stopped = await post(app, "internet-access", { enabled: false }); expect(stopped.status).toBe(200);
    expect((await stopped.json() as SessionCollaborationStatus).internetAccess?.status).toBe("off");
  }, 10_000);
  test("opening a persisted owning Session restores its dead LAN service with public access off", async () => {
    const f = await fixture(); const app = f.mount();
    const created = await (await post(app, "create", { name: "Host administrator" })).json() as SessionCollaborationStatus;
    const recordFile = Bun.file(join(collaborationStateDir(f.root), "service.json")); const record = await recordFile.json();
    process.kill(record.pid, "SIGKILL");
    await waitUntil(async () => { try { process.kill(record.pid, 0); return false; } catch { return true; } });
    const resumed = await getStatus(f.mount());
    expect(resumed.connection?.authorityBaseUrl).toBe(created.connection?.authorityBaseUrl);
    expect(resumed.connection?.workspaceId).toBe(created.connection?.workspaceId);
    expect(resumed.canManageInternetAccess).toBe(true);
    expect(resumed.internetAccess?.status).toBe("off");
    expect((await state(resumed)).project.id).toBe(created.connection!.projectId);
  }, 10_000);
  test("opening a shared Session after a viewer upgrade replaces the idle authority and republishes automatically", async () => {
    const f = await fixture(); const app = f.mount();
    await post(app, "create", { name: "Owner" });
    const shared = await (await post(app, "share", { title: "Persisted room", contentSet: "site-a", activeFile: "index.html" })).json() as SessionCollaborationStatus;
    const originalBinding = await readLocalCollaborationBinding(f.root);
    const originalRoom = await readLocalCollaborationRoom(f.stateDir);
    const recordPath = join(collaborationStateDir(f.root), "service.json");
    const beforePid = (await Bun.file(recordPath).json()).pid;
    const catalogPath = join(f.frontendDir, "viewer-manifest.json");
    const catalog = await Bun.file(catalogPath).json();
    catalog.coreVersion = "3.58.0";
    catalog.modes[0].coreVersion = "3.58.0"; catalog.modes[0].viewerHash = "b".repeat(64);
    await Bun.write(catalogPath, JSON.stringify(catalog));
    const resumedApp = f.mount();
    const waiting = await getStatus(resumedApp);
    expect(waiting.error).toContain("active collaboration participants and publishers");
    expect(waiting.connection).toBeUndefined(); expect(waiting.sharing).toBe(false);
    expect(waiting.canManageInternetAccess).toBe(true);
    expect((await post(resumedApp, "share", { title: "Must wait", contentSet: "site-a", activeFile: "index.html" })).status).toBe(409);
    const disabled = await (await post(resumedApp, "internet-access", { enabled: false })).json() as SessionCollaborationStatus;
    expect(disabled.internetAccess?.status).toBe("off"); expect(disabled.connection).toBeUndefined(); expect(disabled.error).toContain("active collaboration");
    await f.controllers[0]!.stop();
    await Bun.sleep(10);
    const resumed = await getStatus(resumedApp);
    expect(resumed.error).toBeUndefined(); expect(resumed.roomId).toBe(shared.roomId);
    await waitUntil(async () => (await state(resumed)).rooms[0]?.revision === 2);
    const upgraded = (await state(resumed)).rooms[0]!;
    expect(upgraded.compatibility?.coreVersion).toBe("3.58.0"); expect(upgraded.viewerRevisionStart).toBe(2);
    expect((await Bun.file(recordPath).json()).pid).not.toBe(beforePid);
    expect(await readLocalCollaborationBinding(f.root)).toEqual(originalBinding);
    expect(await readLocalCollaborationRoom(f.stateDir)).toEqual(originalRoom);
    expect(resumed.connection?.authorityBaseUrl).toBe(shared.connection?.authorityBaseUrl);
  }, 15000);
  test("a mode without shared viewing can create the project directory but cannot publish a room", async () => {
    const f = await fixture();
    const app = f.mount({ ...manifest, name: "unsupported", viewerApi: undefined });
    const response = await post(app, "create", { name: "Directory member" });
    expect(response.status).toBe(200);
    const created = await response.json() as SessionCollaborationStatus;
    expect(created.supported).toBe(false); expect(created.connection).toBeDefined();
    expect((await state(created)).workspaces).toHaveLength(1);
    expect((await post(app, "share", { title: "Unsupported", contentSet: "site-a", activeFile: "index.html" })).status).toBe(400);
    expect((await state(created)).rooms).toHaveLength(0);
  }, 10_000);
  test("member links adopt the portable project identity and reader connections cannot publish", async () => {
    const owner = await fixture(); const ownerApp = owner.mount();
    const created = await (await post(ownerApp, "create", { name: "Owner" })).json() as SessionCollaborationStatus;
    const connection = created.connection!;
    const memberResponse = await fetch(`${connection.authorityBaseUrl}/api/members`, { method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Reader", role: "reader" }) });
    expect(memberResponse.status).toBe(200);
    const member = await memberResponse.json() as { token: string; member: { id: string } };
    const destination = await fixture(); const destinationApp = destination.mount();
    const response = await post(destinationApp, "connect", { url: `${connection.authorityBaseUrl}#token=${encodeURIComponent(member.token)}` });
    expect(response.status).toBe(200);
    const connected = await response.json() as SessionCollaborationStatus;
    expect(connected.connection?.projectId).toBe(connection.projectId);
    expect(connected.connection?.workspaceId).not.toBe(connection.workspaceId);
    expect(connected.connection?.ownerId).toBe(member.member.id);
    expect((await loadProjectManifest(destination.root))?.id).toBe(connection.projectId);
    expect((await post(destinationApp, "share", { title: "Forbidden reader publication", contentSet: "site-a", activeFile: "index.html" })).status).toBe(403);
    expect(await readLocalCollaborationRoom(destination.stateDir)).toBeNull();
    expect((await state(created)).rooms).toHaveLength(0);
    expect((await post(destinationApp, "connect", { url: `${connection.authorityBaseUrl}#token=${encodeURIComponent(connection.token)}` })).status).toBe(409);
  }, 10_000);
  test("creates a real detached LAN authority, publishes, resumes from GET, and stops without changing the pinned site", async () => {
    const f = await fixture(); const app = f.mount();
    expect(await getStatus(app)).toMatchObject({ projectAvailable: true, supported: true, sharing: false });
    const createdResponse = await post(app, "create", { name: "Ada" });
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json() as SessionCollaborationStatus;
    expect(created.connection?.projectId).toBe((await loadProjectManifest(f.root))?.id);
    expect((await loadProjectManifest(f.root))?.name).toBe("local-slug");
    expect((await state(created)).workspaces).toContainEqual(expect.objectContaining({ id: created.connection!.workspaceId, ownerId: created.connection!.ownerId }));
    const repeated = await (await post(app, "create", { name: "Ignored repeat" })).json() as SessionCollaborationStatus;
    expect(repeated.connection).toEqual(created.connection);

    const sharedResponse = await post(app, "share", { title: "Shared site", contentSet: "site-a", activeFile: "index.html" });
    expect(sharedResponse.status).toBe(200);
    const shared = await sharedResponse.json() as SessionCollaborationStatus;
    expect(shared).toMatchObject({ sharing: true, sharedContentSet: "site-a" });
    expect(shared.error).toBeUndefined();
    const publicState = await state(shared);
    const room = publicState.rooms.find((entry) => entry.id === shared.roomId)!;
    expect(room).toMatchObject({ workspaceId: shared.connection!.workspaceId, modeInstanceId: "instance-a", page: "site-a/index.html", revision: 1 });
    expect(JSON.stringify(publicState)).not.toContain(f.root);
    expect(JSON.stringify(publicState)).not.toContain("private Agent transcript");

    const wsUrl = new URL(`${shared.connection!.authorityBaseUrl}/ws`);
    wsUrl.protocol = "ws:"; wsUrl.searchParams.set("token", shared.connection!.token);
    const socket = new WebSocket(wsUrl); f.sockets.push(socket);
    let joined: CollaborationRoomState | null = null;
    socket.onmessage = (event) => { const message = JSON.parse(String(event.data)); if (message.type === "room") joined = message.state; };
    await new Promise<void>((resolve, reject) => { socket.onopen = () => { socket.send(JSON.stringify({ type: "join", roomId: room.id })); resolve(); }; socket.onerror = reject; });
    await waitUntil(async () => joined !== null);
    const publicationBeforeReconnect = await readLocalCollaborationRoom(f.stateDir);
    const reconnectedResponse = await post(app, "connect", { url: shared.connection!.authorityBaseUrl });
    expect(reconnectedResponse.status).toBe(200);
    const reconnected = await reconnectedResponse.json() as SessionCollaborationStatus;
    expect(reconnected.connection?.workspaceId).toBe(shared.connection!.workspaceId);
    expect(reconnected.roomId).toBe(shared.roomId);
    expect((await readLocalCollaborationRoom(f.stateDir))?.publisherToken).toBe(publicationBeforeReconnect!.publisherToken);
    expect((await state(reconnected)).rooms).toHaveLength(1);
    expect(joined!.publication?.projection?.entryAddress).toEqual({ contentSet: "site-a", page: "index.html" });
    expect(joined!.publication?.files.map((file) => file.path)).toEqual(["site-a/index.html", "site-a/second.html"]);
    const page = await fetch(new URL(joined!.pageUrl, shared.connection!.authorityBaseUrl));
    const pageText = await page.text();
    expect({ status: page.status, body: page.status === 200 ? "ok" : pageText }).toEqual({ status: 200, body: "ok" });
    expect(pageText).toContain("First published page");

    const writerResponse = await fetch(`${shared.connection!.authorityBaseUrl}/api/members`, { method: "POST", headers: { Authorization: `Bearer ${shared.connection!.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Bo", role: "writer" }) });
    const writer = await writerResponse.json() as { token: string };
    const destination = await fixture(); const destinationApp = destination.mount();
    const writerConnection = await (await post(destinationApp, "connect", { url: `${shared.connection!.authorityBaseUrl}#token=${encodeURIComponent(writer.token)}` })).json() as SessionCollaborationStatus;
    expect((await state(writerConnection)).workspaces?.some((workspace) => workspace.id === writerConnection.connection!.workspaceId)).toBe(true);
    expect((await state(writerConnection)).rooms.filter((room) => room.workspaceId === writerConnection.connection!.workspaceId)).toHaveLength(0);
    const pinResponse = await fetch(`${writerConnection.connection!.authorityBaseUrl}/api/references`, { method: "POST", headers: { Authorization: `Bearer ${writer.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ opId: "pin-without-sharing", destinationWorkspaceId: writerConnection.connection!.workspaceId, label: "Ada's published heading", source: { projectId: shared.connection!.projectId, workspaceId: room.workspaceId, roomId: room.id, publicationRevision: 1, address: { contentSet: "site-a", page: "index.html", selector: "h1" } } }) });
    expect(pinResponse.status).toBe(201);
    const pin = await pinResponse.json() as CollaborationReference;
    const importedResponse = await destinationApp.request(`/api/collaboration/references/${pin.id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "explicit-local-copy" }) });
    expect(importedResponse.status).toBe(200);
    const imported = await importedResponse.json() as CollaborationReferenceImportReceipt;
    expect(imported).toMatchObject({ kind: "local-copy", referenceId: pin.id, destinationWorkspaceId: writerConnection.connection!.workspaceId, publicationRevision: 1 });
    expect(await Bun.file(join(destination.workspace, imported.path, "site-a/index.html")).text()).toBe("<h1>First published page</h1>");
    expect((await state(writerConnection)).rooms.filter((room) => room.workspaceId === writerConnection.connection!.workspaceId)).toHaveLength(0);

    await f.controllers[0]!.stop();
    writeFileSync(join(f.workspace, "site-a", "index.html"), "<h1>Published after resume</h1>");
    const resumedApp = f.mount();
    const resumed = await getStatus(resumedApp);
    expect(resumed).toMatchObject({ sharing: true, roomId: room.id, sharedContentSet: "site-a" });
    await waitUntil(async () => (await state(resumed)).rooms.find((entry) => entry.id === room.id)!.revision === 2);
    expect((await state(resumed)).rooms).toHaveLength(1);
    const stopped = await (await post(resumedApp, "stop", {})).json() as SessionCollaborationStatus;
    expect(stopped).toMatchObject({ sharing: false, publisherStatus: "Not sharing", roomId: room.id });
    expect(stopped.error).toBeUndefined();
    expect((await state(stopped)).rooms.find((entry) => entry.id === room.id)?.enabled).toBe(false);
    expect((await readLocalCollaborationRoom(f.stateDir))?.enabled).toBe(false);

    const incompatible = await post(resumedApp, "share", { title: "Different site", contentSet: null, activeFile: "site-a/index.html" });
    expect(incompatible.status).toBe(409);
    const reshared = await (await post(resumedApp, "share", { title: "Shared again", contentSet: "site-a", activeFile: "second.html" })).json() as SessionCollaborationStatus;
    expect(reshared.roomId).toBe(room.id);
    expect((await state(reshared)).rooms.find((entry) => entry.id === room.id)?.page).toBe("site-a/index.html");
    expect((await readLocalCollaborationRoom(f.stateDir))?.activeFile).toBe("index.html");
    const removedResponse = await post(resumedApp, "remove", {});
    expect(removedResponse.status).toBe(200);
    const removed = await removedResponse.json() as SessionCollaborationStatus;
    expect(removed.sharing).toBe(false); expect(removed.roomId).toBeUndefined();
    expect(await readLocalCollaborationRoom(f.stateDir)).toBeNull();
    expect((await state(removed)).rooms).toHaveLength(0);
    expect((await post(resumedApp, "remove", {})).status).toBe(200);
    const replaced = await (await post(resumedApp, "share", { title: "Another entry", contentSet: "site-a", activeFile: "second.html" })).json() as SessionCollaborationStatus;
    expect(replaced.roomId).not.toBe(room.id);
    expect((await state(replaced)).rooms.find((entry) => entry.id === replaced.roomId)?.page).toBe("site-a/second.html");
    const serviceRecord = Bun.file(join(collaborationStateDir(f.root), "service.json"));
    const failedPid = (await serviceRecord.json()).pid;
    process.kill(failedPid, "SIGKILL");
    await waitUntil(async () => { try { process.kill(failedPid, 0); return false; } catch { return true; } });
    const uncertain = await post(resumedApp, "remove", {});
    expect(uncertain.status).toBe(502);
    expect(await uncertain.json()).toMatchObject({ error: expect.stringContaining("removal has not been confirmed") });
    expect(await readLocalCollaborationRoom(f.stateDir)).toMatchObject({ roomId: replaced.roomId, enabled: false });
    const serviceConfig = await Bun.file(join(collaborationStateDir(f.root), "service-config.json")).json();
    await ensureLanCollaborationService({ projectRoot: f.root, packageRoot: resolve(import.meta.dir, "../../.."),
      project: serviceConfig.project, owner: serviceConfig.owner, frontendDir: serviceConfig.frontendDir });
    expect((await post(resumedApp, "remove", {})).status).toBe(200);
    expect(await readLocalCollaborationRoom(f.stateDir)).toBeNull();
    const finalShare = await (await post(resumedApp, "share", { title: "Before shared removal", contentSet: "site-a", activeFile: "second.html" })).json() as SessionCollaborationStatus;
    expect(finalShare.sharing).toBe(true);
    const removedProject = await fetch(`${finalShare.connection!.authorityBaseUrl}/api/project`, { method: "DELETE", headers: { Authorization: `Bearer ${finalShare.connection!.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ opId: "remove-shared-project" }) });
    expect(removedProject.status).toBe(200);
    await waitUntil(async () => !!(await getStatus(resumedApp)).projectRemoved);
    expect(await getStatus(resumedApp)).toMatchObject({ sharing: false, projectRemoved: true, publisherStatus: "Shared project removed" });
    expect(await readLocalCollaborationBinding(f.root)).toMatchObject({ projectId: shared.connection!.projectId, workspace: { id: shared.connection!.workspaceId } });
    expect(await Bun.file(join(f.workspace, "site-a/index.html")).text()).toBe("<h1>Published after resume</h1>");
    expect((await post(resumedApp, "create", { name: "Must not fork" })).status).toBe(410);
    expect(await readLocalCollaborationBinding(f.root)).toMatchObject({ projectId: shared.connection!.projectId });
  }, 20_000);
});
