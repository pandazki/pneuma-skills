/**
 * sticker-state.mjs — the one algorithm the CLI and the viewer share:
 * pack validation, prompts, staleness, status, export keys and the platform
 * checklists. Pure; no files, no ffmpeg.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ASSET_STATUSES, statusOf } from "../../_shared/scripts/craft-project.mjs";
import * as S from "../skill/scripts/sticker-state.mjs";
import type { CheckRow, Measure, Platform } from "../skill/scripts/sticker-state.mjs";
import { addImage, addTake, emptyDoc, exportAll, packFrom, rawPack, readyDoc } from "./sticker-fixture.js";

const rowOf = (rows: CheckRow[], id: string) => {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row '${id}' in ${rows.map((r) => r.id).join(", ")}`);
  return found;
};

describe("the module is pure", () => {
  test("no node: imports and no file system — domain.ts can bundle it", () => {
    const source = readFileSync(join(import.meta.dir, "..", "skill", "scripts", "sticker-state.mjs"), "utf-8");
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\(/);
  });

  test("assetStatus is craft's statusOf", () => {
    for (const status of [...ASSET_STATUSES, undefined]) {
      const asset = { id: "a", type: "image", uri: "", name: "a", metadata: {}, createdAt: 0, ...(status ? { status } : {}) } as never;
      expect(S.assetStatus(asset)).toBe(statusOf(asset));
    }
  });
});

describe("pack.json validation", () => {
  test("a valid pack parses, with defaults applied", () => {
    const raw = rawPack();
    delete raw.motion;
    delete raw.character.style;
    const parsed = S.parsePack(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack.motion).toEqual({ frames: 16, frameMs: 120, size: 512 });
    expect(parsed.pack.character.style).toBe(S.DEFAULT_STYLE);
    expect(parsed.pack.stickers).toHaveLength(8);
  });

  test("errors name the field", () => {
    const raw = rawPack();
    raw.version = 2;
    raw.rights = { basis: "celebrity", confirmedAt: "yesterday" };
    raw.platforms = ["wechat", "weibo", "wechat"];
    raw.stickers[1].id = "s1";
    raw.stickers[2].id = "s01";
    raw.stickers[3].take = "s05-take-1";
    raw.stickers[4].keepFrames = [3, 1];
    raw.stickers[5].caption = 5;
    raw.motion = { frames: 1, frameMs: 120, size: 500 };
    raw.art = { portrait: "character-1", lineMain: "s99", poster: "x" };
    raw.listing.weibo = {};
    const parsed = S.validatePack(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const paths = parsed.errors.map((e) => e.path);
    for (const path of [
      "version", "rights.basis", "rights.confirmedAt", "platforms[1]", "platforms[2]", "stickers[1].id", "stickers[2].id",
      "stickers[3].take", "stickers[4].keepFrames", "stickers[5].caption", "motion.frames", "motion.size",
      "art.portrait", "art.lineMain", "art.poster", "listing.weibo",
    ]) {
      expect({ path, named: paths.includes(path) }).toEqual({ path, named: true });
    }
    for (const e of parsed.errors) expect(e.message.startsWith(`${e.path}:`)).toBe(true);
  });

  test("invalid JSON and a missing rights are told apart", () => {
    const bad = S.parsePack("{ nope");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0].message).toContain("not valid JSON");
    const raw = rawPack();
    delete raw.rights;
    const parsed = S.validatePack(raw);
    expect(parsed.ok && parsed.pack.rights).toBe(null);
  });

  test("warnings for listing of an unchosen platform, unknown fields and a small motion size", () => {
    const raw = rawPack();
    raw.platforms = ["wechat"];
    raw.listing.wechat.slogan = "x";
    raw.extra = true;
    raw.motion.size = 240;
    const parsed = S.validatePack(raw);
    expect(parsed.ok).toBe(true);
    const text = parsed.warnings.join("\n");
    expect(text).toContain("listing.telegram is ignored");
    expect(text).toContain("listing.wechat.slogan");
    expect(text).toContain("'extra'");
    expect(text).toContain("Telegram exports are scaled up");
  });
});

describe("prompts", () => {
  const pack = packFrom(rawPack());

  test("a captioned sticker: identity, the probe's constraints, the action and the exact caption", () => {
    const p = S.stickerPrompt(pack, pack.stickers[0]);
    expect(p).toContain("Use the character in the input image exactly");
    expect(p).toContain("The character: round pale blue-grey ox calf with cream horns.");
    expect(p).toContain("Style: thick clean dark outlines, flat colors.");
    expect(p).toContain("Same character size and same ground line in every frame");
    expect(p).toContain("no motion blur, no dust, no semi-transparent effects");
    expect(p).toContain("The last frame flows smoothly back into the first.");
    expect(p).toContain("Surround the whole character with a thick white sticker border");
    expect(p).toContain("Action: nods twice and salutes.");
    expect(p).toContain('hand-lettered Chinese caption at the bottom, identical and in the same place in every frame, reading exactly: "收到".');
    expect(p).toContain("thick white outline. No other text.");
    expect(p).not.toContain("No text, letters");
  });

  test("no caption: no text anywhere, and the meaning word guides the face", () => {
    const p = S.stickerPrompt(pack, pack.stickers[4]);
    expect(p).toContain('It expresses "摸鱼" through pose and face only.');
    expect(p).toContain("No text, letters or symbols anywhere.");
    expect(p).not.toContain("caption");
    // The white border is about the character on a dark plate, caption or not.
    expect(p).toContain(S.STICKER_BORDER);
  });

  test("the caption's language word follows its script", () => {
    expect(S.captionLanguage("收到")).toBe("Chinese");
    expect(S.captionLanguage("りょうかい")).toBe("Japanese");
    expect(S.captionLanguage("알았어")).toBe("Korean");
    expect(S.captionLanguage("OK!")).toBe("");
    const latin = S.stickerPrompt(pack, { ...pack.stickers[0], caption: "OK!" });
    expect(latin).toContain('hand-lettered caption at the bottom');
  });

  test("character and art prompts", () => {
    expect(S.characterPrompt(pack)).toContain("Redraw the subject of the input image as an original chat-sticker character. Keep who it is: round pale blue-grey ox calf");
    expect(S.characterPrompt(pack, { fromImage: false })).toContain("Design an original chat-sticker character: round pale blue-grey ox calf");
    expect(S.characterPrompt(pack)).toContain("Fully transparent background");
    for (const kind of S.ART_KINDS) {
      const a = S.artPrompt(pack, kind);
      expect(a.prompt).toContain("Use the character in the input image exactly");
      expect(a.background).toBe(kind === "portrait" || kind === "head" ? "transparent" : "opaque");
    }
    expect(S.artPrompt(pack, "banner").aspectRatio).toBe("16:9");
    expect(S.artPrompt(pack, "banner").prompt).toContain("not a white background");
    expect(S.artPrompt(pack, "portrait").prompt).toContain("no white outline");
    expect(() => S.artPrompt(pack, "poster" as never)).toThrow("unknown art kind");
  });

  test("scene art carries the pack's theme; the character art does not", () => {
    for (const kind of ["banner", "reward-guide", "reward-thanks"] as const) {
      const p = S.artPrompt(pack, kind).prompt;
      expect(p).toContain('The sticker pack is called "打工牛马". What it is about: 打工人的日常表情.');
      expect(p).toContain("not in a place the character's species suggests");
      expect(p).toContain("do not write them or any other words in the picture");
    }
    for (const kind of ["portrait", "head"] as const) expect(S.artPrompt(pack, kind).prompt).not.toContain("打工牛马");

    // The theme follows the chosen platforms' order; LINE's blurb when WeChat is not chosen.
    const lineOnly = packFrom({ ...rawPack(), platforms: ["line"] });
    expect(S.packTheme(lineOnly)).toMatchObject({ name: "Work Ox", about: "Everyday office life of an ox" });
    expect(S.artPrompt(lineOnly, "banner").prompt).toContain('called "Work Ox". What it is about: Everyday office life of an ox.');

    // No listing yet: the stickers' words say what the pack is about.
    const bare = packFrom({ ...rawPack(), listing: {} });
    expect(S.artPrompt(bare, "banner").prompt).toContain("Its stickers say: 收到, 好的, 加班, 下班, 摸鱼, 开会, 谢谢, 晚安.");
    const empty = packFrom({ ...rawPack(), listing: {}, stickers: [], art: {} });
    expect(S.artPrompt(empty, "banner").prompt).toContain("a lively everyday world that suits the character");
  });

  test("the request carries the pack's motion and the probe defaults", () => {
    expect(S.stickerRequest(pack)).toEqual({ frames: 16, frameMs: 120, size: 512, quality: "medium", background: "transparent", model: "flare" });
  });
});

describe("sticker status", () => {
  test("each of the six statuses, derived from takes and pack.json", () => {
    const raw = rawPack();
    raw.stickers.forEach((s: { take: string | null }) => (s.take = null));
    const pack = packFrom(raw);
    const doc = emptyDoc();
    addImage(doc, "character-1", "character/anchor-1.png");
    expect(S.stickerState(pack, doc, "s01").status).toBe("empty");
    addTake(doc, pack, "s01", 1, { status: "failed" });
    expect(S.stickerState(pack, doc, "s01").status).toBe("failed");
    addTake(doc, pack, "s01", 2);
    expect(S.stickerState(pack, doc, "s01")).toMatchObject({ status: "pick", ready: ["s01-take-2"], failed: ["s01-take-1"] });
    addTake(doc, pack, "s01", 3, { status: "generating" });
    expect(S.stickerState(pack, doc, "s01")).toMatchObject({ status: "generating", inFlight: ["s01-take-3"] });

    const picked = packFrom({ ...raw, stickers: raw.stickers.map((s: object, i: number) => (i === 1 ? { ...s, take: "s02-take-1" } : s)) });
    addTake(doc, picked, "s02", 1);
    expect(S.stickerState(picked, doc, "s02")).toMatchObject({ status: "ready", effective: "s02-take-1", reason: null });
    const edited = packFrom({ ...raw, stickers: raw.stickers.map((s: object, i: number) => (i === 1 ? { ...s, take: "s02-take-1", caption: "好嘞" } : s)) });
    expect(S.stickerState(edited, doc, "s02")).toMatchObject({ status: "stale", reason: "caption changed", effective: "s02-take-1" });
  });

  test("a pick that is not a ready take reads as pick, saying why", () => {
    const raw = rawPack();
    raw.stickers[0].take = "s01-take-9";
    const pack = packFrom(raw);
    const doc = readyDoc(pack);
    const state = S.stickerState(pack, doc, "s01");
    expect(state.status).toBe("pick");
    expect(state.reason).toContain("picked s01-take-9 is not in project.json");
    expect(state.effective).toBe(null);
  });

  test("stale reasons name what moved: text, motion, anchor, wording", () => {
    const pack = packFrom(rawPack());
    const doc = readyDoc(pack);
    expect(S.takeStaleness(pack, doc, "s01-take-1")).toEqual({ stale: false, reasons: [] });
    const raw = rawPack();
    raw.character.description = "a tall ox";
    raw.stickers[0].action = "jumps";
    raw.motion.frames = 12;
    raw.character.anchor = "character-2";
    const moved = packFrom(raw);
    addImage(doc, "character-2", "character/anchor-2.png");
    const { stale, reasons } = S.takeStaleness(moved, doc, "s01-take-1");
    expect(stale).toBe(true);
    expect(reasons).toEqual(["character description changed", "action changed", "motion.frames changed (16 → 12)", "the character anchor changed (character-1 → character-2)"]);
    // A caption change on a captioned sticker never blames the word.
    const recaption = rawPack();
    recaption.stickers[0].caption = "收到啦";
    recaption.stickers[0].word = "收到啦";
    expect(S.takeStaleness(packFrom(recaption), doc, "s01-take-1").reasons).toEqual(["caption changed"]);
    // A take whose recorded prompt differs with no input changed: the wording moved.
    const edge = doc.provenance.find((e) => e.toAssetId === "s02-take-1")!;
    (edge.operation.params as Record<string, unknown>).prompt = "an older prompt";
    expect(S.takeStaleness(pack, doc, "s02-take-1").reasons).toEqual(["the prompt wording changed"]);
  });
});

describe("exports", () => {
  test("deliverables: stickers in pack order, then the platform's art; reward art only with a reward line", () => {
    const raw = rawPack();
    const pack = packFrom(raw);
    expect(S.platformDeliverables(pack, "wechat").map((d) => `${d.name}:${d.deliverable}`)).toEqual([
      "01:s01", "02:s02", "03:s03", "04:s04", "05:s05", "06:s06", "07:s07", "08:s08", "cover:cover", "icon:icon", "banner:banner",
    ]);
    raw.listing.wechat.rewardLine = "请老板喝杯咖啡";
    expect(S.platformDeliverables(packFrom(raw), "wechat").map((d) => d.deliverable).slice(-2)).toEqual(["reward-guide", "reward-thanks"]);
    expect(S.platformDeliverables(pack, "telegram").map((d) => d.deliverable).slice(-1)).toEqual(["thumb"]);
    const line = S.platformDeliverables(pack, "line");
    expect(line.slice(-2).map((d) => [d.deliverable, d.sticker ?? d.art])).toEqual([["main", "s01"], ["tab", "head"]]);
    raw.art.lineMain = "s03";
    expect(S.platformDeliverables(packFrom(raw), "line").find((d) => d.deliverable === "main")!.sticker).toBe("s03");
    expect(S.exportNumber(0, 8)).toBe("01");
    expect(S.exportNumber(9, 120)).toBe("010");
  });

  test("state: blocked without a source, missing before export, current after, stale when an input moves", () => {
    const raw = rawPack();
    const pack = packFrom(raw);
    const doc = readyDoc(pack);
    const before = S.exportState(pack, doc, "line");
    expect(before.items.every((i) => i.state === "missing")).toBe(true);
    expect(before.archive.state).toBe("blocked");
    exportAll(doc, pack, "line");
    const after = S.exportState(pack, doc, "line");
    expect(after.items.map((i) => i.state)).toEqual(Array(after.items.length).fill("current"));
    expect(after.archive.state).toBe("current");
    expect(after.stale).toBe(false);

    // A new pick: that sticker's export (and the main image it feeds) go stale, the rest stay.
    addTake(doc, pack, "s01", 2);
    raw.stickers[0].take = "s01-take-2";
    const repicked = packFrom(raw);
    const s = S.exportState(repicked, doc, "line");
    expect(s.items.filter((i) => i.state === "stale").map((i) => i.deliverable)).toEqual(["s01", "main"]);
    expect(s.items.find((i) => i.deliverable === "s01")!.reason).toBe("exported from s01-take-1; the pick is now s01-take-2");
    expect(s.archive.state).toBe("blocked");

    // keepFrames is an input too; so is the order (the file name).
    const trimmed = rawPack();
    trimmed.stickers[1].keepFrames = [0, 2, 4, 6, 8];
    expect(S.exportState(packFrom(trimmed), doc, "line").items.filter((i) => i.state === "stale").map((i) => i.deliverable)).toEqual(["s02"]);
    const reordered = rawPack();
    reordered.stickers = [reordered.stickers[1], reordered.stickers[0], ...reordered.stickers.slice(2)];
    // …and LINE's main image follows the first sticker unless art.lineMain says otherwise.
    expect(S.exportState(packFrom(reordered), doc, "line").items.filter((i) => i.state === "stale").map((i) => i.deliverable).sort()).toEqual(["main", "s01", "s02"]);

    // No picked art: its deliverable is blocked, naming the field.
    const noArt = rawPack();
    delete noArt.art.head;
    const tab = S.exportState(packFrom(noArt), doc, "line").items.find((i) => i.deliverable === "tab")!;
    expect(tab).toMatchObject({ state: "blocked", reason: "art.head is not picked" });
  });

  test("the export key depends on the inputs and the recipe, nothing else", () => {
    const pack = packFrom(rawPack());
    const doc = readyDoc(pack);
    const item = S.platformDeliverables(pack, "wechat")[0];
    const key = S.exportKey(pack, doc, "wechat", item);
    expect(key).toMatch(/^[0-9a-f]{8}$/);
    expect(S.exportKey(packFrom(rawPack()), doc, "wechat", item)).toBe(key);
    const raw = rawPack();
    raw.stickers[0].caption = "收到收到";
    expect(S.exportKey(packFrom(raw), doc, "wechat", item)).toBe(key);
    raw.stickers[0].keepFrames = [0, 1, 2];
    expect(S.exportKey(packFrom(raw), doc, "wechat", item)).not.toBe(key);
    expect(S.exportKey(pack, doc, "telegram", S.platformDeliverables(pack, "telegram")[0])).not.toBe(key);
  });
});

describe("checks", () => {
  function exportedEverywhere(raw = rawPack()) {
    const pack = packFrom(raw);
    const doc = readyDoc(pack);
    for (const p of pack.platforms) exportAll(doc, pack, p);
    return { pack, doc };
  }

  test("a complete pack passes every platform, unconfirmed rules stay warnings", () => {
    const { pack, doc } = exportedEverywhere();
    for (const platform of S.PLATFORMS) {
      const rows = S.checkPack(pack, doc, platform);
      const bad = rows.filter((r) => r.level === "fail");
      expect({ platform, bad }).toEqual({ platform, bad: [] });
    }
    const line = S.checkPack(pack, doc, "line");
    expect(rowOf(line, "zip-naming").level).toBe("warn");
    expect(rowOf(line, "zip-naming").detail).toStartWith("unconfirmed:");
    expect(S.tally(line)).toEqual({ pass: line.length - 1, warn: 1, fail: 0 });
  });

  test("the reward thumbnail is an unconfirmed warning, only when the reward is on", () => {
    const raw = rawPack();
    expect(S.checkPack(packFrom(raw), readyDoc(packFrom(raw)), "wechat").some((r) => r.id === "reward-thumb")).toBe(false);
    raw.listing.wechat.rewardLine = "请老板喝杯咖啡";
    raw.art["reward-guide"] = "art-reward-guide-1";
    raw.art["reward-thanks"] = "art-reward-thanks-1";
    const { pack, doc } = exportedEverywhere(raw);
    const rows = S.checkPack(pack, doc, "wechat");
    expect(rowOf(rows, "reward-thumb")).toMatchObject({ level: "warn" });
    expect(rowOf(rows, "reward-guide").level).toBe("pass");
    expect(rowOf(rows, "listing-rewardLine").level).toBe("pass");
  });

  test("rights and counts", () => {
    const raw = rawPack();
    delete raw.rights;
    raw.stickers = raw.stickers.slice(0, 7);
    const pack = packFrom(raw);
    const doc = readyDoc(pack);
    expect(rowOf(S.checkPack(pack, doc, "wechat"), "rights").level).toBe("fail");
    expect(rowOf(S.checkPack(pack, doc, "wechat"), "count").level).toBe("fail");
    expect(rowOf(S.checkPack(pack, doc, "line"), "count").detail).toContain("8, 16, 24");
    expect(rowOf(S.checkPack(pack, doc, "telegram"), "count").level).toBe("pass");
  });

  test("a sticker without a picked take, an unexported one and a stale one fail with the reason", () => {
    const raw = rawPack();
    raw.stickers[0].take = null;
    const pack = packFrom(raw);
    const doc = readyDoc(pack);
    exportAll(doc, pack, "wechat");
    expect(rowOf(S.checkPack(pack, doc, "wechat"), "sticker-s01")).toMatchObject({ level: "fail", detail: "s01: no take picked (no take picked; ready: s01-take-1)", address: { sticker: "s01", platform: "wechat" } });
    const fresh = readyDoc(packFrom(rawPack()));
    expect(rowOf(S.checkPack(packFrom(rawPack()), fresh, "wechat"), "sticker-s02").detail).toContain("not exported yet");
    const p2 = packFrom(rawPack());
    const d2 = readyDoc(p2);
    exportAll(d2, p2, "wechat");
    const trimmed = rawPack();
    trimmed.stickers[2].keepFrames = [0, 1, 2, 3];
    expect(rowOf(S.checkPack(packFrom(trimmed), d2, "wechat"), "sticker-s03").detail).toContain("export again");
    // A stale take (caption edited after the take) exports fine but warns.
    const recaptioned = rawPack();
    recaptioned.stickers[3].caption = "下班了";
    const row = rowOf(S.checkPack(packFrom(recaptioned), d2, "wechat"), "sticker-s04");
    expect(row.level).toBe("warn");
    expect(row.detail).toContain("its take is stale (caption changed) — re-roll to apply");
  });

  /** Each measured rule fails on its own. */
  const STICKER_RULES: [Platform, string, (m: Measure) => Measure, string][] = [
    ["wechat", "over 500 KB", (m) => ({ ...m, bytes: 500_001 }), "over 500 KB"],
    ["wechat", "not 240", (m) => ({ ...m, width: 480, height: 480 }), "not 240×240"],
    ["wechat", "no loop", (m) => ({ ...m, loopCount: null }), "does not loop"],
    ["wechat", "loops once", (m) => ({ ...m, loopCount: 1 }), "not forever"],
    ["wechat", "static", (m) => ({ ...m, frames: 1 }), "is not animated"],
    ["telegram", "over 256 KB", (m) => ({ ...m, bytes: 256_001 }), "over 256 KB"],
    ["telegram", "no alpha", (m) => ({ ...m, alpha: { ...m.alpha!, channel: false } }), "no alpha channel"],
    ["telegram", "codec", (m) => ({ ...m, codec: "vp8" }), "not WEBM VP9"],
    ["telegram", "no 512 side", (m) => ({ ...m, width: 480, height: 480 }), "exactly 512"],
    ["telegram", "too long", (m) => ({ ...m, durationMs: 3100 }), "over 3 s"],
    ["telegram", "fps", (m) => ({ ...m, fps: 60 }), "over 30"],
    ["telegram", "audio", (m) => ({ ...m, hasAudio: true }), "audio stream"],
    ["line", "over 1 MB", (m) => ({ ...m, bytes: 1_000_001 }), "over 1.00 MB"],
    ["line", "too wide", (m) => ({ ...m, width: 330 }), "outside 320×270"],
    ["line", "too small", (m) => ({ ...m, width: 200, height: 200 }), "at least 270"],
    ["line", "too few frames", (m) => ({ ...m, frames: 4 }), "not 5–20"],
    ["line", "too many frames", (m) => ({ ...m, frames: 21 }), "not 5–20"],
    ["line", "loop too long", (m) => ({ ...m, durationMs: 4100, loopCount: 1 }), "over 4 s"],
    ["line", "plays forever", (m) => ({ ...m, loopCount: 0 }), "not 1–4"],
    ["line", "plays too long", (m) => ({ ...m, loopCount: 3 }), "is over 4 s"],
    ["line", "identical frames", (m) => ({ ...m, identical: true }), "every frame is identical"],
    ["line", "opaque", (m) => ({ ...m, alpha: { ...m.alpha!, clear: 0 } }), "not transparent"],
  ];
  for (const [platform, name, mutate, expected] of STICKER_RULES) {
    test(`${platform} sticker rule: ${name}`, () => {
      const pack = packFrom(rawPack());
      const doc = readyDoc(pack);
      exportAll(doc, pack, platform, (d, m) => (d === "s02" ? mutate(m) : m));
      const row = rowOf(S.checkPack(pack, doc, platform), "sticker-s02");
      expect(row.level).toBe("fail");
      expect(row.detail).toContain(expected);
      expect(rowOf(S.checkPack(pack, doc, platform), "sticker-s01").level).toBe("pass");
    });
  }

  test("LINE warns on margins left and a weak first frame (the store still)", () => {
    const pack = packFrom(rawPack());
    const doc = readyDoc(pack);
    exportAll(doc, pack, "line", (d, m) => (d === "s01" ? { ...m, margin: 12, firstFrameCoverage: 0.3 } : m));
    const row = rowOf(S.checkPack(pack, doc, "line"), "sticker-s01");
    expect(row.level).toBe("warn");
    expect(row.detail).toContain("12 px of empty margin");
    expect(row.detail).toContain("the first frame (the store still) shows 30%");
  });

  const ART_RULES: [Platform, string, (m: Measure) => Measure, string, "fail" | "warn"][] = [
    ["wechat", "cover", (m) => ({ ...m, width: 256 }), "not 240×240", "fail"],
    ["wechat", "cover", (m) => ({ ...m, alpha: { ...m.alpha!, clear: 0 } }), "not transparent", "fail"],
    ["wechat", "cover", (m) => ({ ...m, alpha: { ...m.alpha!, cornersClear: false } }), "square frame", "fail"],
    ["wechat", "cover", (m) => ({ ...m, alpha: { ...m.alpha!, edgeWhite: 0.8 } }), "no white outline", "warn"],
    ["wechat", "icon", (m) => ({ ...m, bytes: 100_001 }), "over 100 KB", "fail"],
    ["wechat", "banner", (m) => ({ ...m, alpha: { ...m.alpha!, semi: 0.1 } }), "must be opaque", "fail"],
    ["wechat", "banner", (m) => ({ ...m, nearWhite: 0.9 }), "must not be white", "warn"],
    ["wechat", "banner", (m) => ({ ...m, format: "gif" as never }), "not png or jpg", "fail"],
    ["telegram", "thumb", (m) => ({ ...m, width: 128, height: 128 }), "not 100×100", "fail"],
    ["telegram", "thumb", (m) => ({ ...m, bytes: 128_001 }), "over 128 KB", "fail"],
    ["line", "main", (m) => ({ ...m, frames: 1 }), "is not animated", "fail"],
    ["line", "main", (m) => ({ ...m, loopCount: 0 }), "1–4 plays", "fail"],
    ["line", "tab", (m) => ({ ...m, width: 96, height: 96 }), "not 96×74", "fail"],
  ];
  for (const [platform, deliverable, mutate, expected, level] of ART_RULES) {
    test(`${platform} ${deliverable} rule: ${expected}`, () => {
      const pack = packFrom(rawPack());
      const doc = readyDoc(pack);
      exportAll(doc, pack, platform, (d, m) => (d === deliverable ? mutate(m) : m));
      const row = rowOf(S.checkPack(pack, doc, platform), deliverable);
      expect(row.level).toBe(level);
      expect(row.detail).toContain(expected);
    });
  }

  test("the Telegram thumbnail is optional; LINE's tab and WeChat's cover are not", () => {
    const raw = rawPack();
    delete raw.art.portrait;
    delete raw.art.head;
    const pack = packFrom(raw);
    const doc = readyDoc(pack);
    for (const p of pack.platforms) exportAll(doc, pack, p);
    expect(rowOf(S.checkPack(pack, doc, "telegram"), "thumb")).toMatchObject({ level: "pass" });
    expect(rowOf(S.checkPack(pack, doc, "telegram"), "thumb").detail).toContain("Telegram uses the first sticker");
    expect(rowOf(S.checkPack(pack, doc, "telegram"), "zip").level).toBe("pass");
    expect(rowOf(S.checkPack(pack, doc, "line"), "tab")).toMatchObject({ level: "fail", detail: "art.head is not picked" });
    expect(rowOf(S.checkPack(pack, doc, "wechat"), "cover").level).toBe("fail");
    expect(rowOf(S.checkPack(pack, doc, "wechat"), "zip").detail).toContain("waits for every deliverable");
  });

  test("text rules: WeChat counts characters, LINE counts Asian characters twice", () => {
    const raw = rawPack();
    raw.listing.wechat = { name: "打工牛马的一天天哈", intro: "x".repeat(81), copyright: "版权所有翻印必究违者必究", rewardLine: "请喝" };
    raw.listing.line = { title: "打".repeat(21), description: "ok", copyright: "c" };
    raw.listing.telegram = { title: "", shortName: "ox" };
    const pack = packFrom(raw);
    const doc = readyDoc(pack);
    const wechat = S.checkPack(pack, doc, "wechat");
    expect(rowOf(wechat, "listing-name")).toMatchObject({ level: "fail" });
    expect(rowOf(wechat, "listing-name").detail).toContain("9 characters, over 8");
    expect(rowOf(wechat, "listing-intro").detail).toContain("81 characters, over 80");
    expect(rowOf(wechat, "listing-copyright").detail).toContain("12 characters, over 10");
    const punct = rawPack();
    punct.listing.wechat.name = "打工，牛马";
    expect(rowOf(S.checkPack(packFrom(punct), doc, "wechat"), "listing-name").detail).toContain("no punctuation allowed");
    expect(rowOf(wechat, "listing-rewardLine").detail).toContain("under 5");
    const best = rawPack();
    best.listing.wechat.name = "打工牛马们呀";
    expect(rowOf(S.checkPack(packFrom(best), doc, "wechat"), "listing-name")).toMatchObject({ level: "warn" });
    const line = S.checkPack(pack, doc, "line");
    expect(rowOf(line, "listing-title").detail).toContain("42 width (Asian characters count 2), over 40");
    expect(rowOf(line, "listing-creator").level).toBe("pass");
    expect(rowOf(S.checkPack(pack, doc, "telegram"), "listing-title").level).toBe("fail");
    expect(S.asianWidthLength("打工 ox")).toBe(7);
  });

  test("WeChat meaning words: 1–4 characters, unique; Telegram: one emoji each", () => {
    const raw = rawPack();
    raw.stickers[1].word = "收到";
    raw.stickers[2].word = "又又又加班";
    raw.stickers[3].emoji = "👍👍";
    raw.stickers[4].emoji = "";
    const pack = packFrom(raw);
    const doc = readyDoc(pack);
    const words = rowOf(S.checkPack(pack, doc, "wechat"), "words");
    expect(words.level).toBe("fail");
    expect(words.detail).toContain('s03 "又又又加班": 1–4 characters');
    expect(words.detail).toContain('s02 "收到": used twice');
    const emoji = rowOf(S.checkPack(pack, doc, "telegram"), "emoji");
    expect(emoji.level).toBe("fail");
    expect(emoji.detail).toContain("s04");
    expect(emoji.detail).toContain("s05");
    expect(emoji.address).toEqual({ sticker: "s04", platform: "telegram" });
    expect(S.isSingleEmoji("🇯🇵")).toBe(true);
    expect(S.isSingleEmoji("1️⃣")).toBe(true);
    expect(S.isSingleEmoji("👨‍👩‍👧")).toBe(true);
    expect(S.isSingleEmoji("a")).toBe(false);
  });

  test("every profile carries its source and the date it was read", () => {
    for (const platform of S.PLATFORMS) {
      const p = S.PLATFORM_PROFILES[platform];
      expect(p.checked).toBe("2026-11-06");
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) expect(s.url).toMatch(/^https:\/\//);
    }
    // The brief's numbers, read 2026-11-06 — changing one is a deliberate act.
    expect(S.PLATFORM_PROFILES.wechat.sticker).toMatchObject({ width: 240, height: 240, maxBytes: 500_000 });
    expect(S.PLATFORM_PROFILES.wechat.count).toEqual({ min: 8, max: 24 });
    expect(S.PLATFORM_PROFILES.telegram.sticker).toMatchObject({ edge: 512, maxDurationMs: 3000, fps: 30, maxBytes: 256_000 });
    expect(S.PLATFORM_PROFILES.line.sticker).toMatchObject({ maxWidth: 320, maxHeight: 270, minLongSide: 270, minFrames: 5, maxFrames: 20, maxLoopMs: 4000, maxPlays: 4, maxBytes: 1_000_000 });
    expect(S.PLATFORM_PROFILES.line.count.allowed).toEqual([8, 16, 24]);
  });
});

describe("next step", () => {
  test("follows the work: rights, character, stickers, takes, picks, re-rolls, exports, checks, done", () => {
    const raw = rawPack();
    delete raw.rights;
    expect(S.nextStep(packFrom(raw), null).id).toBe("rights");
    const withRights = rawPack();
    withRights.character.anchor = null;
    withRights.stickers.forEach((s: { take: string | null }) => (s.take = null));
    expect(S.nextStep(packFrom(withRights), null)).toMatchObject({ id: "character", command: "sticker.mjs character --from <image>" });
    const doc = emptyDoc();
    addImage(doc, "character-1", "character/anchor-1.png");
    expect(S.nextStep(packFrom(withRights), doc)).toMatchObject({ id: "anchor" });
    withRights.character.anchor = "character-1";
    let pack = packFrom(withRights);
    expect(S.nextStep(pack, doc)).toMatchObject({ id: "generate", command: "sticker.mjs gen" });
    for (const s of pack.stickers) addTake(doc, pack, s.id, 1);
    expect(S.nextStep(pack, doc)).toMatchObject({ id: "pick" });
    withRights.stickers.forEach((s: { id: string; take: string | null }) => (s.take = `${s.id}-take-1`));
    withRights.stickers[2].action = "dances";
    pack = packFrom(withRights);
    expect(S.nextStep(pack, doc)).toMatchObject({ id: "reroll", command: "sticker.mjs gen --only s03 --redo" });
    pack = packFrom(rawPack());
    const full = readyDoc(pack);
    expect(S.nextStep(pack, full)).toMatchObject({ id: "export", command: "sticker.mjs export --platform wechat" });
    for (const p of pack.platforms) exportAll(full, pack, p);
    expect(S.nextStep(pack, full).id).toBe("done");
    const noIntro = rawPack();
    noIntro.listing.wechat.intro = "";
    expect(S.nextStep(packFrom(noIntro), full)).toMatchObject({ id: "check", command: "sticker.mjs check --platform wechat" });
  });
});
