import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
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
  it("resolves a workspace-relative path against the workspace, not process.cwd()", async () => {
    // A cosmos excerpt is referenced workspace-relative (e.g.
    // `.cosmos-assets/<id>/x.png`). The server process isn't chdir'd into the
    // workspace, so this must anchor to the workspace root regardless of cwd.
    await mkdir(join(workspace, ".cosmos-assets", "n1"), { recursive: true });
    await writeFile(join(workspace, ".cosmos-assets", "n1", "x.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await app.request(`/api/file?path=${encodeURIComponent(".cosmos-assets/n1/x.png")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });
  it("403 for a relative path escaping the workspace", async () => {
    const res = await app.request(`/api/file?path=${encodeURIComponent("../outside.txt")}`);
    expect(res.status).toBe(403);
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

/**
 * Byte ranges are not an optimization here — they decide whether a media
 * element can seek AT ALL.
 *
 * Chromium's `MultibufferDataSource` marks a response streaming when the
 * server neither advertises `Accept-Ranges` nor answers a `Range` request
 * with 206. For a streaming source of FINITE duration `Seekable()` then
 * returns the `allow_seek_to_zero` range `[0, 0]`, and the HTML seek
 * algorithm clamps every `currentTime` write into `seekable` — so every
 * seek silently lands at 0 and the audio replays from the top. Measured on
 * bansho's pre-mixed narration track: asked 111.6s, element read back 0.0s
 * with `readyState 4` and 42s buffered.
 *
 * A missing `content-length` is the same bug by a second route: a chunked
 * body has no known size, which is itself enough to mark the source
 * streaming. `Response(BunFile)` streams by default, so the length must be
 * stated explicitly.
 */
describe("GET /api/file — byte ranges (media seeking)", () => {
  /** 1 KiB of distinguishable bytes: byte i has value i % 251. */
  const BODY = Buffer.from(
    Array.from({ length: 1024 }, (_, i) => i % 251),
  );
  const ask = (headers?: Record<string, string>) =>
    app.request(
      `/api/file?path=${encodeURIComponent("track.mp3")}`,
      headers ? { headers } : undefined,
    );

  beforeEach(async () => {
    await writeFile(join(workspace, "track.mp3"), BODY);
  });

  it("advertises byte ranges on a plain GET", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    // Said on every response, not just partial ones — this is the header a
    // media element reads to decide the resource is seekable at all.
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(BODY),
    );
  });

  it("answers a closed range with 206 and exactly those bytes", async () => {
    const res = await ask({ Range: "bytes=100-200" });
    expect(res.status).toBe(206);
    // HTTP ranges are INCLUSIVE at both ends; `BunFile.slice` is exclusive
    // at the end. 100..200 inclusive is 101 bytes — the classic off-by-one.
    expect(res.headers.get("content-range")).toBe("bytes 100-200/1024");
    expect(res.headers.get("content-length")).toBe("101");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(101);
    expect(body).toEqual(new Uint8Array(BODY.subarray(100, 201)));
  });

  it("answers an open range (bytes=N-) to the end of the file", async () => {
    const res = await ask({ Range: "bytes=1000-" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 1000-1023/1024");
    expect(res.headers.get("content-length")).toBe("24");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(BODY.subarray(1000)),
    );
  });

  it("answers a suffix range (bytes=-N) with the last N bytes", async () => {
    const res = await ask({ Range: "bytes=-24" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 1000-1023/1024");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(BODY.subarray(1000)),
    );
  });

  it("clamps a range that runs past the end", async () => {
    const res = await ask({ Range: "bytes=1000-99999" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 1000-1023/1024");
    expect(res.headers.get("content-length")).toBe("24");
  });

  it("416 when the range starts past the end", async () => {
    const res = await ask({ Range: "bytes=2048-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */1024");
  });

  it("serves the whole file for a range it will not honour", async () => {
    // Multi-range and unparseable units are answered with a plain 200 —
    // legal per RFC 9110, and no media element needs either.
    for (const value of ["bytes=0-10,20-30", "items=0-10", "bytes=abc"]) {
      const res = await ask({ Range: value });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe(String(BODY.length));
    }
  });

  it("keeps the containment guard ahead of range handling", async () => {
    const res = await app.request(
      `/api/file?path=${encodeURIComponent("../outside.mp3")}`,
      { headers: { Range: "bytes=0-10" } },
    );
    expect(res.status).toBe(403);
  });

  /**
   * `app.request()` hands back the Response object; it does NOT prove what
   * reaches a socket. That gap is not theoretical — an earlier draft of
   * this fix set `content-length` and passed here while `Bun.serve` sent
   * the body chunked with no length at all (Hono's `cors()` middleware
   * replaces the `BunFile` body with a generic stream, so the size stops
   * being knowable). The browser is what has to seek, so the wire contract
   * is pinned over a real socket, through the same middleware stack
   * `startServer` mounts.
   */
  it("carries the range contract over a real socket, behind cors", async () => {
    await writeFile(join(workspace, "wire.mp3"), BODY);
    const live = new Hono();
    live.use("/api/*", cors({ origin: "*" }));
    mountFileRoute(live, { workspace });
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: live.fetch });
    try {
      const url = `http://127.0.0.1:${server.port}/api/file?path=${encodeURIComponent("wire.mp3")}`;
      const plain = await fetch(url);
      expect(plain.status).toBe(200);
      expect(plain.headers.get("accept-ranges")).toBe("bytes");

      // The request Chromium actually opens a media resource with. Its
      // 206 + `Content-Range` total is what makes the source non-streaming,
      // which is what makes `seekable` the whole duration instead of [0,0].
      const probe = await fetch(url, { headers: { Range: "bytes=0-" } });
      expect(probe.status).toBe(206);
      expect(probe.headers.get("content-range")).toBe(`bytes 0-${BODY.length - 1}/${BODY.length}`);

      const mid = await fetch(url, { headers: { Range: "bytes=100-200" } });
      expect(mid.status).toBe(206);
      expect(mid.headers.get("content-range")).toBe("bytes 100-200/1024");
      // The bytes on the socket, not the bytes on the Response object.
      // `Response(BunFile.slice(a,b)).body` read as a stream ignores the
      // slice's end and runs to EOF — this asked for 101 and got 924
      // before the handler stopped streaming sub-ranges.
      const body = new Uint8Array(await mid.arrayBuffer());
      expect(body.length).toBe(101);
      expect(body).toEqual(new Uint8Array(BODY.subarray(100, 201)));
      expect(mid.headers.get("content-length")).toBe("101");
    } finally {
      server.stop(true);
    }
  });

  it("serves a shorter range than asked when the ask exceeds the chunk cap", async () => {
    // A server may always answer with less than was requested; the client
    // asks for the rest. This is what keeps one request from holding an
    // arbitrarily large file in memory.
    const capped = new Hono();
    mountFileRoute(capped, { workspace, maxRangeChunk: 64 });
    const res = await capped.request(
      `/api/file?path=${encodeURIComponent("track.mp3")}`,
      { headers: { Range: "bytes=100-900" } },
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-163/1024");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(64);
    expect(body).toEqual(new Uint8Array(BODY.subarray(100, 164)));
  });

  it("streams the whole file for bytes=0- rather than holding it", async () => {
    // Chromium opens every media resource this way. The cap must not turn
    // it into a hundred round trips, so the whole-file case is exempt.
    const capped = new Hono();
    mountFileRoute(capped, { workspace, maxRangeChunk: 64 });
    const res = await capped.request(
      `/api/file?path=${encodeURIComponent("track.mp3")}`,
      { headers: { Range: "bytes=0-" } },
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1023/1024");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(BODY),
    );
  });
});
