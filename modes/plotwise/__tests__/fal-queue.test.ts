/**
 * fal-queue.mjs — the asynchronous fal.ai submission path every fal-backed
 * script shares. Pinned against a REAL server (`Bun.serve` on port 0) that
 * scripts the queue protocol, not a mocked fetch: the whole point of the
 * module is the sequence of HTTP calls, and a mock of that sequence would
 * only test itself.
 *
 * Covered: the queue-URL derivation, a transient submit failure followed by
 * a queued accept, the IN_QUEUE → IN_PROGRESS → COMPLETED walk with its
 * status callbacks, the fallback URLs when the envelope omits them, a 4xx
 * submit reported at once, in-place poll retries, FAILED, the deadline, and
 * abort (remote cancel PUT + an AbortError rejection).
 *
 * The last block pins the caller that moved onto this path,
 * `generate-video.mjs`: its argv contract and its `fail()` messages are
 * unchanged, and the module graph (this module included) still loads.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runFalJob, toQueueUrl } from "../../_shared/scripts/fal-queue.mjs";

// ---------------------------------------------------------------------------
// A scripted fal.ai queue, served locally.
// ---------------------------------------------------------------------------

interface SubmitStep {
  status?: number;
  body?: unknown;
  text?: string;
}

interface StatusStep {
  status?: number;
  body?: unknown;
  text?: string;
}

interface FakeFalConfig {
  /** Consumed in order; the last entry repeats. Default: one queued accept. */
  submit?: SubmitStep[];
  /** Consumed in order; the last entry repeats. Default: one COMPLETED. */
  status?: StatusStep[];
  result?: { status?: number; body?: unknown; text?: string };
  /** Answer the submit with `request_id` only, forcing derived URLs. */
  omitUrls?: boolean;
  /** Called with the 1-based poll number before the status is answered. */
  onStatusRequest?: (call: number) => void;
}

interface FakeFal {
  /** The synchronous-looking endpoint a caller passes to `runFalJob`. */
  url: string;
  submits: Array<{ auth: string | null; contentType: string | null; body: unknown }>;
  statusUrls: string[];
  resultUrls: string[];
  cancels: string[];
  stop: () => void;
}

function startFakeFal(config: FakeFalConfig = {}): FakeFal {
  const submitScript = config.submit ?? [{ status: 200 }];
  const statusScript = config.status ?? [{ body: { status: "COMPLETED" } }];
  const submits: FakeFal["submits"] = [];
  const statusUrls: string[] = [];
  const resultUrls: string[] = [];
  const cancels: string[] = [];
  let submitCalls = 0;
  let origin = "";

  const pick = <T,>(script: T[], index: number): T => script[Math.min(index, script.length - 1)]!;

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "POST") {
        const step = pick(submitScript, submitCalls);
        submitCalls += 1;
        submits.push({
          auth: req.headers.get("authorization"),
          contentType: req.headers.get("content-type"),
          body: await req.json(),
        });
        const status = step.status ?? 200;
        if (status !== 200) return new Response(step.text ?? "upstream said no", { status });
        if (step.body !== undefined) return json(step.body);
        const id = "req-42";
        return json(
          config.omitUrls
            ? { request_id: id }
            : {
                request_id: id,
                status_url: `${origin}/requests/${id}/status`,
                response_url: `${origin}/requests/${id}`,
                cancel_url: `${origin}/requests/${id}/cancel`,
              },
        );
      }

      if (req.method === "PUT" && /\/requests\/[^/]+\/cancel$/.test(path)) {
        cancels.push(path);
        return json({ status: "CANCELLED" });
      }

      if (req.method === "GET" && /\/requests\/[^/]+\/status$/.test(path)) {
        const call = statusUrls.length + 1;
        statusUrls.push(url.pathname + url.search);
        config.onStatusRequest?.(call);
        const step = pick(statusScript, call - 1);
        const status = step.status ?? 200;
        if (status !== 200) return new Response(step.text ?? "status blew up", { status });
        return json(step.body ?? { status: "COMPLETED" });
      }

      if (req.method === "GET" && /\/requests\/[^/]+$/.test(path)) {
        resultUrls.push(path);
        const step = config.result ?? {
          body: { video: { url: "https://cdn.example/clip.mp4" }, timings: { inference: 12.5 } },
        };
        const status = step.status ?? 200;
        if (status !== 200) return new Response(step.text ?? "result blew up", { status });
        return json(step.body);
      }

      return new Response("not found", { status: 404 });
    },
  });

  origin = `http://127.0.0.1:${server.port}`;

  return {
    url: `${origin}/minimax/h3-max/image-to-video`,
    submits,
    statusUrls,
    resultUrls,
    cancels,
    stop: () => server.stop(true),
  };
}

/** The rejection of `promise`, or a thrown assertion when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the job to reject, but it resolved");
}

/** Fast, deterministic defaults — no real 6s/15s waits in a test. */
const FAST = { pollMs: 5, retryDelaysMs: [5, 5], key: "test-key" } as const;

// ---------------------------------------------------------------------------

describe("toQueueUrl", () => {
  test("moves a synchronous fal endpoint onto the queue host", () => {
    expect(toQueueUrl("https://fal.run/minimax/h3-max/image-to-video")).toBe(
      "https://queue.fal.run/minimax/h3-max/image-to-video",
    );
  });

  test("is idempotent and leaves other hosts (a test double) alone", () => {
    expect(toQueueUrl("https://queue.fal.run/fal-ai/wizper")).toBe(
      "https://queue.fal.run/fal-ai/wizper",
    );
    expect(toQueueUrl("http://127.0.0.1:8080/minimax/h3-max/text-to-video")).toBe(
      "http://127.0.0.1:8080/minimax/h3-max/text-to-video",
    );
  });

  test("drops a trailing slash so derived request URLs stay well formed", () => {
    expect(toQueueUrl("https://fal.run/minimax/h3-max/text-to-video/")).toBe(
      "https://queue.fal.run/minimax/h3-max/text-to-video",
    );
  });

  test("refuses a value that is not a URL", () => {
    expect(() => toQueueUrl("minimax/h3-max/text-to-video")).toThrow(/not a valid URL/i);
  });
});

describe("runFalJob", () => {
  test("retries a transient submit, then walks the queue to the result", async () => {
    const seen: Array<{ status: string; queue_position?: number }> = [];
    const retries: Array<{ attempt: number; attempts: number; delayMs: number }> = [];
    const fake = startFakeFal({
      submit: [{ status: 503, text: "downstream_service_unavailable" }, { status: 200 }],
      status: [
        { body: { status: "IN_QUEUE", queue_position: 3 } },
        { body: { status: "IN_QUEUE", queue_position: 3 } },
        { body: { status: "IN_PROGRESS" } },
        { body: { status: "COMPLETED", metrics: { inference_time: 11 } } },
      ],
    });
    try {
      const result = await runFalJob({
        ...FAST,
        url: fake.url,
        body: { prompt: "a chalkboard", duration: 5 },
        label: "H3 Max video generation",
        onStatus: (update) => seen.push(update),
        onRetry: (info) => retries.push(info),
      });

      expect(result.data).toEqual({
        video: { url: "https://cdn.example/clip.mp4" },
        timings: { inference: 12.5 },
      });
      expect(result.attempts).toBe(2);
      expect(result.requestId).toBe("req-42");
      // `data.timings.inference` outranks the status metric.
      expect(result.inferenceSeconds).toBe(12.5);
      expect(result.apiMs).toBeGreaterThanOrEqual(0);

      // Two submits: the 503 and the accept. The body round-trips verbatim.
      expect(fake.submits.length).toBe(2);
      expect(fake.submits[0]!.auth).toBe("Key test-key");
      expect(fake.submits[0]!.contentType).toContain("application/json");
      expect(fake.submits[1]!.body).toEqual({ prompt: "a chalkboard", duration: 5 });

      // The transient failure was reported, not swallowed.
      expect(retries.length).toBe(1);
      expect(retries[0]).toMatchObject({ attempt: 1, attempts: 3, delayMs: 5 });

      // Polling asks for no logs, and only *changes* are announced.
      expect(fake.statusUrls.length).toBe(4);
      expect(fake.statusUrls[0]).toContain("logs=0");
      expect(seen.length).toBe(2);
      expect(seen[0]).toEqual({ status: "IN_QUEUE", queue_position: 3 });
      expect(seen[1]!.status).toBe("IN_PROGRESS");
      expect(seen[1]!.queue_position).toBeUndefined();
      expect(fake.resultUrls.length).toBe(1);
    } finally {
      fake.stop();
    }
  });

  test("derives status/result URLs when the envelope omits them", async () => {
    const fake = startFakeFal({ omitUrls: true });
    try {
      const result = await runFalJob({ ...FAST, url: fake.url, body: {} });
      expect(result.data).toMatchObject({ video: { url: "https://cdn.example/clip.mp4" } });
      expect(fake.statusUrls[0]).toBe(
        "/minimax/h3-max/image-to-video/requests/req-42/status?logs=0",
      );
      expect(fake.resultUrls[0]).toBe("/minimax/h3-max/image-to-video/requests/req-42");
    } finally {
      fake.stop();
    }
  });

  test("reports a 4xx submit at once, without a second attempt", async () => {
    const fake = startFakeFal({
      submit: [{ status: 422, text: "duration must be <= 15" }],
    });
    try {
      const error = await rejection(runFalJob({ ...FAST, url: fake.url, body: {} }));
      expect(error.message).toContain("HTTP 422");
      expect(error.message).toContain("duration must be <= 15");
      expect(error.message).not.toContain("after");
      expect(fake.submits.length).toBe(1);
    } finally {
      fake.stop();
    }
  });

  test("gives up after three submit attempts on a persistent 5xx", async () => {
    const fake = startFakeFal({ submit: [{ status: 504, text: "gateway" }] });
    try {
      const error = await rejection(runFalJob({ ...FAST, url: fake.url, body: {} }));
      expect(error.message).toContain("HTTP 504");
      expect(error.message).toContain("after 3 attempts");
      expect(fake.submits.length).toBe(3);
    } finally {
      fake.stop();
    }
  });

  test("rides out transient poll failures in place", async () => {
    const fake = startFakeFal({
      status: [
        { status: 502 },
        { status: 502 },
        { body: { status: "IN_PROGRESS" } },
        { body: { status: "COMPLETED" } },
      ],
    });
    try {
      const result = await runFalJob({ ...FAST, url: fake.url, body: {} });
      expect(result.data).toMatchObject({ video: { url: "https://cdn.example/clip.mp4" } });
      expect(fake.statusUrls.length).toBe(4);
    } finally {
      fake.stop();
    }
  });

  test("throws once the poll keeps failing, and cancels the job it can no longer watch", async () => {
    const fake = startFakeFal({ status: [{ status: 500 }] });
    try {
      const error = await rejection(runFalJob({ ...FAST, url: fake.url, body: {} }));
      expect(error.message).toContain("status HTTP 500");
      expect(fake.statusUrls.length).toBe(4);
      expect(fake.cancels).toEqual(["/requests/req-42/cancel"]);
    } finally {
      fake.stop();
    }
  });

  test("surfaces a FAILED job with the upstream message", async () => {
    const fake = startFakeFal({
      status: [{ body: { status: "FAILED", error: "content policy violation" } }],
    });
    try {
      const error = await rejection(runFalJob({ ...FAST, url: fake.url, body: {} }));
      expect(error.message).toContain("content policy violation");
      expect(fake.resultUrls.length).toBe(0);
    } finally {
      fake.stop();
    }
  });

  test("enforces the deadline while the job stays in progress, and cancels the job it gives up on", async () => {
    const fake = startFakeFal({ status: [{ body: { status: "IN_PROGRESS" } }] });
    try {
      const startedAt = Date.now();
      const error = await rejection(
        runFalJob({ ...FAST, url: fake.url, body: {}, label: "H3 Max", deadlineMs: 120 }),
      );
      expect(error.name).not.toBe("AbortError");
      expect(error.message).toContain("H3 Max");
      expect(error.message).toMatch(/exceeded/i);
      expect(Date.now() - startedAt).toBeLessThan(3000);
      // The job would otherwise keep running — and billing — upstream.
      expect(fake.cancels).toEqual(["/requests/req-42/cancel"]);
    } finally {
      fake.stop();
    }
  });

  test("a job that finished upstream is not cancelled when its result cannot be read", async () => {
    const fake = startFakeFal({ result: { status: 500, text: "storage hiccup" } });
    try {
      const error = await rejection(runFalJob({ ...FAST, url: fake.url, body: {} }));
      expect(error.message).toContain("result HTTP 500");
      expect(fake.cancels).toEqual([]);
    } finally {
      fake.stop();
    }
  });

  describe("submit failures without an answer", () => {
    /** A fetch whose first call throws `error`, then behaves normally. */
    const failFirst = (error: Error): typeof fetch => {
      let first = true;
      return ((input: RequestInfo | URL, init?: RequestInit) => {
        if (first) {
          first = false;
          return Promise.reject(error);
        }
        return fetch(input, init);
      }) as typeof fetch;
    };

    test("a connection that never opened is retried — no job can exist for it", async () => {
      const fake = startFakeFal({});
      try {
        const refused = new TypeError("fetch failed");
        (refused as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        const retries: unknown[] = [];
        const result = await runFalJob({
          ...FAST,
          url: fake.url,
          body: {},
          fetchImpl: failFirst(refused),
          onRetry: (info) => retries.push(info),
        });
        expect(result.attempts).toBe(2);
        expect(retries.length).toBe(1);
        expect(fake.submits.length).toBe(1);
      } finally {
        fake.stop();
      }
    });

    test("a request that left and lost its answer is not sent again — fal has no idempotency key", async () => {
      const fake = startFakeFal({});
      try {
        const timedOut = new DOMException("The operation was aborted due to timeout", "TimeoutError");
        const error = await rejection(
          runFalJob({ ...FAST, url: fake.url, body: {}, fetchImpl: failFirst(timedOut) }),
        );
        expect(error.message).toContain("not sent again");
        expect(error.message).toContain("timeout");
        expect(fake.submits.length).toBe(0);
      } finally {
        fake.stop();
      }
    });
  });

  test("aborting mid-poll cancels the job remotely and rejects with AbortError", async () => {
    const controller = new AbortController();
    const fake = startFakeFal({
      status: [{ body: { status: "IN_PROGRESS" } }],
      onStatusRequest: (call) => {
        if (call === 2) controller.abort();
      },
    });
    try {
      const error = await rejection(
        runFalJob({ ...FAST, url: fake.url, body: {}, signal: controller.signal }),
      );
      expect(error.name).toBe("AbortError");
      // The remote job is cancelled BEFORE the rejection surfaces, so a CLI
      // may exit the moment it catches this.
      expect(fake.cancels).toEqual(["/requests/req-42/cancel"]);
      expect(fake.resultUrls.length).toBe(0);
    } finally {
      fake.stop();
    }
  });

  test("an already-aborted signal never reaches the network", async () => {
    const fake = startFakeFal({});
    try {
      const error = await rejection(
        runFalJob({ ...FAST, url: fake.url, body: {}, signal: AbortSignal.abort() }),
      );
      expect(error.name).toBe("AbortError");
      expect(fake.submits.length).toBe(0);
    } finally {
      fake.stop();
    }
  });

  test("falls back to the status metric for inference seconds", async () => {
    const fake = startFakeFal({
      status: [{ body: { status: "COMPLETED", metrics: { inference_time: 8.25 } } }],
      result: { body: { video: { url: "https://cdn.example/clip.mp4" } } },
    });
    try {
      const result = await runFalJob({ ...FAST, url: fake.url, body: {} });
      expect(result.inferenceSeconds).toBe(8.25);
    } finally {
      fake.stop();
    }
  });

  test("refuses to run without a key", async () => {
    const fake = startFakeFal({});
    try {
      const error = await rejection(
        runFalJob({ url: fake.url, body: {}, key: "" }),
      );
      expect(error.message).toMatch(/key/i);
      expect(fake.submits.length).toBe(0);
    } finally {
      fake.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// The caller: generate-video.mjs now submits through the queue.
// ---------------------------------------------------------------------------

const GENERATE_VIDEO = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "_shared",
  "scripts",
  "generate-video.mjs",
);

/**
 * Run the real CLI. `process.execPath` is the runtime already running this
 * test — no external binary, so this stays out of the live tier — and cwd is
 * a scratch dir so no `.env` up the tree (or auto-loaded from cwd) can leak
 * a key into the run.
 */
function runGenerateVideo(args: string[], env: Record<string, string | undefined>, cwd: string) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  const res = Bun.spawnSync({
    cmd: [process.execPath, GENERATE_VIDEO, ...args],
    env: merged,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: res.exitCode,
    stdout: res.stdout.toString(),
    stderr: res.stderr.toString(),
  };
}

describe("generate-video.mjs guard rails (all die before any network I/O)", () => {
  test("the argv contract is unchanged and the queue module loads with it", () => {
    const dir = mkdtempSync(join(tmpdir(), "genvid-cli-"));
    try {
      const bad = runGenerateVideo(
        ["--prompt", "hi", "--output", join(dir, "o.mp4"), "--duration", "20"],
        { FAL_KEY: "dummy" },
        dir,
      );
      expect(bad.exitCode).toBe(1);
      // A module-resolution failure would die differently — reaching this
      // message proves `import { runFalJob } from "./fal-queue.mjs"` resolved.
      expect(bad.stderr).toContain("ERROR: --duration must be an integer between 5 and 15 (got: 20)");

      const noPrompt = runGenerateVideo(["--output", join(dir, "o.mp4")], { FAL_KEY: "dummy" }, dir);
      expect(noPrompt.exitCode).toBe(1);
      expect(noPrompt.stderr).toContain("ERROR: --prompt is required");

      const refConflict = runGenerateVideo(
        ["--prompt", "hi", "--output", join(dir, "o.mp4"), "--endpoint", "text", "--ref-image", "a.png"],
        { FAL_KEY: "dummy" },
        dir,
      );
      expect(refConflict.exitCode).toBe(1);
      expect(refConflict.stderr).toContain("--ref-* inputs require the reference endpoint");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no FAL_KEY anywhere still dies with the documented message", () => {
    const dir = mkdtempSync(join(tmpdir(), "genvid-cli-"));
    try {
      const res = runGenerateVideo(
        ["--prompt", "hi", "--output", join(dir, "o.mp4")],
        { FAL_KEY: undefined },
        dir,
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("ERROR: No API key found.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
