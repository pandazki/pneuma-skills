/**
 * The 0.6.0 game-asset pipeline's pure modules: facing sheets and packs
 * (`pack.mjs`), item sheets, and the remakes — variants, restyles,
 * storyboards and the motion library (`remake.mjs`) — plus how `domain.ts`
 * loads what they record. No ffmpeg, no network.
 */

import { describe, expect, test } from "bun:test";

import { loadRoster } from "../domain.js";
import {
  FACING_LAYOUTS,
  PACK_PROMPT_BUILDER,
  cellRects,
  facingLayout,
  facingSheetPrompt,
  itemGrid,
  itemId,
  itemSheetPrompt,
  packCellMotionId,
  packClipPrompt,
} from "../skill/scripts/pack.mjs";
import {
  MOTION_LIBRARY,
  libraryClipPrompt,
  libraryEntry,
  restylePrompt,
  storyboardPrompt,
  variantEditPrompt,
} from "../skill/scripts/remake.mjs";

const PIP = {
  name: "Pip",
  style: "Chibi isometric game character art.",
  description: "A small alchemist girl with a round satchel.",
  cell: { width: 256, height: 256 },
  view: "isometric" as const,
};

describe("facing layouts", () => {
  test("8 is the compass on a 3x3 grid with the centre empty, in AutoSprite's row-major order", () => {
    expect(FACING_LAYOUTS[8].cells).toEqual(["back-left", "back", "back-right", "left", null, "right", "front-left", "front", "front-right"]);
    expect(facingLayout("8")).toEqual({ rows: 3, cols: 3, cells: FACING_LAYOUTS[8].cells });
    expect(facingLayout(4).cells).toEqual(["front", "back", "left", "right"]);
  });

  test("a layout is refused when it does not fill its grid, repeats a facing, or names an unknown one", () => {
    expect(() => facingLayout("6")).toThrow(/--layout/);
    expect(() => facingLayout({ rows: 1, cols: 2, cells: ["front"] })).toThrow(/lists 2 cells/);
    expect(() => facingLayout({ rows: 1, cols: 2, cells: ["front", "front"] })).toThrow(/twice/);
    expect(() => facingLayout({ rows: 1, cols: 2, cells: ["front", "north" as never] })).toThrow(/unknown direction/);
  });

  test("cell rects are equal, even-sized and cover the picture row by row", () => {
    const rects = cellRects(1440, 1440, 3, 3);
    expect(rects).toHaveLength(9);
    expect(rects[4]).toEqual({ row: 1, col: 1, x: 480, y: 480, w: 480, h: 480 });
    for (const r of cellRects(1001, 641, 2, 3)) {
      expect(r.w % 2).toBe(0);
      expect(r.h % 2).toBe(0);
    }
  });
});

describe("facing sheet and pack clip prompts", () => {
  test("the facing sheet names every copy's facing by its cell and states the camera", () => {
    const { prompt, layout, builder } = facingSheetPrompt({ character: PIP });
    expect(builder).toBe(PACK_PROMPT_BUILDER);
    expect(layout.cells.filter(Boolean)).toHaveLength(8);
    expect(prompt).toContain("The centre cell is completely empty white.");
    expect(prompt).toContain("the top-middle copy faces straight away from the viewer");
    expect(prompt).toContain("the bottom-right copy is a front three-quarter view facing down and to the right");
    expect(prompt).toContain("Isometric game camera");
    expect(prompt.startsWith(PIP.style)).toBe(true);
  });

  test("a 2×2 four-facing sheet names each copy's facing without the compass sentence", () => {
    const { prompt } = facingSheetPrompt({ character: PIP, layout: "4" });
    expect(prompt).not.toContain("pointing from the centre");
    expect(prompt).toContain("The copies face: the top-left copy faces straight toward the viewer");
  });

  test("an asymmetric character's facing sheet carries the side sentence for every copy", () => {
    const { prompt } = facingSheetPrompt({ character: { ...PIP, asymmetric: "the satchel hangs at her own left hip" } });
    expect(prompt).toContain("stay on the same side of the body in every copy: the satchel hangs at her own left hip.");
    expect(prompt).toContain("For the front-left copy: Facing down and to the left");
  });

  test("a pack clip keeps every copy facing its way and in its cell; idle pins its last frame", () => {
    const pack = { state: "walk", rows: 3, cols: 3, cells: FACING_LAYOUTS[8].cells.map((d) => (d ? { direction: d, motion: `walk-${d}` } : null)) };
    const walk = packClipPrompt({ character: PIP, pack });
    expect(walk.prompt).toContain("All 8 copies walk in place at the same time, in sync");
    expect(walk.prompt).toContain("no copy turns, rotates or changes direction");
    expect(walk.pinned).toBe(false);
    const idle = packClipPrompt({ character: PIP, pack: { ...pack, state: "idle" } });
    expect(idle.pinned).toBe(true);
    expect(idle.prompt).toContain("The last frame returns to the exact picture of the first frame.");
    expect(() => packClipPrompt({ character: PIP, pack: { ...pack, state: "moonwalk" } })).toThrow(/--action/);
    expect(packClipPrompt({ character: PIP, pack: { ...pack, state: "moonwalk" }, action: "moonwalk backwards in place." }).prompt)
      .toContain("All 8 copies moonwalk backwards in place.");
  });

  test("an items pack speaks of items and always closes its loop", () => {
    const pack = { state: "loop", rows: 1, cols: 2, cells: [{ item: "key", motion: "key-loop" }, { item: "ring", motion: "ring-loop" }] };
    const { prompt, pinned } = packClipPrompt({ character: PIP, pack });
    expect(prompt).toContain("a 2 by 1 grid of 2 game items");
    expect(prompt).toContain("All 2 items come alive");
    expect(pinned).toBe(true);
    expect(packCellMotionId("loop", { item: "key" })).toBe("key-loop");
    expect(packCellMotionId("walk", { direction: "front-left" })).toBe("walk-front-left");
  });
});

describe("item sheets", () => {
  test("the grid is the tidiest at least as wide as tall, at most five across", () => {
    expect(itemGrid(10)).toEqual({ rows: 2, cols: 5 });
    expect(itemGrid(6)).toEqual({ rows: 2, cols: 3 });
    expect(itemGrid(4)).toEqual({ rows: 2, cols: 2 });
    expect(itemGrid(10, 4)).toEqual({ rows: 3, cols: 4 });
    expect(itemGrid(17, 4)).toEqual({ rows: 5, cols: 4 });
    expect(itemGrid(5, 2)).toEqual({ rows: 3, cols: 2 });
    expect(() => itemGrid(0)).toThrow();
    expect(() => itemGrid(26)).toThrow(/at most 25/);
  });

  test("ids are slugs; the prompt lists the items in cell order on a white plate", () => {
    expect(itemId("Healing Potion!")).toBe("healing-potion");
    expect(() => itemId("!!")).toThrow();
    const { prompt } = itemSheetPrompt({ character: { style: "Painterly icons." }, items: ["Key", "Ring", "Map"], cols: 3, rows: 1 });
    expect(prompt).toContain("The items, in order: 1. Key; 2. Ring; 3. Map.");
    expect(prompt).toContain("A flat solid pure white background");
  });
});

describe("remakes", () => {
  test("a variant edit keeps the person and the layout and changes one thing", () => {
    const { prompt } = variantEditPrompt({ character: PIP, note: "a purple witch outfit", what: "directions" });
    expect(prompt).toContain("Pip's facing sheet");
    expect(prompt).toContain("every copy in the same cell");
    expect(prompt).toContain("Change only this: a purple witch outfit.");
    expect(() => variantEditPrompt({ character: PIP, note: " " })).toThrow(/--variant/);
  });

  test("a restyle keeps @Video1's movement and takes @Image1's look; a pack keeps its grid", () => {
    const { prompt } = restylePrompt({ character: PIP, note: "witch outfit", grid: { rows: 3, cols: 3 } });
    expect(prompt).toContain("keep its movement exactly");
    expect(prompt).toContain("a 3 by 3 grid of copies");
    expect(prompt).toContain("The new look is @Image1");
  });

  test("a storyboard names its beats in time order and numbers the keyframes after the character", () => {
    const { prompt, attach } = storyboardPrompt({
      character: PIP,
      duration: 5,
      beats: [{ at: 0, text: "spins the staff" }, { at: 2, text: "tosses it up", keyframe: "a" }, { at: 3.5, text: "catches it", keyframe: "b" }],
    });
    expect(prompt).toContain("one continuous 5-second take of @Image1");
    expect(prompt).toContain("at 2s — tosses it up, matching the pose in @Image2.");
    expect(prompt).toContain("at 3.5s — catches it, matching the pose in @Image3.");
    expect(attach).toEqual(["@Image1 = the turnaround", "@Image2 = the keyframe at 2s", "@Image3 = the keyframe at 3.5s"]);
    expect(() => storyboardPrompt({ character: PIP, beats: [] })).toThrow(/no beats/);
  });

  test("the motion library films a realistic performer, whole body, locked camera", () => {
    expect(MOTION_LIBRARY.length).toBeGreaterThanOrEqual(8);
    expect(new Set(MOTION_LIBRARY.map((e) => e.id)).size).toBe(MOTION_LIBRARY.length);
    const dance = libraryEntry("victory-dance")!;
    const prompt = libraryClipPrompt(dance);
    expect(prompt).toContain("A realistic video of a young adult performer");
    expect(prompt).toContain("entire body from head to feet is always fully visible");
    expect(libraryEntry("nope")).toBeNull();
  });
});

describe("domain: what 0.6.0 records loads", () => {
  const project = (sprite: Record<string, unknown>) =>
    loadRoster([{ path: "pip/project.json", content: JSON.stringify({ $schema: "pneuma-craft/project/v1", title: "Pip", composition: null, assets: [], provenance: [], sprite: { version: 1, character: { name: "Pip", description: "", style: "s", cell: { width: 256, height: 256 } }, refs: [], motions: [], ...sprite } }) }])!.byContentSet.pip;

  test("a pack, its cells, a facing sheet, a variant and a view survive the loader", () => {
    const p = project({
      character: { name: "Pip", description: "", style: "s", cell: { width: 256, height: 256 }, view: "isometric", variantOf: { contentSet: "pip-base", note: "witch" } },
      refs: [{ id: "directions", asset: "ref-directions", role: "directions", label: "D", layout: { rows: 3, cols: 3, cells: FACING_LAYOUTS[8].cells } }],
      motions: [
        { id: "walk-pack", label: "Walk", kind: "pack", grid: { rows: 3, cols: 3 }, fps: 12, frames: [], videos: [], pack: { state: "walk", rows: 1, cols: 2, cells: [{ direction: "front", motion: "walk-front" }, null] } },
        { id: "walk-front", label: "Walk front", direction: "front", packOf: "walk-pack", grid: { rows: 1, cols: 1 }, fps: 12, frames: [], videos: [{ id: "video-1", asset: "a", model: "ffmpeg", mode: "derived", op: "crop", derivedFrom: "walk-pack/video-1", status: "ready", prompt: "" }] },
      ],
    });
    expect(p.sprite.character.view).toBe("isometric");
    expect(p.sprite.character.variantOf).toEqual({ contentSet: "pip-base", note: "witch" });
    expect(p.sprite.refs[0].role).toBe("directions");
    expect(p.sprite.refs[0].layout?.cells[4]).toBeNull();
    expect(p.sprite.motions[0].kind).toBe("pack");
    expect(p.sprite.motions[0].pack?.cells).toEqual([{ motion: "walk-front", direction: "front" }, null]);
    expect(p.sprite.motions[1].packOf).toBe("walk-pack");
    expect(p.sprite.motions[1].videos[0].op).toBe("crop");
  });

  test("a broken pack is no pack, a facing sheet without a layout is a custom ref", () => {
    const p = project({
      refs: [{ id: "directions", asset: "ref-directions", role: "directions", label: "D" }],
      motions: [{ id: "x", label: "X", kind: "pack", grid: { rows: 1, cols: 1 }, fps: 8, frames: [], videos: [], pack: { state: "walk", rows: 1, cols: 2, cells: [null] } }],
    });
    expect(p.sprite.refs[0].role).toBe("custom");
    expect(p.sprite.motions[0].kind).toBeUndefined();
  });

  test("a props set, its items, a model, a storyboard, a restyle and a transfer survive the loader", () => {
    const p = project({
      set: "props",
      items: [{ id: "key", label: "Key", image: "item-key", loop: "key-loop" }, { id: "key", label: "dupe", image: "x" }, { label: "no id" }],
      model: { glb: "model-glb", provider: "meshy-7.1", animations: [{ id: "walk", label: "Walk", asset: "model-anim-walk", action: 30 }, { id: "bad" }] },
      motions: [
        { id: "spin", label: "Spin", grid: { rows: 1, cols: 1 }, fps: 12, frames: [], videos: [], storyboard: { beats: [{ at: 0, text: "spins" }, { at: -1, text: "bad" }, { at: 2, text: "tosses", keyframe: "spin-beat-2" }] }, restyleOf: { contentSet: "pip", motion: "walk-pack" }, transfer: { from: "victory-dance", video: "spin-driver", label: "Victory dance" } },
        { id: "intro", label: "Intro", kind: "cutscene", grid: { rows: 1, cols: 1 }, fps: 24, frames: [], videos: [] },
      ],
    });
    expect(p.sprite.set).toBe("props");
    expect(p.sprite.items).toEqual([{ id: "key", label: "Key", image: "item-key", loop: "key-loop" }]);
    expect(p.sprite.model?.animations).toEqual([{ id: "walk", label: "Walk", asset: "model-anim-walk", action: 30 }]);
    expect(p.sprite.motions[0].storyboard?.beats).toEqual([{ at: 0, text: "spins" }, { at: 2, text: "tosses", keyframe: "spin-beat-2" }]);
    expect(p.sprite.motions[0].restyleOf).toEqual({ contentSet: "pip", motion: "walk-pack" });
    expect(p.sprite.motions[0].transfer).toEqual({ from: "victory-dance", video: "spin-driver", label: "Victory dance" });
    expect(p.sprite.motions[1].kind).toBe("cutscene");
  });
});
