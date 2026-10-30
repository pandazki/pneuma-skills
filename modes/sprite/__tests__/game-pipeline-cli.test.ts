/**
 * The 0.6.0 pipeline end to end, on synthetic pictures and clips (media
 * tier: ffmpeg, no network): a facing sheet cut into anchors, a direction
 * pack planned, plated, shot (a bobbing loop of the plate stands in for the
 * model's take), split on one shared window and registered — and a take
 * whose cells collapsed into one facing caught and refused. Then a props set
 * from an item sheet to an items pack.
 */

import { announceMediaTierSkip, mediaTierEnabled } from "../../../core/__tests__/test-tier.js";
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = join(import.meta.dir, "..", "skill", "scripts", "sprite-project.mjs");
const SHEET = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");
const MEDIA_TIER = mediaTierEnabled("sprite");
announceMediaTierSkip("sprite", "sprite game-pipeline CLI tests");
const HAS_FFMPEG = MEDIA_TIER && spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const media = HAS_FFMPEG ? describe : describe.skip;

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function run(script: string, argv: string[], stdin?: string) {
  const r = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd: import.meta.dir,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}
const ok = (r: { code: number; out: string; err: string }, what: string) => {
  if (r.code !== 0) throw new Error(`${what} failed (${r.code}):\n${r.err}`);
  return r.out;
};
const project = (dir: string, ...argv: string[]) => run(PROJECT, [argv[0], "--dir", dir, ...argv.slice(1)]);
const sheet = (...argv: string[]) => run(SHEET, argv);
const doc = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));

/** An RGBA picture as PNG: `paint(x, y)` returns [r, g, b, a]. */
function png(path: string, width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", "-", "-frames:v", "1", path], { input: data });
  if (r.status !== 0) throw new Error(String(r.stderr));
}

/** A figure for cell `k`: a body and a head, coloured and marked by k so no two cells look alike. */
const HUES: Array<[number, number, number]> = [
  [220, 60, 60], [60, 160, 220], [230, 200, 40], [150, 70, 200], [0, 0, 0], [240, 130, 30], [40, 180, 120], [200, 90, 160], [110, 110, 240],
];
function figure(k: number, lx: number, ly: number): [number, number, number, number] | null {
  // lx, ly in a 120×120 cell
  const [r, g, b] = HUES[k];
  if (lx >= 44 && lx < 76 && ly >= 22 && ly < 46) return [255 - r / 2, 220, 200, 255]; // head
  if (lx >= 40 && lx < 80 && ly >= 46 && ly < 100) {
    const mark = (lx - 40) < 8 + k * 3 && (lx - 40) >= k * 3 ? 60 : 0; // a stripe whose place says k
    return [Math.max(0, r - mark), Math.max(0, g - mark), Math.max(0, b - mark), 255];
  }
  return null;
}
const LAYOUT8 = ["back-left", "back", "back-right", "left", null, "right", "front-left", "front", "front-right"];

/** A cut-out 3×3 facing sheet; `same` draws cell 0's figure everywhere. */
function facingSheet(path: string, same = false) {
  png(path, 360, 360, (x, y) => {
    const cell = Math.floor(y / 120) * 3 + Math.floor(x / 120);
    if (cell === 4) return [0, 0, 0, 0];
    return figure(same ? 0 : cell, x % 120, y % 120) ?? [0, 0, 0, 0];
  });
}

/** A 2 s clip of a plate bobbing as a whole twice a second — every cell in phase. */
function bobbingClip(plate: string, out: string) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", plate, "-t", "2.5", "-r", "24",
    "-vf", "pad=iw:ih+24:0:12:color=0x00ff00,crop=iw:ih-24:0:'12+10*sin(2*PI*t*2)',scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", out]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}

media("a direction pack, end to end", () => {
  test("facing sheet → anchors → pack → plate → clip → split → register; a mixed-up take is refused", () => {
    const root = mkdtempSync(join(tmpdir(), "sprite-pack-"));
    roots.push(root);
    const dir = join(root, "hero");
    ok(project(dir, "init", "--name", "Hero", "--style", "Flat test shapes.", "--view", "isometric"), "init");
    mkdirSync(join(dir, "refs"), { recursive: true });
    facingSheet(join(dir, "refs", "directions.png"));
    ok(project(dir, "add-ref", "--id", "directions", "--file", "refs/directions.png", "--role", "directions", "--layout", "8", "--uploaded"), "add-ref directions");
    expect(doc(dir).sprite.refs[0].layout.cells).toEqual(LAYOUT8);

    // One anchor per facing, trimmed, registered as derived from the sheet.
    const facings = ok(sheet("split-facings", join(dir, "refs", "directions.png"), "--character", dir, "--ref", "directions", "--out", join(dir, "refs"), "--json"), "split-facings");
    expect(JSON.parse(facings).files).toHaveLength(8);
    ok(run(PROJECT, ["register-facings", "--dir", dir, "--report", "-"], facings), "register-facings");
    const anchors = doc(dir).sprite.refs.filter((r: { role: string }) => r.role === "anchor");
    expect(anchors.map((r: { direction: string }) => r.direction).sort()).toEqual(LAYOUT8.filter(Boolean).sort());
    const anchorEdge = doc(dir).provenance.find((e: { toAssetId: string }) => e.toAssetId === "ref-anchor-front");
    expect(anchorEdge.fromAssetId).toBe("ref-directions");

    // The pack and its eight planned cells.
    ok(project(dir, "add-pack", "--state", "walk"), "add-pack");
    const planned = doc(dir).sprite.motions;
    expect(planned.map((m: { id: string }) => m.id)).toEqual(["walk-pack", ...LAYOUT8.filter(Boolean).map((d) => `walk-${d}`)]);
    expect(planned[0].pack.cells[4]).toBeNull();
    expect(planned[1]).toMatchObject({ packOf: "walk-pack", direction: "back-left", status: "planned", source: "video" });
    const prompt = ok(project(dir, "pack-prompt", "--motion", "walk-pack"), "pack-prompt");
    expect(prompt).toContain("All 8 copies walk in place");
    expect(prompt).toContain("Isometric game camera");

    // The plate, every drawing re-placed at one scale with room around it.
    mkdirSync(join(dir, "motions", "walk-pack"), { recursive: true });
    const plate = JSON.parse(ok(sheet("pack-plate", join(dir, "refs", "directions.png"), "--character", dir, "--ref", "directions", "--out", join(dir, "motions", "walk-pack", "plate.png"), "--size", "720", "--json"), "pack-plate"));
    expect(plate.cells).toHaveLength(8);
    expect(plate.size).toEqual({ width: 720, height: 720 });
    for (const cell of plate.cells) expect(cell.placed.h).toBeLessThanOrEqual(Math.ceil(240 * 0.62) + 1);

    // A take: the plate bobbing in phase. Split on one shared window.
    bobbingClip(join(dir, "motions", "walk-pack", "plate.png"), join(dir, "motions", "walk-pack", "take.mp4"));
    ok(project(dir, "add-video", "--motion", "walk-pack", "--file", "motions/walk-pack/take.mp4", "--model", "seedance-2.5", "--mode", "i2v", "--from", "ref-directions", "--status", "ready"), "add-video");
    const report = ok(sheet("pack-split", join(dir, "motions", "walk-pack", "take.mp4"), "--character", dir, "--pack", "walk-pack", "--frames", "6", "--json"), "pack-split");
    const split = JSON.parse(report);
    expect(split.cells).toHaveLength(8);
    expect(split.facingCheck.ok).toBe(true);
    expect(split.facingCheck.lowest[0].ratio).toBeGreaterThan(0.6);
    expect(new Set(split.cells.map((c: { run: { frames: string[] } }) => c.run.frames.length))).toEqual(new Set([6]));
    for (const c of split.cells) expect(existsSync(c.clip)).toBe(true);

    ok(run(PROJECT, ["register-pack", "--dir", dir, "--motion", "walk-pack", "--report", "-"], report), "register-pack");
    const after = doc(dir).sprite.motions;
    expect(after[0].status).toBe("ready");
    for (const cell of after.slice(1)) {
      expect(cell.status).toBe("ready");
      expect(cell.frames).toHaveLength(6);
      expect(cell.videos[0]).toMatchObject({ mode: "derived", op: "crop", derivedFrom: "walk-pack/video-1", model: "ffmpeg" });
    }

    // A take whose every cell shows one facing: caught and refused.
    facingSheet(join(root, "same.png"), true);
    ok(sheet("pack-plate", join(root, "same.png"), "--character", dir, "--ref", "directions", "--out", join(root, "same-plate.png"), "--size", "720"), "pack-plate same");
    bobbingClip(join(root, "same-plate.png"), join(dir, "motions", "walk-pack", "take-2.mp4"));
    ok(project(dir, "add-video", "--motion", "walk-pack", "--file", "motions/walk-pack/take-2.mp4", "--model", "seedance-2.5", "--mode", "i2v", "--status", "ready"), "add-video 2");
    // Refused before anything is cut: the registered take's frames stay.
    const before = readFileSync(join(dir, "motions", "walk-front", "frames", "00.png"));
    const split2 = sheet("pack-split", join(dir, "motions", "walk-pack", "take-2.mp4"), "--character", dir, "--pack", "walk-pack", "--frames", "6", "--json");
    expect(split2.code).toBe(1);
    expect(split2.err).toMatch(/the take mixed up its cells/);
    expect(readFileSync(join(dir, "motions", "walk-front", "frames", "00.png")).equals(before)).toBe(true);
    // Forced, it is cut — and register-pack still refuses it without --force.
    const mixed = ok(sheet("pack-split", join(dir, "motions", "walk-pack", "take-2.mp4"), "--character", dir, "--pack", "walk-pack", "--frames", "6", "--force", "--json"), "pack-split mixed --force");
    expect(JSON.parse(mixed).facingCheck.ok).toBe(false);
    const refused = run(PROJECT, ["register-pack", "--dir", dir, "--motion", "walk-pack", "--report", "-"], mixed);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/mixed up its cells/);
    // Registering the first take's report again is a no-op on its crops.
    const videosBefore = doc(dir).sprite.motions.find((m: { id: string }) => m.id === "walk-front").videos.length;
    ok(run(PROJECT, ["register-pack", "--dir", dir, "--motion", "walk-pack", "--report", "-"], report), "register-pack again");
    expect(doc(dir).sprite.motions.find((m: { id: string }) => m.id === "walk-front").videos.length).toBe(videosBefore);

    // A cell does not go alone; the pack takes its cells with it.
    expect(project(dir, "remove-motion", "--motion", "walk-front").err).toMatch(/cell of the pack 'walk-pack'/);
    ok(project(dir, "remove-motion", "--motion", "walk-pack"), "remove-motion pack");
    expect(doc(dir).sprite.motions).toEqual([]);

    // A whole move set booked as packs, one price — and run flagged: it has
    // not held eight facings in one clip.
    const booked = JSON.parse(ok(project(dir, "plan-moveset", "--packs", "--json"), "plan-moveset --packs"));
    expect(booked.planned.map((p: { id: string }) => p.id)).toEqual(["idle-pack", "walk-pack", "run-pack"]);
    expect(booked.quote.usd).toBe(5.61);
    expect(booked.planned[1].warning).toBeUndefined();
    expect(booked.planned[2].warning).toMatch(/rarely holds eight facings/);
  }, 300_000);
});

media("a props set, end to end", () => {
  test("item sheet → items → items pack laid out from the items", () => {
    const root = mkdtempSync(join(tmpdir(), "sprite-props-"));
    roots.push(root);
    const dir = join(root, "loot");
    ok(project(dir, "init", "--set", "props", "--name", "Loot", "--style", "Flat test icons."), "init props");
    expect(doc(dir).sprite).toMatchObject({ set: "props", items: [] });
    expect(doc(dir).sprite.character.facing).toBeUndefined();
    const built = JSON.parse(ok(project(dir, "items-prompt", "--items", "Red Gem,Blue Gem,Gold Key", "--json"), "items-prompt"));
    expect(built.grid).toEqual({ rows: 1, cols: 3 });
    expect(built.ids).toEqual(["red-gem", "blue-gem", "gold-key"]);

    mkdirSync(join(dir, "sheets"), { recursive: true });
    png(join(dir, "sheets", "items.png"), 360, 120, (x, y) => figure(Math.floor(x / 120), x % 120, y) ?? [0, 0, 0, 0]);
    // A sheet whose middle cell came back empty: the labels follow the cells.
    png(join(root, "gap.png"), 360, 120, (x, y) => (Math.floor(x / 120) === 1 ? null : figure(Math.floor(x / 120), x % 120, y)) ?? [0, 0, 0, 0]);
    const gap = JSON.parse(ok(sheet("split-items", join(root, "gap.png"), "--rows", "1", "--cols", "3", "--ids", "a,b,c", "--out", join(root, "gap"), "--json"), "split-items gap"));
    expect(gap.files.map((f: { id: string; cell: number }) => `${f.id}@${f.cell}`)).toEqual(["a@0", "c@2"]);
    expect(gap.warnings[0]).toMatch(/b: its cell is empty/);
    const cut = ok(sheet("split-items", join(dir, "sheets", "items.png"), "--rows", "1", "--cols", "3", "--ids", built.ids.join(","), "--out", join(dir, "items"), "--json"), "split-items");
    const items = JSON.parse(cut);
    expect(items.files).toHaveLength(3);
    expect(new Set(items.files.map((f: { width: number }) => f.width)).size).toBe(1);
    ok(run(PROJECT, ["register-items", "--dir", dir, "--report", "-", "--sheet", "sheets/items.png", "--labels", "Red Gem,Blue Gem,Gold Key"], cut), "register-items");
    expect(doc(dir).sprite.items.map((i: { id: string; label: string }) => `${i.id}:${i.label}`)).toEqual(["red-gem:Red Gem", "blue-gem:Blue Gem", "gold-key:Gold Key"]);

    ok(project(dir, "add-pack"), "add-pack items");
    const pack = doc(dir).sprite.motions[0];
    expect(pack.pack).toMatchObject({ state: "loop", rows: 1, cols: 3 });
    expect(pack.pack.cells.map((c: { item: string }) => c.item)).toEqual(built.ids);
    const plate = JSON.parse(ok(sheet("pack-plate", "--character", dir, "--pack", "items-pack", "--out", join(root, "plate.png"), "--size", "720", "--json"), "pack-plate items"));
    expect(plate.cells.map((c: { cell: string }) => c.cell)).toEqual(built.ids);
  }, 300_000);
});
