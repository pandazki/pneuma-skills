/**
 * generate_gif.mjs — GPT Image 2.6 animated GIF on fal.ai.
 *
 * No paid call is made here. The library half runs against an injected job
 * runner and downloader; the CLI half runs the real script, the real queue
 * runner and the real downloader against a fetch fixture preloaded into the
 * child process, so a test can count submits.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGifRequest,
  costLine,
  generateGif,
  GIF_LIMITS,
  readGifInfo,
} from "../generate_gif.mjs";

const workspace = mkdtempSync(join(tmpdir(), "pneuma-gif-test-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
const SCRIPT = join(fileURLToPath(new URL("..", import.meta.url)), "generate_gif.mjs");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
  "base64",
);
const turnaround = join(workspace, "turnaround.png");
const portrait = join(workspace, "portrait.png");
writeFileSync(turnaround, PNG);
writeFileSync(portrait, Buffer.concat([PNG, Buffer.from([0])]));

/**
 * A structurally complete GIF89a: a 2-colour global table, a NETSCAPE loop
 * block, and per frame a graphic control extension (delay in centiseconds,
 * transparent index 1) and a 1x1 image. The logical screen can claim any
 * size — the reader counts blocks, it does not decode pixels.
 */
function gif(frames: number, { delayCs = 9, width = 512, height = 512 } = {}): Buffer {
  const parts: number[] = [];
  parts.push(...Buffer.from("GIF89a", "latin1"));
  parts.push(width & 0xff, width >> 8, height & 0xff, height >> 8, 0x80, 0, 0);
  parts.push(0, 0, 0, 255, 255, 255);
  parts.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0", "latin1"), 3, 1, 0, 0, 0);
  for (let i = 0; i < frames; i++) {
    parts.push(0x21, 0xf9, 4, 0x09, delayCs & 0xff, delayCs >> 8, 1, 0);
    parts.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0);
    parts.push(2, 2, 0x44, 0x01, 0);
  }
  parts.push(0x3b);
  return Buffer.from(parts);
}

describe("readGifInfo", () => {
  test("counts every frame and reads each delay and the canvas from the structure", () => {
    const info = readGifInfo(gif(12, { delayCs: 9 }));
    expect(info).toEqual({ width: 512, height: 512, frames: 12, delaysMs: Array(12).fill(90), transparent: true, loops: 0 });
  });

  test("refuses bytes that are not a whole GIF", () => {
    expect(() => readGifInfo(PNG)).toThrow("not a GIF");
    const whole = gif(4);
    expect(() => readGifInfo(whole.subarray(0, whole.length - 4))).toThrow("truncated");
    expect(() => readGifInfo(gif(0))).toThrow("no frames");
  });
});

describe("GIF request bodies", () => {
  const out = join(workspace, "out.gif");

  test("no references: Flare text-to-image, the documented GIF fields, defaults filled in", () => {
    const request = buildGifRequest({ prompt: "A fox trots in place", output: out });
    expect(request.url).toBe("https://fal.run/openai/gpt-image-2.6/flare/text-to-image");
    expect(request.model).toBe("openai/gpt-image-2.6-flare");
    expect(request.body).toEqual({
      prompt: "A fox trots in place",
      output_format: "gif",
      frame_count: 9,
      frame_duration_ms: 200,
      image_size: { width: 512, height: 512 },
      quality: "medium",
    });
  });

  test("references select the edit endpoint, inlined in the order given; sunburst is an explicit upgrade", () => {
    const request = buildGifRequest({
      prompt: "Animate her", output: out, model: "sunburst", imageUrls: [turnaround, portrait],
      frameCount: "12", frameDurationMs: "90", imageSize: "512x512", background: "transparent",
    });
    expect(request.url).toBe("https://fal.run/openai/gpt-image-2.6/sunburst/edit");
    expect(request.model).toBe("openai/gpt-image-2.6-sunburst");
    expect(request.body.image_urls).toEqual([
      `data:image/png;base64,${readFileSync(turnaround).toString("base64")}`,
      `data:image/png;base64,${readFileSync(portrait).toString("base64")}`,
    ]);
    expect(request.body.frame_count).toBe(12);
    expect(request.body.frame_duration_ms).toBe(90);
    expect(request.body.background).toBe("transparent");
  });

  test("everything fal's schema states is refused before a request", () => {
    const base = { prompt: "x", output: out };
    expect(() => buildGifRequest({ ...base, frameCount: 1 })).toThrow("--frame-count");
    expect(() => buildGifRequest({ ...base, frameCount: GIF_LIMITS.maxFrames + 1 })).toThrow("--frame-count");
    expect(() => buildGifRequest({ ...base, frameCount: 2.5 })).toThrow("--frame-count");
    expect(() => buildGifRequest({ ...base, frameDurationMs: 10 })).toThrow("--frame-duration-ms");
    expect(() => buildGifRequest({ ...base, imageSize: "500x512" })).toThrow("multiples of 16");
    expect(() => buildGifRequest({ ...base, imageSize: "1600x512" })).toThrow("3:1");
    expect(() => buildGifRequest({ ...base, imageSize: "4096x2048" })).toThrow("longest edge");
    // 16 x 1024 x 1024 = 16.8M px, twice fal's 8,294,400 budget for one GIF.
    expect(() => buildGifRequest({ ...base, frameCount: 16, imageSize: "1024x1024" })).toThrow("at most 7 frames at this size");
    expect(buildGifRequest({ ...base, frameCount: 16, imageSize: "512x512" }).body.frame_count).toBe(16);
    expect(() => buildGifRequest({ ...base, imageUrls: Array(17).fill(turnaround) })).toThrow("at most 16");
    expect(() => buildGifRequest({ ...base, quality: "max" })).toThrow("--quality");
    expect(() => buildGifRequest({ ...base, background: "white" })).toThrow("--background");
    expect(() => buildGifRequest({ ...base, model: "gpt-image-2.6-flare" })).toThrow("--model");
    expect(() => buildGifRequest({ ...base, output: join(workspace, "out.png") })).toThrow(".gif");
    expect(() => buildGifRequest({ ...base, prompt: " " })).toThrow("prompt");
    expect(() => buildGifRequest({ ...base, imageUrls: [join(workspace, "missing.png")] })).toThrow("not found");
  });
});

describe("generateGif", () => {
  const job = (requestId = "req-gif-1") => async () => ({
    data: { images: [{ url: "https://v3b.fal.media/files/b/x/anim.gif", content_type: "image/gif" }] },
    requestId,
    apiMs: 1,
    attempts: 1,
  });

  test("writes the GIF and reports what the file holds", async () => {
    const output = join(workspace, "ok", "gif-raw.gif");
    const result = await generateGif(
      { prompt: "Idle", output, apiKey: "k", frameCount: 12, frameDurationMs: 90, imageUrls: [turnaround], background: "transparent" },
      { runJob: job(), download: async () => gif(12, { delayCs: 9 }) },
    );
    expect(readFileSync(output).equals(gif(12, { delayCs: 9 }))).toBe(true);
    expect(existsSync(`${output}.tmp`)).toBe(false);
    expect(result).toMatchObject({
      backend: "fal",
      model: "openai/gpt-image-2.6-flare",
      endpoint: "https://fal.run/openai/gpt-image-2.6/flare/edit",
      requestId: "req-gif-1",
      files: [output],
      frameCount: 12,
      frameDurationMs: 90,
      durationMs: 1080,
      size: { width: 512, height: 512 },
      background: "transparent",
      hasTransparency: true,
    });
    expect(result.cost.usd).toBeNull();
  });

  test("a GIF with another frame count is kept for inspection and thrown as a failure", async () => {
    const output = join(workspace, "short", "gif-raw.gif");
    let error: (Error & { requestId?: string; path?: string }) | undefined;
    try {
      await generateGif({ prompt: "Idle", output, apiKey: "k", frameCount: 12 }, { runJob: job("req-short"), download: async () => gif(9) });
    } catch (e) {
      error = e as Error & { requestId?: string; path?: string };
    }
    expect(error?.message).toContain("asked for 12 frames but the GIF holds 9");
    expect(error?.message).toContain("req-short");
    expect(error?.requestId).toBe("req-short");
    expect(error?.path).toBe(output);
    expect(readGifInfo(readFileSync(output)).frames).toBe(9);
  });

  type PaidError = Error & { requestId?: string; url?: string; path?: string };
  const failure = async (promise: Promise<unknown>) => promise.then(() => undefined, (e) => e as PaidError);
  const RESULT_URL = "https://v3b.fal.media/files/b/x/anim.gif";

  test("bytes that are not a GIF are kept beside the output, not at it, and the failure names the request and the URL", async () => {
    const output = join(workspace, "png", "gif-raw.gif");
    const error = await failure(generateGif({ prompt: "Idle", output, apiKey: "k" }, { runJob: job("req-png"), download: async () => PNG }));
    expect(error?.message).toContain("not a usable GIF");
    expect(existsSync(output)).toBe(false);
    expect(error?.requestId).toBe("req-png");
    expect(error?.url).toBe(RESULT_URL);
    expect(error?.message).toContain(RESULT_URL);
    expect(error?.message).toContain("req-png");
    expect(error?.message).toContain(error!.path!);
    expect(readFileSync(error!.path!).equals(PNG)).toBe(true);
  });

  test("a finished job whose download fails names its request and its URL, and writes nothing", async () => {
    const output = join(workspace, "cdn", "gif-raw.gif");
    const error = await failure(generateGif({ prompt: "Idle", output, apiKey: "k" }, {
      runJob: job("req-cdn"),
      download: async () => {
        throw new Error("HTTP 503");
      },
    }));
    expect(error?.requestId).toBe("req-cdn");
    expect(error?.url).toBe(RESULT_URL);
    expect(error?.message).toContain("HTTP 503");
    expect(error?.message).toContain(`fetch it from ${RESULT_URL}`);
    expect(error?.message).toContain("do not resubmit");
    expect(error?.message).toContain("req-cdn");
    expect(existsSync(output)).toBe(false);
  });

  test("an existing --output is refused before any request; a file that appears there mid-job is never replaced", async () => {
    const output = join(workspace, "taken", "gif-raw.gif");
    mkdirSync(join(workspace, "taken"), { recursive: true });
    writeFileSync(output, "an earlier take");
    let calls = 0;
    const counting = async () => {
      calls += 1;
      return job()();
    };
    await expect(generateGif({ prompt: "Idle", output, apiKey: "k" }, { runJob: counting, download: async () => gif(9) }))
      .rejects.toThrow("already exists");
    expect(calls).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("an earlier take");

    // Free before paying, taken by the time the GIF arrives.
    const raced = join(workspace, "raced", "gif-raw.gif");
    const error = await failure(generateGif({ prompt: "Idle", output: raced, apiKey: "k" }, {
      runJob: job("req-race"),
      download: async () => {
        mkdirSync(join(workspace, "raced"), { recursive: true });
        writeFileSync(raced, "the other run's take");
        return gif(9);
      },
    }));
    expect(readFileSync(raced, "utf8")).toBe("the other run's take");
    expect(error?.requestId).toBe("req-race");
    expect(error?.url).toBe(RESULT_URL);
    expect(readGifInfo(readFileSync(error!.path!)).frames).toBe(9);
    expect(error?.message).toContain(error!.path!);
  });

  test("a job that ran and failed is reported with its id and run exactly once", async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw Object.assign(new Error('{"type":"downstream_service_error"}'), { requestId: "req-500" });
    };
    const output = join(workspace, "failed", "gif-raw.gif");
    let error: (Error & { requestId?: string }) | undefined;
    try {
      await generateGif({ prompt: "Idle", output, apiKey: "k" }, { runJob: failing, download: async () => gif(9) });
    } catch (e) {
      error = e as Error & { requestId?: string };
    }
    expect(calls).toBe(1);
    expect(error?.requestId).toBe("req-500");
    expect(error?.message).toContain("downstream_service_error");
    expect(error?.message).toContain("not sent again");
    expect(existsSync(output)).toBe(false);
  });

  test("the cost line says unknown and quotes fal's per-token list price", () => {
    expect(costLine()).toBe(
      "cost: unknown (fal bills GPT Image 2.6 by tokens and returns no token counts for a request; fal list price per 1M tokens: image output $30, image input $8, text input $5)",
    );
  });
});

describe("generate_gif.mjs CLI against a fake fal queue", () => {
  /**
   * A preloaded `fetch` playing fal's queue: submit, one status poll,
   * result, CDN download. Every submit body is appended to a log file.
   */
  function preload(dir: string, { status, frames }: { status: string; frames: number }) {
    const gifPath = join(dir, "served.gif");
    writeFileSync(gifPath, gif(frames, { delayCs: 9 }));
    const file = join(dir, "fetch-fixture.mjs");
    writeFileSync(file, `import { appendFileSync, readFileSync } from "node:fs";
const base = "https://queue.fal.run/openai/gpt-image-2.6/flare";
const json = (v) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  if (options.method === "POST" && url.startsWith(base)) {
    appendFileSync(process.env.GIF_TEST_SUBMITS, options.body + "\\n");
    return json({ request_id: "req-cli", status_url: base + "/requests/req-cli/status", response_url: base + "/requests/req-cli", cancel_url: base + "/requests/req-cli/cancel" });
  }
  if (url.startsWith(base + "/requests/req-cli/status")) {
    return json(${JSON.stringify(status)} === "FAILED" ? { status: "FAILED", error: { type: "downstream_service_error" } } : { status: "COMPLETED" });
  }
  if (url === base + "/requests/req-cli") return json({ images: [{ url: "https://v3b.fal.media/files/b/x/anim.gif", content_type: "image/gif" }] });
  if (url === "https://v3b.fal.media/files/b/x/anim.gif") return new Response(readFileSync(${JSON.stringify(gifPath)}));
  if (options.method === "PUT") return json({ status: "CANCELLED" });
  throw new Error("unexpected fetch " + (options.method ?? "GET") + " " + url);
};`);
    return file;
  }

  function runCli(name: string, args: string[], fixture: { status: string; frames: number } | null, env: Record<string, string> = {}) {
    const dir = join(workspace, name);
    mkdirSync(dir, { recursive: true });
    const submits = join(dir, "submits.log");
    const cmd = [process.execPath, "--env-file=/dev/null"];
    if (fixture) cmd.push("--preload", preload(dir, fixture));
    const child = Bun.spawnSync([...cmd, SCRIPT, ...args], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", FAL_KEY: "fixture-key", GIF_TEST_SUBMITS: submits, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const sent = existsSync(submits) ? readFileSync(submits, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { dir, code: child.exitCode, out: child.stdout.toString(), err: child.stderr.toString(), sent };
  }

  test("one submit, the GIF on disk, one JSON object on stdout and a cost line on stderr", () => {
    const r = runCli("cli-ok", ["Lantern swing", "--output", "motions/attack/gif-raw.gif", "--image-urls", turnaround,
      "--frame-count", "12", "--frame-duration-ms", "90", "--background", "transparent", "--json"], { status: "COMPLETED", frames: 12 });
    expect(r.code).toBe(0);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ prompt: "Lantern swing", output_format: "gif", frame_count: 12, frame_duration_ms: 90, background: "transparent" });
    const result = JSON.parse(r.out);
    expect(result).toMatchObject({ requestId: "req-cli", frameCount: 12, frameDurationMs: 90, files: ["motions/attack/gif-raw.gif"] });
    expect(readGifInfo(readFileSync(join(r.dir, "motions/attack/gif-raw.gif"))).frames).toBe(12);
    expect(r.err).toContain("cost: unknown (fal bills GPT Image 2.6 by tokens");
  });

  test("a job fal reports FAILED exits 1 after one submit and names the request", () => {
    const r = runCli("cli-failed", ["Idle", "--output", "gif-raw.gif", "--json"], { status: "FAILED", frames: 9 });
    expect(r.code).toBe(1);
    expect(r.sent).toHaveLength(1);
    expect(r.out).toBe("");
    expect(r.err).toContain("downstream_service_error");
    expect(r.err).toContain("fal request req-cli");
    expect(existsSync(join(r.dir, "gif-raw.gif"))).toBe(false);
  });

  test("a short GIF exits 1 and is not printed as a result", () => {
    const r = runCli("cli-short", ["Idle", "--output", "gif-raw.gif", "--frame-count", "12", "--json"], { status: "COMPLETED", frames: 9 });
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain("asked for 12 frames but the GIF holds 9");
  });

  test("a request outside fal's limits is refused before any key or network is needed", () => {
    const r = runCli("cli-budget", ["Idle", "--output", "gif-raw.gif", "--frame-count", "16", "--image-size", "1024x1024"], null, { FAL_KEY: "" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("budget");
    expect(r.err).not.toContain("No API key");
  });
});
