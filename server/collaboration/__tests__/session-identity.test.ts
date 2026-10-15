import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { writeProjectManifest } from "../../../core/project-loader.js";
import { collaborationIdentityChallenge } from "../../../core/types/collaboration-workspace.js";
import type { SessionCollaborationStatus } from "../../../core/types/collaboration-session.js";
import { readLocalCollaborationBinding, writeLocalCollaborationBinding, writePrivateJson } from "../local-state.js";
import { mountSessionCollaborationRoutes } from "../session-routes.js";

const token = "explicit-member-token-long-enough";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function local() {
  const root = mkdtempSync(join(tmpdir(), "pneuma-session-identity-"));
  const stateDir = join(root, ".pneuma/sessions/instance-a"); mkdirSync(stateDir, { recursive: true });
  await writeProjectManifest(root, { version: 1, name: "local", displayName: "Local Project", createdAt: 1 });
  const app = new Hono();
  const controller = mountSessionCollaborationRoutes(app, { projectRoot: root, packageRoot: resolve(import.meta.dir, "../../.."), workspace: root, stateDir });
  cleanups.push(async () => { await controller.stop(); rmSync(root, { recursive: true, force: true }); });
  return { root, app };
}
function authority(options: { keys?: { publicKey: KeyObject; privateKey: KeyObject }; signedOrigin?: string; kind?: "lan" | "cloud" } = {}) {
  const keys = options.keys ?? generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  let authenticated = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req): Response {
    const url = new URL(req.url); const origin = options.signedOrigin ?? server.url.origin;
    if (url.pathname === "/projects/project-a/api/identity") {
      expect(req.headers.has("authorization")).toBe(false);
      const nonce = url.searchParams.get("nonce")!;
      return Response.json(options.kind === "cloud" ? { version: 1, kind: "cloud", projectId: "project-a", origin } : { version: 1, kind: "lan", projectId: "project-a", origin, publicKey, nonce, lanOrigin: server.url.origin, publicOrigin: null, signature: sign(null, Buffer.from(collaborationIdentityChallenge("project-a", origin, nonce)), keys.privateKey).toString("base64") });
    }
    authenticated++;
    if (req.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: "Bad member token" }, { status: 401 });
    if (url.pathname.endsWith("/api/workspaces")) return Response.json({});
    return Response.json({ project: { id: "project-a", name: "Shared" }, self: { id: "member-a", name: "Member", role: "writer", kind: "member" }, rooms: [], members: [], workspaces: [] });
  } });
  cleanups.push(async () => { await server.stop(true); });
  return { keys, publicKey, origin: server.url.origin, link: `${server.url.origin}/projects/project-a#token=${token}`, authenticated: () => authenticated };
}
async function connect(app: Hono, url: string) { return app.request("/api/collaboration/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }); }

describe("private Session authority continuity", () => {
  test("an owning Session can read and stop loopback public access when its LAN entry is unreachable", async () => {
    const f = await local(); const first = authority(); expect((await connect(f.app, first.link)).status).toBe(200);
    const binding = (await readLocalCollaborationBinding(f.root))!; binding.authority.origin = "http://127.0.0.1:1"; await writeLocalCollaborationBinding(f.root, binding);
    let phase = "active";
    const control = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
      expect(req.headers.get("authorization")).toBe("Bearer private-control-key");
      const body = await req.json() as { memberToken: string; change?: { enabled: boolean } }; expect(body.memberToken).toBe(token);
      if (body.change?.enabled === false) phase = "off";
      return Response.json({ status: phase, provider: { kind: "quick" }, publicOrigin: phase === "active" ? "https://temporary.example" : null, publicClients: 0, idleDeadline: null, idleTimeoutMs: 600000 });
    } });
    cleanups.push(async () => { await control.stop(true); });
    await writePrivateJson(join(f.root, ".pneuma/collaboration/service.json"), { projectId: "project-a", origin: binding.authority.origin, controlOrigin: control.url.origin, controlKey: "private-control-key" });
    // Mount anew to read the changed persisted binding and exercise normal GET initialization.
    const app = new Hono(); const controller = mountSessionCollaborationRoutes(app, { projectRoot: f.root, packageRoot: resolve(import.meta.dir, "../../.."), workspace: f.root, stateDir: join(f.root, ".pneuma/sessions/instance-a") });
    cleanups.push(async () => { await controller.stop(); });
    const status = await (await app.request("/api/collaboration")).json() as SessionCollaborationStatus;
    expect(status.canManageInternetAccess).toBe(true); expect(status.internetAccess?.status).toBe("active"); expect(status.entries?.map((entry) => entry.kind)).toEqual(["lan", "public"]);
    const stopped = await app.request("/api/collaboration/internet-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    expect(stopped.status).toBe(200); expect((await stopped.json() as SessionCollaborationStatus).internetAccess?.status).toBe("off");
  });
  test("explicit LAN placement survives a new entry while workspace identity remains fixed", async () => {
    const f = await local(); const first = authority();
    const initial = await connect(f.app, first.link); expect(initial.status).toBe(200);
    const one = await initial.json() as SessionCollaborationStatus;
    expect(one.connection?.authorityKind).toBe("lan"); expect(one.canManageInternetAccess).toBe(false);
    const second = authority({ keys: first.keys });
    const moved = await connect(f.app, `${second.origin}/projects/project-a`); expect(moved.status).toBe(200);
    const two = await moved.json() as SessionCollaborationStatus;
    expect(one.connection?.referenceOperationAuthority).toMatch(/^lan-key:[a-f0-9]{64}$/);
    expect(two.connection?.referenceOperationAuthority).toBe(one.connection?.referenceOperationAuthority);
    expect(two.connection?.workspaceId).toBe(one.connection?.workspaceId);
    expect(two.connection?.projectId).toBe(one.connection?.projectId);
    expect(two.connection?.authorityBaseUrl).toBe(`${second.origin}/projects/project-a`);
    expect((await readLocalCollaborationBinding(f.root))?.authority.publicKey).toBe(first.publicKey);
    expect((await readLocalCollaborationBinding(f.root))?.memberToken).toBe(token);
  });
  test("a different key or relayed old-origin signature never receives an existing member credential", async () => {
    const f = await local(); const first = authority(); expect((await connect(f.app, first.link)).status).toBe(200);
    const attacker = authority(); expect((await connect(f.app, `${attacker.origin}/projects/project-a`)).status).toBe(409); expect(attacker.authenticated()).toBe(0);
    const relay = authority({ keys: first.keys, signedOrigin: first.origin });
    expect((await connect(f.app, `${relay.origin}/projects/project-a`)).status).toBe(502); expect(relay.authenticated()).toBe(0);
    expect((await readLocalCollaborationBinding(f.root))?.authority.origin).toBe(first.origin);
  });
  test("an existing legacy binding pins its old trusted origin before considering the new entry", async () => {
    const f = await local(); const first = authority(); expect((await connect(f.app, first.link)).status).toBe(200);
    const legacy = (await readLocalCollaborationBinding(f.root))!; delete legacy.authority.publicKey; await writeLocalCollaborationBinding(f.root, legacy);
    const attacker = authority(); expect((await connect(f.app, attacker.link)).status).toBe(409); expect(attacker.authenticated()).toBe(0);
    expect((await readLocalCollaborationBinding(f.root))?.authority.publicKey).toBe(first.publicKey);
  });
  test("a new workspace cannot connect using a credential-free Project URL", async () => {
    const f = await local(); const first = authority();
    expect((await connect(f.app, `${first.origin}/projects/project-a`)).status).toBe(400);
    expect(first.authenticated()).toBe(0);
    expect(await readLocalCollaborationBinding(f.root)).toBeNull();
  });
  test("cloud placement is explicit and an existing cloud binding cannot move to another origin", async () => {
    const f = await local(); const cloud = authority({ kind: "cloud" });
    const response = await connect(f.app, cloud.link); expect(response.status).toBe(200);
    const status = await response.json() as SessionCollaborationStatus;
    expect(status.connection?.authorityKind).toBe("cloud");
    expect(status.connection?.referenceOperationAuthority).toBe(`cloud-origin:${cloud.origin}`);
    const other = authority({ kind: "cloud" }); expect((await connect(f.app, other.link)).status).toBe(409); expect(other.authenticated()).toBe(0);
  });
  test("attached workspace public-access commands cannot mint or control a local authority", async () => {
    const f = await local(); const remote = authority(); expect((await connect(f.app, remote.link)).status).toBe(200);
    const response = await f.app.request("/api/collaboration/internet-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, provider: { kind: "quick" } }) });
    expect(response.ok).toBe(false);
    expect(await Bun.file(join(f.root, ".pneuma/collaboration/service.json")).exists()).toBe(false);
  });
});
