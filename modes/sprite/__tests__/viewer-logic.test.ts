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
  alphaCoverageOf,
  bodyDriftOf,
  bodyDriftVerdict,
  formatBytes,
  joinVerdict,
  loopDuration,
  loopLine,
  maxJumpVerdict,
  scaleDriftVerdict,
  seamFillOf,
  seamOf,
  seamVerdict,
  sizeLine,
  stepOf,
} from "../viewer/metrics.js";
import {
  commandLabel,
  commandTooltip,
  motionCommands,
} from "../viewer/CommandPopovers.js";
import { rivePlan } from "../skill/scripts/rive-plan.mjs";
import {
  canAskAgent,
  defaultTab,
  defaultExportRepeat,
  EXPORT_SWATCHES,
  exportKey,
  exportRequestNotification,
  exportRows,
  loopExports,
  motionLabel,
  normalizeExportColor,
  panelTabs,
  railGroups,
  rivePlanFor,
  tabAfterNavigate,
  tabHasContent,
  type ExportRow,
} from "../viewer/panel.js";
import {
  riveControls,
  riveFailure,
  riveMachineToPlay,
  riveStateName,
  riveTrail,
  RIVE_INPUT_TYPE,
  RIVE_PREFERRED_MACHINE,
} from "../viewer/rive-preview.js";
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
  nearestStripFrame,
  stripFrames,
  transportIntent,
  typingTarget,
  STRIP_MAX_THUMBS,
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
    expect(source.frames[0]).toBe("/content/mini/motions/bounce/frames/00.png?v=7&r=1757400002000");
    expect(source.frames[3]).toBe("/content/mini/motions/bounce/frames/03.png?v=7&r=1757400002000");
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
    expect(source.frames[3]).toBe("/content/mini/motions/bounce/frames/03.png?v=1&r=1757400002000");
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
    expect(source.frames[0]).toBe("/content/motions/bounce/frames/00.png?v=2&r=1757400002000");
  });
});

// ── The strip of a long motion ─────────────────────────────────────────────

/**
 * A video-model loop is hundreds of frames long (the Kiki idle is 355 at
 * 532x460), and the strip used to mount one `<img>` per frame: the renderer
 * stopped answering and the tab had to be killed. The row is a sample now, so
 * what these pin is that the sample never becomes a lie — the stage still has
 * every frame, and every thumbnail still carries its own true index.
 */
describe("stripFrames", () => {
  test("a sprite-sheet motion is shown whole", () => {
    expect(stripFrames(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(stripFrames(STRIP_MAX_THUMBS).length).toBe(STRIP_MAX_THUMBS);
    expect(stripFrames(STRIP_MAX_THUMBS).at(-1)).toBe(STRIP_MAX_THUMBS - 1);
  });

  test("a long loop is sampled, and both ends of the seam are in it", () => {
    const shown = stripFrames(355);
    expect(shown.length).toBe(STRIP_MAX_THUMBS);
    expect(shown[0]).toBe(0);
    expect(shown.at(-1)).toBe(354);
  });

  test("the sample is even and never repeats or goes backwards", () => {
    const shown = stripFrames(355);
    const steps = shown.slice(1).map((value, i) => value - (shown[i] as number));
    expect(Math.min(...steps)).toBeGreaterThan(0);
    // An even stride: no gap is more than one frame off any other.
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThanOrEqual(1);
  });

  test("nothing to show is an empty row, not a row of blanks", () => {
    expect(stripFrames(0)).toEqual([]);
    expect(stripFrames(-4)).toEqual([]);
    expect(stripFrames(Number.NaN)).toEqual([]);
  });

  test("the sample is display only — the stage keeps every frame", () => {
    const shown = stripFrames(355);
    // 213 is not a thumbnail...
    expect(shown).not.toContain(213);
    // ...and `navigate-to` still lands on exactly 213.
    const p = mutate((body) => {
      const bounce = body.sprite.motions[0];
      bounce.frames = Array.from({ length: 355 }, () => bounce.frames[0]);
    });
    const r = resolveAddress(p, { motion: "bounce", frame: 213 }, null);
    expect(r.ok).toBe(true);
    expect(r.target).toEqual({ kind: "motion", motionId: "bounce", frame: 213 });
  });
});

describe("the strip says when it is sampling", () => {
  test("both locales name the two counts, so the row is never a silent lie", () => {
    for (const text of Object.values(SPRITE_STRING_TABLES)) {
      const line = text.stripSampled(96, 355);
      expect(line).toContain("96");
      expect(line).toContain("355");
      expect(text.stripSampledTitle.length).toBeGreaterThan(0);
    }
  });
});

describe("nearestStripFrame", () => {
  test("the playhead marks the thumbnail it is nearest", () => {
    const shown = [0, 4, 8, 12];
    expect(nearestStripFrame(shown, 0)).toBe(0);
    expect(nearestStripFrame(shown, 5)).toBe(4);
    expect(nearestStripFrame(shown, 7)).toBe(8);
    expect(nearestStripFrame(shown, 99)).toBe(12);
  });

  test("a tie marks the earlier frame, so the mark never runs ahead", () => {
    expect(nearestStripFrame([0, 4, 8], 2)).toBe(0);
    expect(nearestStripFrame([0, 4, 8], 6)).toBe(4);
  });

  test("an empty row has no mark at all", () => {
    expect(nearestStripFrame([], 3)).toBeNull();
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

  test("the bar beside a value reads as a bar, not as another measurement", () => {
    // "SEAM 0.0022 · closes max 0.0036" put the word `max` next to a report
    // that also prints `maxJump`, and the threshold read as a second reading
    // of the motion. Both locales must say "at most this", in one glance.
    for (const [locale, text] of Object.entries(SPRITE_STRING_TABLES)) {
      const limit = text.limit("0.0036");
      expect(limit).toContain("0.0036");
      expect(limit.toLowerCase()).not.toContain("max");
      expect(locale === "en" ? limit.startsWith("\u2264") : limit.startsWith("\u4e0a\u9650")).toBe(true);
    }
  });

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

// ── A loop motion, through the whole viewer ────────────────────────────────

/**
 * The loop path, end to end in the pure half.
 *
 * Every one of these can be wrong in a way a screenshot would not catch: a
 * keyframe reported to the agent as a "raw sheet" that will never exist, a
 * seam printed without the step it is judged against, a download link with a
 * size nobody measured, a panel opening a GIF tab for a motion that has no
 * GIF. The fixture is the canonical character with a `flame` loop beside its
 * sprite motion, so both shapes are exercised against the same project.
 */
describe("loop motions", () => {
  const LOOP_CELL = { width: 64, height: 72 };

  /** `mini` plus a loop motion, at whatever stage of the workflow. */
  function loopProject(
    stage: "planned" | "keyframe" | "ready" = "ready",
    edit: (motion: any, body: any) => void = () => {},
  ): CharacterProject {
    return mutate((body) => {
      const assets: any[] = [];
      const motion: any = {
        id: "flame",
        label: "Flame",
        prompt: "a clay flame swaying",
        kind: "loop",
        grid: { rows: 1, cols: 1 },
        fps: 12,
        loop: true,
        anchor: "bottom",
        status: stage === "ready" ? "ready" : "generating",
        source: "video",
        frames: [],
        videos: [],
      };

      if (stage !== "planned") {
        motion.keyframe = "flame-keyframe";
        motion.keyframeAlpha = "flame-keyframe-alpha";
        assets.push(
          { id: "flame-keyframe", type: "image", uri: "motions/flame/keyframe.png", name: "flame keyframe", metadata: LOOP_CELL, createdAt: 1, status: "ready" },
          { id: "flame-keyframe-alpha", type: "image", uri: "motions/flame/keyframe-alpha.png", name: "flame keyframe (alpha)", metadata: LOOP_CELL, createdAt: 1, status: "ready" },
        );
      }

      if (stage === "ready") {
        motion.frames = ["flame-frame-000", "flame-frame-001", "flame-frame-002"];
        motion.webp = "flame-webp";
        motion.exports = { apng: "flame-apng", webm: "flame-webm", lottie: "flame-lottie" };
        motion.inspect = {
          frameCount: 3,
          cell: LOOP_CELL,
          anchorDrift: { x: 0, y: 0 },
          maxJump: 0,
          scaleDrift: 0,
          emptyFrames: [],
          warnings: [],
          seam: 0.0065,
          step: 0.02,
          alphaCoverage: 0.31,
        };
        for (const [i, id] of motion.frames.entries()) {
          assets.push({ id, type: "image", uri: `motions/flame/frames/00${i}.png`, name: `flame frame 00${i}`, metadata: LOOP_CELL, createdAt: 1, status: "ready" });
        }
        assets.push(
          { id: "flame-webp", type: "image", uri: "motions/flame/loop.webp", name: "flame loop (webp)", metadata: { ...LOOP_CELL, fps: 12, size: 1680 }, createdAt: 1, status: "ready" },
          { id: "flame-apng", type: "image", uri: "motions/flame/loop.apng", name: "flame loop (apng)", metadata: { ...LOOP_CELL, fps: 12, size: 1_383_000 }, createdAt: 1, status: "ready" },
          { id: "flame-webm", type: "video", uri: "motions/flame/loop.webm", name: "flame loop (webm)", metadata: { ...LOOP_CELL, fps: 12, size: 12_750 }, createdAt: 1, status: "ready" },
          { id: "flame-lottie", type: "text", uri: "motions/flame/loop.json", name: "flame loop (lottie)", metadata: { fps: 12, size: 8025 }, createdAt: 1, status: "ready" },
        );
      }

      body.assets.push(...assets);
      body.sprite.motions.push(motion);
      // Last, so a test can edit the motion AND the assets it just added —
      // the motion is in the document by reference either way.
      edit(motion, body);
    });
  }

  const flame = (p: CharacterProject): Motion => motionOf(p, "flame");

  describe("what the stage plays", () => {
    test("the keyframe stands in until the frames exist", () => {
      const p = loopProject("keyframe");
      const source = resolveFrameSource(p, flame(p), 5);
      expect(source.kind).toBe("raw-sheet");
      if (source.kind !== "raw-sheet") return;
      // The cut-out wins over the white-plate original, the way the keyed
      // sheet does for a sprite motion.
      expect(source.url).toBe("/content/mini/motions/flame/keyframe-alpha.png?v=5");
      expect(source.alpha).toBe(true);
      expect({ cols: source.cols, rows: source.rows, count: source.count })
        .toEqual({ cols: 1, rows: 1, count: 1 });

      const raw = loopProject("keyframe", (motion) => { delete motion.keyframeAlpha; });
      const rawSource = resolveFrameSource(raw, flame(raw), 1);
      expect(rawSource.kind === "raw-sheet" && rawSource.url)
        .toBe("/content/mini/motions/flame/keyframe.png?v=1");
      expect(rawSource.kind === "raw-sheet" && rawSource.alpha).toBe(false);
    });

    test("frames win once they are cut, and nothing yet is nothing", () => {
      const p = loopProject("ready");
      const source = resolveFrameSource(p, flame(p), 1);
      expect(source.kind).toBe("frames");
      expect(frameCountOf(source)).toBe(3);
      expect(resolveFrameSource(loopProject("planned"), flame(loopProject("planned")), 1).kind)
        .toBe("none");
    });

    test("the keyframe is one addressable frame", () => {
      // Without this an agent's `{ motion: "flame", frame: 0 }` is refused
      // while the stage is visibly showing something.
      const p = loopProject("keyframe");
      const r = resolveAddress(p, { motion: "flame", frame: 0 }, null);
      expect(r.ok).toBe(true);
      expect(r.target).toEqual({ kind: "motion", motionId: "flame", frame: 0 });
      expect(resolveAddress(p, { motion: "flame", frame: 1 }, null).ok).toBe(false);
    });
  });

  describe("what the agent reads back", () => {
    test("a keyframe is reported as a keyframe, not as a sheet", () => {
      const p = loopProject("keyframe");
      const motion = flame(p);
      const data = playbackStateData({
        project: p,
        motion,
        source: resolveFrameSource(p, motion, 1),
        frame: 0,
        playing: false,
        fps: 12,
        loop: true,
      });
      expect(data.kind).toBe("loop");
      // "raw-sheet" would name a file this motion will never have.
      expect(data.source).toBe("keyframe");
      expect(data.frameCount).toBe(1);
      expect(data.warnings).toEqual([
        "No frames yet — the stage shows the keyframe; the clip is rendering or `sprite-sheet.mjs loop` has not run.",
      ]);
      // And it is not the sprite motion's sentence, which claims a sheet is
      // being sliced on a grid that does not exist here.
      expect(data.warnings.some((w) => w.includes("slicing"))).toBe(false);
    });

    test("a finished loop says kind and nothing else changes", () => {
      const p = loopProject("ready");
      const motion = flame(p);
      const data = playbackStateData({
        project: p,
        motion,
        source: resolveFrameSource(p, motion, 1),
        frame: 1,
        playing: true,
        fps: 12,
        loop: true,
      });
      expect(data).toEqual({
        contentSet: "mini",
        motion: "flame",
        kind: "loop",
        frame: 1,
        frameCount: 3,
        fps: 12,
        loop: true,
        playing: true,
        source: "frames",
        warnings: [],
      });
    });

    test("a sprite motion carries no kind at all", () => {
      // Absent is how the sidecar says "sprite motion"; an explicit null or a
      // "sprite" string would be a second vocabulary for the same fact.
      const p = project();
      const data = playbackStateData({
        project: p,
        motion: motionOf(p),
        source: resolveFrameSource(p, motionOf(p), 1),
        frame: 0,
        playing: false,
        fps: 8,
        loop: true,
      });
      expect("kind" in data).toBe(false);
    });
  });

  describe("the panel", () => {
    test("a loop opens on Loop and a sprite motion on GIF", () => {
      const p = loopProject("ready");
      expect(panelTabs(flame(p))).toEqual(["loop", "video", "atlas", "export"]);
      expect(panelTabs(motionOf(p))).toEqual(["gif", "video", "atlas", "export"]);
      expect(defaultTab(flame(p))).toBe("loop");
      expect(defaultTab(motionOf(p))).toBe("gif");
      expect(defaultTab(null)).toBe("gif");
    });

    test("a tab the motion does not have is not kept", () => {
      // The shell holds the tab across selections, so a loop and a sprite
      // motion hand each other tabs the other cannot render.
      const p = loopProject("ready");
      expect(tabAfterNavigate("gif", flame(p))).toBe("loop");
      expect(tabAfterNavigate("loop", motionOf(p))).toBe("gif");
      // A tab both of them have is kept when it has something in it.
      expect(tabAfterNavigate("atlas", motionOf(p))).toBe("atlas");
      expect(tabAfterNavigate("atlas", flame(p))).toBe("loop");
    });

    test("the Loop tab has content as soon as any export exists", () => {
      const p = loopProject("ready");
      expect(tabHasContent(flame(p), "loop")).toBe(true);
      const webpOnly = loopProject("ready", (motion) => { delete motion.exports; });
      expect(tabHasContent(flame(webpOnly), "loop")).toBe(true);
      const nothing = loopProject("keyframe");
      expect(tabHasContent(flame(nothing), "loop")).toBe(false);
    });

    test("the exports are listed in order with the sizes that were measured", () => {
      const p = loopProject("ready");
      expect(loopExports(p, flame(p))).toEqual([
        { format: "webp", assetId: "flame-webp", size: 1680 },
        { format: "apng", assetId: "flame-apng", size: 1_383_000 },
        { format: "webm", assetId: "flame-webm", size: 12_750 },
        { format: "lottie", assetId: "flame-lottie", size: 8025 },
      ]);

      // An export the sidecar does not name is simply not offered.
      const partial = loopProject("ready", (motion) => {
        delete motion.exports.webm;
      });
      expect(loopExports(partial, flame(partial)).map((e) => e.format))
        .toEqual(["webp", "apng", "lottie"]);

      // An export whose ASSET is gone is not a broken download link.
      const orphaned = loopProject("ready", (_motion, body) => {
        body.assets = body.assets.filter((a: any) => a.id !== "flame-apng");
      });
      expect(loopExports(orphaned, flame(orphaned)).map((e) => e.format))
        .toEqual(["webp", "webm", "lottie"]);

      // And one with no recorded size is a link without a size — never a 0.
      const unmeasured = loopProject("ready");
      delete (unmeasured.assetsById.get("flame-lottie")!.metadata as Record<string, unknown>).size;
      expect(loopExports(unmeasured, flame(unmeasured)).at(-1)).toEqual({
        format: "lottie", assetId: "flame-lottie", size: null,
      });
    });

    test("a file size reads as a file size", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(940)).toBe("940 B");
      expect(formatBytes(8025)).toBe("7.8 KB");
      expect(formatBytes(1_383_000)).toBe("1.3 MB");
      expect(formatBytes(31_457_280)).toBe("30 MB");
      // Nothing to print is null, not "0 B" — the link stands on its own.
      expect(formatBytes(null)).toBeNull();
      expect(formatBytes(undefined)).toBeNull();
      expect(formatBytes(Number.NaN)).toBeNull();
    });
  });

  describe("does it close", () => {
    const inspect = (over: Record<string, unknown> = {}) =>
      ({
        frameCount: 96,
        cell: { width: 520, height: 600 },
        anchorDrift: { x: 0, y: 0 },
        maxJump: 0,
        scaleDrift: 0,
        emptyFrames: [],
        warnings: [],
        seam: 0.0065,
        step: 0.02,
        alphaCoverage: 0.31,
        ...over,
      }) as any;

    test("seamFill is carried finite-or-absent, like every other loop number", () => {
      expect(seamFillOf(inspect({ seamFill: 3 }))).toBe(3);
      // 0 is the reading of a loop that closed on its own — it must survive.
      expect(seamFillOf(inspect({ seamFill: 0 }))).toBe(0);
      expect(seamFillOf(inspect())).toBeNull();
      expect(seamFillOf(inspect({ seamFill: Number.NaN }))).toBeNull();
    });

    test("the bar is twice the step, so it moves with the motion", () => {
      // The reference clip: a seam a third of a normal step — it closes.
      expect(seamVerdict(inspect())).toEqual({ limit: 0.04, over: false });
      // The same seam against a nearly frozen loop is a visible jump.
      expect(seamVerdict(inspect({ seam: 0.0065, step: 0.002 })))
        .toEqual({ limit: 0.004, over: true });
      expect(seamVerdict(inspect({ seam: 0.13, step: 0.02 })).over).toBe(true);
    });

    test("no step is no bar, and no seam is no verdict", () => {
      // A loop nobody measured is not judged — it is not judged YET, which is
      // a different thing from passing.
      const noStep = seamVerdict(inspect({ step: undefined }));
      expect(noStep).toEqual({ limit: null, over: false });
      expect(stepOf(inspect({ step: undefined }))).toBeNull();
      expect(seamOf(inspect({ seam: undefined }))).toBeNull();
      expect(seamVerdict(inspect({ seam: undefined })).over).toBe(false);
    });

    test("a seam of exactly 0 is a measurement, not a missing one", () => {
      expect(seamOf(inspect({ seam: 0 }))).toBe(0);
      expect(alphaCoverageOf(inspect({ alphaCoverage: 0 }))).toBe(0);
      expect(alphaCoverageOf(inspect({ alphaCoverage: "0.31" }))).toBeNull();
    });

    test("duration is frames over fps, and undefined when either is missing", () => {
      expect(loopDuration(96, 24)).toBe(4);
      expect(loopDuration(122, 24)).toBe(5.08);
      expect(loopDuration(0, 24)).toBeNull();
      expect(loopDuration(96, 0)).toBeNull();
    });
  });

  describe("what the rail and the command bar offer", () => {
    test("a loop's rail line drops the grid it does not have", () => {
      const en = spriteStrings("en");
      // The 1×1 in the sidecar is what `register-run` writes because the
      // field exists, not a fact about the animation.
      expect(en.motionMeta({ cols: null, rows: null, frames: 119, fps: 24, loop: true }))
        .toBe("119 frames · 24 fps · loop");
      expect(spriteStrings("zh").motionMeta({ cols: null, rows: null, frames: 119, fps: 24, loop: true }))
        .toBe("119 帧 · 24 fps · 循环");
      // A sprite motion is unchanged: its grid is the whole point.
      expect(en.motionMeta({ cols: 4, rows: 4, frames: 16, fps: 8, loop: true }))
        .toBe("4×4 · 16 frames · 8 fps · loop");
    });

    test("\"frames are misaligned\" is not offered on a loop", () => {
      const commands = [
        { id: "render-video", label: "Render a clip" },
        { id: "regenerate-motion", label: "Redraw" },
        { id: "fix-alignment", label: "Frames are misaligned" },
      ];
      const p = loopProject("ready");
      // A loop is never aligned — its frames stay where the clip put them —
      // so the button would ask the agent for a step that cannot happen.
      expect(motionCommands(commands, flame(p)).map((c) => c.id))
        .toEqual(["render-video", "regenerate-motion"]);
      // A sprite motion keeps all three, and so does an empty stage: with no
      // motion selected the bar is how a user learns what it can do.
      expect(motionCommands(commands, motionOf(p)).map((c) => c.id)).toHaveLength(3);
      expect(motionCommands(commands, null).map((c) => c.id)).toHaveLength(3);
    });
  });

  describe("what the header says", () => {
    test("a loop prints its measured size and its cycle, in both languages", () => {
      const p = loopProject("ready");
      const line = loopLine(flame(p));
      expect(line).toEqual({ measured: "64×72", frames: 3, fps: 12 });
      expect(spriteStrings("en").loopLine(line)).toBe("64×72 · 3 frames @ 12 fps");
      expect(spriteStrings("zh").loopLine(line)).toBe("64×72 · 3 帧 @ 12 fps");
    });

    test("before the run there is no measurement, and none is invented", () => {
      const p = loopProject("keyframe");
      const line = loopLine(flame(p));
      expect(line.measured).toBeNull();
      expect(line.frames).toBe(0);
      expect(spriteStrings("en").loopLine(line)).toBe("0 frames @ 12 fps");
    });

    test("the loop meta line says whether it closes", () => {
      const en = spriteStrings("en");
      expect(en.loopMeta({ frames: 96, fps: 24, duration: 4, seam: "closes", seamFill: 0 }))
        .toBe("96 frames · 24 fps · 4.00 s · closes");
      expect(en.loopMeta({ frames: 96, fps: 24, duration: 4, seam: "open", seamFill: 0 }))
        .toContain("does not close");
      // An unmeasured loop says the facts it has and no verdict.
      expect(en.loopMeta({ frames: 12, fps: 12, duration: null, seam: null, seamFill: null }))
        .toBe("12 frames · 12 fps");
      expect(spriteStrings("zh").loopMeta({ frames: 96, fps: 24, duration: 4, seam: "closes", seamFill: 0 }))
        .toBe("96 帧 · 24 fps · 4.00 秒 · 接得上");
    });

    test("frames the wrap needed are counted out loud, and only when there were any", () => {
      const en = spriteStrings("en");
      // `--seam-fill auto` grew the loop to close it: the frame count above
      // is no longer the clip's own, and this is the only place that says so.
      expect(en.loopMeta({ frames: 99, fps: 24, duration: 4.13, seam: "closes", seamFill: 3 }))
        .toBe("99 frames · 24 fps · 4.13 s · closes · 3 seam frames");
      expect(en.loopMeta({ frames: 97, fps: 24, duration: 4.04, seam: "closes", seamFill: 1 }))
        .toEndWith("· 1 seam frame");
      // A flag that did not fire is not news, and neither is a run that
      // predates it — both stay off the line.
      expect(en.loopMeta({ frames: 96, fps: 24, duration: 4, seam: "closes", seamFill: 0 }))
        .not.toContain("seam frame");
      expect(en.loopMeta({ frames: 96, fps: 24, duration: 4, seam: "closes", seamFill: null }))
        .not.toContain("seam frame");
      expect(spriteStrings("zh").loopMeta({ frames: 99, fps: 24, duration: 4.13, seam: "closes", seamFill: 3 }))
        .toBe("99 帧 · 24 fps · 4.13 秒 · 接得上 · 补了 3 帧接缝");
    });


    test("a derived clip is described by what it is made of", () => {
      expect(spriteStrings("en").derivedClip("video-1", "matte", "veed"))
        .toBe("matte of video-1 · veed");
      expect(spriteStrings("en").derivedClip("video-1", "interpolate", "topaz"))
        .toContain("video-1");
      expect(spriteStrings("zh").derivedClip("video-1", "matte", "veed"))
        .toBe("video-1 的抠像 · veed");
      // A retime is the third op, and it has its own word in both locales —
      // it invents nothing, so calling it an interpolation would be wrong in
      // the one place the user reads what a clip is.
      expect(spriteStrings("en").derivedClip("video-1", "retime", "ffmpeg"))
        .toBe("retime of video-1 · ffmpeg");
      expect(spriteStrings("zh").derivedClip("video-1", "retime", "ffmpeg"))
        .toBe("video-1 的重剪 · ffmpeg");
    });

    test("the Atlas tab tells a loop what it has instead", () => {
      expect(spriteStrings("en").noAtlasForLoop({ frames: 96, width: 520, height: 600 }))
        .toBe("A loop has no atlas — the frames are the PNG sequence (96 frames, 520×600).");
      // Before the run there is nothing to count, and "(0 frames, 0×0)" reads
      // as a measurement of an empty thing rather than as "not yet".
      expect(spriteStrings("en").noAtlasForLoop({ frames: 0, width: 0, height: 0 }))
        .toBe("A loop has no atlas — its frames are a PNG sequence, and there are none yet.");
      expect(/[\u4e00-\u9fff]/.test(
        spriteStrings("zh").noAtlasForLoop({ frames: 96, width: 520, height: 600 }),
      )).toBe(true);
    });
  });
});

// ── The Export tab ─────────────────────────────────────────────────────────

/**
 * The Export tab is a matrix: every format a motion can be delivered as, in
 * one of three states — ready (a download), not generated (ask the agent), or
 * not offered (with the reason). The files every run already makes are rows
 * of the same matrix, never regenerated from here.
 *
 * Every cell can be wrong in a way a screenshot would not catch: a loop
 * offering a GIF the script refuses, a Generate button for a file the user
 * already has, a download link to an asset that is gone, a Rive file that
 * silently lacks the motion made after it.
 */
describe("the Export tab", () => {
  const FLAME_FRAMES = ["flame-frame-000", "flame-frame-001", "flame-frame-002"];

  /** Adds `flame`, a ready loop with its own WebP / APNG / WebM / Lottie. */
  function addFlame(body: any) {
    body.sprite.motions.push({
      id: "flame", label: "Flame", prompt: "a clay flame", kind: "loop",
      grid: { rows: 1, cols: 1 }, fps: 12, loop: true, anchor: "bottom",
      status: "ready", source: "video", frames: FLAME_FRAMES,
      webp: "flame-webp",
      exports: { apng: "flame-apng", webm: "flame-webm", lottie: "flame-lottie" },
      videos: [],
    });
    body.assets.push(
      ...FLAME_FRAMES.map((id, i) => ({ id, type: "image", uri: `motions/flame/frames/00${i}.png`, name: id, metadata: { width: 64, height: 72 }, createdAt: 1, status: "ready" })),
      { id: "flame-webp", type: "image", uri: "motions/flame/loop.webp", name: "", metadata: { size: 1680 }, createdAt: 1, status: "ready" },
      { id: "flame-apng", type: "image", uri: "motions/flame/loop.apng", name: "", metadata: { size: 1_383_000 }, createdAt: 1, status: "ready" },
      { id: "flame-webm", type: "video", uri: "motions/flame/loop.webm", name: "", metadata: { size: 12_750 }, createdAt: 1, status: "ready" },
      { id: "flame-lottie", type: "text", uri: "motions/flame/loop.json", name: "", metadata: { size: 8025 }, createdAt: 1, status: "ready" },
    );
  }

  /** Registers `mini-export-riv` holding `motions`, the way register-export does. */
  function addRiv(body: any, motions: string[], createdAt = 50, sampled?: unknown[]) {
    body.sprite.exports = { riv: "mini-export-riv" };
    body.assets.push({
      id: "mini-export-riv", type: "image", uri: "exports/mini.riv", name: "Mini (rive)",
      metadata: { width: 64, height: 64, frames: 4, motionCount: motions.length, images: "png", estimatedDecodeBytes: 65_536, container: "riv", size: 9_120 },
      createdAt, status: "ready",
    });
    body.provenance.push({
      toAssetId: "mini-export-riv", fromAssetId: "bounce-frame-00",
      operation: { type: "derive", actor: "agent", params: { tool: "sprite-sheet.mjs", step: "rive", images: "png", motions, ...(sampled ? { sampled } : {}), inputs: [] }, timestamp: createdAt },
    });
  }

  /** A compact view of the matrix: family, format, state (or the reason), built-in. */
  const matrix = (rows: ExportRow[]) =>
    rows.map((r) => [r.family, r.format, r.state.kind === "not-offered" ? r.state.reason : r.state.kind, r.builtIn]);

  const rowOf = (rows: ExportRow[], format: string): ExportRow => {
    const row = rows.find((r) => r.format === format);
    if (!row) throw new Error(`no ${format} row`);
    return row;
  };

  const editing = { canRequest: true, requests: new Map<string, number | null>() };

  test("the tab exists for a ready motion and for nothing else", () => {
    const p = project();
    expect(panelTabs(motionOf(p))).toContain("export");
    const planned = mutate((b) => { b.sprite.motions[0].status = "processing"; });
    // Only a ready motion can be exported; the tab would be a wall of
    // "not yet" rows for anything else.
    expect(panelTabs(motionOf(planned))).not.toContain("export");
    expect(tabHasContent(motionOf(p), "export")).toBe(true);
  });

  test("a sprite motion: its run's files are ready, the rest can be generated", () => {
    const p = project();
    const rows = exportRows(p, motionOf(p), editing);
    expect(matrix(rows)).toEqual([
      ["video", "mp4", "missing", false],
      ["video", "mov", "missing", false],
      ["video", "webm", "missing", false],
      ["frames", "gif", "ready", true],
      // The fixture's run was made without a WebP: that file comes from a run,
      // not from an export, so the row says so instead of offering to make it.
      ["frames", "webp", "not-in-run", true],
      ["frames", "apng", "missing", false],
      ["frames", "lottie", "missing", false],
      ["frames", "png-seq", "missing", false],
      ["frames", "sheet", "ready", true],
      ["rive", "riv", "missing", false],
    ]);
    // A run's own file is a download and nothing else.
    const gif = rowOf(rows, "gif");
    expect(gif.canGenerate).toBe(false);
    expect(gif.state).toEqual({
      kind: "ready",
      files: [{ assetId: "bounce-gif", name: "preview.gif", uri: "motions/bounce/preview.gif", size: null, createdAt: 1757400004000 }],
    });
    // The atlas is two files, and both are offered.
    const sheet = rowOf(rows, "sheet");
    expect(sheet.state.kind === "ready" && sheet.state.files.map((f) => f.name)).toEqual(["sheet.png", "atlas.json"]);
    expect(rowOf(rows, "mp4").canGenerate).toBe(true);
    // The .riv would hold every ready motion, and says what it would cost.
    expect(rowOf(rows, "riv").rive).toEqual({
      motions: ["bounce"], transitions: [], missing: [], decodeBytes: 4 * 64 * 64 * 4, loops: null, tooHeavy: false,
    });
  });

  test("a video row says how many times it plays before anything is made", () => {
    // bounce: 4 frames at 8 fps is half a second; a looping motion repeats
    // until the clip lasts 3 s, so the default is six plays.
    expect(defaultExportRepeat(4, 8, true)).toEqual({ repeat: 6, seconds: 3 });
    // A one-shot plays once, whatever its length.
    expect(defaultExportRepeat(4, 8, false)).toEqual({ repeat: 1, seconds: 0.5 });
    expect(defaultExportRepeat(48, 12, true)).toEqual({ repeat: 1, seconds: 4 });
    const p = project();
    expect(rowOf(exportRows(p, motionOf(p), editing), "mp4").video).toEqual({ repeat: 6, seconds: 3, defaulted: true });
    // A frame animation loops by its own flag and has no repeat to state.
    expect(rowOf(exportRows(p, motionOf(p), editing), "apng").video).toBeUndefined();
  });

  test("an exported file is ready with its size, and what it was made with", () => {
    const p = mutate((b) => {
      b.sprite.motions[0].exports = { mp4: "bounce-export-mp4", "png-seq": "bounce-export-png-seq" };
      b.assets.push(
        { id: "bounce-export-mp4", type: "video", uri: "motions/bounce/exports/bounce.mp4", name: "bounce export (mp4)", metadata: { width: 64, height: 64, fps: 8, duration: 1, frames: 8, repeat: 2, scale: 1, background: "#000000", size: 4_096 }, createdAt: 70, status: "ready" },
        { id: "bounce-export-png-seq", type: "image", uri: "motions/bounce/exports/bounce-frames.zip", name: "bounce export (png-seq)", metadata: { container: "zip", size: 20_000 }, createdAt: 71, status: "ready" },
      );
    });
    const rows = exportRows(p, motionOf(p), editing);
    const mp4 = rowOf(rows, "mp4");
    expect(mp4.state).toEqual({
      kind: "ready",
      files: [{ assetId: "bounce-export-mp4", name: "bounce.mp4", uri: "motions/bounce/exports/bounce.mp4", size: 4_096, createdAt: 70 }],
    });
    expect(mp4.builtIn).toBe(false);
    // A made file can be made again — on another colour, say.
    expect(mp4.canGenerate).toBe(true);
    expect(mp4.background).toBe("#000000");
    expect(mp4.video).toEqual({ repeat: 2, seconds: 1, defaulted: false });
    expect(rowOf(rows, "png-seq").state.kind === "ready" && rowOf(rows, "png-seq").state).toMatchObject({
      files: [{ name: "bounce-frames.zip", size: 20_000 }],
    });
  });

  test("an export whose asset is gone is not a broken download", () => {
    const p = mutate((b) => { b.sprite.motions[0].exports = { mov: "bounce-export-mov" }; });
    expect(rowOf(exportRows(p, motionOf(p), editing), "mov").state).toEqual({ kind: "missing" });
  });

  test("a loop: its own four files are ready, GIF and the atlas are not offered, Rive is", () => {
    const p = mutate(addFlame);
    const rows = exportRows(p, motionOf(p, "flame"), editing);
    expect(matrix(rows)).toEqual([
      ["video", "mp4", "missing", false],
      ["video", "mov", "missing", false],
      ["video", "webm", "ready", true],
      ["frames", "gif", "loop-gif", false],
      ["frames", "webp", "ready", true],
      ["frames", "apng", "ready", true],
      ["frames", "lottie", "ready", true],
      ["frames", "png-seq", "missing", false],
      ["frames", "sheet", "loop-atlas", false],
      // The character's .riv, loops and all.
      ["rive", "riv", "missing", false],
    ]);
    expect(rowOf(rows, "webm").state).toMatchObject({ files: [{ name: "loop.webm", size: 12_750 }] });
    expect(rowOf(rows, "webm").canGenerate).toBe(false);
  });

  test("a loop whose run skipped an encoder can still export that format", () => {
    // `loop` skips an encoder the machine does not have, with a warning; the
    // export command makes the same format on demand.
    const p = mutate((b) => { addFlame(b); delete b.sprite.motions[1].exports.apng; });
    const apng = rowOf(exportRows(p, motionOf(p, "flame"), editing), "apng");
    expect([apng.state.kind, apng.builtIn, apng.canGenerate]).toEqual(["missing", false, true]);
  });

  test("a character of loops gets a Rive file, and is told the rate and size it plays at", () => {
    const p = mutate((b) => { addFlame(b); b.sprite.motions.shift(); });
    const riv = rowOf(exportRows(p, motionOf(p, "flame"), editing), "riv");
    expect(riv.state).toEqual({ kind: "missing" });
    expect(riv.canGenerate).toBe(true);
    // The fixture loop is 12 fps and 64x72: under the 24 fps and 320 px
    // defaults, so it keeps both.
    expect(riv.rive).toEqual({
      motions: ["flame"], transitions: [], missing: [], decodeBytes: 3 * 64 * 72 * 4,
      loops: { fps: 12, width: 64, height: 72 }, tooHeavy: false,
    });
  });

  /** tanka's shape: ten UI loops at 60 fps, 512 px wide, 230-300 frames each. */
  /** Loops cut at tanka's size: `[id, frames, height, scale?]`, 512 px wide,
   *  60 fps — `scale` is the clip scale `loop` records, absent on a loop cut
   *  before it did. */
  function tanka(loops: Array<[string, number, number, number?]>) {
    return mutate((b) => {
      b.sprite.motions = [];
      b.assets = [];
      for (const [id, frames, height, scale] of loops) {
        const ids = Array.from({ length: frames }, (_, i) => `${id}-frame-${String(i).padStart(3, "0")}`);
        b.assets.push(...ids.map((fid) => ({ id: fid, type: "image", uri: `motions/${id}/frames/${fid.slice(-3)}.png`, name: fid, metadata: { width: 512, height }, createdAt: 1, status: "ready" })));
        b.sprite.motions.push({
          id, label: id, prompt: "", kind: "loop", grid: { rows: 1, cols: 1 }, fps: 60, loop: true,
          anchor: "bottom", status: "ready", source: "video", frames: ids, videos: [],
          ...(scale ? { inspect: { frameCount: frames, cell: { width: 512, height }, crop: { x: 0, y: 0, w: 512 / scale, h: height / scale }, scale } } : {}),
        });
      }
    });
  }

  test("a loop's recorded clip scale is divided out of the quote, as the script divides it out of the file", () => {
    // tanka's idle was drawn at 1.18× its clip and wave at 1.06×: at one
    // factor over the frames as cut, idle's body stood 11% taller.
    const p = tanka([["idle", 244, 652, 1.1818], ["wave", 281, 570, 1.0645]]);
    const riv = rowOf(exportRows(p, motionOf(p, "idle"), editing), "riv");
    const plan = rivePlan([
      { id: "idle", kind: "loop", loop: true, fps: 60, frames: 244, width: 512, height: 652, clipScale: 1.1818 },
      { id: "wave", kind: "loop", loop: true, fps: 60, frames: 281, width: 512, height: 570, clipScale: 1.0645 },
    ]);
    expect(riv.rive?.decodeBytes).toBe(plan.decodeBytes);
    // Wave now comes out larger than idle's 251 px width: 279×311.
    expect(plan.motions.map((m) => [m.width, m.height])).toEqual([[251, 320], [279, 311]]);
    expect(riv.rive?.loops).toEqual({ fps: 24, width: 279, height: 320 });
  });

  test("loops are quoted resampled — the same plan the script follows", () => {
    const p = tanka([["idle", 244, 652], ["wave", 281, 570]]);
    const riv = rowOf(exportRows(p, motionOf(p, "idle"), editing), "riv");
    // idle: round(244 × 24 / 60) = 98 frames; one factor for both loops,
    // 320 / 652, so idle is 251x320 and wave 251x280.
    expect(riv.rive).toEqual({
      motions: ["idle", "wave"], transitions: [], missing: [],
      decodeBytes: 98 * 251 * 320 * 4 + 112 * 251 * 280 * 4,
      loops: { fps: 24, width: 251, height: 320 }, tooHeavy: false,
    });
  });

  test("a character too heavy to open at the defaults is not offered, with its size", () => {
    // Twenty-four such loops is about 1.5 GB even at 24 fps and 320 px.
    const p = tanka(Array.from({ length: 24 }, (_, i) => [`loop${i}`, 300, 652] as [string, number, number]));
    const riv = rowOf(exportRows(p, motionOf(p, "loop0"), editing), "riv");
    expect(riv.state).toEqual({ kind: "not-offered", reason: "too-heavy" });
    expect(riv.canGenerate).toBe(false);
    expect(riv.rive?.tooHeavy).toBe(true);
    expect(riv.rive?.decodeBytes).toBeGreaterThan(768 * 1024 * 1024);
  });

  test("the .riv is ready for the motions it holds, and says which it lacks", () => {
    const p = mutate((b) => addRiv(b, ["bounce"]));
    const riv = rowOf(exportRows(p, motionOf(p), editing), "riv");
    expect(riv.state).toEqual({
      kind: "ready",
      files: [{ assetId: "mini-export-riv", name: "mini.riv", uri: "exports/mini.riv", size: 9_120, createdAt: 50 }],
    });
    expect(riv.rive).toEqual({ motions: ["bounce"], transitions: [], missing: [], decodeBytes: 65_536, loops: null, tooHeavy: false });

    // A motion that became ready after the file was made is not in it; the
    // row must not read as if it were.
    const later = mutate((b) => {
      addRiv(b, ["bounce"]);
      b.sprite.motions.push({ ...b.sprite.motions[0], id: "hop", label: "Hop", frames: ["bounce-frame-00"], loop: false });
    });
    expect(rowOf(exportRows(later, motionOf(later), editing), "riv").rive)
      .toEqual({ motions: ["bounce"], transitions: [], missing: ["hop"], decodeBytes: 65_536, loops: null, tooHeavy: false });

    // A ready file says the rate and size its loops PLAY at — what the file
    // recorded, not what a new one would be.
    const withLoop = mutate((b) => {
      addFlame(b);
      addRiv(b, ["bounce", "flame"], 50, [
        { motion: "bounce", frames: 4, fps: 8, width: 64, height: 64 },
        { motion: "flame", frames: 2, fps: 6, width: 32, height: 36 },
      ]);
    });
    expect(rowOf(exportRows(withLoop, motionOf(withLoop, "flame"), editing), "riv").rive)
      .toEqual({ motions: ["bounce", "flame"], transitions: [], missing: [], decodeBytes: 65_536, loops: { fps: 6, width: 32, height: 36 }, tooHeavy: false });
  });

  test("a viewing-only session shows only what can be downloaded", () => {
    const p = mutate((b) => addRiv(b, ["bounce"]));
    const rows = exportRows(p, motionOf(p), { canRequest: false, requests: new Map() });
    expect(rows.map((r) => r.format)).toEqual(["gif", "sheet", "riv"]);
    expect(rows.every((r) => r.state.kind === "ready" && !r.canGenerate)).toBe(true);
  });

  test("a request stands until a new file lands, and no longer", () => {
    const p = project();
    const key = exportKey(p, motionOf(p), "mp4");
    const requests = new Map<string, number | null>([[key, null]]);
    expect(rowOf(exportRows(p, motionOf(p), { canRequest: true, requests }), "mp4").requested).toBe(true);
    // Another format of the same motion was not asked for.
    expect(rowOf(exportRows(p, motionOf(p), { canRequest: true, requests }), "mov").requested).toBe(false);

    const landed = mutate((b) => {
      b.sprite.motions[0].exports = { mp4: "bounce-export-mp4" };
      b.assets.push({ id: "bounce-export-mp4", type: "video", uri: "motions/bounce/exports/bounce.mp4", name: "", metadata: {}, createdAt: 80, status: "ready" });
    });
    expect(rowOf(exportRows(landed, motionOf(landed), { canRequest: true, requests }), "mp4").requested).toBe(false);

    // Regenerating keeps the same asset id, so "landed" means a newer file:
    // the request remembers which one it was made against.
    const rivProject = mutate((b) => addRiv(b, ["bounce"], 50));
    const rivKey = exportKey(rivProject, null, "riv");
    const again = new Map<string, number | null>([[rivKey, 50]]);
    expect(rowOf(exportRows(rivProject, motionOf(rivProject), { canRequest: true, requests: again }), "riv").requested).toBe(true);
    const rebuilt = mutate((b) => addRiv(b, ["bounce"], 90));
    expect(rowOf(exportRows(rebuilt, motionOf(rebuilt), { canRequest: true, requests: again }), "riv").requested).toBe(false);

    // Keys are per character: the same motion id in another character is a
    // different request.
    const other = project(MINI, "other/project.json");
    expect(exportKey(other, motionOf(other), "mp4")).not.toBe(key);
  });

  test("the request names the motion, the format, and the colour for MP4", () => {
    const p = project();
    const mp4 = exportRequestNotification({ project: p, motion: motionOf(p), format: "mp4", background: "#1a2b3c", label: "Export" });
    expect(mp4.type).toBe("sprite-command:export");
    // Warning is what reaches the agent; info is only logged.
    expect(mp4.severity).toBe("warning");
    expect(mp4.summary).toBe("/export · Bounce · mp4");
    expect(mp4.message.split("\n")).toEqual([
      "The user pressed \"Export\" on the sprite stage's Export tab.",
      "command: export · character: mini · motion: bounce · format: mp4 · background: #1a2b3c",
      "Export it and register it, as the skill's Exporting section says.",
    ]);
    // Only MP4 is flattened, so only MP4 carries a colour.
    const mov = exportRequestNotification({ project: p, motion: motionOf(p), format: "mov", background: "#1a2b3c", label: "Export" });
    expect(mov.message).not.toContain("background");
    // The .riv is the whole character: it names no motion, but the motions
    // it would hold, and — when loops go in — the rate and size they would
    // be resampled to and what the file would cost.
    const riv = exportRequestNotification({ project: p, motion: null, format: "riv", background: null, label: "Export" });
    // The frames go in as the script's default, WebP: a Generate asks for it by name.
    expect(riv.message).toContain("command: export · character: mini · format: riv · images: webp");
    expect(riv.message).not.toContain("motion:");
    const loops = tanka([["idle", 244, 652], ["wave", 281, 570]]);
    const row = rowOf(exportRows(loops, motionOf(loops, "idle"), editing), "riv");
    const withLoops = exportRequestNotification({ project: loops, motion: null, format: "riv", background: null, label: "Export", rive: row.rive });
    expect(withLoops.message.split("\n")[1]).toBe(
      "command: export · character: mini · format: riv · images: webp · motions: idle,wave · loops: 24 fps, longest edge 320 px · estimate: 60 MB",
    );
    expect(riv.summary).toBe("/export · Mini · riv");
    // Pixel art is asked for lossless, by the rule the script's default follows.
    const pixelDoc = JSON.parse(MINI);
    pixelDoc.sprite.character.style = "16-bit pixel art, crisp outline";
    expect(exportRequestNotification({ project: project(JSON.stringify(pixelDoc)), motion: null, format: "riv", background: null, label: "Export" }).message)
      .toContain("format: riv · images: webp-lossless");
    // A root-level character is named as the workspace root, not as nothing.
    const root = project(MINI, "project.json");
    expect(exportRequestNotification({ project: root, motion: null, format: "riv", background: null, label: "Export" }).message)
      .toContain("character: .");
  });

  test("the colour field takes what a person types and nothing else", () => {
    expect(normalizeExportColor("#1A2B3C")).toBe("#1a2b3c");
    expect(normalizeExportColor("1a2b3c")).toBe("#1a2b3c");
    expect(normalizeExportColor(" #fff ")).toBe("#ffffff");
    for (const bad of ["", "#12345", "white", "#ggggggg", "#1a2b3c4d"]) {
      expect({ bad, out: normalizeExportColor(bad) }).toEqual({ bad, out: null });
    }
    // White first: it is the default, and the script's default too.
    expect(EXPORT_SWATCHES[0]).toBe("#ffffff");
    expect(EXPORT_SWATCHES.every((hex) => normalizeExportColor(hex) === hex)).toBe(true);
  });

  test("no two swatches look alike", () => {
    // #000000 beside #09090b (and #ffffff beside #f4f4f5) were two chips a
    // person cannot tell apart — a choice that is not one. Every pair is at
    // least a quarter of the RGB cube's diagonal apart.
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const far = Math.sqrt(3 * 255 * 255) / 4;
    for (const [i, a] of EXPORT_SWATCHES.entries()) {
      for (const b of EXPORT_SWATCHES.slice(i + 1)) {
        const distance = Math.hypot(...rgb(a).map((v, k) => v - rgb(b)[k]));
        expect({ a, b, apart: distance >= far }).toEqual({ a, b, apart: true });
      }
    }
  });

  test("with no agent to receive a request, nothing on the stage offers to make anything", () => {
    const live = { editing: true, readonly: false, staticPlayer: false, canNotify: true };
    expect(canAskAgent(live)).toBe(true);
    // A local `--viewing` session starts no agent ("Waiting for CLI
    // connection"); the shell hands the viewer `editing: false` in both
    // layouts. A request made there would sit in the queue and fire at
    // whichever agent starts next.
    expect(canAskAgent({ ...live, editing: false })).toBe(false);
    // A replay and the hosted player.
    expect(canAskAgent({ ...live, readonly: true })).toBe(false);
    expect(canAskAgent({ ...live, staticPlayer: true })).toBe(false);
    expect(canAskAgent({ ...live, canNotify: false })).toBe(false);

    // …and the tab it gates: downloads only — no Generate, no Regenerate,
    // and no MP4 colour, which is only shown beside a Generate.
    const p = mutate((b) => addRiv(b, ["bounce"]));
    const rows = exportRows(p, motionOf(p), { canRequest: canAskAgent({ ...live, editing: false }), requests: new Map() });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.state.kind === "ready" && !row.canGenerate)).toBe(true);
    expect(rows.some((row) => row.format === "mp4" && row.canGenerate)).toBe(false);
  });

  test("the export command lives in the tab, never on the stage's command bar", () => {
    const commands = [
      { id: "render-video", label: "Render a clip" },
      { id: "export", label: "Export" },
    ];
    expect(motionCommands(commands, motionOf(project())).map((c) => c.id)).toEqual(["render-video"]);
    expect(motionCommands(commands, null).map((c) => c.id)).toEqual(["render-video"]);
  });

  describe("in both languages", () => {
    const FORMATS = ["mp4", "mov", "webm", "gif", "webp", "apng", "lottie", "png-seq", "sheet", "riv"] as const;
    const REASONS = ["loop-gif", "loop-atlas", "too-heavy", "not-ready", "not-in-run"] as const;

    test("every row has a name and a purpose line", () => {
      for (const locale of ["en", "zh"]) {
        const t = spriteStrings(locale);
        for (const format of FORMATS) {
          expect(t.exportFormatName[format].length).toBeGreaterThan(0);
          expect(t.exportPurpose(format, { motions: 2 }).length).toBeGreaterThan(10);
        }
        for (const reason of REASONS) {
          // A sentence, not a word — Chinese is denser, hence the low bar.
          expect(t.exportNotOffered[reason].length).toBeGreaterThan(5);
        }
      }
    });

    test("the purpose lines say what each format is for", () => {
      const en = spriteStrings("en");
      expect(en.exportPurpose("mov", { motions: 1 })).toBe("ProRes 4444 · keeps transparency, for editing software");
      expect(en.exportPurpose("riv", { motions: 3 })).toBe("whole character, 3 motions, raster frames");
      expect(en.exportPurpose("riv", { motions: 1 })).toBe("whole character, 1 motion, raster frames");
      const zh = spriteStrings("zh");
      expect(zh.exportPurpose("mov", { motions: 1 })).toBe("ProRes 4444 · 保留透明，给剪辑软件用");
      expect(zh.exportPurpose("riv", { motions: 3 })).toBe("整个角色 · 3 个动作 · 位图帧");
      expect(zh.exportFamily).toEqual({ video: "视频", frames: "帧动画", rive: "Rive" });
      expect(zh.tab.export).toBe("导出");
      expect(en.tab.export).toBe("Export");
      // Chinese reasons are written in Chinese, not left in English.
      for (const reason of REASONS) {
        expect(/[一-鿿]/.test(zh.exportNotOffered[reason])).toBe(true);
      }
    });

    test("the repeat is stated, and so is a Rive file that lacks a motion", () => {
      const en = spriteStrings("en");
      expect(en.exportRepeat({ repeat: 6, seconds: 3, defaulted: true }, true)).toBe("plays 6× · 3.0 s — repeats until at least 3 s");
      expect(en.exportRepeat({ repeat: 1, seconds: 0.5, defaulted: true }, false)).toBe("plays once · 0.5 s");
      expect(en.exportRepeat({ repeat: 2, seconds: 1, defaulted: false }, true)).toBe("plays 2× · 1.0 s");
      const zh = spriteStrings("zh");
      expect(zh.exportRepeat({ repeat: 6, seconds: 3, defaulted: true }, true)).toBe("播 6 遍 · 3.0 秒——循环动作会重复到至少 3 秒");
      expect(zh.exportRepeat({ repeat: 1, seconds: 0.5, defaulted: true }, false)).toBe("播 1 遍 · 0.5 秒");
      expect(en.exportRiveMissing(["hop", "jump"])).toBe("Does not include hop, jump yet — regenerate to add them");
      expect(zh.exportRiveMissing(["hop", "jump"])).toBe("还没有包含 hop、jump——重新生成就会加进去");
      expect(en.exportRiveLoops({ fps: 24, width: 251, height: 320 })).toBe("loops resampled to 24 fps, up to 251×320 px");
      expect(zh.exportRiveLoops({ fps: 24, width: 251, height: 320 })).toBe("循环动画降到 24 fps，最大 251×320");
    });
  });
});

// ── The Rive preview ───────────────────────────────────────────────────────

/**
 * The runtime is the official `@rive-app/canvas`; everything it hands back is
 * mapped here, in plain functions, so the component is left with nothing to
 * decide. The runtime itself is exercised by the live-tier test.
 */
describe("the Rive preview", () => {
  test("inputs become controls in the file's order, by kind", () => {
    expect(RIVE_INPUT_TYPE).toEqual({ number: 56, trigger: 58, boolean: 59 });
    const controls = riveControls([
      { name: "play_idle", type: 58 },
      { name: "play_attack", type: 58 },
      { name: "armed", type: 59, value: true },
      { name: "speed", type: 56, value: 1.5 },
    ]);
    expect(controls).toEqual([
      { kind: "trigger", name: "play_idle" },
      { kind: "trigger", name: "play_attack" },
      { kind: "boolean", name: "armed", value: true },
      { kind: "number", name: "speed", value: 1.5 },
    ]);
  });

  test("an input it cannot drive is dropped, and a bad value is not invented", () => {
    const controls = riveControls([
      { name: "mystery", type: 99 },
      { name: "", type: 58 },
      { name: "flag", type: 59, value: "yes" },
      { name: "level", type: 56, value: Number.NaN },
    ]);
    // A boolean with no real value reads as off, a number as 0 — the
    // runtime's own defaults — rather than as whatever was passed.
    expect(controls).toEqual([
      { kind: "boolean", name: "flag", value: false },
      { kind: "number", name: "level", value: 0 },
    ]);
  });

  test("the machine played is the one the export writes, else the file's first", () => {
    // `sprite-sheet.mjs rive` names its machine the way the Rive editor names
    // a first machine; a file from anywhere else still plays its own.
    expect(RIVE_PREFERRED_MACHINE).toBe("State Machine 1");
    expect(riveMachineToPlay(["Other", "State Machine 1"])).toBe("State Machine 1");
    expect(riveMachineToPlay(["Walker"])).toBe("Walker");
    expect(riveMachineToPlay([])).toBeNull();
  });

  test("the current state is the last state name the runtime reported", () => {
    expect(riveStateName(["idle"])).toBe("idle");
    expect(riveStateName(["attack", "idle"])).toBe("idle");
    expect(riveStateName([])).toBeNull();
    expect(riveStateName(undefined)).toBeNull();
    expect(riveStateName([3, null])).toBeNull();
    expect(riveStateName("idle")).toBe("idle");
  });

  test("a failure says where it failed and what the runtime said", () => {
    expect(riveFailure("runtime", new Error("Could not load Rive WASM file"))).toEqual({
      stage: "runtime", detail: "Could not load Rive WASM file",
    });
    // `onLoadError` hands an event whose `data` is the message.
    expect(riveFailure("file", { type: "loaderror", data: "Problem loading file; may be corrupt!" })).toEqual({
      stage: "file", detail: "Problem loading file; may be corrupt!",
    });
    expect(riveFailure("file", "404")).toEqual({ stage: "file", detail: "404" });
    // Nothing to say is still a failure with something on screen.
    expect(riveFailure("state-machine", undefined)).toEqual({ stage: "state-machine", detail: "" });
    const en = spriteStrings("en");
    const zh = spriteStrings("zh");
    for (const stage of ["runtime", "file", "state-machine"] as const) {
      expect(en.riveError[stage].length).toBeGreaterThan(10);
      expect(/[一-鿿]/.test(zh.riveError[stage])).toBe(true);
    }
  });
});

// ── Connected motions ──────────────────────────────────────────────────────

/**
 * A transition is the clip between two loops, made for the `.riv`: it shows
 * as "Idle → Coffee" in its own list, plays once, exports as a one-shot, is
 * counted apart in the Rive row, and a failed join is visible.
 */
describe("connected motions", () => {
  const T0 = 100;
  /** Two ready loops — 待机 and 喝咖啡 — and the transition between them both
   *  ways, the exit made with --reverse-of. */
  function cafe(opts: { endGap?: number; reverseCurrent?: boolean; coffeeReady?: boolean } = {}) {
    return mutate((b) => {
      b.sprite.motions = [];
      b.assets = [];
      b.provenance = [];
      const frames = (id: string, n: number, w: number, h: number, at = T0) => {
        const ids = Array.from({ length: n }, (_, i) => `${id}-frame-${String(i).padStart(3, "0")}`);
        b.assets.push(...ids.map((fid) => ({ id: fid, type: "image", uri: `motions/${id}/frames/${fid.slice(-3)}.png`, name: fid, metadata: { width: w, height: h }, createdAt: at, status: "ready" })));
        return ids;
      };
      const loop = (id: string, label: string, status = "ready") => ({
        id, label, prompt: "", kind: "loop", grid: { rows: 1, cols: 1 }, fps: 24, loop: true, anchor: "bottom",
        status, source: "video", frames: frames(id, 48, 200, 200), videos: [],
        inspect: { frameCount: 48, cell: { width: 200, height: 200 }, crop: { x: 0, y: 0, w: 200, h: 200 }, scale: 1, warnings: [] },
      });
      const into = frames("idle-to-coffee", 12, 200, 200);
      const back = frames("coffee-to-idle", 12, 200, 200, T0 + 1);
      b.provenance.push(...back.map((id, i) => ({
        toAssetId: id, fromAssetId: into[11 - i],
        operation: { type: "derive", actor: "agent", params: { step: "reverse", frameIndex: i }, timestamp: opts.reverseCurrent === false ? T0 - 1 : T0 + 1 },
      })));
      const inspect = (startGap: number, endGap: number) => ({
        frameCount: 12, cell: { width: 200, height: 200 }, crop: { x: 0, y: 0, w: 200, h: 200 }, scale: 1,
        step: 0.05, startGap, endGap, warnings: endGap > 0.1 ? ["the end does not land on coffee's frame 0"] : [],
      });
      b.sprite.motions.push(
        loop("idle", "待机"),
        loop("coffee", "喝咖啡", opts.coffeeReady === false ? "planned" : "ready"),
        {
          id: "idle-to-coffee", label: "idle → coffee", prompt: "", kind: "transition", from: "idle", to: "coffee",
          grid: { rows: 1, cols: 1 }, fps: 24, loop: false, anchor: "bottom", status: "ready", source: "video",
          frames: into, videos: [{ id: "idle-to-coffee-video-1", asset: "idle-to-coffee-clip", model: "seedance-2.5", mode: "first-last", status: "ready" }],
          inspect: inspect(0.02, opts.endGap ?? 0.03),
        },
        {
          id: "coffee-to-idle", label: "coffee → idle", prompt: "", kind: "transition", from: "coffee", to: "idle",
          reverseOf: "idle-to-coffee", grid: { rows: 1, cols: 1 }, fps: 24, loop: false, anchor: "bottom",
          status: "ready", source: "video", frames: back, videos: [], inspect: inspect(opts.endGap ?? 0.03, 0.02),
        },
      );
      b.assets.push({ id: "idle-to-coffee-clip", type: "video", uri: "motions/idle-to-coffee/video-1.mp4", name: "", metadata: {}, createdAt: T0, status: "ready" });
    });
  }
  const editing = { canRequest: true, requests: new Map<string, number | null>() };
  const rowOf = (rows: ExportRow[], format: string): ExportRow => {
    const row = rows.find((r) => r.format === format);
    if (!row) throw new Error(`no ${format} row`);
    return row;
  };

  test("tanka's sidecar shape: the .riv's record is found among thousands of edges, and its row counts loops and transitions apart", () => {
    // As register-export leaves it on a real character: the .riv edge sits
    // deep in provenance (tanka: index 2757 of 3090), frame and clip edges
    // before it and later export edges of the same family after it.
    const machine = {
      name: "State Machine 1", hub: "idle",
      number: { name: "motion", default: 0, values: [{ value: 0, motion: "idle" }, { value: 1, motion: "coffee" }] },
      triggers: [],
    };
    const base = cafe();
    const p = mutate((b) => {
      const real = JSON.parse(JSON.stringify({ assets: base.assets, provenance: base.provenance, sprite: base.sprite }));
      b.assets = real.assets;
      b.sprite = { ...b.sprite, motions: base.sprite.motions.map((m) => ({ ...m })), exports: { riv: "cafe-export-riv" } };
      const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({
        toAssetId: `${tag}-${i}`, fromAssetId: `idle-frame-${String(i % 48).padStart(3, "0")}`,
        operation: { type: "derive", actor: "agent", timestamp: T0, params: { step: "from-video", t: i / 24 } },
      }));
      const allFrames = base.sprite.motions.flatMap((m) => m.frames);
      b.assets.push({ id: "cafe-export-riv", type: "image", uri: "exports/cafe.riv", name: "Cafe (rive)", metadata: { width: 315, height: 341, frames: 132, motionCount: 2, transitionCount: 2, estimatedDecodeBytes: 1_000_000, container: "riv", size: 90_000 }, createdAt: T0 + 5, status: "ready" });
      b.assets.push(...["idle-export-mp4", "coffee-export-webm"].map((id) => ({ id, type: "video", uri: `motions/x/exports/${id}`, name: id, metadata: { size: 1 }, createdAt: T0 + 6, status: "ready" })));
      b.provenance = [
        ...real.provenance, ...filler(2700, "clip-frame"),
        { toAssetId: "cafe-export-riv", fromAssetId: allFrames[0], operation: { type: "derive", actor: "agent", timestamp: T0 + 5,
          params: { tool: "sprite-sheet.mjs", step: "rive", images: "png", motions: base.sprite.motions.map((m) => m.id),
            sampled: [{ motion: "idle", frames: 48, fps: 24, width: 200, height: 200 }], stateMachine: machine, inputs: allFrames } } },
        ...["idle-export-mp4", "coffee-export-webm"].map((id) => ({ toAssetId: id, fromAssetId: allFrames[0], operation: { type: "derive", actor: "agent", timestamp: T0 + 6, params: { tool: "sprite-sheet.mjs", step: "export", format: id.split("-").pop(), inputs: allFrames } } })),
        ...filler(300, "later"),
      ];
    }, "cafe/project.json");
    const riv = rowOf(exportRows(p, motionOf(p, "idle"), editing), "riv");
    expect(riv.state.kind).toBe("ready");
    expect(riv.rive?.machine).toEqual(machine);
    expect(riv.rive).toMatchObject({ motions: ["idle", "coffee"], transitions: ["idle-to-coffee", "coffee-to-idle"], missing: [] });
    const controls = riveControls([{ name: "motion", type: 56, value: 0 }], riv.rive!.machine!);
    expect(controls.map((c) => c.kind === "motion" && c.motion)).toEqual(["idle", "coffee"]);
    const counts = { motions: riv.rive!.motions.length, transitions: riv.rive!.transitions.length };
    expect(spriteStrings("zh").exportPurpose("riv", counts)).toBe("整个角色 · 2 个动作 · 2 段过渡 · 位图帧");
    expect(spriteStrings("en").exportPurpose("riv", counts)).toBe("whole character, 2 motions, 2 transitions, raster frames");
  });

  test("the header counts motions and transitions apart", () => {
    const p = cafe();
    expect(railGroups(p).motions).toHaveLength(2);
    expect(spriteStrings("en").motionCount(2)).toBe("2 motions");
    expect(spriteStrings("en").transitionCount(2)).toBe("2 transitions");
    expect(spriteStrings("en").transitionCount(1)).toBe("1 transition");
    expect(spriteStrings("zh").transitionCount(10)).toBe("10 段过渡");
  });

  test("the rail lists the loops, then the transitions in their own group, named by the loops they join", () => {
    const p = cafe();
    const groups = railGroups(p);
    expect(groups.motions.map((m) => m.id)).toEqual(["idle", "coffee"]);
    expect(groups.transitions.map((m) => m.id)).toEqual(["idle-to-coffee", "coffee-to-idle"]);
    // From the loops' labels as they are now, not the id the transition was made with.
    expect(motionLabel(p, motionOf(p, "idle-to-coffee"))).toBe("待机 → 喝咖啡");
    expect(motionLabel(p, motionOf(p, "coffee-to-idle"))).toBe("喝咖啡 → 待机");
    expect(motionLabel(p, motionOf(p, "idle"))).toBe("待机");
  });

  test("the agent reads a transition on stage as one, with its two loops", () => {
    const p = cafe();
    const data = playbackStateData({
      project: p, motion: motionOf(p, "idle-to-coffee"), source: { kind: "none" }, frame: 0, playing: true, fps: 24, loop: false,
    });
    expect(data).toMatchObject({ motion: "idle-to-coffee", kind: "transition", from: "idle", to: "coffee", loop: false });
  });

  test("a transition has its take and its exports; a reverse, which has no take, only its exports", () => {
    const p = cafe();
    const into = motionOf(p, "idle-to-coffee");
    const back = motionOf(p, "coffee-to-idle");
    expect(panelTabs(into)).toEqual(["video", "export"]);
    expect(defaultTab(into)).toBe("video");
    expect(panelTabs(back)).toEqual(["export"]);
    expect(defaultTab(back)).toBe("export");
    expect(tabAfterNavigate("loop", back)).toBe("export");
  });

  test("a transition exports as a one-shot: plays once, no GIF, no atlas", () => {
    const p = cafe();
    const rows = exportRows(p, motionOf(p, "idle-to-coffee"), editing);
    expect(rows.map((r) => [r.family, r.format, r.state.kind === "not-offered" ? r.state.reason : r.state.kind])).toEqual([
      ["video", "mp4", "missing"], ["video", "mov", "missing"], ["video", "webm", "missing"],
      ["frames", "gif", "transition-gif"],
      ["frames", "apng", "missing"], ["frames", "lottie", "missing"], ["frames", "png-seq", "missing"],
      ["frames", "sheet", "transition-atlas"],
      ["rive", "riv", "missing"],
    ]);
    expect(rowOf(rows, "mp4").video).toEqual({ repeat: 1, seconds: 0.5, defaulted: true });
  });

  test("the Rive row counts motions and transitions apart, and quotes the shared reverse once", () => {
    const p = cafe();
    const riv = rowOf(exportRows(p, motionOf(p, "idle"), editing), "riv");
    expect(riv.rive).toMatchObject({ motions: ["idle", "coffee"], transitions: ["idle-to-coffee", "coffee-to-idle"], missing: [] });
    const plan = rivePlanFor(p)!;
    expect(plan.motions.find((m) => m.id === "coffee-to-idle")!.shares).toBe("idle-to-coffee");
    expect(riv.rive?.decodeBytes).toBe(plan.decodeBytes);
    // A reverse made from an earlier cut of its source carries its own frames.
    const stale = rivePlanFor(cafe({ reverseCurrent: false }))!;
    expect(stale.motions.find((m) => m.id === "coffee-to-idle")!.shares).toBeUndefined();
    expect(stale.decodeBytes).toBeGreaterThan(plan.decodeBytes);
    // A transition whose loop is not ready goes nowhere, and is not counted.
    const half = rowOf(exportRows(cafe({ coffeeReady: false }), motionOf(cafe({ coffeeReady: false }), "idle"), editing), "riv");
    expect(half.rive).toMatchObject({ motions: ["idle"], transitions: [] });

    const en = spriteStrings("en");
    const zh = spriteStrings("zh");
    expect(en.exportPurpose("riv", { motions: 2, transitions: 2 })).toBe("whole character, 2 motions, 2 transitions, raster frames");
    expect(zh.exportPurpose("riv", { motions: 2, transitions: 2 })).toBe("整个角色 · 2 个动作 · 2 段过渡 · 位图帧");
    expect(zh.exportPurpose("riv", { motions: 3, transitions: 0 })).toBe("整个角色 · 3 个动作 · 位图帧");
    expect(en.exportRiveTransition(10)).toBe("This transition is part of the character's .riv — 10 transitions in all");
    expect(zh.exportRiveTransition(10)).toBe("这段过渡在角色的 .riv 里——一共 10 段过渡");
  });

  test("Generate asks for the transitions too", () => {
    const p = cafe();
    const riv = rowOf(exportRows(p, motionOf(p, "idle"), editing), "riv");
    const note = exportRequestNotification({ project: p, motion: motionOf(p, "idle"), format: "riv", background: null, label: "Export", rive: riv.rive });
    expect(note.message).toContain("motions: idle,coffee");
    expect(note.message).toContain("transitions: idle-to-coffee,coffee-to-idle");
  });

  test("a join that does not land is judged the way a seam is: against twice the step", () => {
    const p = cafe({ endGap: 0.4 });
    const verdict = joinVerdict(motionOf(p, "idle-to-coffee").inspect!);
    expect(verdict).toEqual({
      start: { gap: 0.02, limit: 0.1, over: false },
      end: { gap: 0.4, limit: 0.1, over: true },
    });
    expect(joinVerdict(motionOf(cafe(), "idle-to-coffee").inspect!).end.over).toBe(false);
    for (const locale of ["en", "zh"] as const) {
      const t = spriteStrings(locale);
      expect(t.transitions.length).toBeGreaterThan(0);
      expect(t.transitionChip.length).toBeGreaterThan(0);
      expect(t.factStartGap.length).toBeGreaterThan(0);
      expect(t.factEndGap.length).toBeGreaterThan(0);
    }
    expect(spriteStrings("zh").joinVerdict).toEqual({ lands: "接得上", off: "接不上" });
    expect(spriteStrings("en").joinVerdict).toEqual({ lands: "lands", off: "does not land" });
    expect(spriteStrings("zh").transitions).toBe("过渡");
    expect(spriteStrings("zh").joinOff("end")).toBe("终点接不上");
    expect(spriteStrings("en").joinOff("start")).toBe("start does not land");
    expect(spriteStrings("zh").reverseTitle("idle-to-coffee")).toBe("由 idle-to-coffee 倒放而来");
    expect(spriteStrings("en").reverseTitle("idle-to-coffee")).toBe("idle-to-coffee played backwards");
    for (const reason of ["transition-gif", "transition-atlas"] as const) {
      expect(spriteStrings("en").exportNotOffered[reason].length).toBeGreaterThan(20);
      expect(/[一-鿿]/.test(spriteStrings("zh").exportNotOffered[reason])).toBe(true);
    }
  });

  test("the Rive preview: a button per loop sets motion, a button per one-shot fires it, from the file's record", () => {
    const machine = {
      name: "State Machine 1",
      hub: "idle",
      number: { name: "motion", default: 0, values: [{ value: 0, motion: "idle" }, { value: 1, motion: "coffee" }] },
      triggers: [{ name: "play_wave", motion: "wave" }],
    };
    const controls = riveControls([
      { name: "motion", type: 56, value: 1 },
      { name: "play_wave", type: 58 },
      { name: "extra", type: 59, value: true },
    ], machine);
    expect(controls).toEqual([
      { kind: "motion", name: "motion", value: 0, motion: "idle", active: false },
      { kind: "motion", name: "motion", value: 1, motion: "coffee", active: true },
      { kind: "trigger", name: "play_wave", motion: "wave" },
      { kind: "boolean", name: "extra", value: true },
    ]);
    // Without a record — an older file — the number is a plain stepper.
    expect(riveControls([{ name: "motion", type: 56, value: 1 }], null)).toEqual([{ kind: "number", name: "motion", value: 1 }]);
    // The panel reads the record off the registered file.
    const p = mutate((b) => {
      b.sprite.exports = { riv: "mini-export-riv" };
      b.assets.push({ id: "mini-export-riv", type: "image", uri: "exports/mini.riv", name: "", metadata: { motionCount: 1, transitionCount: 0 }, createdAt: 5, status: "ready" });
      b.provenance.push({ toAssetId: "mini-export-riv", fromAssetId: null, operation: { type: "derive", actor: "agent", timestamp: 5, params: { step: "rive", motions: ["bounce"], stateMachine: machine } } });
    });
    expect(rowOf(exportRows(p, motionOf(p), editing), "riv").rive?.machine).toEqual(machine);

    // The route, as the states go by: the last few names, the newest last.
    let trail: string[] = [];
    for (const name of ["idle", "idle-to-coffee", "coffee", "coffee", "coffee-to-idle", "idle"]) trail = riveTrail(trail, name);
    expect(trail).toEqual(["idle-to-coffee", "coffee", "coffee-to-idle", "idle"]);
    expect(riveTrail(["idle"], null)).toEqual(["idle"]);

    for (const locale of ["en", "zh"] as const) {
      const t = spriteStrings(locale);
      expect(t.riveLoopsHeading("motion").length).toBeGreaterThan(3);
      expect(t.riveOneShotsHeading.length).toBeGreaterThan(1);
      expect(t.riveSetMotion("motion", 1, "喝咖啡")).toContain("喝咖啡");
    }
    expect(spriteStrings("zh").riveLoopsHeading("motion")).toBe("循环 · 设置 motion");
    expect(spriteStrings("en").riveLoopsHeading("motion")).toBe("Loops · set motion");
    expect(spriteStrings("zh").riveOneShotsHeading).toBe("单次动作 · 触发");
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
