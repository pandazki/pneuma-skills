/**
 * `runFalJob({ requestId })` attaches to a job fal already accepted.
 *
 * A render whose wait timed out, or whose process was interrupted, may still
 * finish upstream and be billed. Landing it by its recorded `request_id`
 * must never POST the body again (that is a second paid render); it polls
 * and fetches the result at the request URLs fal's own client derives —
 * the app id, without the endpoint's sub-path.
 *
 * Pinned against a real local server (`Bun.serve` on port 0), like the
 * sibling fal-queue suites.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { falRequestBase, runFalJob } from "../fal-queue.mjs";
import { generateSeedanceVideo } from "../seedance-video.mjs";

const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterEach(() => {
  while (servers.length) servers.pop()!.stop(true);
});

interface Seen { method: string; path: string }

function fakeQueue(status: () => unknown) {
  const seen: Seen[] = [];
  const json = (value: unknown, code = 200) =>
    new Response(JSON.stringify(value), { status: code, headers: { "Content-Type": "application/json" } });
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      seen.push({ method: req.method, path });
      if (req.method === "POST") return json({ request_id: "new-job" });
      if (req.method === "PUT") return json({ status: "CANCELLATION_REQUESTED" });
      if (path.endsWith("/status")) return json(status());
      if (path.endsWith("/requests/old-job")) return json({ video: { url: "https://cdn.example/old.mp4" } });
      return new Response("not found", { status: 404 });
    },
  });
  servers.push(server);
  return { url: `http://localhost:${server.port}/bytedance/seedance-2.5/reference-to-video`, seen };
}

describe("falRequestBase — fal's own request URL rule", () => {
  test("the endpoint's sub-path is dropped and the queue host used", () => {
    expect(falRequestBase("https://fal.run/bytedance/seedance-2.5/reference-to-video", "r-1"))
      .toBe("https://queue.fal.run/bytedance/seedance-2.5/requests/r-1");
    expect(falRequestBase("https://queue.fal.run/fal-ai/flux/dev", "r-2")).toBe("https://queue.fal.run/fal-ai/flux/requests/r-2");
  });

  test("a namespaced app keeps its namespace segment", () => {
    expect(falRequestBase("https://fal.run/workflows/acme/pipeline/run", "r-3")).toBe("https://queue.fal.run/workflows/acme/pipeline/requests/r-3");
  });

  test("an id is required", () => {
    expect(() => falRequestBase("https://fal.run/a/b", "")).toThrow("needs a request id");
  });
});

describe("runFalJob — attaching to an accepted job", () => {
  test("polls and fetches the recorded job and never submits again", async () => {
    let polls = 0;
    const fake = fakeQueue(() => (++polls < 2 ? { status: "IN_PROGRESS" } : { status: "COMPLETED" }));
    const job = await runFalJob({ url: fake.url, requestId: "old-job", key: "k", pollMs: 1, retryDelaysMs: [] });
    expect(job.data).toEqual({ video: { url: "https://cdn.example/old.mp4" } });
    expect(job.requestId).toBe("old-job");
    expect(job.attempts).toBe(0);
    expect(fake.seen.some((s) => s.method === "POST")).toBe(false);
    expect(fake.seen.map((s) => s.path)).toEqual([
      "/bytedance/seedance-2.5/requests/old-job/status",
      "/bytedance/seedance-2.5/requests/old-job/status",
      "/bytedance/seedance-2.5/requests/old-job",
    ]);
  });

  test("a job that failed upstream rejects with its id and sends nothing else", async () => {
    const fake = fakeQueue(() => ({ status: "FAILED", error: "content policy" }));
    let caught: (Error & { requestId?: string }) | null = null;
    try {
      await runFalJob({ url: fake.url, requestId: "old-job", key: "k", pollMs: 1, retryDelaysMs: [] });
    } catch (error) {
      caught = error as Error & { requestId?: string };
    }
    expect(caught?.message).toBe("content policy");
    expect(caught?.requestId).toBe("old-job");
    expect(fake.seen.every((s) => s.method === "GET")).toBe(true);
  });

  test("an unknown id (a 404 on status) is reported, not retried as a new job", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("no such request", { status: 404 }) });
    servers.push(server);
    const promise = runFalJob({ url: `http://localhost:${server.port}/a/b/c`, requestId: "gone", key: "k", pollMs: 1, retryDelaysMs: [] });
    await expect(promise).rejects.toThrow("fal.ai status HTTP 404");
  });
});

describe("generateSeedanceVideo over an attached job — how a timed-out render is landed", () => {
  test("the recorded request is polled at fal's URL and its clip written; nothing is submitted", async () => {
    const seen: Seen[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        seen.push({ method: req.method, path });
        if (path.endsWith("/status")) return Response.json({ status: "COMPLETED" });
        return Response.json({ video: { url: "https://cdn.example/late.mp4" } });
      },
    });
    servers.push(server);
    // Every queue.fal.run call goes to the local server instead of fal.
    const local: typeof fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      return fetch(`http://localhost:${server.port}${url.pathname}${url.search}`, init);
    }) as typeof fetch;
    const dir = mkdtempSync(join(tmpdir(), "seedance-attach-"));
    try {
      const output = join(dir, "take.mp4");
      const result = await generateSeedanceVideo(
        { prompt: "a recorded prompt", output, apiKey: "k", endpoint: "text", duration: "5" },
        {
          runJob: (job: Parameters<typeof runFalJob>[0]) => runFalJob({ ...job, requestId: "late-job", fetchImpl: local, pollMs: 1 }),
          download: async () => Buffer.from("late clip"),
          remuxFile: () => true,
          probe: () => ({ width: 854, height: 480, duration: 5 }),
        },
      );
      expect(result.request_id).toBe("late-job");
      expect(readFileSync(output, "utf-8")).toBe("late clip");
      expect(seen.some((s) => s.method === "POST")).toBe(false);
      expect(seen.map((s) => s.path)).toEqual(["/bytedance/seedance-2.5/requests/late-job/status", "/bytedance/seedance-2.5/requests/late-job"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
