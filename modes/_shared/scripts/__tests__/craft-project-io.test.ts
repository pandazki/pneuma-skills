/**
 * craft-project-io.mjs — the writer: the real CLI driven in subprocesses with
 * `--at`, the atomic save and its cleanup on a write failure, and
 * `runRegistered` (record before send, then land or fail) with fake calls.
 *
 * Cheap tests use a WebP fixture, which is measured from its RIFF header
 * without ffprobe. Probing real PNG/MP4/audio with ffprobe is media tier.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { announceMediaTierSkip, mediaTierEnabled } from "../../../../core/__tests__/test-tier.js";
import { probeMedia, runRegistered } from "../craft-project-io.mjs";
import type { CraftProjectFile } from "../craft-project.mjs";

const SCRIPT = resolve(import.meta.dir, "../craft-project-io.mjs");
const MEDIA = mediaTierEnabled("_shared");
announceMediaTierSkip("_shared", "craft-project-io ffprobe probing of real PNG/MP4/audio");
// The release runner enables the media tier on machines without ffmpeg (CI has
// none), so the tier flag alone does not prove the binaries exist.
const HAS_FFMPEG = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;
if (MEDIA && !HAS_FFMPEG) {
  console.warn("(skip) modes/_shared craft-project-io probeMedia fixtures — ffmpeg/ffprobe not on PATH");
}

const root = mkdtempSync(join(tmpdir(), "craft-project-io-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
function workspace(): { dir: string; path: string } {
  const dir = join(root, `ws-${++counter}`);
  mkdirSync(dir, { recursive: true });
  return { dir, path: join(dir, "project.json") };
}

/** A 30-byte lossless WebP header: enough for the RIFF reader, no ffprobe. */
function webp(path: string, width: number, height: number) {
  const head = Buffer.alloc(30);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(22, 4);
  head.write("WEBP", 8, "latin1");
  head.write("VP8L", 12, "latin1");
  head.writeUInt32LE(10, 16);
  head[20] = 0x2f;
  head.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, head);
}

function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function json(...args: string[]) {
  const r = cli(...args, "--json");
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function read(path: string): CraftProjectFile {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function init(path: string) {
  json("init", "--path", path, "--title", "Night Shift", "--sidecar-key", "series", "--width", "1280", "--height", "720", "--fps", "24", "--at", "1000");
}

describe("the CLI — reserve → land and reserve → fail", () => {
  test("init writes an empty project with the sidecar, and refuses to overwrite", () => {
    const { path } = workspace();
    init(path);
    const doc = read(path);
    expect(doc.composition.settings).toEqual({ width: 1280, height: 720, fps: 24, aspectRatio: "16:9" });
    expect(doc.series).toEqual({});
    const again = cli("init", "--path", path, "--title", "x", "--sidecar-key", "series");
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/^ERROR: .*already exists — pass --force/);
  });

  test("reserve is on disk as pending, then land measures it and records the request", () => {
    const { dir, path } = workspace();
    init(path);
    json("reserve", "--path", path, "--id", "ref-guang", "--type", "image", "--name", "Guang sheet", "--op", "generate",
      "--uri", "refs/guang.webp", "--model", "openai/gpt-image-2.5-flare", "--prompt", "turnaround", "--provider", "openrouter",
      "--params-json", '{"aspect":"16:9"}', "--cost-usd", "0.04", "--cost-basis", "estimate", "--at", "2000");
    const reserved = read(path);
    expect(reserved.assets[0]).toEqual({
      id: "ref-guang", type: "image", uri: "refs/guang.webp", name: "Guang sheet", metadata: {}, createdAt: 2000, status: "pending",
    });
    expect(reserved.provenance[0]!.operation.params).toEqual({
      model: "openai/gpt-image-2.5-flare", prompt: "turnaround", provider: "openrouter", aspect: "16:9",
      cost: { usd: 0.04, basis: "estimate" },
    });

    webp(join(dir, "refs/guang.webp"), 1536, 1024);
    const landed = json("land", "--path", path, "--id", "ref-guang", "--request-id", "gen-1",
      "--cost-usd", "0.0388", "--cost-basis", "reported", "--at", "3000");
    expect(landed.asset).toMatchObject({ status: "ready", uri: "refs/guang.webp", metadata: { width: 1536, height: 1024 }, createdAt: 3000 });
    const edge = read(path).provenance[0]!;
    expect(edge.operation.params).toMatchObject({ requestId: "gen-1", finishedAt: 3000, cost: { usd: 0.0388, basis: "reported" } });
    expect(edge.operation.timestamp).toBe(2000);

    const again = cli("land", "--path", path, "--id", "ref-guang", "--at", "4000");
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("is ready and cannot become ready");
  });

  test("land takes the file from --file (absolute or relative) and refuses one outside the project", () => {
    const { dir, path } = workspace();
    init(path);
    json("reserve", "--path", path, "--id", "board", "--type", "image", "--name", "b", "--op", "generate", "--at", "2000");
    const outside = join(root, `outside-${counter}.webp`);
    webp(outside, 10, 10);
    const refused = cli("land", "--path", path, "--id", "board", "--file", outside);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("outside the project directory");
    const missing = cli("land", "--path", path, "--id", "board");
    expect(missing.stderr).toContain("reserved without a planned uri");

    webp(join(dir, "ep01/storyboard-a.webp"), 1920, 1080);
    const landed = json("land", "--path", path, "--id", "board", "--file", join(dir, "ep01/storyboard-a.webp"), "--at", "2500");
    expect(landed.asset.uri).toBe("ep01/storyboard-a.webp");
  });

  test("fail records the reason and billing; cost reads the edges", () => {
    const { path } = workspace();
    init(path);
    json("reserve", "--path", path, "--id", "ep01-a-clip-1", "--type", "video", "--name", "A take 1", "--op", "generate",
      "--uri", "ep01/parts/a-1.mp4", "--cost-usd", "1.2", "--cost-basis", "table", "--generating", "--at", "2000");
    expect(read(path).assets[0]!.status).toBe("generating");
    const failed = json("fail", "--path", path, "--id", "ep01-a-clip-1", "--reason", "deadline exceeded", "--billing", "unknown",
      "--request-id", "req-7", "--at", "9000");
    expect(failed.edge.operation.params).toMatchObject({
      requestId: "req-7", failure: { reason: "deadline exceeded", at: 9000, billing: "unknown" },
    });
    const cost = json("cost", "--path", path);
    expect(cost).toMatchObject({ total: 1.2, calls: 1, uncertain: ["ep01-a-clip-1"] });
    expect(cli("cost", "--path", path).stdout).toContain("failed, billing unknown: ep01-a-clip-1");
  });

  test("reserve on a ready id needs --force; drop cascades; show reports", () => {
    const { dir, path } = workspace();
    init(path);
    webp(join(dir, "a.webp"), 4, 4);
    webp(join(dir, "b.webp"), 4, 4);
    for (const id of ["a", "b"]) {
      json("reserve", "--path", path, "--id", id, "--type", "image", "--name", id, "--op", "generate", "--uri", `${id}.webp`, "--at", "10");
      json("land", "--path", path, "--id", id, "--at", "11");
    }
    json("reserve", "--path", path, "--id", "grid", "--type", "image", "--name", "grid", "--op", "composite",
      "--from", "a,b", "--params-json", '{"op":"replace-panel"}', "--at", "12");
    const refused = cli("reserve", "--path", path, "--id", "a", "--type", "image", "--name", "a", "--op", "generate");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("already ready");

    json("drop", "--path", path, "--id", "a");
    const edge = read(path).provenance.find((e) => e.toAssetId === "grid")!;
    expect(edge.fromAssetId).toBe("b");
    expect(edge.operation.params).toEqual({ op: "replace-panel" });
    const shown = json("show", "--path", path);
    expect(shown.byStatus).toEqual({ pending: 1, generating: 0, ready: 1, failed: 0 });
    expect(json("show", "--path", path, "--id", "grid").edge.operation.type).toBe("composite");
  });

  test("an upload is recorded as the human's", () => {
    const { dir, path } = workspace();
    init(path);
    webp(join(dir, "refs/drawn.webp"), 8, 8);
    const reserved = json("reserve", "--path", path, "--id", "ref-drawn", "--type", "image", "--name", "drawn", "--op", "upload", "--uri", "refs/drawn.webp");
    expect(reserved.edge.operation.actor).toBe("human");
    expect(json("land", "--path", path, "--id", "ref-drawn").asset.status).toBe("ready");
    expect(json("cost", "--path", path).calls).toBe(0);
  });
});

describe("refusals leave the file as it was", () => {
  test("a refused command does not touch the file, and the error is one named line", () => {
    const { path } = workspace();
    init(path);
    const before = readFileSync(path, "utf-8");
    for (const args of [
      ["reserve", "--id", "Bad Id", "--type", "image", "--name", "x", "--op", "generate"],
      ["reserve", "--id", "x", "--type", "image", "--name", "x", "--op", "generate", "--cost-usd", "1"],
      ["reserve", "--id", "x", "--type", "image", "--name", "x", "--op", "import"],
      ["reserve", "--id", "x", "--type", "image", "--name", "x", "--op", "generate", "--from", "ghost"],
      ["fail", "--id", "ghost", "--reason", "r", "--billing", "unknown"],
      ["fail", "--id", "ghost", "--reason", "r", "--billing", "maybe"],
    ]) {
      const r = cli(...args, "--path", path);
      expect(r.code).toBe(1);
      expect(r.stderr.trim().split("\n")).toHaveLength(1);
      expect(r.stderr).toStartWith("ERROR: ");
    }
    expect(readFileSync(path, "utf-8")).toBe(before);
  });

  test("validate names the violation and exits 1; a foreign project is refused by sidecar key", () => {
    const { path } = workspace();
    init(path);
    const doc = read(path);
    doc.assets.push({ id: "x", type: "image", uri: "x.png", name: "x", metadata: {}, createdAt: 1 });
    writeFileSync(path, JSON.stringify(doc));
    const r = cli("validate", "--path", path);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("a ready image must be measured");

    const { path: other } = workspace();
    init(other);
    expect(cli("validate", "--path", other, "--sidecar-key", "sprite").stderr).toContain("no 'sprite' sidecar");
    expect(cli("validate", "--path", other, "--sidecar-key", "series").code).toBe(0);
  });

  test("a write that fails leaves no scratch file and reports one line", () => {
    const { dir } = workspace();
    // The target is a non-empty directory: the scratch file is written, the
    // rename over it fails, and the scratch file must not be left behind.
    const target = join(dir, "project.json");
    mkdirSync(join(target, "occupied"), { recursive: true });
    const driver = join(dir, "driver.mjs");
    writeFileSync(driver, `
      import { saveProject } from ${JSON.stringify(SCRIPT)};
      import { emptyProject } from ${JSON.stringify(resolve(import.meta.dir, "../craft-project.mjs"))};
      saveProject(${JSON.stringify(target)}, emptyProject({ title: "t", sidecarKey: "series" }));
    `);
    const r = Bun.spawnSync(["bun", driver], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toMatch(/^ERROR: cannot write .*project\.json: /);
    expect(readdirSync(dir).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});

describe("runRegistered — record before send", () => {
  function setup() {
    const ws = workspace();
    init(ws.path);
    return ws;
  }
  const spec = { id: "ep01-a-clip-1", type: "video" as const, name: "A take 1", op: "generate" as const, uri: "ep01/parts/a-1.webp", model: "bytedance/seedance-2.5", cost: { usd: 1.2, basis: "table" as const } };

  test("the reservation is on disk while the call runs; the landed file is measured", async () => {
    const { dir, path } = setup();
    let seenDuringCall: unknown = null;
    const phases: string[] = [];
    const outcome = await runRegistered({
      path,
      sidecarKey: "series",
      reserve: { ...spec, type: "image" },
      handleSignals: false,
      now: () => 5000,
      updateSidecar: (doc, phase) => {
        phases.push(phase);
        const series = doc.series as { clips?: string[] };
        if (phase === "land") series.clips = [...(series.clips ?? []), "ep01-a-clip-1"];
      },
      call: async ({ signal }) => {
        expect(signal.aborted).toBe(false);
        seenDuringCall = read(path).assets[0];
        webp(join(dir, "ep01/parts/a-1.webp"), 640, 360);
        return { requestId: "req-42", cost: { usd: 1.1, basis: "reported" as const } };
      },
    });
    expect(seenDuringCall).toMatchObject({ id: "ep01-a-clip-1", status: "generating", uri: "ep01/parts/a-1.webp" });
    expect(outcome.ok).toBe(true);
    expect(phases).toEqual(["reserve", "land"]);
    const doc = read(path);
    expect(doc.assets[0]).toMatchObject({ status: "ready", metadata: { width: 640, height: 360 } });
    expect(doc.provenance[0]!.operation.params).toMatchObject({ requestId: "req-42", cost: { usd: 1.1, basis: "reported" } });
    expect(doc.series).toEqual({ clips: ["ep01-a-clip-1"] });
  });

  test("a request that provably never left is billing none", async () => {
    const { path } = setup();
    const outcome = await runRegistered({
      path, reserve: spec, handleSignals: false,
      call: async () => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
      },
    });
    expect(outcome).toMatchObject({ ok: false, billing: "none", exitCode: 1 });
    expect(read(path).provenance[0]!.operation.params!.failure).toMatchObject({ billing: "none", reason: "fetch failed" });
  });

  test("any other failure is billing unknown and keeps fal's request id", async () => {
    const { path } = setup();
    const outcome = await runRegistered({
      path, reserve: spec, handleSignals: false,
      call: async () => {
        throw Object.assign(new Error("content policy"), { requestId: "req-77" });
      },
    });
    expect(outcome).toMatchObject({ ok: false, billing: "unknown", reason: "content policy" });
    expect(read(path).provenance[0]!.operation.params).toMatchObject({ requestId: "req-77", failure: { billing: "unknown" } });
    expect(read(path).assets[0]!.status).toBe("failed");
  });

  test("an abort says the request was cancelled and that billing is not knowable", async () => {
    const { path } = setup();
    const controller = new AbortController();
    const outcome = await runRegistered({
      path, reserve: spec, handleSignals: false, signal: controller.signal,
      call: ({ signal }) => new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        controller.abort();
      }),
    });
    expect(outcome).toMatchObject({ ok: false, billing: "unknown", interrupted: null, exitCode: 1 });
    expect(outcome.ok ? "" : outcome.reason).toContain("whether it had already been billed is not knowable from here");
  });

  test("a call that returns a file the writer cannot land is still recorded, billing unknown", async () => {
    const { path } = setup();
    const outcome = await runRegistered({
      path, reserve: { ...spec, type: "image" }, handleSignals: false,
      call: async () => ({ requestId: "req-5" }),
    });
    expect(outcome).toMatchObject({ ok: false, billing: "unknown" });
    expect(outcome.ok ? "" : outcome.reason).toContain("file could not be registered: file not found");
    expect(read(path).provenance[0]!.operation.params).toMatchObject({ requestId: "req-5", failure: { billing: "unknown" } });
  });

  test("SIGINT aborts the call, records the failure and exits 130", () => {
    const { path } = setup();
    const driver = join(root, `sigint-${counter}.mjs`);
    writeFileSync(driver, `
      import { runRegistered } from ${JSON.stringify(SCRIPT)};
      const outcome = await runRegistered({
        path: ${JSON.stringify(path)},
        reserve: ${JSON.stringify(spec)},
        call: ({ signal }) => new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
          process.kill(process.pid, "SIGINT");
        }),
      });
      process.exit(outcome.exitCode ?? 0);
    `);
    const r = Bun.spawnSync(["bun", driver], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(130);
    const failure = read(path).provenance[0]!.operation.params!.failure as { reason: string; billing: string };
    expect(failure.billing).toBe("unknown");
    expect(failure.reason).toStartWith("SIGINT — the request was cancelled");
  });
});

describe.skipIf(!MEDIA || !HAS_FFMPEG)("probeMedia — real files through ffprobe [media tier]", () => {
  let dir = "";
  beforeAll(() => {
    dir = workspace().dir;
    const run = (args: string[]) => {
      const r = Bun.spawnSync(["ffmpeg", "-v", "error", "-y", ...args]);
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    };
    run(["-f", "lavfi", "-i", "color=c=red:s=96x54", "-frames:v", "1", join(dir, "a.png")]);
    run(["-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24", "-t", "1", "-pix_fmt", "yuv420p", join(dir, "a.mp4")]);
    run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000", "-t", "1", "-ac", "1", join(dir, "a.wav")]);
    writeFileSync(join(dir, "not-an-image.png"), "plain text");
  });

  test("image, video and audio are measured", () => {
    expect(probeMedia(join(dir, "a.png"), "image")).toEqual({ metadata: { width: 96, height: 54 }, warning: null });
    const video = probeMedia(join(dir, "a.mp4"), "video");
    expect(video.metadata).toMatchObject({ width: 160, height: 90, fps: 24 });
    expect(video.metadata.duration).toBeCloseTo(1, 1);
    const audio = probeMedia(join(dir, "a.wav"), "audio");
    expect(audio.metadata).toMatchObject({ sampleRate: 24000, channels: 1 });
  });

  test("an unreadable image throws; an unreadable video lands with a named warning", () => {
    expect(() => probeMedia(join(dir, "not-an-image.png"), "image")).toThrow("could not read the dimensions");
    expect(probeMedia(join(dir, "not-an-image.png"), "video").warning).toContain("registered without dimensions");
    expect(existsSync(join(dir, "a.png"))).toBe(true);
  });
});
