/**
 * motion-transfer.mjs — Kling motion control / Wan 2.2 Animate on fal.ai.
 *
 * Four layers, none of which reach fal:
 *   - flag validation per model, including every flag the other model owns,
 *     refused by name BEFORE a key is read;
 *   - the request body per model (the orientation default, the driving
 *     clip's sound always off, the Wan resolution default);
 *   - the driving-clip ceiling (10 s Kling + orientation image, else 30 s),
 *     checked before the upload — by injected probe, and against real
 *     ffmpeg-made clips when ffmpeg is on PATH;
 *   - the cost estimate, the download/write half with injected runner and
 *     downloader, and the CLI's own guard rails by spawning the script.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRequestBody,
  checkDrivingDuration,
  costLine,
  endpointUrl,
  maxDrivingSeconds,
  MODELS,
  prepareRequest,
  probeVideo,
  transferCost,
  transferMotion,
  validateOptions,
} from "../motion-transfer.mjs";

const workspace = mkdtempSync(join(tmpdir(), "motion-transfer-test-"));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
  "base64",
);
const image = join(workspace, "hero.png");
writeFileSync(image, PNG);
const dataUri = `data:image/png;base64,${PNG.toString("base64")}`;
// Not a real clip: the cases that use it inject the probe.
const drivingClip = join(workspace, "dance.mp4");
writeFileSync(drivingClip, "not really an mp4");
const HOSTED = "https://v3b.fal.media/files/b/0a847700/dance.mp4";
const output = join(workspace, "out.mp4");

const base = { image, video: drivingClip, output };
/** No ffprobe, no network, no stderr: these cases are about the bodies. */
const quiet = { probe: () => ({ width: 64, height: 64, duration: 5 }), upload: async () => HOSTED, onNote: () => {} };

const SCRIPT = join(fileURLToPath(new URL("..", import.meta.url)), "motion-transfer.mjs");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) {
  console.warn("(skip) modes/_shared motion-transfer.mjs probe fixtures — ffmpeg/ffprobe not on PATH");
}

function makeClip(name: string, seconds: number) {
  const path = join(workspace, name);
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=gray:s=32x32:d=${seconds}:r=5`, "-pix_fmt", "yuv420p", path],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) throw new Error(`fixture ffmpeg failed for ${name}: ${result.stderr}`);
  return path;
}

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

describe("the three models", () => {
  test("endpoints and per-second prices as read on fal's pricing API", () => {
    expect(Object.fromEntries(Object.entries(MODELS).map(([name, m]) => [name, [m.endpoint, m.family, m.usdPerSecond]]))).toEqual({
      "kling-mc": ["fal-ai/kling-video/v3/standard/motion-control", "kling", 0.126],
      "kling-mc-pro": ["fal-ai/kling-video/v3/pro/motion-control", "kling", 0.168],
      "wan-animate": ["fal-ai/wan/v2.2-14b/animate/move", "wan", 0.08],
    });
    expect(endpointUrl("wan-animate")).toBe("https://fal.run/fal-ai/wan/v2.2-14b/animate/move");
  });

  test("the driving-clip ceiling: 10 s for Kling keeping the image's facing, else 30 s", () => {
    expect(maxDrivingSeconds("kling-mc", "image")).toBe(10);
    expect(maxDrivingSeconds("kling-mc")).toBe(10);
    expect(maxDrivingSeconds("kling-mc-pro", "image")).toBe(10);
    expect(maxDrivingSeconds("kling-mc", "video")).toBe(30);
    expect(maxDrivingSeconds("wan-animate")).toBe(30);
  });
});

describe("flag validation", () => {
  test("the three required inputs, each by name", () => {
    expect(() => validateOptions({ video: drivingClip, output })).toThrow("--image is required");
    expect(() => validateOptions({ image, output })).toThrow("--video is required");
    expect(() => validateOptions({ image, video: drivingClip })).toThrow("--output is required");
    expect(() => validateOptions({ ...base, output: join(workspace, "out.webm") })).toThrow("--output must be an .mp4");
  });

  test("an unknown model is refused with the list of known ones", () => {
    expect(() => validateOptions({ ...base, model: "kling-v2" })).toThrow("--model must be one of: kling-mc, kling-mc-pro, wan-animate (got: kling-v2)");
  });

  test("defaults: kling-mc with orientation image; Wan at 480p", () => {
    expect(validateOptions(base)).toEqual({ ...base, model: "kling-mc", orientation: "image" });
    expect(validateOptions({ ...base, model: "wan-animate" })).toEqual({ ...base, model: "wan-animate", resolution: "480p" });
    expect(validateOptions({ ...base, model: "wan-animate", seed: "7" }).seed).toBe(7);
  });

  test("a flag the chosen model does not have is refused by name, not dropped", () => {
    expect(() => validateOptions({ ...base, resolution: "720p" })).toThrow("--resolution applies to --model wan-animate only");
    expect(() => validateOptions({ ...base, model: "kling-mc-pro", seed: "1" })).toThrow("--seed applies to --model wan-animate only");
    expect(() => validateOptions({ ...base, model: "wan-animate", orientation: "video" })).toThrow("--orientation applies to the Kling models only");
    expect(() => validateOptions({ ...base, model: "wan-animate", prompt: "dance" })).toThrow("--prompt applies to the Kling models only");
  });

  test("out-of-range values are refused", () => {
    expect(() => validateOptions({ ...base, orientation: "front" })).toThrow("--orientation must be one of: image, video");
    expect(() => validateOptions({ ...base, model: "wan-animate", resolution: "1080p" })).toThrow("--resolution must be one of: 480p, 580p, 720p");
    expect(() => validateOptions({ ...base, model: "wan-animate", seed: "1.5" })).toThrow("--seed must be an integer");
    expect(() => validateOptions({ ...base, prompt: "  " })).toThrow("--prompt must not be empty");
  });
});

describe("request bodies", () => {
  test("Kling: orientation defaults to image, the driving clip's sound is always off", () => {
    expect(buildRequestBody("kling-mc", { imageUrl: "I", videoUrl: "V" })).toEqual({
      image_url: "I",
      video_url: "V",
      character_orientation: "image",
      keep_original_sound: false,
    });
    expect(buildRequestBody("kling-mc-pro", { imageUrl: "I", videoUrl: "V", orientation: "video", prompt: "a knight" })).toEqual({
      image_url: "I",
      video_url: "V",
      character_orientation: "video",
      prompt: "a knight",
      keep_original_sound: false,
    });
  });

  test("Wan: resolution defaults to 480p, seed only when given", () => {
    expect(buildRequestBody("wan-animate", { imageUrl: "I", videoUrl: "V" })).toEqual({ image_url: "I", video_url: "V", resolution: "480p" });
    expect(buildRequestBody("wan-animate", { imageUrl: "I", videoUrl: "V", resolution: "720p", seed: 9 })).toEqual({
      image_url: "I", video_url: "V", resolution: "720p", seed: 9,
    });
  });

  test("prepareRequest inlines the image and uploads the local video", async () => {
    const uploads: string[] = [];
    const prepared = await prepareRequest(base, { ...quiet, upload: async (path: string) => { uploads.push(path); return HOSTED; } });
    expect(uploads).toEqual([drivingClip]);
    expect(prepared.url).toBe("https://fal.run/fal-ai/kling-video/v3/standard/motion-control");
    expect(prepared.body).toEqual({ image_url: dataUri, video_url: HOSTED, character_orientation: "image", keep_original_sound: false });
  });

  test("a hosted video passes through un-uploaded, unmeasured, and says so", async () => {
    const notes: string[] = [];
    let uploads = 0;
    let probes = 0;
    const prepared = await prepareRequest(
      { ...base, video: HOSTED, model: "wan-animate" },
      { probe: () => { probes += 1; return null; }, upload: async () => { uploads += 1; return "x"; }, onNote: (m: string) => notes.push(m) },
    );
    expect(prepared.body.video_url).toBe(HOSTED);
    expect(uploads).toBe(0);
    expect(probes).toBe(0);
    expect(notes.join("\n")).toContain("was not checked");
  });

  test("a data-URI video and a missing file are refused before any upload", async () => {
    const never = { ...quiet, upload: async () => { throw new Error("must not upload"); } };
    await expect(prepareRequest({ ...base, video: "data:video/mp4;base64,AAAA" }, never)).rejects.toThrow("data URI");
    await expect(prepareRequest({ ...base, video: join(workspace, "missing.mp4") }, never)).rejects.toThrow("file not found");
    await expect(prepareRequest({ ...base, image: join(workspace, "missing.png") }, never)).rejects.toThrow("not found");
  });
});

describe("the driving clip's length", () => {
  test("over the ceiling is refused before the upload, with the way out", async () => {
    let uploads = 0;
    const long = { probe: () => ({ width: 64, height: 64, duration: 12 }), upload: async () => { uploads += 1; return HOSTED; }, onNote: () => {} };
    await expect(prepareRequest(base, long)).rejects.toThrow(
      "--video is 12.0 s — kling-mc with --orientation image takes a driving clip of at most 10 s. Trim it, or pass --orientation video",
    );
    expect(uploads).toBe(0);
    // The same 12 s clip fits when Kling follows the performer's facing, and on Wan.
    expect((await prepareRequest({ ...base, orientation: "video" }, long)).body.character_orientation).toBe("video");
    expect((await prepareRequest({ ...base, model: "wan-animate" }, long)).body.resolution).toBe("480p");
    expect(uploads).toBe(2);
    await expect(prepareRequest({ ...base, model: "wan-animate" }, { ...long, probe: () => ({ width: 1, height: 1, duration: 31 }) }))
      .rejects.toThrow("wan-animate takes a driving clip of at most 30 s");
  });

  test("an unmeasured clip is not a passing one: false, with a note", () => {
    const notes: string[] = [];
    expect(checkDrivingDuration({ model: "kling-mc", orientation: "image", duration: null, onNote: (m: string) => notes.push(m) })).toBe(false);
    expect(notes[0]).toContain("10 s limit was not checked");
    expect(checkDrivingDuration({ model: "kling-mc", orientation: "image", duration: 10, onNote: () => {} })).toBe(true);
  });

  test.skipIf(!HAS_FFMPEG)("real clips through the real ffprobe: 11 s is refused for Kling image, 2 s passes", async () => {
    const short = makeClip("short.mp4", 2);
    const long = makeClip("long.mp4", 11);
    const probed = probeVideo(short);
    expect(probed?.width).toBe(32);
    expect(probed?.duration).toBeGreaterThan(1.9);
    expect(probed?.duration).toBeLessThan(2.3);
    const upload = { upload: async () => HOSTED, onNote: () => {} };
    expect((await prepareRequest({ ...base, video: short }, upload)).body.video_url).toBe(HOSTED);
    await expect(prepareRequest({ ...base, video: long }, upload)).rejects.toThrow(/--video is 11\.0 s/);
    expect(probeVideo(drivingClip)).toBeNull();
  });
});

describe("what a transfer cost", () => {
  test("price per second × the delivered clip's duration", () => {
    const cost = transferCost({ model: "kling-mc", duration: 5.041667 });
    expect(cost).toEqual({
      usd: 0.6353, estimate: true, usdPerSecond: 0.126, checked: "2026-10-30", duration: 5.042, basis: "seconds-of-delivered-clip",
    });
    expect(costLine(cost, "kling-mc")).toBe(
      "cost: ≈ $0.6353 (estimate: 5.042 s × $0.126 per second, kling-mc at fal's list price, pricing API read 2026-10-30)",
    );
    expect(transferCost({ model: "kling-mc-pro", duration: 10 }).usd).toBe(1.68);
    expect(transferCost({ model: "wan-animate", duration: 10 }).usd).toBe(0.8);
  });

  test("an unmeasured clip has no figure, and the line says why and what fal lists", () => {
    const cost = transferCost({ model: "wan-animate" });
    expect(cost.usd).toBeNull();
    expect(cost.basis).toBe("unknown");
    expect(costLine(cost, "wan-animate")).toBe(
      "cost: unknown (the delivered clip's duration could not be measured (ffprobe); fal lists $0.08 per output second for wan-animate)",
    );
  });
});

describe("download and result", () => {
  test("the clip lands whole, with the JSON callers persist", async () => {
    const out = join(workspace, "clips", "take.mp4");
    const bytes = Buffer.from("fake mp4 payload");
    const submitted: unknown[] = [];
    const result = await transferMotion(
      { ...base, output: out, model: "wan-animate", seed: "3", apiKey: "fixture-key", remux: false },
      {
        ...quiet,
        probe: (path: string) => (path === out ? { width: 832, height: 480, duration: 5 } : { width: 64, height: 64, duration: 5 }),
        runJob: async (options: { url: string; body: unknown; deadlineMs?: number }) => {
          submitted.push({ url: options.url, body: options.body, deadlineMs: options.deadlineMs });
          return { data: { video: { url: "https://cdn.fal.ai/take.mp4" }, prompt: "", seed: 3 }, requestId: "req_9" };
        },
        download: async (url: string) => {
          expect(url).toBe("https://cdn.fal.ai/take.mp4");
          return bytes;
        },
      },
    );
    expect(submitted).toEqual([{
      url: "https://fal.run/fal-ai/wan/v2.2-14b/animate/move",
      body: { image_url: dataUri, video_url: HOSTED, resolution: "480p", seed: 3 },
      deadlineMs: 1_500_000,
    }]);
    expect(result).toEqual({
      path: out,
      url: "https://cdn.fal.ai/take.mp4",
      file_size: bytes.length,
      model: "wan-animate",
      endpoint: "fal-ai/wan/v2.2-14b/animate/move",
      duration: 5,
      width: 832,
      height: 480,
      resolution: "480p",
      seed: 3,
      request_id: "req_9",
      cost: { usd: 0.4, estimate: true, usdPerSecond: 0.08, checked: "2026-10-30", duration: 5, basis: "seconds-of-delivered-clip" },
    });
    expect(readFileSync(out)).toEqual(bytes);
    expect(readdirSync(join(workspace, "clips"))).toEqual(["take.mp4"]);
  });

  test("Kling reports its orientation; an unmeasurable output leaves nulls and an unknown cost", async () => {
    const out = join(workspace, "kling", "take.mp4");
    const result = await transferMotion(
      { ...base, output: out, apiKey: "fixture-key", remux: false },
      {
        ...quiet,
        probe: (path: string) => (path === out ? null : { width: 64, height: 64, duration: 5 }),
        runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/k.mp4" } } }),
        download: async () => Buffer.from("bytes"),
      },
    );
    expect(result.orientation).toBe("image");
    expect("resolution" in result).toBe(false);
    expect("seed" in result).toBe(false);
    expect("request_id" in result).toBe(false);
    expect([result.duration, result.width, result.height]).toEqual([null, null, null]);
    expect(result.cost.usd).toBeNull();
  });

  test("a response with no video URL fails loudly and writes nothing", async () => {
    const out = join(workspace, "empty", "take.mp4");
    await expect(
      transferMotion(
        { ...base, output: out, apiKey: "fixture-key", remux: false },
        { ...quiet, runJob: async () => ({ data: { detail: "moderation" } }), download: async () => Buffer.alloc(0) },
      ),
    ).rejects.toThrow("no video URL");
    expect(existsSync(out)).toBe(false);
  });

  test("an interrupt during the download stays an AbortError", async () => {
    const reason = new DOMException("received SIGINT", "AbortError");
    let caught: unknown = null;
    try {
      await transferMotion(
        { ...base, output: join(workspace, "aborted", "take.mp4"), apiKey: "fixture-key", remux: false },
        { ...quiet, runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/k.mp4" } } }), download: async () => { throw reason; } },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(reason);
  });
});

describe("motion-transfer CLI guard rails", () => {
  test("--help documents the flags and the performer requirement, exits 0", () => {
    const help = runCli(["--help"]);
    expect(help.code).toBe(0);
    for (const flag of ["--image", "--video", "--output", "--model", "--orientation", "--prompt", "--resolution", "--seed", "--json", "--deadline-s"]) {
      expect(help.err).toContain(flag);
    }
    expect(help.err).toContain("REALISTIC performer");
    expect(help.out).toBe("");
  });

  test("bad flags and a missing key die before any network I/O", () => {
    expect(runCli(["--video", drivingClip, "--output", output]).err).toContain("ERROR: --image is required");
    expect(runCli(["--image", image, "--output", output]).err).toContain("ERROR: --video is required");
    expect(runCli(["--image", image, "--video", drivingClip]).err).toContain("ERROR: --output is required");
    const wrongFlag = runCli(["--image", image, "--video", drivingClip, "--output", output, "--resolution", "720p"]);
    expect(wrongFlag.code).toBe(1);
    expect(wrongFlag.err).toContain("--resolution applies to --model wan-animate only");
    const unknown = runCli(["--image", image, "--video", drivingClip, "--output", output, "--model", "sora"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("--model must be one of");
    const noKey = runCli(["--image", image, "--video", drivingClip, "--output", output], { FAL_KEY: "" });
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain("FAL_KEY");
  });
});
