import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { mountFileRoute } from "../index.js";

let workspace: string;
let app: Hono;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "pneuma-fileroute-"));
  app = new Hono();
  mountFileRoute(app, { workspace });
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("GET /api/file", () => {
  it("serves a file inside the workspace with a content-type", async () => {
    await writeFile(join(workspace, "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await app.request(`/api/file?path=${encodeURIComponent(join(workspace, "a.png"))}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });
  it("403 for a path escaping the workspace", async () => {
    const res = await app.request(`/api/file?path=${encodeURIComponent(join(workspace, "..", "outside.txt"))}`);
    expect(res.status).toBe(403);
  });
  it("404 for a nonexistent file inside the workspace", async () => {
    const res = await app.request(`/api/file?path=${encodeURIComponent(join(workspace, "nope.png"))}`);
    expect(res.status).toBe(404);
  });
  it("400 when the path is a directory", async () => {
    await mkdir(join(workspace, "sub"), { recursive: true });
    const res = await app.request(`/api/file?path=${encodeURIComponent(join(workspace, "sub"))}`);
    expect(res.status).toBe(400);
  });
  it("400 when path query param is missing", async () => {
    const res = await app.request(`/api/file`);
    expect(res.status).toBe(400);
  });
});
