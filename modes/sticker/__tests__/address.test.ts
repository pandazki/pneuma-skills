/**
 * The ViewerAddress vocabulary both ways (docs/proposals/2026-11-06-sticker-mode.md
 * "ViewerAddress"): what an address resolves to on screen, what the screen
 * reports back, and what the agent reads about it. A refusal names what
 * does exist; nothing moves.
 */

import { describe, expect, test } from "bun:test";

import { loadPack, type StickerPack } from "../domain.js";
import { extractStickerContext } from "../pneuma-mode.js";
import { START, positionAddress, resolveAddress, resolveSetView, type Position } from "../viewer/view-model.js";
import { richWorkspace } from "./pack-workspace.js";

const ws = richWorkspace();
const value: StickerPack = loadPack(ws.files);

function go(address: unknown, here: Position = START): Position {
  const r = resolveAddress(value, address, here);
  if (!r.ok) throw new Error(r.message);
  return r.position;
}

function refusal(address: unknown, here: Position = START): string {
  const r = resolveAddress(value, address, here);
  if (r.ok) throw new Error(`expected a refusal for ${JSON.stringify(address)}`);
  return r.message;
}

describe("resolving an address", () => {
  test("a sticker opens its inspector on the panel; take and frame move its stage", () => {
    expect(go({ sticker: "s01" })).toMatchObject({ view: "panel", focus: { type: "sticker", id: "s01" }, take: null, frame: null });
    expect(go({ sticker: "s02", take: "s02-take-1" })).toMatchObject({ focus: { type: "sticker", id: "s02" }, take: "s02-take-1" });
    // a take names its sticker
    expect(go({ take: "s07-take-1" })).toMatchObject({ focus: { type: "sticker", id: "s07" }, take: "s07-take-1" });
    // fixture takes carry no measure: the pack's 16 frames bound the index
    expect(go({ sticker: "s01", frame: 15 })).toMatchObject({ frame: 15 });
  });

  test("character, art and platform", () => {
    expect(go({ character: true })).toMatchObject({ view: "panel", focus: { type: "character" } });
    expect(go({ art: "banner" })).toMatchObject({ view: "panel", focus: { type: "art", kind: "banner" } });
    expect(go({ platform: "line" })).toMatchObject({ view: "submit", platform: "line", focus: null });
    expect(go({ sticker: "s07", platform: "telegram" })).toMatchObject({ view: "submit", platform: "telegram", focus: { type: "sticker", id: "s07" } });
    expect(go({ art: "portrait", platform: "wechat" })).toMatchObject({ view: "submit", platform: "wechat", focus: { type: "art", kind: "portrait" } });
  });

  test("the plate is set-view's: an address never changes it", () => {
    expect(go({ sticker: "s01" }, { ...START, plate: "dark" }).plate).toBe("dark");
  });

  test("refuses by name, listing what exists", () => {
    expect(refusal({ sticker: "s09" })).toBe('no sticker "s09" in pack.json (has: s01, s02, s03, s04, s05, s06, s07, s08)');
    expect(refusal({ sticker: "s02", take: "s02-take-7" })).toBe('no take "s02-take-7" for s02 (has: s02-take-1, s02-take-2)');
    expect(refusal({ sticker: "s01", take: "s02-take-1" })).toBe('"s02-take-1" is not a take of s01');
    expect(refusal({ sticker: "s01", frame: 16 })).toBe("s01-take-1 has frames 0–15 (got 16)");
    expect(refusal({ sticker: "s01", frame: -1 })).toContain("0-based frame index");
    expect(refusal({ sticker: "s05", frame: 0 })).toBe("s05-take-1 is failed — it has no frames to show");
    expect(refusal({ sticker: "s06", frame: 0 })).toBe("s06 has no take to show frames of (empty)");
    expect(refusal({ frame: 2 })).toContain("frame needs a sticker");
    expect(refusal({ art: "sticker" })).toContain("art must be one of portrait, head, banner, reward-guide, reward-thanks");
    expect(refusal({ art: "reward-guide" })).toBe("no reward-guide art in this pack (has: portrait, head, banner)");
    expect(refusal({ platform: "kakao" })).toContain("platform must be one of wechat, telegram, line");
    expect(refusal({ character: "yes" })).toContain("character must be true");
    expect(refusal({ character: true, platform: "wechat" })).toContain("the character is not exported itself");
    expect(refusal({ sticker: "s01", frame: 2, platform: "line" })).toContain("take and frame point inside the panel's stage");
    expect(refusal({ chapter: 4 })).toContain("names nothing this viewer knows");
    expect(refusal("s01")).toContain("must be an object");
  });

  test("a platform the pack does not ship to is refused", () => {
    const { raw, doc } = richWorkspace();
    raw.platforms = ["wechat"];
    const narrow = loadPack([{ path: "pack.json", content: JSON.stringify(raw) }, { path: "project.json", content: JSON.stringify(doc) }]);
    const r = resolveAddress(narrow, { platform: "line" }, START);
    expect(r.ok ? "" : r.message).toBe('"line" is not in pack.platforms (wechat)');
  });

  test("no pack: refused with the reason, nothing moves", () => {
    expect(resolveAddress(loadPack([]), { sticker: "s01" }, START)).toEqual({ ok: false, message: "there is no pack.json yet" });
  });
});

describe("the address the screen reports", () => {
  test("round-trips: position → address → the same position", () => {
    for (const address of [
      { sticker: "s01" },
      { sticker: "s02", take: "s02-take-1" },
      { sticker: "s01", frame: 3 },
      { character: true },
      { art: "head" },
      { platform: "telegram" },
      { sticker: "s07", platform: "line" },
      { art: "banner", platform: "wechat" },
    ]) {
      expect(positionAddress(go(address))).toEqual(address);
    }
  });

  test("the chat preview addresses nothing; a character focus is not a platform export", () => {
    expect(positionAddress({ ...go({ sticker: "s01" }), view: "chat" })).toEqual({});
    expect(positionAddress({ ...go({ character: true }), view: "submit", platform: "wechat" })).toEqual({ platform: "wechat" });
  });
});

describe("set-view", () => {
  test("switches view, tab and plate; the stage's frame belongs to the panel", () => {
    const at = go({ sticker: "s01", frame: 4 });
    const r = resolveSetView(value, { view: "submit", platform: "line", plate: "dark" }, at);
    expect(r.ok && r.position).toMatchObject({ view: "submit", platform: "line", plate: "dark", frame: null, take: null });
    const chat = resolveSetView(value, { view: "chat" }, at);
    expect(chat.ok && chat.position.view).toBe("chat");
    const submit = resolveSetView(value, { view: "submit" }, START);
    expect(submit.ok && submit.position.platform).toBe("wechat");
  });

  test("refuses what it cannot show", () => {
    const message = (p: unknown) => {
      const r = resolveSetView(value, p, START);
      return r.ok ? "" : r.message;
    };
    expect(message({ view: "grid" })).toContain("view must be one of panel, chat, submit");
    expect(message({ view: "submit", platform: "kakao" })).toContain("platform must be one of pack.platforms (wechat, telegram, line)");
    expect(message({ view: "panel", platform: "line" })).toContain('platform goes with view "submit"');
    expect(message({ view: "panel", plate: "grey" })).toContain('plate must be "light" or "dark"');
  });
});

describe("extractContext — the address first, then what it names", () => {
  const context = (address: Record<string, unknown> | null, type = "sticker") =>
    extractStickerContext(address ? { type, content: "", address } : null, ws.files);

  test("a stale sticker: word, caption, action, status with its reason, every take", () => {
    const text = context({ sticker: "s03" });
    const lines = text.split("\n");
    expect(lines[0]).toBe('<viewer-context mode="sticker">');
    expect(lines[1]).toBe('Address: {"sticker":"s03"}');
    expect(text).toContain('Sticker s03 (03 of 8): word "加班" · caption "收到啦" · emoji 😩');
    expect(text).toContain("Action: slumps over a laptop");
    expect(text).toContain("Status: stale — caption changed");
    expect(text).toContain("Takes: s03-take-1 (ready, picked, stale: caption changed)");
  });

  test("a failed take says whether it may have been charged; a frame names its take and range", () => {
    expect(context({ sticker: "s05" })).toContain("s05-take-1 (failed, billing unknown — may have been charged, upstream error)");
    expect(context({ sticker: "s08" })).toContain("s08-take-1 (failed, not billed");
    expect(context({ sticker: "s01", frame: 3 })).toContain("Frame: 3 of 0–15 in s01-take-1 (0-based");
  });

  test("a platform export names the file state and the check row", () => {
    const text = context({ sticker: "s07", platform: "wechat" });
    expect(text).toContain("WeChat export: exports/wechat/07.gif — stale (exported from s07-take-1; the pick is now s07-take-2)");
    expect(text).toContain("WeChat check: fail — exported from s07-take-1; the pick is now s07-take-2 — export again");
    expect(context({ platform: "line" }, "platform")).toContain("Submission tab: LINE —");
  });

  test("the pack line, the next step, and the chat preview", () => {
    const text = context(null);
    expect(text).not.toContain("Address:");
    expect(text).toContain("Pack: 打工牛马 · 8 sticker(s) (2 ready, 1 pick, 1 stale, 1 generating, 2 failed, 1 empty)");
    expect(text).toContain("failed call(s) whose billing is unknown: s05-take-1");
    expect(text).toContain("Next: ");
    expect(extractStickerContext({ type: "view", content: "the chat preview" }, ws.files)).toContain("On screen: the chat preview");
    expect(extractStickerContext(null, [])).toContain("No pack.json yet");
  });

  test("an unreadable project.json: said first, and nothing it records is guessed", () => {
    const files = [ws.files[0], { path: "project.json", content: "{" }];
    const text = extractStickerContext({ type: "sticker", content: "", address: { sticker: "s01", platform: "wechat" } }, files);
    const lines = text.split("\n");
    expect(lines[1]).toBe('Address: {"sticker":"s01","platform":"wechat"}');
    expect(lines[2]).toStartWith("project.json is unreadable (not valid JSON");
    expect(text).toContain("Status: unknown — project.json is unreadable");
    expect(text).toContain("Takes: unknown — project.json is unreadable");
    expect(text).toContain("WeChat export: unknown — project.json is unreadable");
    expect(text).toContain("Pack: 打工牛马 · 8 sticker(s) · platforms wechat, telegram, line · statuses and spend unknown");
    expect(text).not.toContain("Next:");
    expect(text).not.toContain("≈$");
  });
});
