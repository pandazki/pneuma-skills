/**
 * The `pack` aggregate: what the viewer draws, and what it writes back.
 *
 * - No second copy of a rule: every status, stale reason, export state and
 *   checklist row equals what sticker-state.mjs answers for the same files
 *   (the module `sticker.mjs status` / `check` runs).
 * - Save scope: pack.json only, never project.json, never a delete, a no-op
 *   when nothing changed, and an edit is a minimal diff of the file.
 * - Broken files are named errors, never a throw.
 */

import { describe, expect, test } from "bun:test";

import * as S from "../skill/scripts/sticker-state.mjs";
import {
  findSticker,
  inFlight,
  loadPack,
  pickAnchor,
  pickArt,
  pickTake,
  savePack,
  setListingField,
  setStickerField,
  type StickerPack,
} from "../domain.js";
import { filesOf, finishedWorkspace, richWorkspace } from "./pack-workspace.js";
import { addImage, packFrom } from "./sticker-fixture.js";

const statusById = (v: StickerPack) => Object.fromEntries(v.stickers.map((s) => [s.id, s.state.status]));

/** Lines that differ between two texts (same line count expected). */
function changedLines(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  expect(b.length).toBe(a.length);
  return b.filter((line, i) => line !== a[i]);
}

describe("loadPack — the module's answers, arranged", () => {
  test("every sticker state is stickerState's, in pack order", () => {
    const { raw, files } = richWorkspace();
    const value = loadPack(files);
    expect(value.projectError).toBeNull();
    expect(value.packErrors).toEqual([]);
    const pack = packFrom(raw);
    const project = JSON.parse(files[1].content);
    expect(value.stickers.map((s) => s.state)).toEqual(S.stickerStates(pack, project));
    expect(statusById(value)).toEqual({
      s01: "ready",
      s02: "pick",
      s03: "stale",
      s04: "generating",
      s05: "failed",
      s06: "empty",
      s07: "ready",
      s08: "failed",
    });
    expect(findSticker(value, "s03")!.state.reasons).toEqual(["caption changed"]);
  });

  test("checklist rows and export states are checkPack's and exportState's", () => {
    const { raw, files } = richWorkspace();
    const value = loadPack(files);
    const pack = packFrom(raw);
    const project = JSON.parse(files[1].content);
    expect(value.platforms.map((p) => p.platform)).toEqual(["wechat", "telegram", "line"]);
    for (const view of value.platforms) {
      expect(view.rows).toEqual(S.checkPack(pack, project, view.platform));
      expect(view.tally).toEqual(S.tally(view.rows));
      expect(view.exports).toEqual(S.exportState(pack, project, view.platform));
    }
    const s07 = value.platforms[0].exports.items.find((i) => i.sticker === "s07" && i.kind === "sticker")!;
    expect(s07.state).toBe("stale");
    expect(s07.reason).toBe("exported from s07-take-1; the pick is now s07-take-2");
    expect(value.next).toEqual(S.nextStep(pack, project));
  });

  test("takes carry their staleness, failure and billing; the card plays the picked or newest ready take", () => {
    const value = loadPack(richWorkspace().files);
    const s02 = findSticker(value, "s02")!;
    expect(s02.shown?.id).toBe("s02-take-2");
    expect(s02.takes.map((t) => [t.id, t.status, t.picked])).toEqual([
      ["s02-take-1", "ready", false],
      ["s02-take-2", "ready", false],
    ]);
    const s03 = findSticker(value, "s03")!;
    expect(s03.shown?.id).toBe("s03-take-1");
    expect(s03.takes[0].staleness).toEqual({ stale: true, reasons: ["caption changed"] });
    const s05 = findSticker(value, "s05")!;
    expect(s05.shown).toBeNull();
    expect(s05.uncertain).toEqual(["s05-take-1"]);
    expect(s05.takes[0].failure?.billing).toBe("unknown");
    expect(findSticker(value, "s08")!.uncertain).toEqual([]);
    expect(findSticker(value, "s08")!.takes[0].failure?.billing).toBe("none");
    expect(inFlight(value).map((t) => t.id)).toEqual(["s04-take-1"]);
  });

  test("cost is craft's summary: a failed call with billing unknown stays in, one that never left is out", () => {
    const value = loadPack(richWorkspace().files);
    expect(value.cost.uncertain).toEqual(["s05-take-1"]);
    expect(value.cost.notBilled).toEqual(["s08-take-1"]);
    expect(value.cost.inFlight).toEqual(["s04-take-1"]);
    expect(value.cost.total).toBeGreaterThan(0);
  });

  test("art lists the kinds the chosen platforms use, with what each becomes", () => {
    const value = loadPack(richWorkspace().files);
    expect(value.art.map((a) => [a.kind, a.picked, a.becomes.map((b) => `${b.platform}:${b.deliverable}`)])).toEqual([
      ["portrait", "art-portrait-1", ["wechat:cover", "telegram:thumb"]],
      ["head", "art-head-1", ["wechat:icon", "line:tab"]],
      ["banner", "art-banner-1", ["wechat:banner"]],
    ]);
    expect(value.character?.anchor).toEqual({ anchor: "character-1", ready: true, reason: null });
  });
});

describe("loadPack — empty and broken files", () => {
  test("no files: a pack that is not there yet, not null", () => {
    const value = loadPack([]);
    expect(value.hasPack).toBe(false);
    expect(value.pack).toBeNull();
    expect(value.stickers).toEqual([]);
  });

  test("pack.json that is not JSON, or misses a field, is named the way the CLI names it", () => {
    const notJson = loadPack([{ path: "pack.json", content: "{ nope" }]);
    expect(notJson.hasPack).toBe(true);
    expect(notJson.packErrors[0].message).toStartWith("pack.json is not valid JSON");
    const { raw } = richWorkspace();
    raw.stickers[2].caption = 7;
    const badField = loadPack(filesOf(raw, null).slice(0, 1));
    expect(badField.pack).toBeNull();
    expect(badField.packErrors.map((e) => e.message)).toContain("stickers[2].caption: must be a string (got number)");
  });

  test("a malformed project.json is the reader's named error, and the rules run without it", () => {
    const { files } = richWorkspace();
    const truncated = [files[0], { path: "project.json", content: files[1].content.slice(0, 200) }];
    const value = loadPack(truncated);
    expect(value.projectError).toStartWith("not valid JSON");
    expect(value.project).toBeNull();
    expect(new Set(value.stickers.map((s) => s.state.status))).toEqual(new Set(["empty"]));

    const otherMode = JSON.parse(files[1].content);
    delete otherMode.sticker;
    const foreign = loadPack([files[0], { path: "project.json", content: JSON.stringify(otherMode) }]);
    expect(foreign.projectError).toBe("the file has no 'sticker' sidecar — it is not this mode's project");
  });
});

describe("savePack — pack.json only, minimal diff", () => {
  test("an unchanged pack writes nothing; an edit writes pack.json alone, one line changed", () => {
    const { files } = finishedWorkspace();
    const value = loadPack(files);
    expect(savePack(value, files)).toEqual({ writes: [], deletes: [] });

    const edited = setStickerField(value, "s02", "caption", "好嘞");
    const ops = savePack(edited, files);
    expect(ops.deletes).toEqual([]);
    expect(ops.writes.map((w) => w.path)).toEqual(["pack.json"]);
    expect(changedLines(files[0].content, ops.writes[0].content)).toEqual(['      "caption": "好嘞",']);
  });

  test("the file's own indentation, key order and unknown keys survive an edit", () => {
    const { raw, doc } = finishedWorkspace();
    const withExtra = { note: "kept by hand", ...raw };
    const files = filesOf(withExtra, doc, 4);
    const value = loadPack(files);
    expect(value.packWarnings).toContain("'note' is not a pack.json field; it is kept but nothing reads it");
    const ops = savePack(setStickerField(value, "s01", "action", "salutes"), files);
    expect(changedLines(files[0].content, ops.writes[0].content)).toEqual(['            "action": "salutes",']);
    expect(Object.keys(JSON.parse(ops.writes[0].content))[0]).toBe("note");
  });

  test("no edit ever reaches project.json, even when the project is loaded", () => {
    const { files } = richWorkspace();
    let value = loadPack(files);
    value = pickTake(value, "s02", "s02-take-1");
    value = setListingField(value, "line", "title", "Work Ox Daily");
    value = pickArt(value, "banner", "art-banner-1");
    const ops = savePack(value, files);
    expect(ops.writes.map((w) => w.path)).toEqual(["pack.json"]);
  });
});

describe("edits — decisions only, refused by name when they cannot be made", () => {
  test("a changed caption makes the take stale with the module's reason", () => {
    const value = loadPack(finishedWorkspace().files);
    expect(findSticker(value, "s01")!.state.status).toBe("ready");
    const edited = setStickerField(value, "s01", "caption", "收到收到");
    expect(findSticker(edited, "s01")!.state.status).toBe("stale");
    expect(findSticker(edited, "s01")!.state.reasons).toEqual(["caption changed"]);
    // and the export of that sticker carries the warning row
    const row = edited.platforms[0].rows.find((r) => r.id === "sticker-s01")!;
    expect(row.level).toBe("warn");
    expect(row.detail).toContain("its take is stale (caption changed) — re-roll to apply");
  });

  test("the same text is no edit at all", () => {
    const value = loadPack(finishedWorkspace().files);
    expect(setStickerField(value, "s01", "word", "收到")).toBe(value);
  });

  test("picking a take: only a ready take of that sticker", () => {
    const value = loadPack(richWorkspace().files);
    const picked = pickTake(value, "s02", "s02-take-1");
    expect(findSticker(picked, "s02")!.state.status).toBe("ready");
    expect((picked.raw!.stickers as Array<{ take: string }>)[1].take).toBe("s02-take-1");
    expect(() => pickTake(value, "s05", "s05-take-1")).toThrow("s05-take-1 is failed — only a ready take can be picked");
    expect(() => pickTake(value, "s02", "s02-take-9")).toThrow('no take "s02-take-9" for s02 (has: s02-take-1, s02-take-2)');
    expect(() => pickTake(value, "s99", "s99-take-1")).toThrow('no sticker "s99" in pack.json');
  });

  test("picking the anchor and the art: ready candidates only", () => {
    const { raw, doc } = richWorkspace();
    addImage(doc, "character-2", "character/anchor-2.png", { op: "upload" });
    const value = loadPack(filesOf(raw, doc));
    const moved = pickAnchor(value, "character-2");
    expect(moved.pack!.character.anchor).toBe("character-2");
    // every take was drawn from character-1: now each one is stale for it
    expect(findSticker(moved, "s01")!.state.reasons).toEqual(["the character anchor changed (character-1 → character-2)"]);
    expect(() => pickAnchor(value, "character-9")).toThrow('no character candidate "character-9" (has: character-1, character-2)');
    expect(() => pickArt(value, "banner", "art-banner-2")).toThrow('no banner art "art-banner-2" (has: art-banner-1)');
  });

  test("listing text: chosen platforms and their own fields only", () => {
    const value = loadPack(richWorkspace().files);
    // The row is checkPack's: ≤ 5 shows best, ≤ 8 allowed, past 8 fails.
    const level = (v: StickerPack) => v.platforms[0].rows.find((r) => r.id === "listing-name")!.level;
    const edited = setListingField(value, "wechat", "name", "牛马日常");
    expect(edited.pack!.listing.wechat!.name).toBe("牛马日常");
    expect(level(edited)).toBe("pass");
    expect(setListingField(edited, "wechat", "name", "牛马日常")).toBe(edited);
    expect(level(setListingField(value, "wechat", "name", "打工牛马日常"))).toBe("warn");
    expect(level(setListingField(value, "wechat", "name", "打工牛马的一天到晚"))).toBe("fail");
    expect(() => setListingField(value, "wechat", "title", "x")).toThrow('"title" is not a WeChat listing field (name, intro, copyright, rewardLine)');
    const { raw, doc } = richWorkspace();
    raw.platforms = ["wechat"];
    delete raw.listing.line;
    delete raw.listing.telegram;
    expect(() => setListingField(loadPack(filesOf(raw, doc)), "line", "title", "x")).toThrow("line is not in pack.platforms");
  });

  test("an invalid pack cannot be edited from the viewer", () => {
    const value = loadPack([{ path: "pack.json", content: "[]" }]);
    expect(value.packErrors[0].message).toBe("pack.json: must be a JSON object");
    expect(() => setStickerField(value, "s01", "word", "x")).toThrow("pack.json is not valid");
  });
});
