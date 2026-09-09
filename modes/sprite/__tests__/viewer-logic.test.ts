/**
 * The viewer's decidable half.
 *
 * Everything the stage does that can be wrong in a way a screenshot would not
 * show lives in two pure modules — `viewer/playback.ts` and `viewer/urls.ts` —
 * and is pinned here: the frame scheduler (does a walk cycle actually run at
 * its own fps, does a one-shot stop instead of wrapping), the frame-source
 * precedence (aligned frames beat the raw sheet, and "nothing yet" is a real
 * answer rather than a blank stage pretending to play), the address algebra
 * that `navigate-to` / `capture` / a locator card all route through, and the
 * URL builder every asset request is made of.
 *
 * The failure these tests exist to prevent is the silent one: an address that
 * resolves to the wrong frame, or a frame list whose indices shifted because
 * one asset id went missing, both look exactly like success on screen.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadRoster, type CharacterProject, type Motion } from "../domain.js";
import { atlasGeometry } from "../viewer/atlas.js";
import {
  advance,
  contentSetMismatch,
  frameCountOf,
  parseAddress,
  playbackStateData,
  resolveAddress,
  resolveFrameSource,
  selectActiveCharacter,
  stageWarnings,
  transportIntent,
  typingTarget,
  type PlaybackState,
} from "../viewer/playback.js";
import { contentUrl, encodeContentPath } from "../viewer/urls.js";
import { sourceKey, stableSourceKey } from "../viewer/useFrameImages.js";

const MINI = readFileSync(
  join(import.meta.dir, "fixtures", "mini", "project.json"),
  "utf-8",
);

function project(body: string = MINI, path = "mini/project.json"): CharacterProject {
  const roster = loadRoster([{ path, content: body }]);
  const key = path === "project.json" ? "" : path.slice(0, -"/project.json".length);
  const found = roster?.byContentSet[key];
  if (!found) throw new Error("fixture did not parse");
  return found;
}

/** The canonical fixture, mutated through its JSON so the parser still runs. */
function mutate(edit: (body: any) => void, path = "mini/project.json"): CharacterProject {
  const body = JSON.parse(MINI);
  edit(body);
  return project(JSON.stringify(body), path);
}

const motionOf = (p: CharacterProject, id = "bounce"): Motion => {
  const m = p.sprite.motions.find((x) => x.id === id);
  if (!m) throw new Error(`no motion ${id}`);
  return m;
};

const state = (over: Partial<PlaybackState> = {}): PlaybackState => ({
  frame: 0,
  acc: 0,
  playing: true,
  ...over,
});

// ── Scheduler ──────────────────────────────────────────────────────────────

describe("advance", () => {
  const eight = { frameCount: 8, fps: 8, loop: true };

  test("holds the frame until one frame's worth of time has passed", () => {
    const next = advance(state(), 100, eight);
    expect(next.frame).toBe(0);
    expect(next.acc).toBe(100);
  });

  test("advances one frame at 8 fps and keeps the remainder", () => {
    const next = advance(state(), 130, eight);
    expect(next.frame).toBe(1);
    expect(next.acc).toBeCloseTo(5, 6);
  });

  test("advances several frames when the tick is long", () => {
    const next = advance(state(), 500, eight);
    expect(next.frame).toBe(4);
    expect(next.acc).toBeCloseTo(0, 6);
  });

  test("wraps when looping", () => {
    const next = advance(state({ frame: 7 }), 125, eight);
    expect(next.frame).toBe(0);
    expect(next.playing).toBe(true);
  });

  test("stops on the last frame when not looping", () => {
    const next = advance(state({ frame: 6 }), 500, { ...eight, loop: false });
    expect(next.frame).toBe(7);
    expect(next.playing).toBe(false);
    expect(next.acc).toBe(0);
  });

  test("a stopped one-shot stays on its last frame", () => {
    const stopped = advance(state({ frame: 7, playing: false }), 5000, {
      ...eight,
      loop: false,
    });
    expect(stopped.frame).toBe(7);
    expect(stopped.playing).toBe(false);
  });

  test("a paused stage never moves", () => {
    const next = advance(state({ frame: 3, playing: false }), 1000, eight);
    expect(next).toEqual(state({ frame: 3, playing: false }));
  });

  test("a long stall does not fast-forward through the whole motion", () => {
    // A backgrounded tab hands back one enormous delta; playing it back at
    // real time would spin the loop thousands of times for frames nobody saw.
    // Any delta past the clamp behaves exactly like the clamp.
    expect(advance(state(), 60_000, eight)).toEqual(
      advance(state(), 1_000, eight),
    );
  });

  test("a motion with no frames parks at 0 and stops", () => {
    const next = advance(state({ frame: 3 }), 500, { ...eight, frameCount: 0 });
    expect(next).toEqual({ frame: 0, acc: 0, playing: false });
  });

  test("a single frame never advances but keeps playing", () => {
    const next = advance(state(), 5000, { ...eight, frameCount: 1 });
    expect(next.frame).toBe(0);
  });

  test("a zero fps in the file does not divide by zero", () => {
    const next = advance(state(), 1000, { ...eight, fps: 0 });
    expect(Number.isFinite(next.frame)).toBe(true);
    expect(next.frame).toBeGreaterThanOrEqual(0);
    expect(next.frame).toBeLessThan(8);
  });
});

// ── The keyboard half of the transport ─────────────────────────────────────

describe("transportIntent", () => {
  test("space plays, arrows step, home and end jump", () => {
    expect(transportIntent({ key: " " })).toBe("toggle-play");
    expect(transportIntent({ key: "Spacebar" })).toBe("toggle-play");
    expect(transportIntent({ key: "ArrowLeft" })).toBe("step-back");
    expect(transportIntent({ key: "ArrowRight" })).toBe("step-forward");
    expect(transportIntent({ key: "Home" })).toBe("first-frame");
    expect(transportIntent({ key: "End" })).toBe("last-frame");
  });

  test("a held space does not toggle play dozens of times a second", () => {
    expect(transportIntent({ key: " ", repeat: true })).toBeNull();
    // Held arrows are a legitimate way to scrub, so they keep repeating.
    expect(transportIntent({ key: "ArrowRight", repeat: true })).toBe("step-forward");
  });

  test("a modified key belongs to the browser, not to the stage", () => {
    expect(transportIntent({ key: "ArrowLeft", metaKey: true })).toBeNull();
    expect(transportIntent({ key: "ArrowRight", altKey: true })).toBeNull();
    expect(transportIntent({ key: " ", shiftKey: true })).toBeNull();
    expect(transportIntent({ key: " ", ctrlKey: true })).toBeNull();
  });

  test("every other key is left alone", () => {
    expect(transportIntent({ key: "k" })).toBeNull();
    expect(transportIntent({ key: "Enter" })).toBeNull();
    expect(transportIntent({ key: "ArrowUp" })).toBeNull();
  });
});

describe("typingTarget", () => {
  test("a key typed into a field is not a transport key", () => {
    expect(typingTarget({ tagName: "INPUT" })).toBe(true);
    expect(typingTarget({ tagName: "textarea" })).toBe(true);
    expect(typingTarget({ tagName: "SELECT" })).toBe(true);
    expect(typingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  test("the stage, the canvas and a button are not typing surfaces", () => {
    expect(typingTarget({ tagName: "CANVAS" })).toBe(false);
    expect(typingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(typingTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(typingTarget(null)).toBe(false);
  });
});

// ── Reload versus switch (what the stage may keep showing) ─────────────────

describe("stableSourceKey", () => {
  const p = project();
  const bounce = resolveFrameSource(p, motionOf(p), 1);

  test("a cache-buster bump is the same pictures — the stage may hold them", () => {
    const reloaded = resolveFrameSource(p, motionOf(p), 2);
    expect(sourceKey(reloaded)).not.toBe(sourceKey(bounce));
    expect(stableSourceKey(reloaded)).toBe(stableSourceKey(bounce));
  });

  test("different pictures are a different set, however they are versioned", () => {
    const sheetProject = mutate((body) => {
      body.sprite.motions[0].frames = [];
    });
    const sheet = resolveFrameSource(sheetProject, motionOf(sheetProject), 1);
    expect(stableSourceKey(sheet)).not.toBe(stableSourceKey(bounce));
    expect(stableSourceKey({ kind: "none" })).toBe("none");
  });
});

// ── Frame source precedence ────────────────────────────────────────────────

describe("resolveFrameSource", () => {
  test("aligned frames win, in declared order, with cache-busting urls", () => {
    const p = project();
    const source = resolveFrameSource(p, motionOf(p), 7);
    expect(source.kind).toBe("frames");
    if (source.kind !== "frames") return;
    expect(source.count).toBe(4);
    expect(source.missing).toBe(0);
    expect(source.frames[0]).toBe("/content/mini/motions/bounce/frames/00.png?v=7");
    expect(source.frames[3]).toBe("/content/mini/motions/bounce/frames/03.png?v=7");
  });

  test("a frame whose asset is gone keeps its slot so indices never shift", () => {
    const p = mutate((body) => {
      body.assets = body.assets.filter((a: any) => a.id !== "bounce-frame-02");
    });
    const source = resolveFrameSource(p, motionOf(p), 1);
    expect(source.kind).toBe("frames");
    if (source.kind !== "frames") return;
    expect(source.count).toBe(4);
    expect(source.missing).toBe(1);
    expect(source.frames[2]).toBeNull();
    expect(source.frames[3]).toBe("/content/mini/motions/bounce/frames/03.png?v=1");
  });

  test("falls back to slicing the raw sheet when there are no frames yet", () => {
    const p = mutate((body) => {
      body.sprite.motions[0].frames = [];
      body.sprite.motions[0].status = "processing";
    });
    const source = resolveFrameSource(p, motionOf(p), 3);
    expect(source.kind).toBe("raw-sheet");
    if (source.kind !== "raw-sheet") return;
    expect(source.url).toBe("/content/mini/motions/bounce/sheet-raw.png?v=3");
    expect(source.cols).toBe(2);
    expect(source.rows).toBe(2);
    expect(source.count).toBe(4);
    expect(source.alpha).toBe(false);
  });

  test("prefers the keyed sheet over the raw one", () => {
    const p = mutate((body) => {
      body.sprite.motions[0].frames = [];
      body.sprite.motions[0].sheetAlpha = "bounce-sheet-alpha";
      body.assets.push({
        id: "bounce-sheet-alpha",
        type: "image",
        uri: "motions/bounce/sheet-alpha.png",
        name: "bounce sheet (alpha)",
        metadata: {},
        createdAt: 1757400001500,
        status: "ready",
      });
    });
    const source = resolveFrameSource(p, motionOf(p), 1);
    expect(source.kind).toBe("raw-sheet");
    if (source.kind !== "raw-sheet") return;
    expect(source.url).toBe("/content/mini/motions/bounce/sheet-alpha.png?v=1");
    expect(source.alpha).toBe(true);
  });

  test("a planned motion with neither frames nor a sheet has no source", () => {
    const p = mutate((body) => {
      body.sprite.motions[0].frames = [];
      delete body.sprite.motions[0].sheetRaw;
      body.sprite.motions[0].status = "planned";
    });
    expect(resolveFrameSource(p, motionOf(p), 1).kind).toBe("none");
    expect(frameCountOf(resolveFrameSource(p, motionOf(p), 1))).toBe(0);
  });

  test("no motion selected has no source", () => {
    expect(resolveFrameSource(project(), null, 1).kind).toBe("none");
  });

  test("a root-level project builds urls without a content-set segment", () => {
    const p = project(MINI, "project.json");
    const source = resolveFrameSource(p, motionOf(p), 2);
    expect(source.kind).toBe("frames");
    if (source.kind !== "frames") return;
    expect(source.frames[0]).toBe("/content/motions/bounce/frames/00.png?v=2");
  });
});

// ── URLs ───────────────────────────────────────────────────────────────────

describe("contentUrl", () => {
  test("encodes each segment and keeps the separators", () => {
    expect(encodeContentPath("refs/a b/c#d.png")).toBe("refs/a%20b/c%23d.png");
  });

  test("leaves ordinary paths byte-identical", () => {
    expect(encodeContentPath("motions/idle/frames/00.png")).toBe(
      "motions/idle/frames/00.png",
    );
  });

  test("encodes a content set that needs it", () => {
    expect(contentUrl("ルミ", "refs/portrait.png", 4)).toBe(
      "/content/%E3%83%AB%E3%83%9F/refs/portrait.png?v=4",
    );
  });

  test("a root project has no empty segment", () => {
    expect(contentUrl("", "project.json", 0)).toBe("/content/project.json?v=0");
  });

  test("a nested content set keeps its depth", () => {
    expect(contentUrl("cast/lumi", "refs/p.png", 1)).toBe(
      "/content/cast/lumi/refs/p.png?v=1",
    );
  });
});

// ── Address algebra ────────────────────────────────────────────────────────

describe("parseAddress", () => {
  test("keeps the four keys and drops everything else", () => {
    expect(
      parseAddress({
        contentSet: "mini",
        motion: "bounce",
        frame: 2,
        junk: "x",
        ref: "",
      }),
    ).toEqual({ contentSet: "mini", motion: "bounce", frame: 2 });
  });

  test("accepts a numeric string frame — the shape an agent writes by hand", () => {
    expect(parseAddress({ frame: "3" })).toEqual({ frame: 3 });
  });

  test("refuses a frame that is not a whole number", () => {
    expect(parseAddress({ frame: "later" })).toEqual({});
    expect(parseAddress({ frame: 1.5 })).toEqual({});
    expect(parseAddress({ frame: -2 })).toEqual({});
  });

  test("a non-object is an empty address", () => {
    expect(parseAddress(null)).toEqual({});
    expect(parseAddress("bounce")).toEqual({});
  });
});

describe("resolveAddress", () => {
  const p = project();

  test("a motion id selects that motion at no particular frame", () => {
    const r = resolveAddress(p, { motion: "bounce" }, null);
    expect(r.ok).toBe(true);
    expect(r.target).toEqual({ kind: "motion", motionId: "bounce", frame: null });
  });

  test("a frame alone applies to the motion already on stage", () => {
    const r = resolveAddress(p, { frame: 2 }, "bounce");
    expect(r.ok).toBe(true);
    expect(r.target).toEqual({ kind: "motion", motionId: "bounce", frame: 2 });
  });

  test("a frame with nothing on stage is a refusal, not a guess", () => {
    const r = resolveAddress(p, { frame: 2 }, null);
    expect(r.ok).toBe(false);
    expect(r.target).toBeNull();
    expect(r.message).toContain("no motion");
  });

  test("an unknown motion fails and says what this character has", () => {
    const r = resolveAddress(p, { motion: "attack" }, null);
    expect(r.ok).toBe(false);
    expect(r.target).toBeNull();
    expect(r.message).toContain("attack");
    expect(r.message).toContain("bounce");
  });

  test("a reference opens the ref", () => {
    const r = resolveAddress(p, { ref: "portrait" }, null);
    expect(r.ok).toBe(true);
    expect(r.target).toEqual({ kind: "ref", refId: "portrait" });
  });

  test("an unknown reference fails", () => {
    const r = resolveAddress(p, { ref: "turnaround" }, null);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("turnaround");
  });

  test("motion wins over ref, and says so", () => {
    const r = resolveAddress(p, { motion: "bounce", ref: "portrait" }, null);
    expect(r.ok).toBe(true);
    expect(r.target).toEqual({ kind: "motion", motionId: "bounce", frame: null });
    expect(r.message).toContain("ref");
  });

  test("another character is refused rather than shown as this one", () => {
    const r = resolveAddress(p, { contentSet: "other", motion: "bounce" }, null);
    expect(r.ok).toBe(false);
    expect(r.target).toBeNull();
    expect(r.message).toContain("other");
  });

  test("this character's own name, with or without a trailing slash, is fine", () => {
    expect(resolveAddress(p, { contentSet: "mini/" }, null).ok).toBe(true);
    expect(resolveAddress(p, { contentSet: "mini" }, null).target).toEqual({
      kind: "character",
    });
  });

  test("an out-of-range frame lands on the last frame AND reports the miss", () => {
    const r = resolveAddress(p, { motion: "bounce", frame: 12 }, null);
    expect(r.ok).toBe(false);
    expect(r.target).toEqual({ kind: "motion", motionId: "bounce", frame: 3 });
    expect(r.message).toContain("4");
  });

  test("an empty address means the character itself", () => {
    const r = resolveAddress(p, {}, "bounce");
    expect(r.ok).toBe(true);
    expect(r.target).toEqual({ kind: "character" });
  });
});

/**
 * The guard every addressed action shares.
 *
 * `navigate-to` refuses another character's address; `get-playback-state` must
 * refuse the same one, because answering it with THIS character's stage is a
 * report that reads as success and describes the wrong sprite. Both call this
 * function, so they can only ever agree.
 */
describe("contentSetMismatch", () => {
  const p = project();

  test("no content set in the address is not a mismatch", () => {
    expect(contentSetMismatch(p, undefined)).toBeNull();
  });

  test("this character, with or without a trailing slash, passes", () => {
    expect(contentSetMismatch(p, "mini")).toBeNull();
    expect(contentSetMismatch(p, "mini/")).toBeNull();
    expect(contentSetMismatch(p, "/mini")).toBeNull();
  });

  test("another character is refused by name, both names said out loud", () => {
    const message = contentSetMismatch(p, "someone-else");
    expect(message).toContain("someone-else");
    expect(message).toContain("mini");
  });

  test("a root-level character is nameable and still guarded", () => {
    const root = project(MINI, "project.json");
    expect(contentSetMismatch(root, "")).toBeNull();
    expect(contentSetMismatch(root, "lumi")).toContain("the root character");
  });

  test("the refusal `navigate-to` gives is this exact sentence", () => {
    const viaAddress = resolveAddress(p, { contentSet: "someone-else" }, null);
    expect(viaAddress.ok).toBe(false);
    expect(viaAddress.message).toBe(contentSetMismatch(p, "someone-else") ?? "");
  });

  test("no character at all is nothing to compare against", () => {
    expect(contentSetMismatch(null, "mini")).toBeNull();
  });
});

// ── The packed sheet's layout ──────────────────────────────────────────────

describe("atlasGeometry", () => {
  test("a sheet that really is cols x rows of the frame size is trusted", () => {
    const p = project();
    const geometry = atlasGeometry(p, motionOf(p));
    expect(geometry).toEqual({
      width: 128,
      height: 128,
      cols: 2,
      rows: 2,
      cellWidth: 64,
      cellHeight: 64,
      trusted: true,
      note: null,
    });
  });

  test("a pack that chose its own columns is refused, not drawn over", () => {
    // `sprite-sheet.mjs pack` without --cols lays out ceil(sqrt(n)) columns,
    // so a motion whose declared grid says otherwise produces a sheet the
    // declared grid does not divide — the overlay would be lines on nothing.
    const p = mutate((body) => {
      body.sprite.motions[0].grid = { rows: 1, cols: 3 };
      body.assets.find((a: any) => a.id === "bounce-sheet").metadata = {
        width: 128,
        height: 128,
      };
    });
    const geometry = atlasGeometry(p, motionOf(p));
    expect(geometry.trusted).toBe(false);
    expect(geometry.cellWidth).toBe(0);
    expect(geometry.note).toContain("128×128");
    expect(geometry.note).toContain("atlas.json");
  });

  test("cells that divide but do not match the frames are refused too", () => {
    // 256x64 over a 4x1 grid divides cleanly into 64x64 — but these frames
    // are 32 px, so the packed image is not the one this grid describes.
    const p = mutate((body) => {
      body.sprite.motions[0].grid = { rows: 1, cols: 4 };
      body.assets.find((a: any) => a.id === "bounce-sheet").metadata = {
        width: 256,
        height: 64,
      };
      for (const asset of body.assets) {
        if (asset.id.startsWith("bounce-frame")) {
          asset.metadata = { width: 32, height: 32 };
        }
      }
    });
    const geometry = atlasGeometry(p, motionOf(p));
    expect(geometry.trusted).toBe(false);
    expect(geometry.note).toContain("32×32");
  });

  test("an unmeasured sheet says so rather than drawing an unchecked grid", () => {
    const p = mutate((body) => {
      body.assets.find((a: any) => a.id === "bounce-sheet").metadata = {};
    });
    const geometry = atlasGeometry(p, motionOf(p));
    expect(geometry.trusted).toBe(false);
    expect(geometry.width).toBe(0);
    expect(geometry.note).toContain("no recorded size");
  });

  test("frames with no recorded size do not veto an otherwise sound grid", () => {
    const p = mutate((body) => {
      for (const asset of body.assets) {
        if (asset.id.startsWith("bounce-frame")) asset.metadata = {};
      }
    });
    expect(atlasGeometry(p, motionOf(p)).trusted).toBe(true);
  });
});

// ── What the agent reads back ──────────────────────────────────────────────

describe("playbackStateData", () => {
  test("reports the documented shape", () => {
    const p = project();
    const motion = motionOf(p);
    const source = resolveFrameSource(p, motion, 1);
    const data = playbackStateData({
      project: p,
      motion,
      source,
      frame: 2,
      playing: true,
      fps: 8,
      loop: true,
    });
    expect(data).toEqual({
      contentSet: "mini",
      motion: "bounce",
      frame: 2,
      frameCount: 4,
      fps: 8,
      loop: true,
      playing: true,
      source: "frames",
      warnings: [],
    });
  });

  test("an unprocessed motion says it is looking at the raw sheet", () => {
    const p = mutate((body) => {
      body.sprite.motions[0].frames = [];
      body.sprite.motions[0].status = "processing";
      body.sprite.motions[0].inspect.warnings = ["frame 02 is empty"];
    });
    const motion = motionOf(p);
    const data = playbackStateData({
      project: p,
      motion,
      source: resolveFrameSource(p, motion, 1),
      frame: 0,
      playing: false,
      fps: 8,
      loop: true,
    });
    expect(data.source).toBe("raw-sheet");
    expect(data.frameCount).toBe(4);
    expect(data.warnings).toContain("frame 02 is empty");
    expect(data.warnings.some((w) => w.includes("raw sheet"))).toBe(true);
  });

  test("nothing selected is a legible answer, not a crash", () => {
    const data = playbackStateData({
      project: null,
      motion: null,
      source: { kind: "none" },
      frame: 0,
      playing: false,
      fps: 8,
      loop: true,
    });
    expect(data.motion).toBeNull();
    expect(data.source).toBe("none");
    expect(data.frameCount).toBe(0);
  });

  test("missing frame assets are surfaced, not silently skipped", () => {
    const p = mutate((body) => {
      body.assets = body.assets.filter((a: any) => a.id !== "bounce-frame-02");
    });
    const motion = motionOf(p);
    const warnings = stageWarnings(motion, resolveFrameSource(p, motion, 1));
    expect(warnings.some((w) => w.includes("1"))).toBe(true);
  });
});

// ── Which character the stage shows ────────────────────────────────────────

describe("selectActiveCharacter", () => {
  const roster = loadRoster([
    { path: "lumi/project.json", content: MINI },
    { path: "atlas/project.json", content: MINI },
  ]);

  test("the framework's active content set wins", () => {
    expect(selectActiveCharacter(roster, "lumi")?.contentSet).toBe("lumi");
  });

  test("no active set falls back to the first character by name", () => {
    expect(selectActiveCharacter(roster, null)?.contentSet).toBe("atlas");
  });

  test("a single-character workspace still renders — the resolver shows no sets", () => {
    const single = loadRoster([{ path: "lumi/project.json", content: MINI }]);
    expect(selectActiveCharacter(single, null)?.contentSet).toBe("lumi");
  });

  test("an active set that is not in the roster falls back rather than blanking", () => {
    expect(selectActiveCharacter(roster, "gone")?.contentSet).toBe("atlas");
  });

  test("no roster is no character", () => {
    expect(selectActiveCharacter(null, "lumi")).toBeNull();
  });
});
