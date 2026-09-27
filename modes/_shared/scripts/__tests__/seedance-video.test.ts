/**
 * seedance-video.mjs — Seedance 2.5 on fal.ai.
 *
 * Three layers, none of which reach fal:
 *   - endpoint inference and the request body per endpoint, including every
 *     refusal that must happen BEFORE a paid submit (duration range, the
 *     aspect ratio the image endpoint cannot honour, reference counts, an
 *     input too large to inline);
 *   - the download/write half with an injected job runner and downloader —
 *     the output file appears whole, with no `.tmp` left behind;
 *   - the CLI's own guard rails, by spawning the real script.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSeedanceRequest,
  costLine,
  ENDPOINTS,
  generateSeedanceVideo,
  resolveEndpointName,
  SEEDANCE_MODEL,
  SEEDANCE_PRICE,
  seedanceCost,
} from "../seedance-video.mjs";

const workspace = mkdtempSync(join(tmpdir(), "seedance-test-"));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
  "base64",
);
const frame = join(workspace, "frame.png");
writeFileSync(frame, PNG);
const dataUri = `data:image/png;base64,${PNG.toString("base64")}`;

const SCRIPT = join(fileURLToPath(new URL("..", import.meta.url)), "seedance-video.mjs");

function runCli(args: string[], env: Record<string, string> = {}) {
  const res = Bun.spawnSync({
    cmd: [process.execPath, "--env-file=/dev/null", SCRIPT, ...args],
    cwd: workspace,
    env: { PATH: process.env.PATH ?? "", FAL_KEY: "fixture-key", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: res.exitCode, out: res.stdout.toString(), err: res.stderr.toString() };
}

describe("seedance endpoint inference", () => {
  test("the inputs pick the endpoint, and an explicit one has the last word", () => {
    expect(resolveEndpointName({})).toBe("text");
    expect(resolveEndpointName({ image: frame })).toBe("image");
    expect(resolveEndpointName({ refImages: [frame] })).toBe("reference");
    expect(resolveEndpointName({ refVideos: ["https://example.com/a.mp4"] })).toBe("reference");
    expect(resolveEndpointName({ endpoint: "reference-to-video", refImages: [frame] })).toBe("reference");
    expect(() => resolveEndpointName({ endpoint: "sound" })).toThrow("--endpoint");
    expect(() => resolveEndpointName({ endpoint: "text", refImages: [frame] })).toThrow("reference endpoint");
    expect(() => resolveEndpointName({ endpoint: "text", image: frame })).toThrow("--image");
    expect(() => resolveEndpointName({ endpoint: "reference" })).toThrow("at least one");
  });

  test("a forced image endpoint with no first frame is refused here, not by fal", () => {
    // fal answers 422 for a missing `image_url`, i.e. after the request has
    // left. The refusal belongs on this side of the wire, symmetric with
    // the reference endpoint's "at least one anchor" check.
    expect(() => resolveEndpointName({ endpoint: "image" })).toThrow("--image");
    expect(() => resolveEndpointName({ endpoint: "image-to-video" })).toThrow("--image");
    expect(() => resolveEndpointName({ endpoint: "image", endImage: frame })).toThrow("--image");
    expect(() => buildSeedanceRequest({ prompt: "walk", endpoint: "image" })).toThrow("--image");
    expect(resolveEndpointName({ endpoint: "image", image: frame })).toBe("image");
  });

  test("every endpoint is a Seedance 2.5 URL on fal", () => {
    expect(Object.values(ENDPOINTS).map((e: { url: string }) => e.url)).toEqual([
      "https://fal.run/bytedance/seedance-2.5/text-to-video",
      "https://fal.run/bytedance/seedance-2.5/image-to-video",
      "https://fal.run/bytedance/seedance-2.5/reference-to-video",
    ]);
    expect(SEEDANCE_MODEL).toBe("bytedance/seedance-2.5");
  });
});

describe("seedance request bodies", () => {
  test("text-to-video carries the documented field names and the cheap defaults", () => {
    const request = buildSeedanceRequest({ prompt: "A knight idles" });
    expect(request.endpoint).toBe("text");
    expect(request.url).toBe("https://fal.run/bytedance/seedance-2.5/text-to-video");
    expect(request.body).toEqual({
      prompt: "A knight idles",
      resolution: "480p",
      duration: "auto",
      generate_audio: true,
    });
  });

  test("image-to-video inlines local frames and refuses an aspect ratio it cannot honour", () => {
    const request = buildSeedanceRequest({ prompt: "walk", image: frame, endImage: "https://example.com/last.png" });
    expect(request.endpoint).toBe("image");
    expect(request.body).toEqual({
      prompt: "walk",
      image_url: dataUri,
      end_image_url: "https://example.com/last.png",
      resolution: "480p",
      duration: "auto",
      generate_audio: true,
    });
    expect(() => buildSeedanceRequest({ prompt: "walk", image: frame, aspectRatio: "16:9" })).toThrow("--aspect-ratio");
  });

  test("reference-to-video groups the three modalities into their own url lists", () => {
    const request = buildSeedanceRequest({
      prompt: "@Image1 attacks",
      refImages: [frame, "https://example.com/ref.png"],
      refVideos: ["https://example.com/move.mp4"],
      refAudios: ["https://example.com/voice.mp3"],
      duration: "8",
      resolution: "720p",
      aspectRatio: "16:9",
      audio: false,
      bitrate: "high",
      seed: "42",
    });
    expect(request.endpoint).toBe("reference");
    expect(request.body).toEqual({
      prompt: "@Image1 attacks",
      image_urls: [dataUri, "https://example.com/ref.png"],
      video_urls: ["https://example.com/move.mp4"],
      audio_urls: ["https://example.com/voice.mp3"],
      resolution: "720p",
      duration: "8",
      aspect_ratio: "16:9",
      generate_audio: false,
      bitrate_mode: "high",
      seed: 42,
    });
  });

  test("every out-of-range value is refused before a paid submit", () => {
    const base = { prompt: "x" };
    expect(() => buildSeedanceRequest({ ...base, duration: "3" })).toThrow("--duration");
    expect(() => buildSeedanceRequest({ ...base, duration: "31" })).toThrow("--duration");
    expect(() => buildSeedanceRequest({ ...base, duration: "6.5" })).toThrow("--duration");
    expect(buildSeedanceRequest({ ...base, duration: "30" }).body.duration).toBe("30");
    expect(() => buildSeedanceRequest({ ...base, resolution: "4k" })).toThrow("--resolution");
    expect(() => buildSeedanceRequest({ ...base, aspectRatio: "5:4" })).toThrow("--aspect-ratio");
    expect(() => buildSeedanceRequest({ ...base, bitrate: "ultra" })).toThrow("--bitrate");
    expect(() => buildSeedanceRequest({ ...base, seed: "abc" })).toThrow("--seed");
    expect(() => buildSeedanceRequest({ prompt: "  " })).toThrow("--prompt");
    expect(() => buildSeedanceRequest({ ...base, refImages: new Array(31).fill(frame) })).toThrow("30");
    expect(() => buildSeedanceRequest({ ...base, refImages: [frame], refVideos: new Array(11).fill("https://e/x.mp4") })).toThrow("10");
    expect(() => buildSeedanceRequest({ ...base, refImages: [frame], refAudios: new Array(11).fill("https://e/x.mp3") })).toThrow("10");
    expect(() => buildSeedanceRequest({ ...base, image: join(workspace, "missing.png") })).toThrow("not found");
    expect(() => buildSeedanceRequest({ ...base, image: frame.replace(/\.png$/, ".xyz") })).toThrow();
  });

  test("a file too large to inline is refused rather than sent", () => {
    const huge = join(workspace, "huge.mp4");
    writeFileSync(huge, Buffer.alloc(0));
    truncateSync(huge, 31 * 1024 * 1024); // sparse: the guard reads the size, not the bytes
    expect(() => buildSeedanceRequest({ prompt: "x", refImages: [frame], refVideos: [huge] })).toThrow(
      /--ref-video: .*huge\.mp4 is 31\.0 MB .*\(limit 30\.0 MB\)/,
    );
  });
});

describe("seedance download and result", () => {
  test("the clip lands whole, with the JSON the callers persist", async () => {
    const output = join(workspace, "clips", "shot.mp4");
    const bytes = Buffer.from("fake mp4 payload");
    const submitted: unknown[] = [];
    const result = await generateSeedanceVideo(
      { prompt: "A knight idles", output, apiKey: "fixture-key", duration: "6", resolution: "720p", remux: false },
      {
        runJob: async (options: { url: string; body: unknown }) => {
          submitted.push({ url: options.url, body: options.body });
          return { data: { video: { url: "https://cdn.fal.ai/clip.mp4" }, seed: 7 }, apiMs: 10, attempts: 1 };
        },
        download: async (url: string) => {
          expect(url).toBe("https://cdn.fal.ai/clip.mp4");
          return bytes;
        },
      },
    );
    expect(result).toEqual({
      path: output,
      url: "https://cdn.fal.ai/clip.mp4",
      file_size: bytes.length,
      model: SEEDANCE_MODEL,
      endpoint: "text",
      requested_duration: 6,
      resolution: "720p",
      seed: 7,
      // Not a clip ffprobe can read: the cost says it could not be measured.
      cost: {
        usd: null, estimate: true, usdPer1000Tokens: 0.0214, basis: "unknown",
        note: "the delivered clip could not be measured (ffprobe)",
      },
    });
    expect(readFileSync(output)).toEqual(bytes);
    expect(readdirSync(join(workspace, "clips"))).toEqual(["shot.mp4"]);
  });

  test("the queue's request id travels into the result, and is absent when there was none", async () => {
    // A caller that records paid work (backlot's previz.mjs take ledger) needs a
    // handle on the job after this process exits: a finished render whose
    // download was lost is still recoverable through the request id.
    const withId = await generateSeedanceVideo(
      { prompt: "A knight idles", output: join(workspace, "ided", "shot.mp4"), apiKey: "fixture-key", remux: false },
      {
        runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/clip.mp4" } }, apiMs: 10, attempts: 1, requestId: "req_7f3" }),
        download: async () => Buffer.from("bytes"),
      },
    );
    expect(withId.request_id).toBe("req_7f3");

    const withoutId = await generateSeedanceVideo(
      { prompt: "A knight idles", output: join(workspace, "anon", "shot.mp4"), apiKey: "fixture-key", remux: false },
      {
        runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/clip.mp4" } }, apiMs: 10, attempts: 1 }),
        download: async () => Buffer.from("bytes"),
      },
    );
    expect("request_id" in withoutId).toBe(false);
  });

  test("file_size is the file on disk after the remux, not the bytes fal delivered", async () => {
    const output = join(workspace, "remuxed", "shot.mp4");
    const delivered = Buffer.from("fal delivered these bytes");
    const remuxed = Buffer.from("faststart rewrote the file: the index moved, and so did the length");
    const result = await generateSeedanceVideo(
      { prompt: "A knight idles", output, apiKey: "fixture-key" },
      {
        runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/clip.mp4" } }, apiMs: 10, attempts: 1 }),
        download: async () => delivered,
        // Stands in for the ffmpeg pass, which rewrites the staged file.
        remuxFile: (path: string) => {
          writeFileSync(path, remuxed);
          return true;
        },
      },
    );
    expect(result.file_size).toBe(remuxed.length);
    expect(result.file_size).not.toBe(delivered.length);
    expect(statSync(output).size).toBe(result.file_size);
  });

  test("a download that never succeeds names the phase and the attempts it spent", async () => {
    const output = join(workspace, "lost", "shot.mp4");
    await expect(
      generateSeedanceVideo(
        { prompt: "x", output, apiKey: "fixture-key", remux: false },
        {
          runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/clip.mp4" } }, apiMs: 1, attempts: 1 }),
          download: async () => {
            throw new Error("HTTP 504");
          },
        },
      ),
    ).rejects.toThrow(/clip download failed after 3 attempts: HTTP 504/);
    expect(existsSync(output)).toBe(false);
  });

  test("an interrupt during the download stays an AbortError, so the CLI still exits 130", async () => {
    const reason = new DOMException("received SIGINT", "AbortError");
    let caught: unknown = null;
    try {
      await generateSeedanceVideo(
        { prompt: "x", output: join(workspace, "aborted", "shot.mp4"), apiKey: "fixture-key", remux: false },
        {
          runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/clip.mp4" } }, apiMs: 1, attempts: 1 }),
          download: async () => {
            throw reason;
          },
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(reason);
  });

  test("a response with no video URL fails loudly and writes nothing", async () => {
    const output = join(workspace, "empty", "shot.mp4");
    await expect(
      generateSeedanceVideo(
        { prompt: "x", output, apiKey: "fixture-key", remux: false },
        { runJob: async () => ({ data: { detail: "moderation" }, apiMs: 1, attempts: 1 }), download: async () => Buffer.alloc(0) },
      ),
    ).rejects.toThrow("no video URL");
    expect(existsSync(output)).toBe(false);
  });
});

/**
 * The blind trials of 2026-09-27 could not say what a clip cost: fal's result
 * carries no price, and the script printed none. It now prints fal's
 * published formula applied to the clip that landed — an estimate, labelled.
 */
describe("what a clip cost", () => {
  test("fal's rate and formula, as read on the pricing API and the model page", () => {
    expect(SEEDANCE_PRICE.usdPer1000Tokens).toEqual({ "480p": 0.0214, "720p": 0.0214, "1080p": 0.0234 });
    expect(SEEDANCE_PRICE.referenceVideoFactor).toBe(0.6);
  });

  test("the trial's 4 s walk: 640×640 for 4.04 s is 38,800 tokens, ≈ $0.83", () => {
    // Route G, 2026-09-27: a "480p" 1:1 request came back 640×640, 97
    // frames at 24 fps — the size the model chose, which is why the clip is
    // measured rather than the request priced.
    const cost = seedanceCost({ width: 640, height: 640, duration: 4.041667, resolution: "480p" });
    expect(cost).toEqual({
      usd: 0.8303, estimate: true, usdPer1000Tokens: 0.0214, basis: "formula-on-delivered-clip",
      tokens: 38800, width: 640, height: 640, duration: 4.042,
    });
    expect(costLine(cost)).toBe("cost: ≈ $0.8303 (estimate: 640×640, 4.042 s → 38800 tokens × $0.0214 per 1000, fal's published formula)");
    expect(seedanceCost({ width: 1920, height: 1080, duration: 5, resolution: "1080p" }).usdPer1000Tokens).toBe(0.0234);
  });

  test("reference videos: the output at 0.6× the rate, and it says their own duration is billed too", () => {
    const cost = seedanceCost({ width: 640, height: 640, duration: 4.041667, resolution: "480p", referenceVideos: 1 });
    expect(cost.usd).toBe(0.4982);
    expect(cost.note).toBe("output only, at 0.6× the rate — fal also bills the 1 reference video's duration");
  });

  test("a clip that cannot be measured has no figure, and the line says why", () => {
    const cost = seedanceCost({ resolution: "480p" });
    expect(cost.usd).toBeNull();
    expect(costLine(cost)).toMatch(/^cost: unknown — the delivered clip could not be measured \(ffprobe\)/);
  });

  test("the result is measured on disk (probe injected), with the reference count from the request", async () => {
    const frame = join(workspace, "ref-frame.png");
    writeFileSync(frame, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64"));
    const greybox = join(workspace, "greybox.mp4");
    writeFileSync(greybox, "clip");
    const probed: string[] = [];
    const result = await generateSeedanceVideo(
      { prompt: "@Video1 as blocking", output: join(workspace, "costed", "shot.mp4"), apiKey: "fixture-key", remux: false, refVideos: [greybox], refImages: [frame] },
      {
        runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/clip.mp4" } }, apiMs: 10, attempts: 1 }),
        download: async () => Buffer.from("bytes"),
        probe: (path: string) => {
          probed.push(path);
          return { width: 640, height: 640, duration: 4.041667 };
        },
      },
    );
    expect(probed).toEqual([join(workspace, "costed", "shot.mp4")]);
    expect(result.cost).toMatchObject({ usd: 0.4982, tokens: 38800, basis: "formula-on-delivered-clip" });
  });
});

describe("seedance CLI guard rails", () => {
  test("--help documents the flags and exits 0", () => {
    const help = runCli(["--help"]);
    expect(help.code).toBe(0);
    for (const flag of ["--prompt", "--output", "--endpoint", "--ref-image", "--duration", "--resolution", "--aspect-ratio", "--no-audio", "--bitrate", "--seed", "--json", "--deadline-s"]) {
      expect(help.err + help.out).toContain(flag);
    }
    expect(help.err + help.out).toContain("@Image1");
  });

  test("missing arguments and a missing key die before any network I/O", () => {
    expect(runCli(["--output", join(workspace, "o.mp4")]).err).toContain("ERROR: --prompt is required");
    expect(runCli(["--prompt", "hi"]).err).toContain("ERROR: --output is required");
    const noKey = runCli(["--prompt", "hi", "--output", join(workspace, "o.mp4")], { FAL_KEY: "" });
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain("FAL_KEY");
    const badDuration = runCli(["--prompt", "hi", "--output", join(workspace, "o.mp4"), "--duration", "99"]);
    expect(badDuration.code).toBe(1);
    expect(badDuration.err).toContain("--duration");
    const noFrame = runCli(["--prompt", "hi", "--output", join(workspace, "o.mp4"), "--endpoint", "image"]);
    expect(noFrame.code).toBe(1);
    expect(noFrame.err).toContain("--image");
  });
});
