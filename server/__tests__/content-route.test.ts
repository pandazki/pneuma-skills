import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { mountContentRoute } from "../index.js";

let root: string;
let app: Hono;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pneuma-content-"));
  app = new Hono();
  // Same shape as startServer: the CORS middleware sits in front of the
  // route and re-wraps every response to stamp its headers. A body that is
  // only correct until something calls `new Response(res.body, …)` is not
  // correct in production.
  app.use("/content/*", cors({ origin: "*" }));
  mountContentRoute(app, { contentRoot: root });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Every viewer asset is served from here, and several independent consumers
 * fetch the SAME url during one session start — clipcraft alone has the
 * playback engine's audio decode, the waveform, the frame strip, the 3D view
 * and the preview. Without a validator none of them can reuse what the
 * browser already holds, so each one re-downloads the whole file: measured at
 * 42.67 MB served for 6.5 MB of distinct media on a single load.
 */
describe("GET /content/* — cache validators", () => {
  it("serves a strong ETag, Last-Modified and no-cache on a full response", async () => {
    await writeFile(join(root, "a.mp4"), Buffer.alloc(1024, 7));
    const res = await app.request("/content/a.mp4");
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toBeTruthy();
    // Strong, not weak: a `W/` validator cannot validate a Range request,
    // and media is fetched almost entirely by range.
    expect(etag!.startsWith("W/")).toBe(false);
    expect(etag!.startsWith('"')).toBe(true);
    expect(res.headers.get("last-modified")).toBeTruthy();
    // Revalidate rather than go stale — an agent can regenerate an asset
    // at any moment.
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    await writeFile(join(root, "a.mp4"), Buffer.alloc(1024, 7));
    const first = await app.request("/content/a.mp4");
    const etag = first.headers.get("etag")!;

    const second = await app.request("/content/a.mp4", {
      headers: { "if-none-match": etag },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("honours a list of tags and the * wildcard", async () => {
    await writeFile(join(root, "a.mp4"), Buffer.alloc(64, 1));
    const etag = (await app.request("/content/a.mp4")).headers.get("etag")!;
    const list = await app.request("/content/a.mp4", {
      headers: { "if-none-match": `"nope", ${etag}` },
    });
    expect(list.status).toBe(304);
    const star = await app.request("/content/a.mp4", {
      headers: { "if-none-match": "*" },
    });
    expect(star.status).toBe(304);
  });

  it("re-sends the body once the file changes — regenerated assets are never stale", async () => {
    const p = join(root, "a.mp4");
    await writeFile(p, Buffer.alloc(1024, 7));
    const etag = (await app.request("/content/a.mp4")).headers.get("etag")!;

    // An agent regenerates the asset. Same length on purpose: mtime alone
    // has to be enough to invalidate, or a same-size regeneration would be
    // served stale forever.
    await writeFile(p, Buffer.alloc(1024, 9));
    const future = new Date(Date.now() + 4000);
    await utimes(p, future, future);

    const res = await app.request("/content/a.mp4", {
      headers: { "if-none-match": etag },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).not.toBe(etag);
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(9);
  });

  it("carries the validators on a partial response too", async () => {
    await writeFile(join(root, "a.mp4"), Buffer.alloc(1024, 7));
    const res = await app.request("/content/a.mp4", {
      headers: { range: "bytes=0-99" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-99/1024");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  it("a partial response carries exactly the requested bytes", async () => {
    // Bun 1.4.0 regression: a sliced Bun.file() is the right size as a Blob
    // body, but `.stream()` on that slice yields the WHOLE file — and the
    // CORS middleware's re-wrap reads the body as a stream. Chrome then sees
    // a 206 whose body contradicts Content-Range and refuses the clip
    // (MediaError 4): every plotwise stage went black, every clipcraft seek
    // failed. The route must not depend on blob slicing surviving a wrap.
    const bytes = Buffer.alloc(4096, 0);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    await writeFile(join(root, "a.mp4"), bytes);

    const middle = await app.request("/content/a.mp4", {
      headers: { range: "bytes=1000-1499" },
    });
    expect(middle.status).toBe(206);
    expect(middle.headers.get("content-range")).toBe("bytes 1000-1499/4096");
    const body = new Uint8Array(await middle.arrayBuffer());
    expect(body.length).toBe(500);
    expect(body[0]).toBe(1000 % 251);
    expect(body[499]).toBe(1499 % 251);

    // Open-ended, the shape a browser sends on every seek.
    const tail = await app.request("/content/a.mp4", {
      headers: { range: "bytes=4000-" },
    });
    expect(tail.status).toBe(206);
    expect(tail.headers.get("content-range")).toBe("bytes 4000-4095/4096");
    expect((await tail.arrayBuffer()).byteLength).toBe(96);
  });

  it("If-None-Match wins over Range, per RFC 9110 §13.2.2", async () => {
    await writeFile(join(root, "a.mp4"), Buffer.alloc(1024, 7));
    const etag = (await app.request("/content/a.mp4")).headers.get("etag")!;
    const res = await app.request("/content/a.mp4", {
      headers: { "if-none-match": etag, range: "bytes=0-99" },
    });
    expect(res.status).toBe(304);
  });
});

describe("GET /content/* — unchanged behaviour", () => {
  it("404s a missing file and a directory", async () => {
    expect((await app.request("/content/nope.txt")).status).toBe(404);
    await mkdir(join(root, "dir"));
    expect((await app.request("/content/dir")).status).toBe(404);
  });

  it("403s a path escaping the content root", async () => {
    // Percent-encoded, so Hono's router does not normalize the traversal
    // away before the handler's own guard gets to see it.
    const res = await app.request("/content/%2e%2e%2foutside.txt");
    expect(res.status).toBe(403);
  });

  it("serves a decoded path with spaces", async () => {
    await writeFile(join(root, "a b.txt"), "hi");
    const res = await app.request(`/content/${encodeURIComponent("a b.txt")}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });
});
