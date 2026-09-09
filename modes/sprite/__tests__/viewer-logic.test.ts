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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { loadRoster, type CharacterProject, type Motion } from "../domain.js";
import spriteManifest from "../manifest.js";
import { atlasGeometry, atlasPivot } from "../viewer/atlas.js";
import { pivotGuide } from "../viewer/frame-render.js";
import {
  bodyDriftOf,
  bodyDriftVerdict,
  maxJumpVerdict,
  scaleDriftVerdict,
  sizeLine,
} from "../viewer/metrics.js";
import { commandLabel, commandTooltip } from "../viewer/CommandPopovers.js";
import { tabAfterNavigate, tabHasContent } from "../viewer/panel.js";
import {
  resolveLocale,
  selectionLabel,
  spriteStrings,
  SPRITE_STRING_TABLES,
} from "../viewer/strings.js";
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
      scale: 1,
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
    expect(geometry.scale).toBeNull();
    expect(geometry.note).toEqual({
      kind: "not-whole-cells",
      width: 128,
      height: 128,
      cols: 3,
      rows: 2,
    });
  });

  test("cells that are the frames scaled by one factor report the scale", () => {
    // `pack --scale 0.5` is the pixel-art path: 64px frames delivered as 32px
    // cells. The grid lines still fall exactly where the overlay draws them,
    // so refusing this pack hid the one number the user had asked about
    // ("128 became 125") behind an amber note about atlas.json.
    const p = mutate((body) => {
      body.assets.find((a: any) => a.id === "bounce-sheet").metadata = {
        width: 64,
        height: 64,
      };
    });
    const geometry = atlasGeometry(p, motionOf(p));
    expect(geometry.trusted).toBe(true);
    expect(geometry.note).toBeNull();
    expect(geometry.cellWidth).toBe(32);
    expect(geometry.scale).toBe(0.5);
  });

  test("cells whose ratio differs between the axes are still refused", () => {
    // 256x64 over a 4x1 grid divides cleanly into 64x64 — but these frames
    // are 32x16, which is ×2 across and ×4 down. No pack does that, so the
    // declared grid is not the one this sheet was made on.
    const p = mutate((body) => {
      body.sprite.motions[0].grid = { rows: 1, cols: 4 };
      body.assets.find((a: any) => a.id === "bounce-sheet").metadata = {
        width: 256,
        height: 64,
      };
      for (const asset of body.assets) {
        if (asset.id.startsWith("bounce-frame")) {
          asset.metadata = { width: 32, height: 16 };
        }
      }
    });
    const geometry = atlasGeometry(p, motionOf(p));
    expect(geometry.trusted).toBe(false);
    expect(geometry.note).toEqual({
      kind: "cell-mismatch",
      cols: 4,
      rows: 1,
      cellWidth: 64,
      cellHeight: 64,
      frameWidth: 32,
      frameHeight: 16,
    });
  });

  test("an unmeasured sheet says so rather than drawing an unchecked grid", () => {
    const p = mutate((body) => {
      body.assets.find((a: any) => a.id === "bounce-sheet").metadata = {};
    });
    const geometry = atlasGeometry(p, motionOf(p));
    expect(geometry.trusted).toBe(false);
    expect(geometry.width).toBe(0);
    expect(geometry.note).toEqual({ kind: "unmeasured" });
  });

  test("frames with no recorded size do not veto an otherwise sound grid", () => {
    const p = mutate((body) => {
      for (const asset of body.assets) {
        if (asset.id.startsWith("bounce-frame")) asset.metadata = {};
      }
    });
    const geometry = atlasGeometry(p, motionOf(p));
    expect(geometry.trusted).toBe(true);
    // ...but the pack scale is unknowable without them, and an invented ×1
    // would be a claim about a sheet nobody measured.
    expect(geometry.scale).toBeNull();
  });
});

// ── Where the pivot guides go ──────────────────────────────────────────────

/**
 * The guide is the one thing on the stage that claims to know something the
 * picture cannot show: the point a game engine will stand this sprite on.
 * Drawn at the cell edge while `align` actually parked the feet `--pad` px
 * higher, it is a confident line under a floating sprite — a wrong answer
 * that looks exactly like a right one, which is why it is pinned here rather
 * than left to a screenshot.
 */
describe("pivotGuide", () => {
  const cell = { width: 64, height: 64 };
  const at = (over: Partial<Parameters<typeof pivotGuide>[0]> = {}) =>
    pivotGuide({
      anchor: "bottom",
      measured: null,
      frameWidth: 64,
      frameHeight: 64,
      dx: 100,
      dy: 50,
      scale: 4,
      ...over,
    });

  test("with no measurement, bottom is the cell floor and center its middle", () => {
    expect(at()).toEqual({ x: 100 + 128, y: 50 + 256, measured: false });
    expect(at({ anchor: "center" })).toEqual({ x: 228, y: 50 + 128, measured: false });
  });

  test("a measured point wins, scaled with the stage zoom, on either anchor", () => {
    // `--pad 8` on a 64px cell: the feet are at y=56, not y=64. At 4x that is
    // 32 stage pixels of daylight between the sprite and a cell-edge guide.
    const measured = { point: { x: 32, y: 56 }, cell };
    expect(at({ measured })).toEqual({ x: 100 + 128, y: 50 + 224, measured: true });
    // The anchor no longer decides anything once there is a measurement —
    // a `center` motion's recorded point is just as authoritative.
    expect(at({ anchor: "center", measured: { point: { x: 30, y: 30 }, cell } }))
      .toEqual({ x: 100 + 120, y: 50 + 120, measured: true });
  });

  test("an off-centre measurement moves the vertical line too", () => {
    // A character that faces right can have its anchor off the cell's middle;
    // drawing the plumb line down the frame centre would contradict the atlas.
    expect(at({ measured: { point: { x: 20, y: 56 }, cell } }))
      .toEqual({ x: 100 + 80, y: 50 + 224, measured: true });
  });

  test("a point measured in another cell is refused, not rescaled", () => {
    // The raw sheet sliced in the browser, or a re-align with a different
    // --cell, leaves the measurement describing a picture that is not on
    // screen. Falling back says "assumed"; rescaling would invent a number.
    expect(at({ measured: { point: { x: 32, y: 56 }, cell: { width: 46, height: 46 } } }))
      .toEqual({ x: 228, y: 306, measured: false });
    expect(at({ frameWidth: 46, frameHeight: 46, measured: { point: { x: 32, y: 56 }, cell } }))
      .toEqual({ x: 100 + 92, y: 50 + 184, measured: false });
  });

  test("a measurement at the cell edge is still a measurement", () => {
    // `--pad 0` is legal, and the resulting guide is in the same place the
    // fallback would put it — but it is now a fact, and the toolbar says so.
    expect(at({ measured: { point: { x: 32, y: 64 }, cell } }))
      .toEqual({ x: 228, y: 50 + 256, measured: true });
  });
});

// ── What the Atlas tab prints ──────────────────────────────────────────────

describe("atlasPivot", () => {
  const withAnchorPoint = (anchorPoint: unknown, anchor = "bottom") =>
    mutate((body) => {
      body.sprite.motions[0].anchor = anchor;
      body.sprite.motions[0].inspect.anchorPoint = anchorPoint;
    });

  test("prints the measured point as the ratio atlas.json carries", () => {
    // `pack` writes `round(anchorPoint / cell, 4)`; the panel derives the same
    // number from project.json so it needs no second fetch — and so it cannot
    // disagree with the guide the stage just drew.
    const p = withAnchorPoint({ x: 32, y: 56 });
    expect(atlasPivot(motionOf(p))).toEqual({ x: 0.5, y: 0.875, measured: true });
    const padded = withAnchorPoint({ x: 32, y: 62 });
    expect(atlasPivot(motionOf(padded))).toEqual({ x: 0.5, y: 0.9688, measured: true });
  });

  test("without a measurement it falls back exactly like pack does", () => {
    const p = project();
    expect(atlasPivot(motionOf(p))).toEqual({ x: 0.5, y: 1, measured: false });
    const centered = mutate((body) => {
      body.sprite.motions[0].anchor = "center";
    });
    expect(atlasPivot(motionOf(centered))).toEqual({ x: 0.5, y: 0.5, measured: false });
  });

  test("the printed pivot and the stage guide name the same point", () => {
    // The two are derived independently (one normalized, one in stage px);
    // this is the assertion that keeps them from drifting apart.
    const p = withAnchorPoint({ x: 20, y: 56 });
    const motion = motionOf(p);
    const pivot = atlasPivot(motion);
    const guide = pivotGuide({
      anchor: motion.anchor,
      measured: { point: motion.inspect!.anchorPoint!, cell: motion.inspect!.cell },
      frameWidth: 64,
      frameHeight: 64,
      dx: 0,
      dy: 0,
      scale: 1,
    });
    expect({ x: guide.x / 64, y: guide.y / 64 }).toEqual({ x: pivot.x, y: pivot.y });
    expect(guide.measured).toBe(pivot.measured);
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

// ── One size line, and what counts as over ─────────────────────────────────

/**
 * Round 2's first complaint was arithmetic nobody did out loud: a user asked
 * for 128 px and read "128×128 cell" in the header, "CELL 250×250" in the
 * inspect block and "SHEET 500×500" in the atlas tab, with nothing on screen
 * relating the three. `sizeLine` is the relation — declared, measured, and
 * the factor `pack` applied between them.
 */
describe("sizeLine", () => {
  test("declared alone before a motion is selected", () => {
    const p = project();
    expect(sizeLine(p, null, null)).toEqual({
      declared: "64",
      measured: null,
      packedScale: null,
    });
  });

  test("declared, measured and the pack scale once there is a motion", () => {
    const p = mutate((body) => {
      body.sprite.character.cell = { width: 128, height: 128 };
      body.sprite.motions[0].inspect.cell = { width: 250, height: 250 };
      // 250×250 packed over the declared 2×2 grid = 125px cells out of 250px
      // frames: the "128 became 125" the viewer never said.
      body.assets.find((a: any) => a.id === "bounce-sheet").metadata = {
        width: 250,
        height: 250,
      };
      for (const asset of body.assets) {
        if (asset.id.startsWith("bounce-frame")) {
          asset.metadata = { width: 250, height: 250 };
        }
      }
    });
    const motion = motionOf(p);
    const line = sizeLine(p, motion, atlasGeometry(p, motion));
    expect(line).toEqual({
      declared: "128",
      measured: "250×250",
      packedScale: 0.5,
    });
    expect(spriteStrings("en").sizeLine(line)).toBe(
      "declared 128 · measured 250×250 · packed ×0.5",
    );
    expect(spriteStrings("zh").sizeLine(line)).toBe(
      "声明 128 · 实测 250×250 · 打包 ×0.5",
    );
  });

  test("a pack at source size says nothing about scale", () => {
    const p = project();
    const motion = motionOf(p);
    const line = sizeLine(p, motion, atlasGeometry(p, motion));
    expect(line.packedScale).toBeNull();
    expect(spriteStrings("en").sizeLine(line)).toBe(
      "declared 64 · measured 64×64",
    );
    // The declared cell collapses to one number because that is how it was
    // asked for; the measured one never does.
    expect(line.declared).toBe("64");
    expect(line.measured).toBe("64×64");
  });

  test("an untrusted layout reports no scale rather than a wrong one", () => {
    const p = mutate((body) => {
      body.sprite.motions[0].grid = { rows: 1, cols: 3 };
    });
    const motion = motionOf(p);
    const geometry = atlasGeometry(p, motion);
    expect(geometry.trusted).toBe(false);
    expect(sizeLine(p, motion, geometry).packedScale).toBeNull();
  });

  test("a non-square declared cell is printed as both numbers", () => {
    const p = mutate((body) => {
      body.sprite.character.cell = { width: 256, height: 192 };
    });
    expect(sizeLine(p, null, null).declared).toBe("256×192");
  });
});

/**
 * Three testers watched an agent call a warning ignorable while the panel
 * showed the same number with nothing beside it. These are the pipeline's own
 * bars (`sprite-sheet.mjs`), so a value the viewer paints amber is a value
 * the script would have warned about — and one it leaves alone is not.
 */
describe("inspect thresholds", () => {
  const inspect = (over: Record<string, unknown> = {}) =>
    ({
      frameCount: 4,
      cell: { width: 250, height: 250 },
      anchorDrift: { x: 0, y: 0 },
      maxJump: 0,
      scaleDrift: 0,
      emptyFrames: [],
      warnings: [],
      ...over,
    }) as any;

  test("scale drift is judged at 15 %, not at whatever looks big", () => {
    expect(scaleDriftVerdict(inspect({ scaleDrift: 0.126 })).over).toBe(false);
    expect(scaleDriftVerdict(inspect({ scaleDrift: 0.279 })).over).toBe(true);
    expect(scaleDriftVerdict(inspect()).limit).toBe(0.15);
  });

  test("the jump bar is 8 % of the cell, so it moves with the cell", () => {
    // 250px cell → 20px. The same 25px jump is a warning here and not on a
    // 512px sheet, which is exactly why a fixed px limit would lie.
    expect(maxJumpVerdict(inspect({ maxJump: 25 }))).toEqual({
      limit: 20,
      over: true,
    });
    expect(
      maxJumpVerdict(inspect({ maxJump: 25, cell: { width: 512, height: 512 } })),
    ).toEqual({ limit: 40.96, over: false });
  });

  test("no measured cell means no bar at all — never a bar of zero", () => {
    const verdict = maxJumpVerdict(inspect({ cell: { width: 0, height: 0 }, maxJump: 9 }));
    expect(verdict.limit).toBeNull();
    expect(verdict.over).toBe(false);
  });

  test("body drift is absent until the sidecar carries it, never a fake 0", () => {
    expect(bodyDriftOf(inspect())).toBeNull();
    expect(bodyDriftOf(inspect({ bodyDrift: 17.4 }))).toBe(17.4);
    expect(bodyDriftOf(inspect({ bodyDrift: "17.4" }))).toBeNull();
    expect(bodyDriftVerdict(inspect({ bodyDrift: 17.4 }))).toEqual({
      limit: 12.5,
      over: true,
    });
  });
});

/**
 * "Switched the stage to GIF", said an agent, while the panel sat on a Video
 * tab with no clips in it. The action could not do what the sentence claimed;
 * now it can, and only when the tab is empty for that motion.
 */
describe("tabAfterNavigate", () => {
  const motion = (over: Partial<Motion> = {}): Motion =>
    ({
      id: "m",
      label: "m",
      prompt: "",
      grid: { rows: 1, cols: 1 },
      fps: 8,
      loop: true,
      anchor: "bottom",
      status: "ready",
      frames: [],
      videos: [],
      ...over,
    }) as Motion;

  test("a tab with something in it is left alone", () => {
    expect(tabAfterNavigate("atlas", motion({ sheet: "s" }))).toBe("atlas");
    expect(tabAfterNavigate("video", motion({ videos: [{}] as any }))).toBe("video");
    expect(tabAfterNavigate("gif", motion({ gif: "g" }))).toBe("gif");
  });

  test("an empty Video or Atlas tab hands the motion to GIF", () => {
    expect(tabAfterNavigate("video", motion({ gif: "g" }))).toBe("gif");
    expect(tabAfterNavigate("atlas", motion({ gif: "g" }))).toBe("gif");
  });

  test("GIF is the destination even when the GIF is missing too", () => {
    // Its empty state is the true answer; hunting for a tab with content in
    // it would move the panel somewhere nobody asked for.
    expect(tabAfterNavigate("video", motion())).toBe("gif");
  });

  test("no motion means no opinion", () => {
    expect(tabAfterNavigate("atlas", null)).toBe("atlas");
  });

  test("webp alone counts as a preview", () => {
    expect(tabHasContent(motion({ webp: "w" }), "gif")).toBe(true);
  });
});

// ── What the composer chip says ────────────────────────────────────────────

describe("selectionLabel", () => {
  const p = project();
  const bounce = motionOf(p);

  test("a frame names the motion and the frame, never the prompt", () => {
    const label = selectionLabel(spriteStrings("en"), bounce, 7);
    expect(label).toBe(`${bounce.label} · frame 07`);
    expect(label).not.toContain(bounce.prompt);
  });

  test("a whole motion names its status", () => {
    expect(selectionLabel(spriteStrings("en"), bounce, null)).toBe(
      `${bounce.label} · ${bounce.status}`,
    );
  });

  test("zh-CN says the same two facts in Chinese", () => {
    expect(selectionLabel(spriteStrings("zh"), bounce, 7)).toBe(
      `${bounce.label} · 第 07 帧`,
    );
    expect(selectionLabel(spriteStrings("zh"), bounce, null)).toBe(
      `${bounce.label} · 就绪`,
    );
  });
});

// ── The locale table ───────────────────────────────────────────────────────

/**
 * A tester ran a Chinese agent inside an English viewer and called the mix
 * jarring. The table is the fix; this is the part of it a screenshot cannot
 * check — that the runtime's language-only locale finds the right table, and
 * that no string was left behind in the JSX.
 */
describe("spriteStrings", () => {
  test("the runtime's language-only locale finds the Chinese table", () => {
    // `props.locale` is lowercased and stripped to the language by the shell.
    expect(resolveLocale("zh")).toBe("zh-CN");
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
    expect(resolveLocale("zh-hant")).toBe("zh-CN");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("ja")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  test("both tables carry the same keys, and none of them is blank", () => {
    const en = SPRITE_STRING_TABLES.en as unknown as Record<string, unknown>;
    const zh = SPRITE_STRING_TABLES["zh-CN"] as unknown as Record<string, unknown>;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(zh)) {
      if (typeof value === "string") expect(value.length).toBeGreaterThan(0);
      else if (typeof value === "object" && value !== null) {
        for (const inner of Object.values(value as Record<string, string>)) {
          expect(inner.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("English hints come from the manifest, so the table adds none", () => {
    // One source per language: the manifest for English (where the label and
    // the hint are the command's own fields), this table for the rest.
    expect(SPRITE_STRING_TABLES.en.commandHint("render-video")).toBeNull();
    expect(SPRITE_STRING_TABLES.en.commandLabel("render-video")).toBeNull();
    expect(SPRITE_STRING_TABLES["zh-CN"].commandHint("render-video")).toBeTruthy();
    expect(SPRITE_STRING_TABLES["zh-CN"].commandLabel("render-video")).toBeTruthy();
    expect(SPRITE_STRING_TABLES["zh-CN"].commandHint("unknown-command")).toBeNull();
    expect(SPRITE_STRING_TABLES["zh-CN"].commandLabel("unknown-command")).toBeNull();
  });

  test("a command falls back to the manifest when the table has no word", () => {
    const command = { id: "sprite-only-in-english", label: "Do the thing" };
    expect(commandLabel(command, SPRITE_STRING_TABLES["zh-CN"])).toBe(
      "Do the thing",
    );
    expect(commandTooltip(command, SPRITE_STRING_TABLES.en)).toBe("Do the thing");
    expect(
      commandTooltip(
        { ...command, description: "what it does" },
        SPRITE_STRING_TABLES.en,
      ),
    ).toBe("Do the thing — what it does");
  });

  test("the three stage commands hover as label + a hint for the user", () => {
    const commands = spriteManifest.viewerApi!.commands!;
    for (const command of commands) {
      const tip = commandTooltip(command, SPRITE_STRING_TABLES.en);
      expect(tip.startsWith(`${command.label} — `)).toBe(true);
      expect(tip).toContain(command.description!);
      // zh-CN says the same thing in its own words, not half of each.
      const zh = commandTooltip(command, SPRITE_STRING_TABLES["zh-CN"]);
      expect(zh).not.toContain(command.description!);
      expect(/[\u4e00-\u9fff]/.test(zh)).toBe(true);
    }
  });
});

/**
 * The guard that keeps the table honest.
 *
 * Localizing a viewer once is easy; keeping it localized is not — the next
 * feature adds one `<span>Rendering…</span>` and half the panel is bilingual
 * again. So the TSX is parsed (really parsed, not grepped: a regex over JSX
 * cannot tell `a > b && c < d` from a text node) and every visible literal is
 * a failure. Two kinds are allowed through, and both are things a translation
 * would break: a run with no letters in it (`×`, `·`, `, `, a number) and a
 * file name, which has to match what is on disk.
 */
describe("no English left in the viewer's JSX", () => {
  /** Attributes the user can actually read. `className` is not one of them. */
  const VISIBLE_ATTRS = new Set([
    "title",
    "placeholder",
    "aria-label",
    "alt",
    "label",
    "confirmLabel",
    "cancelLabel",
    "hint",
  ]);
  const FILE_NAME = /^[\w.-]+\.(png|jpe?g|gif|webp|json|mp4|svg)$/;
  /** Units and separators — the things a size line is made of. */
  const UNITS = new Set(["px", "fps", "s", "ms"]);

  const allowedText = (text: string): boolean => {
    const trimmed = text.trim();
    if (trimmed === "") return true;
    if (!/[A-Za-z]/.test(trimmed)) return true;
    return trimmed.split(/\s+/).every((word) => UNITS.has(word));
  };

  const allowedLiteral = (text: string): boolean => {
    const trimmed = text.trim();
    if (trimmed === "") return true;
    if (!/[A-Za-z]/.test(trimmed)) return true;
    return FILE_NAME.test(trimmed) || UNITS.has(trimmed);
  };

  const viewerDir = join(import.meta.dir, "..", "viewer");
  const files = readdirSync(viewerDir).filter((name) => name.endsWith(".tsx"));

  test("every .tsx in the viewer is scanned", () => {
    // A file the scan silently skipped would be a file free to go English.
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  for (const name of files) {
    test(`${name} has no user-visible literal outside the table`, () => {
      const source = ts.createSourceFile(
        name,
        readFileSync(join(viewerDir, name), "utf-8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const found: string[] = [];

      const COMPARISON = new Set([
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ]);

      /** Every literal in an attribute that could REACH the screen. A
       *  ternary's condition and an `===` comparison cannot: they decide
       *  which string is shown, they are not one. */
      const literalsIn = (node: ts.Node): string[] => {
        const out: string[] = [];
        const walk = (n: ts.Node) => {
          if (ts.isBinaryExpression(n) && COMPARISON.has(n.operatorToken.kind)) {
            return;
          }
          if (ts.isConditionalExpression(n)) {
            walk(n.whenTrue);
            walk(n.whenFalse);
            return;
          }
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
            out.push(n.text);
          } else if (ts.isTemplateExpression(n)) {
            out.push(n.head.text, ...n.templateSpans.map((span) => span.literal.text));
          }
          n.forEachChild(walk);
        };
        walk(node);
        return out;
      };

      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && !allowedText(node.text)) {
          found.push(`text: ${JSON.stringify(node.text.trim())}`);
        }
        if (ts.isJsxAttribute(node) && node.initializer) {
          const attr = node.name.getText(source);
          if (VISIBLE_ATTRS.has(attr)) {
            for (const literal of literalsIn(node.initializer)) {
              if (!allowedLiteral(literal)) {
                found.push(`${attr}: ${JSON.stringify(literal)}`);
              }
            }
          }
        }
        node.forEachChild(visit);
      };
      visit(source);

      expect(found).toEqual([]);
    });
  }
});
