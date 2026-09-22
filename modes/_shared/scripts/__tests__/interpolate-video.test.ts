/**
 * interpolate-video.mjs — Topaz Video AI or RIFE on fal.ai.
 *
 * The mapping from this CLI's short aliases to fal's enum, and every range
 * refusal that must happen BEFORE a paid submit (and before the upload),
 * are the whole point of the script, so they are pinned here; the upload
 * and download halves run against injected stubs, never fal.
 *
 * `upscale_factor: 1` gets its own case: it is the default a loop wants,
 * fal documents the default as 2, and a silent coercion would double the
 * bill and quadruple the pixels behind the caller's back.
 *
 * The two endpoints share one `--model` flag and nothing else: Topaz is
 * told the rate it must hit, RIFE multiplies the rate it is given. A flag
 * of one reaching the other would be a field the schema does not have, so
 * the cross-refusals are pinned in both directions.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildInterpolateRequest,
  DEFAULT_BETWEEN,
  DEFAULT_UPSCALE,
  INTERPOLATORS,
  interpolateVideo,
  MAX_UPSCALE,
  MODEL_ALIASES,
  RIFE_URL,
  TARGET_FPS_MAX,
  TARGET_FPS_MIN,
  TOPAZ_URL,
} from "../interpolate-video.mjs";

const workspace = mkdtempSync(join(tmpdir(), "topaz-test-"));

const CLIP_BYTES = Buffer.from("not a real mp4, but it exists and is named like one");
const clip = join(workspace, "clip.mp4");
writeFileSync(clip, CLIP_BYTES);
const out = join(workspace, "out.mp4");

/** What `uploadFalFile` hands back: a clip fal can fetch, not a data URI. */
const HOSTED = "https://v3b.fal.media/files/b/0a847700/clip.mp4";
const quiet = { upload: async () => HOSTED, onNote: () => {} };

/** A Topaz body, without the union narrowing every assertion would need. */
const topazBody = async (over: Record<string, unknown> = {}) =>
  (await buildInterpolateRequest({ input: clip, output: out, ...over }, quiet)).body as unknown as Record<string, unknown>;

/** The same for RIFE. */
const rifeBody = async (over: Record<string, unknown> = {}) =>
  (await buildInterpolateRequest({ input: clip, output: out, model: "rife", ...over }, quiet)).body as unknown as Record<string, unknown>;

const SCRIPT = join(fileURLToPath(new URL("..", import.meta.url)), "interpolate-video.mjs");

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

describe("topaz request bodies", () => {
  test("the default is Proteus at 60 fps with no resize, forced to H.264", async () => {
    const request = await buildInterpolateRequest({ input: clip, output: out }, quiet);
    expect(request.url).toBe(TOPAZ_URL);
    expect(TOPAZ_URL).toBe("https://fal.run/fal-ai/topaz/upscale/video");
    expect(request.model).toBe("proteus");
    expect(request.body).toEqual({
      video_url: HOSTED,
      model: "Proteus",
      upscale_factor: 1,
      target_fps: 60,
      H264_output: true,
    });
  });

  test("every alias maps to fal's own spelling, and nothing else does", async () => {
    // Confirmed against the endpoint's documented ModelEnum on
    // https://fal.ai/models/fal-ai/topaz/upscale/video/api — the other
    // documented values are denoise/generative families this pipeline has
    // no use for, and an unknown alias must not travel into a paid request.
    expect(MODEL_ALIASES).toEqual({ proteus: "Proteus", "gaia-2": "Gaia 2" });
    for (const [alias, falName] of Object.entries(MODEL_ALIASES)) {
      const request = await buildInterpolateRequest({ input: clip, output: out, model: alias }, quiet);
      expect(request.body).toMatchObject({ model: falName });
      expect(request.model).toBe(alias);
      expect(request.family).toBe("topaz");
    }
    await expect(buildInterpolateRequest({ input: clip, output: out, model: "Proteus" }, quiet)).rejects.toThrow("--model");
    await expect(buildInterpolateRequest({ input: clip, output: out, model: "apollo" }, quiet)).rejects.toThrow("--model");
  });

  test("target-fps is a whole number inside the supported range, or a refusal naming the flag", async () => {
    expect(await topazBody({ targetFps: TARGET_FPS_MIN })).toMatchObject({ target_fps: 16 });
    expect(await topazBody({ targetFps: TARGET_FPS_MAX })).toMatchObject({ target_fps: 60 });
    // The CLI hands strings through; the body must still carry a number.
    expect(await topazBody({ targetFps: "30" })).toMatchObject({ target_fps: 30 });
    await expect(buildInterpolateRequest({ input: clip, output: out, targetFps: 15 }, quiet)).rejects.toThrow("--target-fps");
    await expect(buildInterpolateRequest({ input: clip, output: out, targetFps: 61 }, quiet)).rejects.toThrow("--target-fps");
    await expect(buildInterpolateRequest({ input: clip, output: out, targetFps: 59.94 }, quiet)).rejects.toThrow("--target-fps");
    await expect(buildInterpolateRequest({ input: clip, output: out, targetFps: "fast" }, quiet)).rejects.toThrow("--target-fps");
  });

  test("upscale 1 is sent as 1 — never quietly promoted to fal's default of 2", async () => {
    // Measured 2026-09-22: the live endpoint accepts upscale_factor 1 and
    // returns the source size, so this is the loop's default and it travels
    // exactly as given.
    expect(DEFAULT_UPSCALE).toBe(1);
    expect(await topazBody({ upscale: 1 })).toMatchObject({ upscale_factor: 1 });
    expect(await topazBody({ upscale: "1" })).toMatchObject({ upscale_factor: 1 });
    expect(await topazBody({ upscale: 1.5 })).toMatchObject({ upscale_factor: 1.5 });
    expect(await topazBody({ upscale: MAX_UPSCALE })).toMatchObject({ upscale_factor: 8 });
    await expect(buildInterpolateRequest({ input: clip, output: out, upscale: 0 }, quiet)).rejects.toThrow("--upscale");
    await expect(buildInterpolateRequest({ input: clip, output: out, upscale: -2 }, quiet)).rejects.toThrow("--upscale");
    await expect(buildInterpolateRequest({ input: clip, output: out, upscale: 9 }, quiet)).rejects.toThrow("--upscale");
    await expect(buildInterpolateRequest({ input: clip, output: out, upscale: "big" }, quiet)).rejects.toThrow("--upscale");
  });

  test("a local clip is uploaded, an http(s) one is passed through, and a data URI is refused", async () => {
    const uploaded: Array<{ path: string; key?: string; label?: string }> = [];
    const upload = async (path: string, options: { key?: string; label?: string }) => {
      uploaded.push({ path, key: options.key, label: options.label });
      return HOSTED;
    };
    const local = await buildInterpolateRequest({ input: clip, output: out, apiKey: "fixture-key" }, { ...quiet, upload });
    expect(local.body.video_url).toBe(HOSTED);
    // The endpoint answers `Invalid URL: URL too long` to a data URI.
    expect(local.body.video_url.startsWith("data:")).toBe(false);
    expect(uploaded).toEqual([{ path: clip, key: "fixture-key", label: "--input" }]);

    uploaded.length = 0;
    const hosted = await buildInterpolateRequest({ input: "https://example.com/a.mp4", output: out }, { ...quiet, upload });
    expect(hosted.body.video_url).toBe("https://example.com/a.mp4");
    expect(uploaded).toEqual([]);

    await expect(buildInterpolateRequest({ input: "data:video/mp4;base64,AAAA", output: out }, quiet))
      .rejects.toThrow(/--input must be a file path or an http\(s\) URL/);
  });

  test("the output container follows H264_output, and no refusal costs an upload", async () => {
    let uploads = 0;
    const counted = { ...quiet, upload: async () => { uploads += 1; return HOSTED; } };
    await expect(buildInterpolateRequest({ input: clip, output: join(workspace, "out.webm") }, counted)).rejects.toThrow(/--output must be a \.mp4 path/);
    await expect(buildInterpolateRequest({ input: clip, output: join(workspace, "out.mov") }, counted)).rejects.toThrow("--output");
    await expect(buildInterpolateRequest({ output: out }, counted)).rejects.toThrow("--input");
    await expect(buildInterpolateRequest({ input: clip }, counted)).rejects.toThrow("--output");
    await expect(buildInterpolateRequest({ input: join(workspace, "gone.mp4"), output: out }, counted)).rejects.toThrow("not found");
    expect(uploads).toBe(0);
  });
});

describe("rife request bodies", () => {
  test("rife names its own endpoint and multiplies the rate rather than setting one", async () => {
    const request = await buildInterpolateRequest({ input: clip, output: out, model: "rife" }, quiet);
    expect(request.url).toBe(RIFE_URL);
    expect(RIFE_URL).toBe("https://fal.run/fal-ai/rife/video");
    expect(request.model).toBe("rife");
    expect(request.family).toBe("rife");
    expect(INTERPOLATORS).toEqual({ proteus: "topaz", "gaia-2": "topaz", rife: "rife" });
    // `num_frames: 1` turns 24 fps into 48 — there is no target rate here,
    // so no `fps` travels and `use_calculated_fps` says to work it out.
    expect(DEFAULT_BETWEEN).toBe(1);
    expect(request.body).toEqual({
      video_url: HOSTED,
      num_frames: 1,
      use_scene_detection: false,
      use_calculated_fps: true,
      loop: false,
    });
  });

  test("--loop is the flag the wrap needs, and --scene-detect the one a cut needs", async () => {
    // fal documents `loop: true` as "the final frame will be looped back to
    // the first frame to create a seamless loop" — the one pair Topaz never
    // sees. Measured on the trial clip: seam 0.0107 against a step of
    // 0.0275, under half a step.
    expect(await rifeBody({ loop: true })).toMatchObject({ loop: true });
    expect(await rifeBody({ sceneDetect: true })).toMatchObject({ use_scene_detection: true });
    expect(await rifeBody({ between: "2" })).toMatchObject({ num_frames: 2 });
    expect(await rifeBody({ between: 3 })).toMatchObject({ num_frames: 3 });
  });

  test("--fps pins the rate, and only then does an fps field travel", async () => {
    expect(await rifeBody({ fps: "48" })).toMatchObject({ use_calculated_fps: false, fps: 48 });
    expect(await rifeBody()).not.toHaveProperty("fps");
    await expect(buildInterpolateRequest({ input: clip, output: out, model: "rife", fps: 120 }, quiet)).rejects.toThrow("--fps");
    await expect(buildInterpolateRequest({ input: clip, output: out, model: "rife", fps: "quick" }, quiet)).rejects.toThrow("--fps");
  });

  test("--between is a whole number of invented frames, at least one", async () => {
    await expect(buildInterpolateRequest({ input: clip, output: out, model: "rife", between: 0 }, quiet)).rejects.toThrow("--between");
    await expect(buildInterpolateRequest({ input: clip, output: out, model: "rife", between: 1.5 }, quiet)).rejects.toThrow("--between");
    await expect(buildInterpolateRequest({ input: clip, output: out, model: "rife", between: "lots" }, quiet)).rejects.toThrow("--between");
  });

  test("each endpoint refuses the other's flags by name, before any upload", async () => {
    let uploads = 0;
    const counted = { ...quiet, upload: async () => { uploads += 1; return HOSTED; } };
    const refuse = (over: Record<string, unknown>) =>
      buildInterpolateRequest({ input: clip, output: out, ...over }, counted);

    // Topaz has no multiplier and no wrap flag …
    await expect(refuse({ between: 2 })).rejects.toThrow("--between");
    await expect(refuse({ loop: true })).rejects.toThrow("--loop");
    await expect(refuse({ sceneDetect: true })).rejects.toThrow("--scene-detect");
    await expect(refuse({ fps: 48 })).rejects.toThrow("--fps");
    // … and RIFE has no target rate and no resize.
    await expect(refuse({ model: "rife", targetFps: 60 })).rejects.toThrow("--target-fps");
    await expect(refuse({ model: "rife", upscale: 2 })).rejects.toThrow("--upscale");
    expect(uploads).toBe(0);
  });
});

describe("topaz download and result", () => {
  const upload = async () => HOSTED;

  test("the retimed clip lands whole, with the JSON the callers persist", async () => {
    const output = join(workspace, "topaz", "loop-60.mp4");
    const bytes = Buffer.from("fake h264 payload");
    const submitted: unknown[] = [];
    const result = await interpolateVideo(
      { input: clip, output, apiKey: "fixture-key", targetFps: "48", upscale: "2", model: "gaia-2" },
      {
        upload,
        runJob: async (options: { url: string; body: unknown }) => {
          submitted.push({ url: options.url, body: options.body });
          return { data: { video: { url: "https://cdn.fal.ai/upscaled.mp4", content_type: "video/mp4" } }, apiMs: 10, attempts: 1 };
        },
        download: async (url: string) => {
          expect(url).toBe("https://cdn.fal.ai/upscaled.mp4");
          return bytes;
        },
      },
    );
    expect(result).toEqual({
      path: output,
      url: "https://cdn.fal.ai/upscaled.mp4",
      file_size: bytes.length,
      target_fps: 48,
      upscale_factor: 2,
      // fal's spelling, as sent — not the alias the caller typed.
      model: "Gaia 2",
    });
    expect(submitted).toEqual([{
      url: TOPAZ_URL,
      body: { video_url: HOSTED, model: "Gaia 2", upscale_factor: 2, target_fps: 48, H264_output: true },
    }]);
    expect(readFileSync(output)).toEqual(bytes);
    // Atomic: the staging file never survives a successful run.
    expect(readdirSync(join(workspace, "topaz"))).toEqual(["loop-60.mp4"]);
    expect(statSync(output).size).toBe(result.file_size);
  });

  test("a list where fal documents one file is unwrapped rather than lost", async () => {
    const output = join(workspace, "listed", "loop-60.mp4");
    const result = await interpolateVideo(
      { input: clip, output, apiKey: "fixture-key" },
      {
        upload,
        runJob: async () => ({ data: { video: [{ url: "https://cdn.fal.ai/upscaled.mp4" }] }, apiMs: 1, attempts: 1 }),
        download: async () => Buffer.from("x"),
      },
    );
    expect(result.url).toBe("https://cdn.fal.ai/upscaled.mp4");
  });

  test("a rife run reports the multiplier and the wrap, not a target rate", async () => {
    const output = join(workspace, "rife", "loop-48.mp4");
    const bytes = Buffer.from("fake h264 payload");
    const submitted: unknown[] = [];
    const result = await interpolateVideo(
      { input: clip, output, apiKey: "fixture-key", model: "rife", between: "1", loop: true },
      {
        upload,
        runJob: async (options: { url: string; body: unknown }) => {
          submitted.push({ url: options.url, body: options.body });
          // The shape fal really answered on the trial clip: one object.
          return { data: { video: { url: "https://cdn.fal.ai/rife.mp4", content_type: "video/mp4", file_size: 570_000 } }, apiMs: 10, attempts: 1 };
        },
        download: async () => bytes,
      },
    );
    expect(result).toEqual({
      path: output,
      url: "https://cdn.fal.ai/rife.mp4",
      file_size: bytes.length,
      model: "rife",
      between: 1,
      loop: true,
    });
    // No `target_fps` and no `upscale_factor`: nobody set either of them.
    expect(result).not.toHaveProperty("target_fps");
    expect(submitted).toEqual([{
      url: RIFE_URL,
      body: { video_url: HOSTED, num_frames: 1, use_scene_detection: false, use_calculated_fps: true, loop: true },
    }]);
    expect(readFileSync(output)).toEqual(bytes);
  });

  test("a response with no video URL fails loudly and writes nothing", async () => {
    const output = join(workspace, "empty", "loop-60.mp4");
    await expect(
      interpolateVideo(
        { input: clip, output, apiKey: "fixture-key" },
        { upload, runJob: async () => ({ data: { detail: "unsupported codec" }, apiMs: 1, attempts: 1 }), download: async () => Buffer.alloc(0) },
      ),
    ).rejects.toThrow("no video URL");
    expect(existsSync(output)).toBe(false);
    expect(existsSync(`${output}.tmp`)).toBe(false);
  });

  test("a download that never succeeds names the phase and the attempts it spent", async () => {
    const output = join(workspace, "lost", "loop-60.mp4");
    await expect(
      interpolateVideo(
        { input: clip, output, apiKey: "fixture-key" },
        {
          upload,
          runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/upscaled.mp4" } }, apiMs: 1, attempts: 1 }),
          download: async () => { throw new Error("HTTP 504"); },
        },
      ),
    ).rejects.toThrow(/clip download failed after 3 attempts: HTTP 504/);
    expect(existsSync(output)).toBe(false);
  });

  test("an interrupt during the download stays an AbortError, so the CLI still exits 130", async () => {
    const reason = new DOMException("received SIGINT", "AbortError");
    let caught: unknown = null;
    try {
      await interpolateVideo(
        { input: clip, output: join(workspace, "aborted", "loop-60.mp4"), apiKey: "fixture-key" },
        {
          upload,
          runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/upscaled.mp4" } }, apiMs: 1, attempts: 1 }),
          download: async () => { throw reason; },
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(reason);
  });

  test("a missing key is refused before anything is uploaded or submitted", async () => {
    await expect(
      interpolateVideo(
        { input: clip, output: join(workspace, "nokey.mp4") },
        {
          upload: async () => { throw new Error("must not upload"); },
          runJob: async () => { throw new Error("must not submit"); },
        },
      ),
    ).rejects.toThrow("No API key found");
  });
});

describe("interpolate-video CLI guard rails", () => {
  test("--help documents the flags, the aliases and the price, and exits 0", () => {
    const help = runCli(["--help"]);
    expect(help.code).toBe(0);
    const text = help.err + help.out;
    for (const flag of ["--input", "--output", "--target-fps", "--upscale", "--model", "--between", "--loop", "--scene-detect", "--json", "--deadline-s"]) {
      expect(text).toContain(flag);
    }
    expect(text).toContain("proteus");
    expect(text).toContain("gaia-2");
    expect(text).toContain("rife");
    expect(text).toContain("$0.01");
    expect(text).toContain("$0.0013");
  });

  test("missing arguments and a missing key die before any network I/O", () => {
    expect(runCli(["--output", out]).err).toContain("ERROR: --input is required");
    expect(runCli(["--input", clip]).err).toContain("ERROR: --output is required");
    const noKey = runCli(["--input", clip, "--output", out], { FAL_KEY: "" });
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain("FAL_KEY");
  });

  test("an out-of-range fps, an unknown model and a non-mp4 output all fail before the paid submit", () => {
    const badFps = runCli(["--input", clip, "--output", out, "--target-fps", "120"]);
    expect(badFps.code).toBe(1);
    expect(badFps.err).toContain("--target-fps");

    const badModel = runCli(["--input", clip, "--output", out, "--model", "apollo"]);
    expect(badModel.code).toBe(1);
    expect(badModel.err).toContain("--model");

    const badContainer = runCli(["--input", clip, "--output", join(workspace, "o.webm")]);
    expect(badContainer.code).toBe(1);
    expect(badContainer.err).toContain("--output");

    const badUpscale = runCli(["--input", clip, "--output", out, "--upscale", "0"]);
    expect(badUpscale.code).toBe(1);
    expect(badUpscale.err).toContain("--upscale");
  });
});
