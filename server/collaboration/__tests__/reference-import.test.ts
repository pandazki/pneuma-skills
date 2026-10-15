import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mountSessionReferenceImportRoutes } from "../reference-import.js";
import { writeLocalCollaborationBinding } from "../local-state.js";
import type { CollaborationResolvedReference } from "../../../core/types/collaboration-reference.js";
import type { CollaborationReferenceImportReceipt } from "../../../core/types/collaboration-reference-import.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });
const digest = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pneuma-reference-import-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const stateDir = join(root, ".pneuma", "sessions", "local");
  mkdirSync(workspace);
  const blobs = new Map([
    ["site/nested/index.html", new TextEncoder().encode('<!doctype html><h1 id="title">Pinned copy</h1>')],
    ["site/data.json", new TextEncoder().encode('{"public":true}')],
    ["site/pixel.png", new Uint8Array([0, 1, 255, 2])],
  ]);
  const compatibility = { coreVersion: "4.0.0", modeVersion: "1.9.0", viewerHash: "a".repeat(64), publicationSchema: "public-v1" };
  const resolved: CollaborationResolvedReference = {
    reference: { id: "ref-a", ownerId: "ada", destinationWorkspaceId: "local", label: "Pinned public example", compatibility,
      source: { projectId: "project", workspaceId: "bo-workspace", roomId: "room", publicationRevision: 7, address: { contentSet: "site", page: "nested/index.html", selector: "#title" } }, createdAt: 1, updatedAt: 1 },
    compatibility, room: { id: "room", title: "Example", mode: "external", ownerId: "bo", workspaceId: "bo-workspace", enabled: true, revision: 7, page: "site/nested/index.html", updatedAt: 1 },
    publication: { revision: 7, files: [...blobs].map(([path, bytes]) => ({ path, size: bytes.length, hash: digest(bytes), type: path.endsWith(".html") ? "text/html; charset=utf-8" : path.endsWith(".png") ? "image/png" : "application/json; charset=utf-8" })) },
    pageUrl: "/projects/project/rooms/room/revisions/7/read-only-grant/site/nested/index.html",
  };
  const calls: { path: string; token: string | null; raw: string | null }[] = [];
  let unavailable = false;
  let corrupt = false;
  let role = "writer";
  let failAsset = "";
  let oversize = false;
  let interrupted = false;
  let pause: (() => Promise<void>) | null = null;
  const authority = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    calls.push({ path, token: request.headers.get("Authorization"), raw: request.headers.get("X-Pneuma-Publication-Bytes") });
    if (path === "/projects/project/api/state") return Response.json({ project: { id: "project" }, self: { id: "ada", kind: "member", role }, workspaces: [{ id: "local", ownerId: "ada" }] });
    if (path === "/projects/project/api/references/ref-a/resolve") return unavailable ? Response.json({ error: "Source unavailable" }, { status: 423 }) : Response.json(resolved);
    const prefix = "/projects/project/rooms/room/revisions/7/read-only-grant/";
    if (path.startsWith(prefix)) {
      if (path.endsWith(failAsset) && failAsset) return Response.json({ error: "Sharing disabled" }, { status: 403 });
      const bytes = blobs.get(decodeURIComponent(path.slice(prefix.length)));
      if (!bytes) return new Response("missing", { status: 404 });
      if (path.endsWith("pixel.png") && pause) await pause();
      if (interrupted) return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 1)); controller.error(new Error("Connection lost")); } }));
      if (oversize) return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.enqueue(new Uint8Array([1])); controller.close(); } }));
      const content = corrupt ? bytes.map((value, index) => index === 0 ? value ^ 1 : value) : bytes;
      return new Response(content, { headers: { "Content-Type": "application/octet-stream" } });
    }
    return new Response("missing", { status: 404 });
  }, error: () => new Response("Interrupted source transfer", { status: 502 }) });
  cleanup.push(() => { authority.stop(true); });
  await writeLocalCollaborationBinding(root, { version: 1, projectId: "project", workspace: { id: "local", projectId: "project", ownerId: "ada", name: "Local", placement: "local" }, authority: { kind: "lan", origin: authority.url.origin }, memberToken: "private-member-token", memberName: "Ada" });
  const mount = () => { const app = new Hono(); mountSessionReferenceImportRoutes(app, { projectRoot: root, workspace, stateDir }); return app; };
  const post = (app: Hono, body: unknown = { requestId: "request-a" }) => app.request("/api/collaboration/references/ref-a/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { root, workspace, stateDir, resolved, calls, blobs, mount, post, unavailable: () => { unavailable = true; }, corrupt: (value = true) => { corrupt = value; }, role: (value: string) => { role = value; }, fail: (path: string) => { failAsset = path; }, oversize: () => { oversize = true; }, interrupt: () => { interrupted = true; },
    pauseLast: () => {
      let entered!: () => void; let release!: () => void;
      const waiting = new Promise<void>((resolve) => { entered = resolve; });
      const resumed = new Promise<void>((resolve) => { release = resolve; });
      pause = async () => { entered(); await resumed; };
      return { waiting, release };
    },
  };
}

describe("explicit private Session reference import", () => {
  test("copies exact pinned bytes and attribution; completed retry survives source revocation without a second copy", async () => {
    const f = await fixture(); const app = f.mount();
    const response = await f.post(app);
    expect(response.status).toBe(200);
    const receipt = await response.json() as CollaborationReferenceImportReceipt;
    expect(receipt.kind).toBe("local-copy");
    expect(receipt.path).toBe("imports/ref-a-r7");
    expect(receipt.source).toEqual(f.resolved.reference.source);
    expect(receipt.paths).toContain(receipt.attributionPath);
    for (const [path, bytes] of f.blobs) expect(new Uint8Array(await Bun.file(join(f.workspace, receipt.path, path)).arrayBuffer())).toEqual(bytes);
    expect(await Bun.file(join(f.workspace, receipt.attributionPath)).json()).toEqual(receipt);
    expect(f.calls.filter((call) => call.path.includes("/api/")).every((call) => call.token === "Bearer private-member-token")).toBe(true);
    expect(f.calls.filter((call) => !call.path.includes("/api/")).every((call) => call.token === null && call.raw === "1")).toBe(true);
    writeFileSync(join(f.workspace, receipt.path, "site/nested/index.html"), "My local edits remain mine");
    f.unavailable(); const count = f.calls.length;
    expect(await (await f.post(f.mount())).json()).toEqual(receipt);
    expect(await Bun.file(join(f.workspace, receipt.path, "site/nested/index.html")).text()).toBe("My local edits remain mine");
    expect(f.calls).toHaveLength(count);
    expect((await f.post(app, { requestId: "new-request" })).status).toBe(423);
    expect(readdirSync(join(f.workspace, "imports"))).toEqual(["ref-a-r7"]);
  });

  test("integrity mismatch and mid-stream source revocation leave no partial copied directory", async () => {
    const f = await fixture(); f.corrupt();
    expect((await f.post(f.mount())).status).toBe(502);
    expect(readdirSync(join(f.workspace, "imports"))).toEqual([]);
    const g = await fixture(); g.fail("data.json");
    expect((await g.post(g.mount())).status).toBe(403);
    expect(readdirSync(join(g.workspace, "imports"))).toEqual([]);
  });

  test("a new request for the same completed revision recovers one copy and remains retryable offline", async () => {
    const f = await fixture(); const app = f.mount();
    const first = await (await f.post(app)).json() as CollaborationReferenceImportReceipt;
    const again = await f.post(app, { requestId: "request-b" });
    expect(again.status).toBe(200);
    const second = await again.json() as CollaborationReferenceImportReceipt;
    expect(second).toEqual({ ...first, requestId: "request-b" });
    expect(readdirSync(join(f.workspace, "imports"))).toEqual(["ref-a-r7"]);
    f.unavailable();
    expect(await (await f.post(f.mount(), { requestId: "request-b" })).json()).toEqual(second);
  });

  test("copies stay hidden until all bytes verify, concurrent imports conflict, and an interrupted operation retries once", async () => {
    const f = await fixture(); const gate = f.pauseLast(); const app = f.mount();
    const pending = f.post(app);
    await gate.waiting;
    expect(existsSync(join(f.workspace, "imports", "ref-a-r7"))).toBe(false);
    expect(readdirSync(join(f.workspace, "imports")).every((path) => path.startsWith(".import-"))).toBe(true);
    expect((await f.post(f.mount(), { requestId: "competing" })).status).toBe(409);
    gate.release();
    expect((await pending).status).toBe(200);
    expect(readdirSync(join(f.workspace, "imports"))).toEqual(["ref-a-r7"]);
    const g = await fixture(); g.corrupt(); const gApp = g.mount();
    expect((await g.post(gApp)).status).toBe(502);
    g.corrupt(false);
    expect((await g.post(g.mount())).status).toBe(200);
    expect(readdirSync(join(g.workspace, "imports"))).toEqual(["ref-a-r7"]);
  });

  test("bounded chunked bodies and interrupted transfers fail without exposing a partial copy", async () => {
    for (const behavior of ["oversize", "interrupt"] as const) {
      const f = await fixture(); f[behavior]();
      expect((await f.post(f.mount())).status).toBe(502);
      expect(readdirSync(join(f.workspace, "imports"))).toEqual([]);
    }
  });

  test("rejects other destination ownership, readers, traversal, private paths, case collisions and oversize manifests before fetching resources", async () => {
    for (const mutate of [
      (f: Awaited<ReturnType<typeof fixture>>) => { f.resolved.reference.destinationWorkspaceId = "other"; },
      (f: Awaited<ReturnType<typeof fixture>>) => { f.role("reader"); },
      (f: Awaited<ReturnType<typeof fixture>>) => { f.resolved.publication.files[0]!.path = "../outside.html"; },
      (f: Awaited<ReturnType<typeof fixture>>) => { f.resolved.publication.files[0]!.path = "history.json"; },
      (f: Awaited<ReturnType<typeof fixture>>) => { f.resolved.publication.files.push({ ...f.resolved.publication.files[0]!, path: "SITE/NESTED/INDEX.HTML" }); },
      (f: Awaited<ReturnType<typeof fixture>>) => { f.resolved.publication.files[0]!.size = 4 * 1024 * 1024 + 1; },
      (f: Awaited<ReturnType<typeof fixture>>) => { f.resolved.pageUrl = "http://attacker.invalid/public/index.html"; },
    ]) {
      const f = await fixture(); mutate(f);
      expect((await f.post(f.mount())).status).toBeGreaterThanOrEqual(400);
      expect(f.calls.filter((call) => !call.path.includes("/api/"))).toHaveLength(0);
      expect(existsSync(join(f.workspace, "imports", "ref-a-r7"))).toBe(false);
    }
  });

  test("rejects caller destinations, existing user files and escaping symlinks; retry cannot reuse an ID for a different reference", async () => {
    const f = await fixture(); const app = f.mount();
    expect((await f.post(app, { requestId: "bad", destinationWorkspaceId: "other", path: "../outside" })).status).toBe(400);
    mkdirSync(join(f.workspace, "imports", "ref-a-r7"), { recursive: true });
    writeFileSync(join(f.workspace, "imports", "ref-a-r7", "user.txt"), "Do not overwrite");
    expect((await f.post(app)).status).toBe(409);
    expect(await Bun.file(join(f.workspace, "imports", "ref-a-r7", "user.txt")).text()).toBe("Do not overwrite");
    const g = await fixture(); const outside = join(g.root, "outside"); mkdirSync(outside); symlinkSync(outside, join(g.workspace, "imports"));
    expect((await g.post(g.mount())).status).toBe(400);
    expect(readdirSync(outside)).toEqual([]);
    const h = await fixture(); const hApp = h.mount(); expect((await h.post(hApp)).status).toBe(200);
    expect((await hApp.request("/api/collaboration/references/ref-b/import", { method: "POST", body: JSON.stringify({ requestId: "request-a" }) })).status).toBe(409);
  });
});
