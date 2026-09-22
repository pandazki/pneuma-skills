/**
 * remove-video-background.mjs — VEED / Bria video matting on fal.ai.
 *
 * Three layers, none of which reach fal:
 *   - the two request bodies and every refusal that must happen BEFORE a
 *     paid submit — and before the upload (the container each model can
 *     write, the veed-only flags, Bria's documented 30 s / 4000² limits);
 *   - the result half with an injected uploader, job runner and
 *     downloader, pinning that a local clip is UPLOADED rather than
 *     inlined, the two different documented response shapes (`video[0]`
 *     for veed, `video` for bria) and the atomic write;
 *   - the CLI's own guard rails, by spawning the real script.
 *
 * The limit check is exercised twice: with an injected probe (so it runs
 * on a machine without ffmpeg) and against real ffmpeg-made clips, which
 * is the only way to know the ffprobe invocation itself is right. That
 * second group skips with a named reason when ffmpeg is missing.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRIA_MAX_DIMENSION,
  BRIA_MAX_DURATION_S,
  buildRemoveVideoBackgroundRequest,
  DEFAULT_SPILL_SUPPRESSION,
  MATTE_MODELS,
  mattedFile,
  probeVideoFile,
  removeVideoBackground,
} from "../remove-video-background.mjs";

const workspace = mkdtempSync(join(tmpdir(), "video-matte-test-"));

/** Bytes are irrelevant to the request builder: it checks name and existence. */
const CLIP_BYTES = Buffer.from("not a real mp4, but it exists and is named like one");
const clip = join(workspace, "clip.mp4");
writeFileSync(clip, CLIP_BYTES);

/** What `uploadFalFile` hands back: a clip fal can fetch, not a data URI. */
const HOSTED = "https://v3b.fal.media/files/b/0a847700/clip.mp4";

/** No ffprobe, no network, no stderr: these cases are about the bodies. */
const quiet = { probe: () => null, upload: async () => HOSTED, onNote: () => {} };

const SCRIPT = join(fileURLToPath(new URL("..", import.meta.url)), "remove-video-background.mjs");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

if (!HAS_FFMPEG) {
  console.warn("(skip) modes/_shared remove-video-background.mjs probe fixtures — ffmpeg/ffprobe not on PATH");
}

function makeClip(name: string, { seconds = 1, size = "64x64", fps = 25 } = {}) {
  const path = join(workspace, name);
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=green:s=${size}:d=${seconds}:r=${fps}`,
      "-pix_fmt", "yuv420p", path],
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

describe("video matting request bodies", () => {
  test("veed asks for VP9 with alpha, refined, and a subject that is not a person", async () => {
    const request = await buildRemoveVideoBackgroundRequest({ input: clip, output: join(workspace, "out.webm") }, quiet);
    expect(request.url).toBe("https://fal.run/veed/video-background-removal");
    expect(request.model).toBe("veed");
    expect(request.body).toEqual({
      video_url: HOSTED,
      output_codec: "vp9",
      // fal's own default for `subject_is_person` is true; this pipeline
      // mattes 3D icons and stylized characters, so it is sent false.
      refine_foreground_edges: true,
      subject_is_person: false,
    });
  });

  test("--person and --no-refine are the two knobs veed has", async () => {
    const out = join(workspace, "out.webm");
    expect((await buildRemoveVideoBackgroundRequest({ input: clip, output: out, person: true }, quiet)).body).toMatchObject({
      subject_is_person: true,
      refine_foreground_edges: true,
    });
    expect((await buildRemoveVideoBackgroundRequest({ input: clip, output: out, refine: false }, quiet)).body).toMatchObject({
      subject_is_person: false,
      refine_foreground_edges: false,
    });
  });

  test("veed-gs asks the green-screen endpoint for VP9 with alpha and a spill strength", async () => {
    const request = await buildRemoveVideoBackgroundRequest(
      { input: clip, output: join(workspace, "gs.webm"), model: "veed-gs" },
      quiet,
    );
    expect(request.url).toBe("https://fal.run/veed/video-background-removal/green-screen");
    expect(request.model).toBe("veed-gs");
    // The endpoint is TOLD the plate is chroma green, so it carries neither
    // `subject_is_person` nor `refine_foreground_edges`: sending either would
    // be a field the schema does not have.
    expect(request.body).toEqual({
      video_url: HOSTED,
      output_codec: "vp9",
      spill_suppression_strength: DEFAULT_SPILL_SUPPRESSION,
    });
    expect(MATTE_MODELS["veed-gs"].extension).toBe(".webm");
  });

  test("--spill is the one knob veed-gs has, and it is a number", async () => {
    const out = join(workspace, "gs.webm");
    const gs = (spill: unknown) =>
      buildRemoveVideoBackgroundRequest({ input: clip, output: out, model: "veed-gs", spill } as any, quiet);
    expect((await gs("0.35")).body).toMatchObject({ spill_suppression_strength: 0.35 });
    expect((await gs(0)).body).toMatchObject({ spill_suppression_strength: 0 });
    await expect(gs("aggressive")).rejects.toThrow("--spill");
    await expect(gs(-1)).rejects.toThrow("--spill");
  });

  test("the flags the other endpoints have are refused on veed-gs, and --spill on them", async () => {
    const gs = join(workspace, "gs.webm");
    await expect(buildRemoveVideoBackgroundRequest(
      { input: clip, output: gs, model: "veed-gs", person: true }, quiet,
    )).rejects.toThrow("--person");
    await expect(buildRemoveVideoBackgroundRequest(
      { input: clip, output: gs, model: "veed-gs", refine: false }, quiet,
    )).rejects.toThrow("--no-refine");
    await expect(buildRemoveVideoBackgroundRequest(
      { input: clip, output: join(workspace, "out.webm"), model: "veed", spill: 0.5 } as any, quiet,
    )).rejects.toThrow("--spill");
    await expect(buildRemoveVideoBackgroundRequest(
      { input: clip, output: join(workspace, "out.mov"), model: "bria", spill: 0.5 } as any, quiet,
    )).rejects.toThrow("--spill");
  });

  test("bria asks for a transparent ProRes MOV and drops the audio", async () => {
    const request = await buildRemoveVideoBackgroundRequest({ input: clip, output: join(workspace, "out.mov"), model: "bria" }, quiet);
    expect(request.url).toBe("https://fal.run/bria/video/background-removal");
    expect(request.model).toBe("bria");
    expect(request.body).toEqual({
      video_url: HOSTED,
      background_color: "Transparent",
      output_container_and_codec: "mov_proresks",
      preserve_audio: false,
    });
  });

  test("a local clip is uploaded, and an http(s) one is passed through untouched", async () => {
    const uploaded: Array<{ path: string; key?: string; label?: string }> = [];
    const upload = async (path: string, options: { key?: string; label?: string }) => {
      uploaded.push({ path, key: options.key, label: options.label });
      return HOSTED;
    };
    const local = await buildRemoveVideoBackgroundRequest(
      { input: clip, output: join(workspace, "out.webm"), apiKey: "fixture-key" },
      { ...quiet, upload },
    );
    expect(local.body.video_url).toBe(HOSTED);
    // The endpoints cap `video_url` at 2083 characters: inlining is not an
    // option for a clip, however small this fixture happens to be.
    expect(local.body.video_url.startsWith("data:")).toBe(false);
    expect(uploaded).toEqual([{ path: clip, key: "fixture-key", label: "--input" }]);

    uploaded.length = 0;
    const hosted = await buildRemoveVideoBackgroundRequest(
      { input: "https://example.com/a.mp4", output: join(workspace, "out.webm") },
      { ...quiet, upload },
    );
    expect(hosted.body.video_url).toBe("https://example.com/a.mp4");
    expect(uploaded).toEqual([]);
  });

  test("a data URI is refused here, naming the limit that would have refused it upstream", async () => {
    await expect(buildRemoveVideoBackgroundRequest(
      { input: "data:video/mp4;base64,AAAA", output: join(workspace, "out.webm") },
      quiet,
    )).rejects.toThrow(/--input must be a file path or an http\(s\) URL/);
  });

  test("the container each model can write is enforced by the output's name", async () => {
    expect(MATTE_MODELS.veed.extension).toBe(".webm");
    expect(MATTE_MODELS.bria.extension).toBe(".mov");
    await expect(buildRemoveVideoBackgroundRequest({ input: clip, output: join(workspace, "out.mov") }, quiet)).rejects.toThrow(/--output must be a \.webm path/);
    await expect(buildRemoveVideoBackgroundRequest({ input: clip, output: join(workspace, "out.webm"), model: "bria" }, quiet)).rejects.toThrow(/--output must be a \.mov path/);
    await expect(buildRemoveVideoBackgroundRequest({ input: clip, output: join(workspace, "out.mp4") }, quiet)).rejects.toThrow("--output");
  });

  test("every other refusal names its flag too, and none of them costs an upload", async () => {
    const webm = join(workspace, "out.webm");
    const mov = join(workspace, "out.mov");
    let uploads = 0;
    const counted = { ...quiet, upload: async () => { uploads += 1; return HOSTED; } };

    await expect(buildRemoveVideoBackgroundRequest({ output: webm }, counted)).rejects.toThrow("--input");
    await expect(buildRemoveVideoBackgroundRequest({ input: clip }, counted)).rejects.toThrow("--output");
    await expect(buildRemoveVideoBackgroundRequest({ input: clip, output: webm, model: "birefnet" }, counted)).rejects.toThrow("--model");
    // A flag the chosen endpoint does not have must not travel as a no-op.
    await expect(buildRemoveVideoBackgroundRequest({ input: clip, output: mov, model: "bria", person: true }, counted)).rejects.toThrow("--person");
    await expect(buildRemoveVideoBackgroundRequest({ input: clip, output: mov, model: "bria", refine: false }, counted)).rejects.toThrow("--no-refine");
    await expect(buildRemoveVideoBackgroundRequest({ input: join(workspace, "gone.mp4"), output: webm }, counted)).rejects.toThrow("not found");
    expect(uploads).toBe(0);
  });
});

describe("Bria's documented input limits are measured before the paid call", () => {
  const mov = join(workspace, "limits.mov");
  const bria = (probe: () => any, notes: string[] = []) =>
    buildRemoveVideoBackgroundRequest(
      { input: clip, output: mov, model: "bria" },
      { probe, upload: async () => HOSTED, onNote: (m: string) => notes.push(m) },
    );

  test("a clip past 30 s or 4000 px is refused here, naming the input", async () => {
    await expect(bria(() => ({ width: 1440, height: 1440, duration: 31 }))).rejects.toThrow(/--input is 31\.0s/);
    await expect(bria(() => ({ width: 1440, height: 1440, duration: 31 }))).rejects.toThrow(String(BRIA_MAX_DURATION_S));
    await expect(bria(() => ({ width: 4001, height: 1440, duration: 4 }))).rejects.toThrow(/--input is 4001x1440/);
    await expect(bria(() => ({ width: 1440, height: 4001, duration: 4 }))).rejects.toThrow(String(BRIA_MAX_DIMENSION));
    // The documented ceilings themselves are inside the window.
    const edge = await bria(() => ({ width: BRIA_MAX_DIMENSION, height: BRIA_MAX_DIMENSION, duration: BRIA_MAX_DURATION_S }));
    expect(edge.body).toMatchObject({ background_color: "Transparent" });
  });

  test("an unmeasurable input says the limits were not checked instead of pretending", async () => {
    const notes: string[] = [];
    expect((await bria(() => null, notes)).body.video_url).toBe(HOSTED);
    expect(notes.join("\n")).toMatch(/ffprobe could not measure/);

    const remote: string[] = [];
    await buildRemoveVideoBackgroundRequest(
      { input: "https://example.com/a.mp4", output: mov, model: "bria" },
      {
        probe: () => { throw new Error("a URL must not be probed locally"); },
        upload: async () => { throw new Error("a URL must not be uploaded"); },
        onNote: (m: string) => remote.push(m),
      },
    );
    expect(remote.join("\n")).toMatch(/URL, so Bria's limits/);
  });

  test("veed has no documented ceiling, so it is not probed at all", async () => {
    let probes = 0;
    await buildRemoveVideoBackgroundRequest(
      { input: clip, output: join(workspace, "no-probe.webm") },
      { probe: () => { probes += 1; return null; }, upload: async () => HOSTED, onNote: () => {} },
    );
    expect(probes).toBe(0);
  });

  test.skipIf(!HAS_FFMPEG)("the real ffprobe call reads a real clip, and the refusal fires on a real 31 s one", async () => {
    const short = makeClip("probe-short.mp4", { seconds: 1 });
    const probed = probeVideoFile(short);
    expect(probed?.width).toBe(64);
    expect(probed?.height).toBe(64);
    expect(probed?.duration).toBeGreaterThan(0.9);
    expect(probed?.duration).toBeLessThan(1.2);

    // Default probe: the real ffprobe runs, and a 1 s clip passes.
    const upload = { upload: async () => HOSTED, onNote: () => {} };
    const ok = await buildRemoveVideoBackgroundRequest({ input: short, output: join(workspace, "short.mov"), model: "bria" }, upload);
    expect(ok.body).toMatchObject({ background_color: "Transparent" });

    const long = makeClip("probe-long.mp4", { seconds: BRIA_MAX_DURATION_S + 1 });
    await expect(buildRemoveVideoBackgroundRequest({ input: long, output: join(workspace, "long.mov"), model: "bria" }, upload))
      .rejects.toThrow(/--input is 31\.0s/);
    // veed takes the same clip: the limit belongs to Bria, not to the script.
    const veed = await buildRemoveVideoBackgroundRequest({ input: long, output: join(workspace, "long.webm") }, upload);
    expect(veed.body).toMatchObject({ output_codec: "vp9" });
  });

  test.skipIf(!HAS_FFMPEG)("a file ffprobe cannot read measures as null, not as zero", () => {
    expect(probeVideoFile(clip)).toBeNull();
    expect(probeVideoFile(join(workspace, "does-not-exist.mp4"))).toBeNull();
  });
});

describe("which file in the response is the matte", () => {
  test("veed-gs answers the same list shape as its sibling", () => {
    const file = { url: "https://v3.fal.media/files/gs.webm" };
    expect(mattedFile({ video: [file] }, "veed-gs", { onNote: () => {} })).toBe(file);
  });

  test("veed's list and bria's single file are each taken as documented", () => {
    // Measured 2026-09-22: VEED's entry carries content_type
    // "application/octet-stream", so the pick must not depend on it.
    const listed = mattedFile({ video: [{ url: "https://cdn.fal.ai/a.webm", content_type: "application/octet-stream" }] }, "veed");
    expect(listed?.url).toBe("https://cdn.fal.ai/a.webm");
    const single = mattedFile({ video: { url: "https://cdn.fal.ai/a.mov" } }, "bria");
    expect(single?.url).toBe("https://cdn.fal.ai/a.mov");
  });

  test("the other shape is used with a warning rather than dropped — the render is already paid for", () => {
    const veedNotes: string[] = [];
    const veed = mattedFile({ video: { url: "https://cdn.fal.ai/a.webm" } }, "veed", { onNote: (m: string) => veedNotes.push(m) });
    expect(veed?.url).toBe("https://cdn.fal.ai/a.webm");
    expect(veedNotes.join("\n")).toMatch(/^WARN: veed answered `video: File`/);

    const briaNotes: string[] = [];
    const bria = mattedFile({ video: [{ url: "https://cdn.fal.ai/a.mov" }] }, "bria", { onNote: (m: string) => briaNotes.push(m) });
    expect(bria?.url).toBe("https://cdn.fal.ai/a.mov");
    expect(briaNotes.join("\n")).toMatch(/^WARN: bria answered `video: \[File/);
  });

  test("nothing usable is null, and says nothing about a shape it did not find", () => {
    const notes: string[] = [];
    expect(mattedFile({ detail: "moderation" }, "veed", { onNote: (m: string) => notes.push(m) })).toBeNull();
    expect(mattedFile({ video: [] }, "veed", { onNote: (m: string) => notes.push(m) })).toBeNull();
    expect(mattedFile({ video: { content_type: "video/webm" } }, "bria", { onNote: (m: string) => notes.push(m) })).toBeNull();
    expect(mattedFile(null, "veed", { onNote: (m: string) => notes.push(m) })).toBeNull();
    expect(notes).toEqual([]);
  });
});

describe("video matting download and result", () => {
  const upload = async () => HOSTED;

  test("veed's matte lands whole, with the JSON register-run consumes", async () => {
    const output = join(workspace, "veed", "matte.webm");
    const bytes = Buffer.from("fake vp9 payload with alpha");
    const submitted: unknown[] = [];
    const result = await removeVideoBackground(
      { input: clip, output, apiKey: "fixture-key", person: true },
      {
        upload,
        runJob: async (options: { url: string; body: unknown }) => {
          submitted.push({ url: options.url, body: options.body });
          return { data: { video: [{ url: "https://cdn.fal.ai/matte.webm", content_type: "application/octet-stream", file_size: 641966 }] }, apiMs: 10, attempts: 1 };
        },
        download: async (url: string) => {
          expect(url).toBe("https://cdn.fal.ai/matte.webm");
          return bytes;
        },
      },
    );
    expect(result).toEqual({
      path: output,
      url: "https://cdn.fal.ai/matte.webm",
      file_size: bytes.length,
      model: "veed",
      endpoint: "https://fal.run/veed/video-background-removal",
      alpha: true,
    });
    expect(submitted).toEqual([{
      url: "https://fal.run/veed/video-background-removal",
      body: { video_url: HOSTED, output_codec: "vp9", refine_foreground_edges: true, subject_is_person: true },
    }]);
    expect(readFileSync(output)).toEqual(bytes);
    // Atomic: the staging file never survives a successful run.
    expect(readdirSync(join(workspace, "veed"))).toEqual(["matte.webm"]);
    expect(statSync(output).size).toBe(result.file_size);
  });

  test("bria's single-file answer is downloaded the same way, under its own endpoint", async () => {
    const output = join(workspace, "bria", "matte.mov");
    const bytes = Buffer.from("fake prores payload");
    const result = await removeVideoBackground(
      { input: clip, output, apiKey: "fixture-key", model: "bria" },
      {
        upload,
        probe: () => null,
        runJob: async () => ({ data: { video: { url: "https://cdn.fal.ai/matte.mov", file_size: 99 } }, apiMs: 10, attempts: 1 }),
        download: async () => bytes,
      },
    );
    expect(result).toEqual({
      path: output,
      url: "https://cdn.fal.ai/matte.mov",
      // The file on disk, not the `file_size` fal reported for its own copy.
      file_size: bytes.length,
      model: "bria",
      endpoint: "https://fal.run/bria/video/background-removal",
      alpha: true,
    });
  });

  test("a response with no video URL fails loudly and writes nothing", async () => {
    const output = join(workspace, "empty", "matte.webm");
    await expect(
      removeVideoBackground(
        { input: clip, output, apiKey: "fixture-key" },
        { upload, runJob: async () => ({ data: { detail: "moderation" }, apiMs: 1, attempts: 1 }), download: async () => Buffer.alloc(0) },
      ),
    ).rejects.toThrow("no video URL");
    expect(existsSync(output)).toBe(false);
    expect(existsSync(`${output}.tmp`)).toBe(false);
  });

  test("a download that never succeeds names the phase and the attempts it spent", async () => {
    const output = join(workspace, "lost", "matte.webm");
    await expect(
      removeVideoBackground(
        { input: clip, output, apiKey: "fixture-key" },
        {
          upload,
          runJob: async () => ({ data: { video: [{ url: "https://cdn.fal.ai/matte.webm" }] }, apiMs: 1, attempts: 1 }),
          download: async () => { throw new Error("HTTP 504"); },
        },
      ),
    ).rejects.toThrow(/matte download failed after 3 attempts: HTTP 504/);
    expect(existsSync(output)).toBe(false);
  });

  test("an interrupt during the download stays an AbortError, so the CLI still exits 130", async () => {
    const reason = new DOMException("received SIGINT", "AbortError");
    let caught: unknown = null;
    try {
      await removeVideoBackground(
        { input: clip, output: join(workspace, "aborted", "matte.webm"), apiKey: "fixture-key" },
        {
          upload,
          runJob: async () => ({ data: { video: [{ url: "https://cdn.fal.ai/matte.webm" }] }, apiMs: 1, attempts: 1 }),
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
      removeVideoBackground(
        { input: clip, output: join(workspace, "nokey.webm") },
        {
          upload: async () => { throw new Error("must not upload"); },
          runJob: async () => { throw new Error("must not submit"); },
        },
      ),
    ).rejects.toThrow("No API key found");
  });
});

describe("remove-video-background CLI guard rails", () => {
  test("--help documents the flags, the containers and the prices, and exits 0", () => {
    const help = runCli(["--help"]);
    expect(help.code).toBe(0);
    const text = help.err + help.out;
    for (const flag of ["--input", "--output", "--model", "--person", "--no-refine", "--spill", "--json", "--deadline-s"]) {
      expect(text).toContain(flag);
    }
    expect(text).toContain(".webm");
    expect(text).toContain(".mov");
    expect(text).toContain("veed-gs");
    expect(text).toContain("$0.0225");
    expect(text).toContain("$0.015");
    expect(text).toContain("$0.14");
  });

  test("missing arguments and a missing key die before any network I/O", () => {
    expect(runCli(["--output", join(workspace, "o.webm")]).err).toContain("ERROR: --input is required");
    expect(runCli(["--input", clip]).err).toContain("ERROR: --output is required");
    const noKey = runCli(["--input", clip, "--output", join(workspace, "o.webm")], { FAL_KEY: "" });
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain("FAL_KEY");
  });

  test("a bad model, a wrong container and a veed-only flag all fail before the paid submit", () => {
    const badModel = runCli(["--input", clip, "--output", join(workspace, "o.webm"), "--model", "rmbg"]);
    expect(badModel.code).toBe(1);
    expect(badModel.err).toContain("--model");

    const badContainer = runCli(["--input", clip, "--output", join(workspace, "o.mp4"), "--model", "veed"]);
    expect(badContainer.code).toBe(1);
    expect(badContainer.err).toContain("--output");

    const wrongFlag = runCli(["--input", clip, "--output", join(workspace, "o.mov"), "--model", "bria", "--person"]);
    expect(wrongFlag.code).toBe(1);
    expect(wrongFlag.err).toContain("--person");

    const spillOnVeed = runCli(["--input", clip, "--output", join(workspace, "o.webm"), "--model", "veed", "--spill", "0.5"]);
    expect(spillOnVeed.code).toBe(1);
    expect(spillOnVeed.err).toContain("--spill");
  });
});
