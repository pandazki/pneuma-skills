/**
 * The exporters on real media (media tier: PNEUMA_TEST_MEDIA=sticker).
 *
 * A full pack is made by sticker.mjs with ffmpeg-drawn stand-ins for the
 * providers (MOCK_REAL_MEDIA=1: transparent GIFs that move, PNG art with
 * GPT Image 2.6's alpha haze), exported for all three platforms, and then
 * every exported file is decoded independently of the exporter — ffprobe,
 * ffmpeg and the container bytes — and held to the platform's numbers.
 * Then: idempotency, determinism, staleness after a pick / keepFrames /
 * order change, and the exporter's edge cases (decimation, repeats,
 * speed-ups, non-uniform delays, the size fit, premultiplied scaling).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { announceMediaTierSkip, mediaTierEnabled } from "../../../core/__tests__/test-tier.js";
import { readGifInfo } from "../../_shared/scripts/generate_gif.mjs";
import * as M from "../skill/scripts/sticker-media.mjs";
import * as S from "../skill/scripts/sticker-state.mjs";
import { drawGif } from "./scripts-mock-generators.mjs";
import { rawPack } from "./sticker-fixture.js";

const MEDIA_TIER = mediaTierEnabled("sticker");
announceMediaTierSkip("sticker", "the sticker exporters on real media (export, decode every file, idempotency, edge cases)");
// The tier can be on where the tools are not (the release runner has no
// ffmpeg): skip with a reason instead of failing every setup.
const MEDIA = MEDIA_TIER &&
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (MEDIA_TIER && !MEDIA) {
  console.warn("(skip) modes/sticker exporters on real media: ffmpeg/ffprobe not on PATH");
}

const STICKER = join(import.meta.dir, "..", "skill", "scripts", "sticker.mjs");
const CRAFT_IO = join(import.meta.dir, "..", "..", "_shared", "scripts", "craft-project-io.mjs");
const MOCK = join(import.meta.dir, "scripts-mock-generators.mjs");
const T0 = 1793000000000;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
function fresh(prefix = "sticker-media-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function run(dir: string, argv: string[]) {
  const r = Bun.spawnSync([process.execPath, STICKER, ...argv, "--dir", dir, "--at", String(T0)], {
    cwd: dir, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, STICKER_GENERATORS: MOCK, MOCK_REAL_MEDIA: "1", MOCK_LOG: "", MOCK_FAIL: "", MOCK_FAIL_STICKER: "", MOCK_NO_KEYS: "", MOCK_SLEEP_MS: "" },
  });
  return { code: r.exitCode ?? -1, out: r.stdout.toString(), err: r.stderr.toString() };
}
function ok(dir: string, argv: string[]) {
  const r = run(dir, [...argv, "--json"]);
  if (r.code !== 0) throw new Error(`sticker ${argv.join(" ")} failed (${r.code}):\n${r.err}\n${r.out}`);
  return JSON.parse(r.out);
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8"));
function editPack(dir: string, mutate: (p: Record<string, any>) => void) {
  const p = readJson(join(dir, "pack.json"));
  mutate(p);
  writeFileSync(join(dir, "pack.json"), JSON.stringify(p, null, 2));
}
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function hashes(dir: string) {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(r);
      else out[r] = sha(join(dir, r));
    }
  };
  walk("exports");
  return out;
}

function ffprobe(path: string, entries: string) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "json", path], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

/** Decode every frame as RGBA with plain ffmpeg (libvpx for WebM alpha) — not the exporter's reader. */
function decode(path: string, width: number, height: number, codec?: string) {
  const r = spawnSync("ffmpeg", ["-v", "error", ...(codec ? ["-c:v", codec] : []), "-i", path, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const size = width * height * 4;
  const frames: Buffer[] = [];
  for (let i = 0; i < r.stdout.length; i += size) frames.push(r.stdout.subarray(i, i + size));
  return frames;
}

/** Semi-transparent pixels with no pixel of alpha ≥ 128 within 2 px: haze, not an anti-aliased edge. */
function detachedSemi(f: Buffer, w: number, h: number) {
  let n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = f[(y * w + x) * 4 + 3];
      if (a === 0 || a >= 128) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy += 1) {
        for (let dx = -2; dx <= 2 && !near; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && f[(yy * w + xx) * 4 + 3] >= 128) near = true;
        }
      }
      if (!near) n += 1;
    }
  }
  return n;
}

const alphaAt = (frame: Buffer, width: number, x: number, y: number) => frame[(y * width + x) * 4 + 3];
const clearPixels = (frames: Buffer[]) => frames.reduce((n, f) => n + [...f].filter((_, i) => i % 4 === 3 && f[i] === 0).length, 0);

/** The 8-sticker pack, made and exported by the CLI. */
let pack: Record<string, any>;
let ws = "";

describe.skipIf(!MEDIA)("sticker export on real media", () => {
  beforeAll(() => {
    ws = fresh("sticker-pack-");
    pack = rawPack();
    pack.character.anchor = null;
    pack.stickers = pack.stickers.map((s: object) => ({ ...s, take: null }));
    pack.art = {};
    pack.listing.wechat.rewardLine = "请老板喝杯咖啡";
    writeFileSync(join(ws, "pack.json"), JSON.stringify(pack, null, 2));
    spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x8899aa:s=640x480", "-frames:v", "1", join(ws, "photo.png")]);
    ok(ws, ["character", "--from", join(ws, "photo.png")]);
    editPack(ws, (p) => {
      p.character.anchor = "character-1";
    });
    ok(ws, ["gen"]);
    ok(ws, ["gen", "--art"]);
    editPack(ws, (p) => {
      p.stickers.forEach((s: { id: string; take: string }) => (s.take = `${s.id}-take-1`));
      p.art = { portrait: "art-portrait-1", head: "art-head-1", banner: "art-banner-1", "reward-guide": "art-reward-guide-1", "reward-thanks": "art-reward-thanks-1" };
    });
    ok(ws, ["export"]);
  }, 300_000);

  test("WeChat: 240×240 GIFs under 500 KB that loop forever, every frame decodes, 1-bit alpha", () => {
    const rules = S.PLATFORM_PROFILES.wechat.sticker;
    for (const n of ["01", "02", "03", "04", "05", "06", "07", "08"]) {
      const file = join(ws, "exports", "wechat", `${n}.gif`);
      const bytes = readFileSync(file);
      expect(bytes.length).toBeLessThanOrEqual(rules.maxBytes);
      const info = readGifInfo(bytes);
      expect(info).toMatchObject({ width: 240, height: 240, frames: 16 });
      expect(info.delaysMs).toEqual(Array(16).fill(120));
      expect(M.gifStructure(bytes).loopCount).toBe(0);
      const frames = decode(file, 240, 240);
      expect(frames).toHaveLength(16);
      expect(clearPixels(frames)).toBeGreaterThan(0);
      for (const f of frames) for (let i = 3; i < f.length; i += 4) expect(f[i] === 0 || f[i] === 255).toBe(true);
    }
  });

  test("WeChat art: a transparent cover and icon with the haze cleaned; opaque banner and reward art", () => {
    const cover = join(ws, "exports", "wechat", "cover.png");
    expect(ffprobe(cover, "stream=width,height,pix_fmt").streams[0]).toMatchObject({ width: 240, height: 240, pix_fmt: "rgba" });
    const [c] = decode(cover, 240, 240);
    // The subject was alpha 254 in the art: now opaque. The faint fog ring around it: now clear.
    expect(alphaAt(c, 240, 120, 120)).toBe(255);
    const ring = [[120 + 79, 120], [120, 120 + 79], [120 - 79, 120], [120, 120 - 79]];
    for (const [x, y] of ring) expect(alphaAt(c, 240, x, y)).toBe(0);
    for (const [x, y] of [[0, 0], [239, 0], [0, 239], [239, 239]]) expect(alphaAt(c, 240, x, y)).toBe(0);
    expect(readFileSync(cover).length).toBeLessThanOrEqual(500_000);
    // No stray alpha anywhere: every semi-transparent pixel of every transparent still sits on the outline.
    for (const [platform, name, w, h] of [["wechat", "cover", 240, 240], ["wechat", "icon", 50, 50], ["telegram", "thumb", 100, 100], ["line", "tab", 96, 74]] as const) {
      const [f] = decode(join(ws, "exports", platform, `${name}.png`), w, h);
      expect({ name, detached: detachedSemi(f, w, h) }).toEqual({ name, detached: 0 });
    }
    expect(ffprobe(join(ws, "exports", "wechat", "icon.png"), "stream=width,height").streams[0]).toMatchObject({ width: 50, height: 50 });
    for (const [name, w, h] of [["banner", 750, 400], ["reward-guide", 750, 560], ["reward-thanks", 750, 750]] as const) {
      const file = join(ws, "exports", "wechat", `${name}.png`);
      const s = ffprobe(file, "stream=width,height,pix_fmt").streams[0];
      expect(s).toMatchObject({ width: w, height: h, pix_fmt: "rgb24" });
      expect(readFileSync(file).length).toBeLessThanOrEqual(500_000);
    }
  });

  test("Telegram: VP9 + alpha WebM, 512 edge, constant 30 fps, ≤ 3 s, ≤ 256 KB, no audio", () => {
    const rules = S.PLATFORM_PROFILES.telegram.sticker;
    for (const n of ["01", "02", "03", "04", "05", "06", "07", "08"]) {
      const file = join(ws, "exports", "telegram", `${n}.webm`);
      expect(readFileSync(file).length).toBeLessThanOrEqual(rules.maxBytes);
      const probe = ffprobe(file, "stream=codec_type,codec_name,width,height,r_frame_rate:stream_tags=alpha_mode");
      expect(probe.streams).toHaveLength(1);
      expect(probe.streams[0]).toMatchObject({ codec_type: "video", codec_name: "vp9", width: 512, height: 512, r_frame_rate: "30/1" });
      expect(probe.streams[0].tags.alpha_mode).toBe("1");
      const frames = decode(file, 512, 512, "libvpx-vp9");
      // 16 × 120 ms = 1.92 s → 58 frames at 30 fps (1.933 s).
      expect(frames).toHaveLength(58);
      expect(frames.length / 30).toBeLessThanOrEqual(3);
      expect(clearPixels([frames[0]])).toBeGreaterThan(0);
    }
    expect(ffprobe(join(ws, "exports", "telegram", "thumb.png"), "stream=width,height").streams[0]).toMatchObject({ width: 100, height: 100 });
  });

  test("LINE: APNG within 320×270 with a 270 side, margins cropped, 5–20 frames, plays within 4 s, ≤ 1 MB", () => {
    const rules = S.PLATFORM_PROFILES.line.sticker;
    for (const n of ["01", "02", "03", "04", "05", "06", "07", "08"]) {
      const file = join(ws, "exports", "line", `${n}.png`);
      const bytes = readFileSync(file);
      expect(bytes.length).toBeLessThanOrEqual(rules.maxBytes);
      const info = M.apngInfo(bytes);
      expect(info.animated).toBe(true);
      expect(info.width).toBeLessThanOrEqual(320);
      expect(info.height).toBeLessThanOrEqual(270);
      expect(info.width >= 270 || info.height >= 270).toBe(true);
      expect(info.frames).toBeGreaterThanOrEqual(5);
      expect(info.frames).toBeLessThanOrEqual(20);
      const loop = info.delaysMs.reduce((a, b) => a + b, 0);
      expect(loop).toBeLessThanOrEqual(4000);
      expect(info.plays).toBeGreaterThanOrEqual(1);
      expect(info.plays! * loop).toBeLessThanOrEqual(4000);
      const frames = decode(file, info.width, info.height);
      expect(frames).toHaveLength(info.frames);
      expect(frames.every((f) => f.equals(frames[0]))).toBe(false);
      expect(clearPixels(frames)).toBeGreaterThan(0);
      // Non-animated margins removed: the figure (over all frames) touches an edge.
      const box = M.unionBox(frames.map((f) => M.alphaBox(f, info.width, info.height)))!;
      expect(Math.min(box.x, box.y, info.width - box.x - box.width, info.height - box.y - box.height)).toBeLessThanOrEqual(1);
    }
    const main = M.apngInfo(readFileSync(join(ws, "exports", "line", "main.png")));
    expect(main).toMatchObject({ width: 240, height: 240, animated: true });
    expect(main.plays! * main.delaysMs.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(4000);
    expect(ffprobe(join(ws, "exports", "line", "tab.png"), "stream=width,height").streams[0]).toMatchObject({ width: 96, height: 74 });
  });

  test("zips hold the upload files only, in order; listing text beside them; every check passes", () => {
    const list = (zip: string) => spawnSync("unzip", ["-Z1", zip], { encoding: "utf-8" }).stdout.trim().split("\n");
    if (spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0) {
      expect(list(join(ws, "exports", "line.zip"))).toEqual(["01.png", "02.png", "03.png", "04.png", "05.png", "06.png", "07.png", "08.png", "main.png", "tab.png"]);
      expect(list(join(ws, "exports", "wechat.zip"))).toEqual(["01.gif", "02.gif", "03.gif", "04.gif", "05.gif", "06.gif", "07.gif", "08.gif", "cover.png", "icon.png", "banner.png", "reward-guide.png", "reward-thanks.png"]);
      expect(spawnSync("unzip", ["-tq", join(ws, "exports", "telegram.zip")]).status).toBe(0);
    }
    const listing = readFileSync(join(ws, "exports", "wechat", "上架文案.md"), "utf-8");
    expect(listing).toContain("表情名称 name: 打工牛马");
    expect(listing).toContain("- 01.gif: 收到");
    const check = run(ws, ["check", "--json"]);
    const out = JSON.parse(check.out);
    for (const platform of ["wechat", "telegram", "line"]) {
      const fails = out.platforms[platform].rows.filter((r: { level: string }) => r.level === "fail");
      expect({ platform, fails }).toEqual({ platform, fails: [] });
    }
    // Only the unconfirmed rules warn.
    expect(out.platforms.wechat.rows.filter((r: { level: string }) => r.level === "warn").map((r: { id: string }) => r.id)).toEqual(["reward-thumb"]);
    expect(out.platforms.line.rows.filter((r: { level: string }) => r.level === "warn").map((r: { id: string }) => r.id)).toEqual(["zip-naming"]);
    expect(check.code).toBe(0);
  });

  test("check holds the upload zip to its record: a truncated or missing zip fails, in the JSON and the exit status", () => {
    const file = join(ws, "exports", "wechat.zip");
    const bytes = readFileSync(file);
    try {
      writeFileSync(file, bytes.subarray(0, 100));
      const truncated = run(ws, ["check", "--json"]);
      expect(truncated.code).toBe(1);
      expect(JSON.parse(truncated.out).diskMismatch).toEqual(["exports/wechat.zip"]);
      rmSync(file);
      const missing = run(ws, ["check"]);
      expect(missing.code).toBe(1);
      expect(missing.out).toContain("exports/wechat.zip is missing or changed on disk since it was exported");
    } finally {
      writeFileSync(file, bytes);
    }
    expect(run(ws, ["check"]).code).toBe(0);
  });

  test("idempotent and deterministic: a rerun writes nothing; re-deriving gives the same bytes", () => {
    const before = hashes(ws);
    const projectBefore = readFileSync(join(ws, "project.json"), "utf-8");
    const again = ok(ws, ["export"]);
    for (const p of ["wechat", "telegram", "line"]) {
      expect(again.platforms[p].items.every((i: { state: string }) => i.state === "current")).toBe(true);
      expect(again.platforms[p].archive.state).toBe("current");
    }
    expect(readFileSync(join(ws, "project.json"), "utf-8")).toBe(projectBefore);
    expect(hashes(ws)).toEqual(before);
    // The files gone: the same inputs make the same bytes, and no asset is duplicated.
    rmSync(join(ws, "exports"), { recursive: true, force: true });
    ok(ws, ["export"]);
    expect(hashes(ws)).toEqual(before);
    const ids = readJson(join(ws, "project.json")).assets.map((a: { id: string }) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 120_000);

  test("a new pick, keepFrames and a removed sticker re-export only what they touch", () => {
    ok(ws, ["gen", "--only", "s02", "--redo"]);
    editPack(ws, (p) => {
      p.stickers[1].take = "s02-take-2";
      p.stickers[2].keepFrames = [0, 2, 4, 6, 8, 10, 12, 14];
    });
    const state = ok(ws, ["status"]);
    expect(state.exports.line.items.filter((i: { state: string }) => i.state === "stale").map((i: { deliverable: string }) => i.deliverable)).toEqual(["s02", "s03"]);
    const out = ok(ws, ["export", "--platform", "line"]);
    const exported = out.platforms.line.items.filter((i: { state: string }) => i.state === "exported").map((i: { deliverable: string }) => i.deliverable);
    expect(exported).toEqual(["s02", "s03"]);
    const trimmed = M.apngInfo(readFileSync(join(ws, "exports", "line", "03.png")));
    expect(trimmed.frames).toBe(8);
    expect(trimmed.delaysMs).toEqual(Array(8).fill(120));
    const project = readJson(join(ws, "project.json"));
    expect(project.provenance.find((e: { toAssetId: string }) => e.toAssetId === "line-s02").fromAssetId).toBe("s02-take-2");

    // Drop s04: its exports go, the rest renumber, and the WeChat zip follows.
    editPack(ws, (p) => {
      p.stickers.splice(3, 1);
    });
    ok(ws, ["export", "--platform", "wechat"]);
    const files = readdirSync(join(ws, "exports", "wechat")).filter((f) => f.endsWith(".gif")).sort();
    expect(files).toEqual(["01.gif", "02.gif", "03.gif", "04.gif", "05.gif", "06.gif", "07.gif"]);
    const after = readJson(join(ws, "project.json"));
    expect(after.assets.some((a: { id: string }) => a.id === "wechat-s04")).toBe(false);
    expect(after.assets.find((a: { id: string }) => a.id === "wechat-s05").uri).toBe("exports/wechat/04.gif");
    expect(after.sticker.archives.wechat.entries.slice(0, 7)).toEqual(files);
    // 7 stickers: WeChat (8–24) now fails its count, and says so.
    const check = JSON.parse(run(ws, ["check", "--platform", "wechat", "--json"]).out);
    expect(check.platforms.wechat.rows.find((r: { id: string }) => r.id === "count").level).toBe("fail");
  }, 120_000);

  test("inspect: a contact sheet on both plates and the loop numbers", () => {
    const out = ok(ws, ["inspect", "s01"]);
    expect(out.contactSheet).toBe("inspect/s01-take-1-contact.png");
    expect(existsSync(join(ws, out.contactSheet))).toBe(true);
    expect(out.sheet).toMatchObject({ frames: 16, cell: { width: 160, height: 160 } });
    const s = ffprobe(join(ws, out.contactSheet), "stream=width,height").streams[0];
    expect(s).toMatchObject({ width: out.sheet.width, height: out.sheet.height });
    expect(out.measure.motion.steps).toHaveLength(15);
    expect(out.measure.alpha.semi).toBe(0);
  });

  test("inspect after a trim shows what ships: the kept frames by their own numbers, the seam from the last kept to the first; --all shows the whole take", () => {
    // s03 keeps [0, 2, …, 14] since the re-export test above.
    const kept = [0, 2, 4, 6, 8, 10, 12, 14];
    const out = ok(ws, ["inspect", "s03"]);
    expect(out).toMatchObject({ take: "s03-take-1", kept, contactSheet: "inspect/s03-take-1-kept-contact.png" });
    expect(out.sheet).toMatchObject({ frames: 8, labels: kept });
    expect(out.measure).toMatchObject({ frames: 8, framesInTake: 16, kept, durationMs: 960 });
    expect(out.measure.delaysMs).toEqual(Array(8).fill(120));
    expect(out.measure.motion.steps).toHaveLength(7);
    expect(existsSync(join(ws, out.contactSheet))).toBe(true);
    const text = run(ws, ["inspect", "s03"]).out;
    expect(text).toContain("keepFrames: these are the 8 kept frames of 16 (0, 2, 4, 6, 8, 10, 12, 14) — what every export uses; --all shows the whole take");
    expect(text).toContain("contact sheet (light and dark plates): inspect/s03-take-1-kept-contact.png");
    const all = ok(ws, ["inspect", "s03", "--all"]);
    expect(all).toMatchObject({ contactSheet: "inspect/s03-take-1-contact.png", kept: null });
    expect(all.measure.frames).toBe(16);
    expect(run(ws, ["inspect", "s03", "--all"]).out).toContain("the whole take — exports use only the 8 kept frames");
    // The seam the export plays is last kept → first kept, not frame 15 → frame 0.
    expect(out.measure.motion.seam).not.toBe(all.measure.motion.seam);
  });
});

describe.skipIf(!MEDIA)("Telegram's thumbnail without portrait art", () => {
  let dir = "";
  beforeAll(() => {
    dir = fresh("sticker-thumb-");
    const raw = rawPack();
    raw.platforms = ["telegram"];
    raw.listing = { telegram: raw.listing.telegram };
    raw.character.anchor = null;
    raw.stickers = raw.stickers.slice(0, 2).map((s: object) => ({ ...s, take: null }));
    raw.art = {};
    writeFileSync(join(dir, "pack.json"), JSON.stringify(raw, null, 2));
    spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x8899aa:s=640x480", "-frames:v", "1", join(dir, "photo.png")]);
    ok(dir, ["character", "--from", join(dir, "photo.png")]);
    editPack(dir, (p) => {
      p.character.anchor = "character-1";
    });
    ok(dir, ["gen"]);
    editPack(dir, (p) => {
      p.stickers.forEach((s: { id: string; take: string }) => (s.take = `${s.id}-take-1`));
    });
  }, 120_000);

  /** The left edge of the figure in a 100×100 RGBA still. */
  const leftEdge = (file: string) => M.alphaBox(decode(file, 100, 100)[0], 100, 100)!.x;

  test("is made, free, from the first sticker's first kept frame: a 100×100 transparent PNG in the zip, and the row says where it came from", () => {
    const out = ok(dir, ["export", "--platform", "telegram"]);
    expect(out.platforms.telegram.items.find((i: { deliverable: string }) => i.deliverable === "thumb")).toMatchObject({ state: "exported", file: "exports/telegram/thumb.png", derivedFrom: { sticker: "s01", frame: 0 } });
    const thumb = join(dir, "exports", "telegram", "thumb.png");
    expect(ffprobe(thumb, "stream=width,height,pix_fmt").streams[0]).toMatchObject({ width: 100, height: 100, pix_fmt: "rgba" });
    expect(readFileSync(thumb).length).toBeLessThanOrEqual(128_000);
    const [f] = decode(thumb, 100, 100);
    expect(detachedSemi(f, 100, 100)).toBe(0);
    for (const [x, y] of [[0, 0], [99, 0], [0, 99], [99, 99]]) expect(alphaAt(f, 100, x, y)).toBe(0);
    const edge = readJson(join(dir, "project.json")).provenance.find((e: { toAssetId: string }) => e.toAssetId === "telegram-thumb");
    expect(edge).toMatchObject({ fromAssetId: "s01-take-1", operation: { type: "derive", params: { op: "export", deliverable: "thumb", frame: 0 } } });
    const check = JSON.parse(run(dir, ["check", "--json"]).out);
    const row = check.platforms.telegram.rows.find((r: { id: string }) => r.id === "thumb");
    expect(row.level).toBe("pass");
    expect(row.detail).toContain("made from s01, frame 0 (no portrait art picked)");
    expect(check.platforms.telegram.rows.find((r: { id: string }) => r.id === "zip").level).toBe("pass");
    if (spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0) {
      expect(spawnSync("unzip", ["-Z1", join(dir, "exports", "telegram.zip")], { encoding: "utf-8" }).stdout.trim().split("\n")).toEqual(["01.webm", "02.webm", "thumb.png"]);
    }
  }, 60_000);

  test("follows a trim: keepFrames moves it to the first kept frame, and only it and the trimmed sticker are made again", () => {
    const before = leftEdge(join(dir, "exports", "telegram", "thumb.png"));
    editPack(dir, (p) => {
      p.stickers[0].keepFrames = [10, 11, 12, 13, 14, 15];
    });
    const out = ok(dir, ["export", "--platform", "telegram"]);
    const exported = out.platforms.telegram.items.filter((i: { state: string }) => i.state === "exported").map((i: { deliverable: string }) => i.deliverable);
    expect(exported).toEqual(["s01", "thumb"]);
    // The re-made trimmed sticker is named, with the look that shows what ships.
    expect(out.trimmed).toEqual(["s01"]);
    expect(ok(dir, ["export", "--platform", "telegram"]).trimmed).toEqual([]);
    // The mock figure moves right frame by frame: frame 10 sits further right than frame 0.
    expect(leftEdge(join(dir, "exports", "telegram", "thumb.png"))).toBeGreaterThan(before);
    expect(readJson(join(dir, "project.json")).provenance.find((e: { toAssetId: string }) => e.toAssetId === "telegram-thumb").operation.params.frame).toBe(10);
  }, 60_000);
});

describe.skipIf(!MEDIA)("export writes and deletes only what the project owns", () => {
  let dir = "";
  const wechat = (name: string) => join(dir, "exports", "wechat", name);
  const zip = () => join(dir, "exports", "wechat.zip");
  beforeAll(() => {
    dir = fresh("sticker-own-");
    const raw = rawPack();
    raw.platforms = ["wechat"];
    raw.character.anchor = null;
    raw.stickers = raw.stickers.slice(0, 3).map((s: object) => ({ ...s, take: null }));
    raw.art = {};
    writeFileSync(join(dir, "pack.json"), JSON.stringify(raw, null, 2));
    spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x8899aa:s=640x480", "-frames:v", "1", join(dir, "photo.png")]);
    ok(dir, ["character", "--from", join(dir, "photo.png")]);
    editPack(dir, (p) => {
      p.character.anchor = "character-1";
    });
    ok(dir, ["gen"]);
    ok(dir, ["gen", "--art"]);
    editPack(dir, (p) => {
      p.stickers.forEach((s: { id: string; take: string }) => (s.take = `${s.id}-take-1`));
      p.art = { portrait: "art-portrait-1", head: "art-head-1", banner: "art-banner-1" };
    });
  }, 300_000);

  test("a file at a deliverable's name that the project does not record is refused by name and left as it is", () => {
    mkdirSync(join(dir, "exports", "wechat"), { recursive: true });
    writeFileSync(wechat("02.gif"), "the user's own file");
    writeFileSync(wechat("09.gif"), "another file of theirs");
    const r = run(dir, ["export", "--json"]);
    expect(r.code).toBe(1);
    const row = JSON.parse(r.out).platforms.wechat.items.find((i: { deliverable: string }) => i.deliverable === "s02");
    expect(row.state).toBe("error");
    expect(row.reason).toContain("exports/wechat/02.gif exists but project.json does not record it");
    expect(readFileSync(wechat("02.gif"), "utf-8")).toBe("the user's own file");
    expect(readFileSync(wechat("09.gif"), "utf-8")).toBe("another file of theirs");
    expect(readJson(join(dir, "project.json")).assets.some((a: { id: string }) => a.id === "wechat-s02")).toBe(false);
    expect(existsSync(wechat("01.gif")) && existsSync(wechat("03.gif"))).toBe(true);
    expect(r.err).toContain("left alone in exports/wechat (not recorded as this pack's exports): 02.gif, 09.gif");
    // Resolved the way the error says: 02.gif is made, the zip is built, 09.gif stays out of both.
    rmSync(wechat("02.gif"));
    const again = ok(dir, ["export"]);
    expect(again.platforms.wechat.items.filter((i: { state: string }) => i.state === "exported").map((i: { deliverable: string }) => i.deliverable)).toEqual(["s02"]);
    expect(again.platforms.wechat.archive.state).toBe("exported");
    expect(readFileSync(wechat("09.gif"), "utf-8")).toBe("another file of theirs");
    expect(readJson(join(dir, "project.json")).sticker.archives.wechat.entries).not.toContain("09.gif");
  }, 120_000);

  test("an upload zip the project does not record is refused unless it already holds exactly the archive's bytes", () => {
    const ours = readFileSync(zip());
    const drop = (doc: Record<string, any>) => {
      delete doc.sticker.archives.wechat;
      writeFileSync(join(dir, "project.json"), `${JSON.stringify(doc, null, 2)}\n`);
    };
    drop(readJson(join(dir, "project.json")));
    writeFileSync(zip(), "their zip");
    const r = run(dir, ["export", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).platforms.wechat.archive).toMatchObject({ state: "error" });
    expect(JSON.parse(r.out).platforms.wechat.archive.reason).toContain("exports/wechat.zip exists but project.json does not record it");
    expect(readFileSync(zip(), "utf-8")).toBe("their zip");
    // A run cut off after writing the zip and before recording it: the same bytes are taken back.
    writeFileSync(zip(), ours);
    const back = ok(dir, ["export"]);
    expect(back.platforms.wechat.archive.state).toBe("exported");
    expect(readFileSync(zip()).equals(ours)).toBe(true);
    expect(readJson(join(dir, "project.json")).sticker.archives.wechat.bytes).toBe(ours.length);
  }, 120_000);

  test("a file the project owned and no export claims any more is deleted; the rest stay", () => {
    // Identical bytes whose record was lost are taken back too.
    const before = readFileSync(wechat("01.gif"));
    const dropped = Bun.spawnSync([process.execPath, CRAFT_IO, "drop", "--path", join(dir, "project.json"), "--id", "wechat-s01"], { cwd: dir, stderr: "pipe" });
    expect(dropped.exitCode).toBe(0);
    editPack(dir, (p) => {
      p.stickers.splice(2, 1);
    });
    const out = ok(dir, ["export"]);
    expect(out.platforms.wechat.removed).toEqual(["wechat-s03"]);
    expect(existsSync(wechat("03.gif"))).toBe(false);
    expect(readFileSync(wechat("01.gif")).equals(before)).toBe(true);
    expect(readFileSync(wechat("09.gif"), "utf-8")).toBe("another file of theirs");
    const doc = readJson(join(dir, "project.json"));
    expect(doc.assets.find((a: { id: string }) => a.id === "wechat-s01").uri).toBe("exports/wechat/01.gif");
    expect(doc.sticker.archives.wechat.entries.slice(0, 2)).toEqual(["01.gif", "02.gif"]);
  }, 120_000);
});

describe.skipIf(!MEDIA)("exporter edge cases", () => {
  let dir = "";
  beforeAll(() => {
    dir = fresh();
  });
  const source = (frames: number, frameMs: number, size = 256) => {
    const file = join(dir, `src-${frames}-${frameMs}-${size}.gif`);
    if (!existsSync(file)) drawGif(file, { frames, frameMs, width: size, height: size });
    return M.readGifFrames(file);
  };

  test("LINE: 24 frames are decimated, 3 are repeated, a long loop is played faster", () => {
    const many = M.exportSticker("line", source(24, 120), null);
    expect(many.measure).toMatchObject({ frames: 12, loopCount: 1, durationMs: 2880 });
    expect(many.measure.fit).toMatchObject({ step: 2, ok: true });
    const few = M.exportSticker("line", source(3, 200), null);
    expect(few.measure).toMatchObject({ frames: 6, durationMs: 1200, loopCount: 3 });
    const slow = M.exportSticker("line", source(10, 500), null);
    expect(slow.measure.durationMs).toBeLessThanOrEqual(4000);
    expect(slow.measure.fit.speed).toBe(0.8);
    expect(slow.measure.loopCount).toBe(1);
  }, 60_000);

  test("Telegram: a 4 s loop plays in 3 s at 30 fps", () => {
    const long = M.exportSticker("telegram", source(40, 100), null);
    expect(long.measure).toMatchObject({ frames: 90, fps: 30, durationMs: 3000, width: 512, height: 512 });
    expect(long.measure.fit.speed).toBe(0.75);
  }, 60_000);

  test("non-uniform delays survive into GIF and APNG exactly", () => {
    const base = join(dir, "uneven.gif");
    drawGif(base, { frames: 6, frameMs: 120, width: 256, height: 256 });
    const uneven = join(dir, "uneven-delays.gif");
    writeFileSync(uneven, M.setGifDelays(readFileSync(base), [120, 120, 480, 120, 120, 240]));
    const src = M.readGifFrames(uneven);
    expect(src.delaysMs).toEqual([120, 120, 480, 120, 120, 240]);
    const gif = M.exportSticker("wechat", src, null);
    expect(readGifInfo(gif.bytes).delaysMs).toEqual([120, 120, 480, 120, 120, 240]);
    const apng = M.exportSticker("line", src, null);
    expect(M.apngInfo(apng.bytes).delaysMs).toEqual([120, 120, 480, 120, 120, 240]);
  }, 60_000);

  test("the size fit: noise over 500 KB is brought under by fewer colours or frames", () => {
    const noisy = join(dir, "noise.gif");
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=512x512:r=25/3:d=1.92,format=rgb24,noise=alls=100:allf=t+u", "-frames:v", "16", "-filter_complex", "[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0", noisy]);
    expect(r.status).toBe(0);
    const out = M.exportSticker("wechat", M.readGifFrames(noisy), null);
    expect(out.measure.fit.ok).toBe(true);
    expect(out.bytes.length).toBeLessThanOrEqual(500_000);
    expect(out.measure.fit.colors! < 256 || out.measure.fit.step! > 1).toBe(true);
  }, 60_000);

  test("every encoder is deterministic", () => {
    const src = source(8, 120);
    for (const platform of ["wechat", "telegram", "line"] as const) {
      expect(M.exportSticker(platform, src, null).bytes.equals(M.exportSticker(platform, src, null).bytes)).toBe(true);
    }
  }, 60_000);

  test("scaling is premultiplied: GPT Image's white-under-clear never fringes the outline", () => {
    // White under every clear pixel (as GPT Image 2.6 GIFs have), a dark figure.
    const w = 512;
    const frames = [0, 1, 2, 3].map((k) => {
      const f = Buffer.alloc(w * w * 4);
      for (let i = 0; i < w * w; i += 1) f.set([255, 255, 255, 0], i * 4);
      for (let y = 150; y < 350; y += 1) for (let x = 150 + k * 8; x < 350 + k * 8; x += 1) f.set([30, 30, 40, 255], (y * w + x) * 4);
      return f;
    });
    const out = M.exportSticker("wechat", { width: w, height: w, frames, delaysMs: [120, 120, 120, 120], info: { width: w, height: w, frames: 4, delaysMs: [120, 120, 120, 120] } }, null);
    const file = join(dir, "fringe.gif");
    writeFileSync(file, out.bytes);
    const [f] = decode(file, 240, 240);
    let edge = 0;
    let light = 0;
    for (let y = 1; y < 239; y += 1) {
      for (let x = 1; x < 239; x += 1) {
        const p = (y * 240 + x) * 4;
        if (f[p + 3] === 0) continue;
        if (![p - 4, p + 4, p - 960, p + 960].some((q) => f[q + 3] === 0)) continue;
        edge += 1;
        if (f[p] > 100) light += 1;
      }
    }
    expect(edge).toBeGreaterThan(100);
    expect(light).toBe(0);
  }, 60_000);

});
