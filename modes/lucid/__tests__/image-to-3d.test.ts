/**
 * image-to-3d.mjs — the job file that stands between the loop and a paid
 * API with no idempotency key. These cases are ported from the upstream
 * skill this script comes from (`achimala/dream-loop`, MIT,
 * `scripts/fal-batch.test.mjs`) and extended for this repository's shared
 * fal transport.
 *
 * What they pin, in one sentence each: money is never spent twice, money
 * is never spent on something a local check could have refused, and a job
 * that has left for fal is always recoverable from the file on disk. Every
 * call goes through an injected `fetchFn`; nothing here touches fal.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAL_QUEUE_URL, runBatch } from "../skill/scripts/image-to-3d.mjs";
import type { FalFetch, FalFetchInit } from "../skill/scripts/image-to-3d.mjs";

const H3 = "tripo3d/h3.1/image-to-3d";
const SUBMIT_URL = `https://queue.fal.run/${H3}`;

type JobRecord = Record<string, any>;
interface Plan {
  jobs: JobRecord[];
}

/** A real 1x1 PNG. Only local mocked fetches are used in these tests. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=",
  "base64",
);

const workspaces: string[] = [];
afterEach(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(count = 2) {
  const dir = mkdtempSync(join(tmpdir(), "lucid-image-to-3d-"));
  workspaces.push(dir);
  const filename = join(dir, "jobs.json");
  writeFileSync(join(dir, "input.png"), TINY_PNG);
  const plan: Plan = {
    jobs: Array.from({ length: count }, (_, i) => ({
      id: `asset-${i}`,
      endpoint: H3,
      image: "input.png",
      output: `models/${i}.glb`,
    })),
  };
  writeFileSync(filename, JSON.stringify(plan));
  return {
    dir,
    filename,
    read: (): Plan => JSON.parse(readFileSync(filename, "utf8")),
    write: (data: Plan) => writeFileSync(filename, JSON.stringify(data)),
    output: (i: number) => join(dir, "models", `${i}.glb`),
  };
}

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

/** A complete, minimal GLB 2.0 container. */
function glb(): Buffer<ArrayBuffer> {
  const raw = JSON.stringify({ asset: { version: "2.0" } });
  const body = Buffer.from(raw.padEnd(Math.ceil(raw.length / 4) * 4, " "));
  const bytes = Buffer.alloc(20 + body.length);
  bytes.write("glTF");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(body.length, 12);
  bytes.write("JSON", 16);
  body.copy(bytes, 20);
  return bytes;
}

/** A submitted job, as the file looks after fal accepted it. */
function accepted(job: JobRecord, id = "accepted"): JobRecord {
  return Object.assign(job, {
    request_id: id,
    status_url: "https://queue.fal.run/returned/status",
    response_url: "https://queue.fal.run/returned/result",
  });
}

describe("image-to-3d.mjs", () => {
  test("resolves the shared fal transport from the repository copy", () => {
    const path = fileURLToPath(FAL_QUEUE_URL);
    expect(path.endsWith(join("modes", "_shared", "scripts", "fal-queue.mjs"))).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  test("submits concurrently, keeps the returned URLs, resumes without spending again, and collects GLBs", async () => {
    const f = fixture();
    let active = 0;
    let peak = 0;
    let posts = 0;
    const calls: Array<{ url: string; init: FalFetchInit }> = [];

    const fetchFn: FalFetch = async (url, init) => {
      calls.push({ url, init });
      if (init.method === "POST") {
        const i = posts++;
        active++;
        peak = Math.max(peak, active);
        expect(url).toBe(SUBMIT_URL);
        expect(JSON.parse(init.body ?? "{}").image_url).toMatch(/^data:image\/png;base64,.+/);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return json({
          request_id: `r${i}`,
          status: "IN_QUEUE",
          status_url: `https://queue.fal.run/returned/r${i}/status`,
          response_url: `https://queue.fal.run/returned/r${i}/result`,
        });
      }
      if (url.endsWith("/status")) return json({ status: "COMPLETED" });
      if (url.endsWith("/result")) return json({ model_mesh: { url: "https://files.example/model.glb" } });
      expect(url).toBe("https://files.example/model.glb");
      return new Response(glb());
    };

    const config = { key: "test-only-key", fetchFn };
    await runBatch("submit", f.filename, config);
    expect(peak).toBe(2);
    expect(posts).toBe(2);
    expect(f.read().jobs.map((job) => job.status_url)).toEqual([
      "https://queue.fal.run/returned/r0/status",
      "https://queue.fal.run/returned/r1/status",
    ]);
    expect(f.read().jobs.every((job) => job.state === "IN_QUEUE")).toBe(true);

    // The file already carries every request id: nothing may leave again.
    await runBatch("submit", f.filename, config);
    expect(posts).toBe(2);
    expect((await runBatch("check", f.filename, { key: "" })).map((row) => row.state)).toEqual([
      "already-submitted",
      "already-submitted",
    ]);

    const rows = await runBatch("collect", f.filename, config);
    expect(rows.every((row) => row.state === "downloaded")).toBe(true);
    expect(rows[0]?.bytes).toBe(glb().length);
    expect(readFileSync(f.output(0))).toEqual(glb());
    expect(readFileSync(f.output(1))).toEqual(glb());

    // The credential belongs to the queue host and nowhere else.
    for (const call of calls) {
      if (call.url.startsWith("https://queue.fal.run/")) expect(call.init.headers?.Authorization).toBe("Key test-only-key");
      else expect(call.init.headers).toBeUndefined();
    }
  });

  test("invalid inputs never reach the paid submission API", async () => {
    const f = fixture(1);
    writeFileSync(join(f.dir, "input.png"), "");
    let called = false;
    const fetchFn: FalFetch = async () => {
      called = true;
      throw new Error("the paid API must not be called");
    };

    expect((await runBatch("check", f.filename, { key: "" }))[0]).toMatchObject({ state: "invalid-image" });
    const rows = await runBatch("submit", f.filename, { key: "test-only-key", fetchFn });
    expect(called).toBe(false);
    expect(rows[0]?.error).toContain("nonempty PNG");
    expect(rows[0]?.error_stage).toBe("submit");
    // Nothing left for fal, so nothing to recover: the job stays submittable.
    expect(f.read().jobs[0]?.state).toBeUndefined();
  });

  test("a submission that lost its answer stays uncertain and is never retried automatically", async () => {
    const f = fixture(1);
    let calls = 0;
    const config = {
      key: "test-only-key",
      fetchFn: (async () => {
        calls++;
        throw new Error("network timeout");
      }) as FalFetch,
    };

    await runBatch("submit", f.filename, config);
    expect(f.read().jobs[0]?.state).toBe("submission-uncertain");
    expect(f.read().jobs[0]?.submitted_at).toBeTruthy();

    await runBatch("submit", f.filename, config);
    expect(calls).toBe(1);
    expect((await runBatch("check", f.filename, { key: "" }))[0]?.state).toBe("submission-uncertain");
  });

  test("a connection that never opened is not-submitted, and the next submit sends it", async () => {
    const f = fixture(1);
    const rows = await runBatch("submit", f.filename, {
      key: "test-only-key",
      fetchFn: (async () => {
        throw new Error("fetch failed", { cause: { code: "ENOTFOUND" } });
      }) as FalFetch,
    });
    expect(rows[0]?.state).toBe("not-submitted");
    expect(rows[0]?.connection_error).toBe("ENOTFOUND");

    let called = false;
    await runBatch("submit", f.filename, {
      key: "test-only-key",
      fetchFn: (async () => {
        called = true;
        return json({
          request_id: "retried",
          status_url: "https://queue.fal.run/status",
          response_url: "https://queue.fal.run/result",
        });
      }) as FalFetch,
    });
    expect(called).toBe(true);
    expect(f.read().jobs[0]?.request_id).toBe("retried");
  });

  test("a 422 is rejected, its detail is sanitized, and the corrected job submits normally", async () => {
    const f = fixture(1);
    const key = "test-only-secret-key";
    const rows = await runBatch("submit", f.filename, {
      key,
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            detail: [
              {
                loc: ["body", "texture_size"],
                msg: `Invalid size ${key} data:image/png;base64,AAAA https://files.example/leak.png`,
                input: "DO NOT SAVE THIS IMAGE",
              },
            ],
          }),
          { status: 422 },
        )) as FalFetch,
    });

    expect(rows[0]?.state).toBe("rejected");
    expect(rows[0]?.error_stage).toBe("submit");
    expect(rows[0]?.error).toBe("fal.ai HTTP 422");
    expect(rows[0]?.error_detail).toContain("body.texture_size: Invalid size");
    const saved = readFileSync(f.filename, "utf8");
    for (const secret of [key, "DO NOT SAVE THIS IMAGE", "base64,AAAA", "files.example"]) {
      expect(saved.includes(secret)).toBe(false);
    }

    let calls = 0;
    await runBatch("submit", f.filename, {
      key,
      fetchFn: (async () => {
        calls++;
        return json({
          request_id: "fixed",
          status_url: "https://queue.fal.run/status",
          response_url: "https://queue.fal.run/result",
        });
      }) as FalFetch,
    });
    expect(calls).toBe(1);
    expect(f.read().jobs[0]?.request_id).toBe("fixed");
  });

  test("a partial acceptance keeps its id, and a record with queue URLs but no id is refused", async () => {
    const f = fixture(1);
    const rows = await runBatch("submit", f.filename, {
      key: "test-only-key",
      fetchFn: (async () => json({ request_id: "partial-accepted" })) as FalFetch,
    });
    expect(rows[0]?.request_id).toBe("partial-accepted");
    expect(rows[0]?.state).toBe("submission-uncertain");

    // An id with no queue URLs cannot be collected either, and says why
    // instead of calling an undefined URL.
    const uncollectable = await runBatch("collect", f.filename, {
      key: "test-only-key",
      fetchFn: (async () => {
        throw new Error("the queue must not be called for a record with no URLs");
      }) as FalFetch,
    });
    expect(uncollectable[0]?.error).toContain("Recover the original record");
    expect(uncollectable[0]?.error_stage).toBe("collect");

    // Losing the id does not unlock a resubmission: the queue URLs prove a
    // job exists somewhere, and only the original record can find it.
    const data = f.read();
    delete data.jobs[0]!.request_id;
    Object.assign(data.jobs[0]!, { state: "IN_QUEUE", response_url: "https://queue.fal.run/result" });
    f.write(data);

    expect((await runBatch("check", f.filename, { key: "" }))[0]).toMatchObject({ state: "missing-request-id" });
    let called = false;
    const refused = await runBatch("submit", f.filename, {
      key: "test-only-key",
      fetchFn: (async () => {
        called = true;
        throw new Error("the paid API must not be called");
      }) as FalFetch,
    });
    expect(called).toBe(false);
    expect(refused[0]?.error).toContain("Recover the original record");
  });

  test("check catches the Trellis suffix and mixed model options before any paid request, and never writes", async () => {
    const f = fixture(1);
    let calls = 0;
    const config = {
      key: "",
      fetchFn: (async () => {
        calls++;
        throw new Error("check must stay offline");
      }) as FalFetch,
    };

    const withEndpoint = (endpoint: string, input?: Record<string, unknown>) => {
      const data = f.read();
      data.jobs[0]!.endpoint = endpoint;
      if (input) data.jobs[0]!.input = input;
      f.write(data);
    };

    withEndpoint("fal-ai/trellis/image-to-3d");
    await expect(runBatch("check", f.filename, config)).rejects.toThrow(/no \/image-to-3d suffix/);

    withEndpoint("fal-ai/trellis", { face_limit: 200000 });
    await expect(runBatch("check", f.filename, config)).rejects.toThrow(/H3\.1 option/);

    withEndpoint("fal-ai/trellis", { mesh_simplify: 0.95, texture_size: 999 });
    await expect(runBatch("check", f.filename, config)).rejects.toThrow(/texture_size must be 512, 1024, or 2048/);

    withEndpoint(H3, { mesh_simplify: 0.95 });
    await expect(runBatch("check", f.filename, config)).rejects.toThrow(/Trellis option/);

    withEndpoint(H3, { texture: true, pbr: true, image_url: "data:image/png;base64,AAAA" });
    await expect(runBatch("check", f.filename, config)).rejects.toThrow(/the helper supplies image_url/);

    withEndpoint("fal-ai/trellis", { mesh_simplify: 0.95, texture_size: 1024 });
    const before = readFileSync(f.filename, "utf8");
    expect((await runBatch("check", f.filename, config))[0]?.state).toBe("ready");
    expect(calls).toBe(0);
    expect(readFileSync(f.filename, "utf8")).toBe(before);
  });

  test("a missing image waits instead of failing, so submit can run as cut-outs land", async () => {
    const f = fixture(2);
    const data = f.read();
    data.jobs[1]!.image = "not-yet.png";
    f.write(data);

    expect((await runBatch("check", f.filename, { key: "" })).map((row) => row.state)).toEqual([
      "ready",
      "waiting-for-image",
    ]);
    let posts = 0;
    const rows = await runBatch("submit", f.filename, {
      key: "test-only-key",
      fetchFn: (async () => {
        posts++;
        return json({
          request_id: `r${posts}`,
          status_url: "https://queue.fal.run/status",
          response_url: "https://queue.fal.run/result",
        });
      }) as FalFetch,
    });
    expect(posts).toBe(1);
    expect(rows.map((row) => row.state)).toEqual(["IN_QUEUE", "waiting-for-image"]);
    expect(rows.some((row) => row.error)).toBe(false);
  });

  test("the lock file keeps two runs off one job file", async () => {
    const f = fixture(1);
    let posts = 0;
    const fetchFn: FalFetch = async (_url, init) => {
      if (init.method === "POST") {
        posts++;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return json({
        request_id: "only-once",
        status_url: "https://queue.fal.run/status",
        response_url: "https://queue.fal.run/result",
      });
    };

    const config = { key: "test-only-key", fetchFn };
    const settled = await Promise.allSettled([
      runBatch("submit", f.filename, config),
      runBatch("submit", f.filename, config),
    ]);

    expect(settled.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    const rejection = settled[1] as PromiseRejectedResult;
    expect(String(rejection.reason?.message)).toContain("another run is using this job file");
    expect(posts).toBe(1);
    expect(existsSync(`${f.filename}.lock`)).toBe(false);

    // A lock left behind by a dead run refuses the next one out loud.
    writeFileSync(`${f.filename}.lock`, "{}");
    await expect(runBatch("collect", f.filename, config)).rejects.toThrow(/another run is using this job file/);
    rmSync(`${f.filename}.lock`);
  });

  test("a truncated GLB is a download-error and leaves no output behind", async () => {
    const f = fixture(1);
    const data = f.read();
    accepted(data.jobs[0]!);
    f.write(data);

    const rows = await runBatch("collect", f.filename, {
      key: "test-only-key",
      fetchFn: (async (url) => {
        if (url.endsWith("/status")) return json({ status: "COMPLETED" });
        if (url.endsWith("/result")) return json({ model_urls: { glb: { url: "https://files.example/model.glb" } } });
        return new Response(glb().subarray(0, 24));
      }) as FalFetch,
    });

    expect(rows[0]?.state).toBe("download-error");
    expect(rows[0]?.error_stage).toBe("download");
    expect(rows[0]?.error).toContain("complete GLB 2.0");
    expect(rows[0]?.request_id).toBe("accepted");
    expect(existsSync(f.output(0))).toBe(false);
    expect(existsSync(`${f.output(0)}.part`)).toBe(false);
  });

  test("collect reaches an accepted job even when another job's inputs would fail the plan check", async () => {
    const f = fixture(2);
    const data = f.read();
    accepted(data.jobs[0]!);
    // Never submitted, and it would never pass `check`. An accepted job must
    // not become uncollectable because a sibling's plan is still wrong.
    Object.assign(data.jobs[1]!, { endpoint: "fal-ai/trellis", input: { face_limit: 200000 } });
    f.write(data);

    await expect(runBatch("check", f.filename, { key: "" })).rejects.toThrow(/H3\.1 option/);

    let posts = 0;
    const rows = await runBatch("collect", f.filename, {
      key: "test-only-key",
      fetchFn: (async (url, init) => {
        if (init.method === "POST") posts++;
        if (url.endsWith("/status")) return json({ status: "COMPLETED" });
        if (url.endsWith("/result")) return json({ model_mesh: { url: "https://files.example/model.glb" } });
        return new Response(glb());
      }) as FalFetch,
    });
    expect(rows[0]?.state).toBe("downloaded");
    expect(rows[1]?.state).toBeUndefined();
    expect(posts).toBe(0);

    // Submitting, on the other hand, still refuses the plan until it is fixed.
    await expect(
      runBatch("submit", f.filename, {
        key: "test-only-key",
        fetchFn: (async () => {
          throw new Error("the paid API must not be called");
        }) as FalFetch,
      }),
    ).rejects.toThrow(/H3\.1 option/);
  });

  test("a failed download is retried by the next collect, never by a new submission", async () => {
    const f = fixture(1);
    const data = f.read();
    accepted(data.jobs[0]!);
    f.write(data);

    let downloads = 0;
    let posts = 0;
    const fetchFn: FalFetch = async (url, init) => {
      if (init.method === "POST") posts++;
      if (url.endsWith("/status")) return json({ status: "COMPLETED" });
      if (url.endsWith("/result")) return json({ model_urls: { glb: { url: "https://files.example/model.glb" } } });
      downloads++;
      return downloads <= 3 ? new Response("gone", { status: 404 }) : new Response(glb());
    };
    // The back-off is injected: a test should not spend the transport's seconds.
    const config = { key: "test-only-key", fetchFn, sleep: async () => {} };

    const failed = await runBatch("collect", f.filename, config);
    expect(failed[0]?.state).toBe("download-error");
    expect(failed[0]?.error).toBe("model download HTTP 404");
    expect(downloads).toBeGreaterThan(1); // the shared transport retries a download
    expect(existsSync(f.output(0))).toBe(false);

    // An accepted model is fetched again, not generated again.
    const recovered = await runBatch("collect", f.filename, config);
    expect(recovered[0]?.state).toBe("downloaded");
    expect(posts).toBe(0);
    expect(readFileSync(f.output(0))).toEqual(glb());
  });

  test("a 404 result leaves the job unresolved and writes no error page to disk", async () => {
    const f = fixture(1);
    const data = f.read();
    accepted(data.jobs[0]!);
    f.write(data);

    const rows = await runBatch("collect", f.filename, {
      key: "test-only-key",
      fetchFn: (async (url) =>
        url.endsWith("/status") ? json({ status: "COMPLETED" }) : new Response("not found", { status: 404 })) as FalFetch,
    });

    expect(rows[0]?.error).toBe("fal.ai HTTP 404");
    expect(rows[0]?.state).toBe("result-error");
    expect(existsSync(f.output(0))).toBe(false);
  });

  test("a failed result keeps its request identity, explains itself, and is not resubmitted", async () => {
    const f = fixture(1);
    const data = f.read();
    // An input mistake that only fal could catch: the job was accepted with
    // the wrong Trellis route, so `collect` must not re-run the plan checks.
    accepted(data.jobs[0]!).endpoint = "fal-ai/trellis/image-to-3d";
    f.write(data);

    let posts = 0;
    const fetchFn: FalFetch = async (url, init) => {
      if (init.method === "POST") posts++;
      return url.endsWith("/status")
        ? json({ status: "COMPLETED" })
        : new Response(JSON.stringify({ detail: "Model generation failed; invalid topology" }), { status: 422 });
    };
    const config = { key: "test-only-key", fetchFn };

    const rows = await runBatch("collect", f.filename, config);
    expect(rows[0]?.state).toBe("result-error");
    expect(rows[0]?.request_id).toBe("accepted");
    expect(rows[0]?.error_detail).toBe("Model generation failed; invalid topology");

    await runBatch("submit", f.filename, config);
    expect(posts).toBe(0);
  });
});
