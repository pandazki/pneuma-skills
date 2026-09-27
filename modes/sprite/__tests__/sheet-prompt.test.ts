/**
 * The code-built sheet prompt (`sheet-prompt.mjs`, `sprite-project.mjs
 * sheet-prompt`) and the layout guide (`sprite-sheet.mjs guide`).
 *
 * The module tests are pure and run everywhere. The builder's text is pinned
 * word for word under `sheet-prompt/1`: a change to any sentence has to fail
 * here, because a recorded `promptParts.builder` must keep meaning the words
 * it produced — change the text, bump the builder.
 *
 * The CLI halves run the real scripts. `sheet-prompt` needs no ffmpeg; the
 * guide PNG and the anchor ref (a registered image) do, and skip with a named
 * reason without it.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_SAFE_MARGIN_RATIO,
  GUIDE_DEFAULT,
  SHEET_PROMPT_BUILDER,
  buildSheetPrompt,
  generationCell,
  guideGeometry,
  guideRaster,
  renderSheetPrompt,
  safeMarginFor,
  sheetGrid,
  sheetGuards,
  stateOf,
  type SheetCharacter,
  type SheetMotion,
} from "../skill/scripts/sheet-prompt.mjs";
import { buildSheet } from "./fixtures/pipeline/make-sheet.mjs";

const PROJECT = join(import.meta.dir, "..", "skill", "scripts", "sprite-project.mjs");
const SHEET = join(import.meta.dir, "..", "skill", "scripts", "sprite-sheet.mjs");

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!HAS_FFMPEG) console.warn("(skip) sheet-prompt guide PNG + anchor ref cases — ffmpeg/ffprobe not on PATH");

const BLOB: SheetCharacter = {
  style: "Flat vector blob, thick outline",
  description: "A round test blob with one antenna.",
  cell: { width: 64, height: 64 },
  facing: "right",
};
const IDLE: SheetMotion = { id: "idle", label: "Idle", grid: { rows: 2, cols: 4 }, loop: true };
const ACTION = "Cells 1-4 the blob swells, cells 5-8 it settles back.";

/** `sheet-prompt/1` for BLOB's 8-frame idle, word for word. */
const GOLDEN_IDLE =
  "Flat vector blob, thick outline. A single 2048x1024 image laid out as a strict 4x2 grid of 8 equal 512x512 cells, 4 columns and 2 rows, read left to right, top to bottom. Each cell holds the whole character exactly once, centred in the cell, with at least 48 px of empty background on every side — anything the character holds or wears that moves included — and nothing crosses into a neighbouring cell. The same character in every cell, matching the attached references exactly. A round test blob with one antenna. Keep white and pale details inside the character — highlights, eye whites, pale hair or clothing — fully opaque; only the background is white. The character faces right. Fixed camera: consistent body proportions, drawing scale and camera distance in every cell, and ground contacts share one baseline while the character stands on the ground. The references own the identity — face, hair shape, markings, palette, outline weight, proportions, outfit and props stay exactly as they show, and whatever is worn or held on one side stays on that side. This sheet owns motion only: spend the variation on pose, limb contacts, body height, torso lean, head bob, and hair and cloth follow-through. Prefer a subtler animation over any change that alters the character's identity. The motion (8 frames, looping): Cells 1-4 the blob swells, cells 5-8 it settles back. This is an idle: the feet, or whatever the character rests on, stay planted on the same baseline in every cell and never lift, step, shuffle or slide — no walking, no marching in place, no turning, no change of facing. The eyes close in one cell at most. The motion runs straight on across row ends: the first cell of each row continues from the last cell of the row above by the same small step as the cells within a row. Cell 8 leads smoothly into cell 1 on the next beat, with compatible movement direction and without an extra hold. Show it through pose, expression and silhouette, never through effects: nothing detached from the character — no floating sparkles, symbols, smoke, dust, motion arcs, speed lines, afterimages, smears, glows or impact bursts. A flat solid pure white background filling every cell, no gradient. No grid lines, no cell borders, no numbers, no text, no floor, no drop shadow, no ground shadow, no motion blur.";

describe("sheet-prompt.mjs — the builder", () => {
  test("sheet-prompt/1 text is pinned, and the same parts render the same text", () => {
    const built = buildSheetPrompt({ character: BLOB, motion: IDLE, action: ACTION });
    expect(SHEET_PROMPT_BUILDER).toBe("sheet-prompt/1");
    expect(built.prompt).toBe(GOLDEN_IDLE);
    expect(built.parts).toEqual({
      builder: "sheet-prompt/1",
      action: ACTION,
      guards: ["state:idle", "row-continuity", "loop-close"],
    });
    // Twice, and from the recorded parts alone: byte for byte.
    expect(buildSheetPrompt({ character: BLOB, motion: IDLE, action: ACTION }).prompt).toBe(built.prompt);
    expect(renderSheetPrompt({ character: BLOB, motion: IDLE }, JSON.parse(JSON.stringify(built.parts)))).toBe(built.prompt);
  });

  test("the style sentence opens the prompt verbatim; the action is carried verbatim", () => {
    const style = "32-bit pixel art, limited 16-color palette, hard pixel edges.";
    const action = "  Side view. Contact, down, pass, up in cells 1-4; the mirrored half in 5-8  ";
    const { prompt, parts } = buildSheetPrompt({ character: { ...BLOB, style }, motion: IDLE, action });
    expect(prompt.startsWith(`${style} A single `)).toBe(true);
    expect(parts.action).toBe(action.trim());
    expect(prompt).toContain(`(8 frames, looping): ${action.trim()}. This is an idle`);
  });

  test("the geometry: grid, generation cell, image size and 9.4 % safe margin", () => {
    const { geometry } = buildSheetPrompt({ character: BLOB, motion: IDLE, action: ACTION });
    expect(geometry).toEqual({
      rows: 2, cols: 4, cell: { width: 512, height: 512 }, safeMargin: { x: 48, y: 48 },
      width: 2048, height: 1024, imageSize: "2048x1024",
    });
    expect(generationCell({ width: 256, height: 256 })).toEqual({ width: 512, height: 512 });
    expect(generationCell({ width: 256, height: 384 })).toEqual({ width: 256, height: 384 });
    expect(generationCell({ width: 600, height: 600 })).toEqual({ width: 600, height: 600 });
    expect(DEFAULT_SAFE_MARGIN_RATIO).toBe(0.094);
    expect(safeMarginFor({ width: 256, height: 256 })).toEqual({ x: 24, y: 24 });
    expect(safeMarginFor({ width: 256, height: 384 })).toEqual({ x: 24, y: 36 });
    const tall = buildSheetPrompt({ character: { ...BLOB, cell: { width: 256, height: 384 } }, motion: IDLE, action: ACTION });
    expect(tall.prompt).toContain("A single 1024x768 image laid out as a strict 4x2 grid of 8 equal 256x384 cells");
    expect(tall.prompt).toContain("at least 24 px of empty background left and right and 36 px above and below");
  });

  test("frame counts map to grids of at most four columns; others are refused", () => {
    expect(sheetGrid(2)).toEqual({ rows: 1, cols: 2 });
    expect(sheetGrid(3)).toEqual({ rows: 1, cols: 3 });
    expect(sheetGrid(4)).toEqual({ rows: 2, cols: 2 });
    expect(sheetGrid(6)).toEqual({ rows: 2, cols: 3 });
    expect(sheetGrid(8)).toEqual({ rows: 2, cols: 4 });
    expect(sheetGrid(9)).toEqual({ rows: 3, cols: 3 });
    expect(sheetGrid(12)).toEqual({ rows: 3, cols: 4 });
    expect(sheetGrid(16)).toEqual({ rows: 4, cols: 4 });
    for (const bad of [0, 1, 5, 7, 10, 24]) expect(() => sheetGrid(bad)).toThrow(/a sheet holds 2, 3, 4, 6, 8, 9, 12, 16 frames/);
  });

  test("the state is read off the id, then the label; unknown is generic", () => {
    expect(stateOf({ id: "idle" })).toBe("idle");
    expect(stateOf({ id: "walk-right" })).toBe("walk");
    expect(stateOf({ id: "run-front" })).toBe("run");
    expect(stateOf({ id: "lantern-swing" })).toBe("attack");
    expect(stateOf({ id: "m3", label: "Big Hop" })).toBe("jump");
    expect(stateOf({ id: "hello" })).toBe("wave");
    expect(stateOf({ id: "celebrate", label: "Celebrate" })).toBe("generic");
    // The id wins over the label, and the first matching token wins.
    expect(stateOf({ id: "attack", label: "Walk" })).toBe("attack");
    expect(stateOf({ id: "run-attack" })).toBe("run");
  });

  test("each state carries its own guard; generic carries none of theirs", () => {
    const guard = (id: string, direction?: SheetMotion["direction"]) =>
      buildSheetPrompt({ character: BLOB, motion: { ...IDLE, id, label: id, loop: false, ...(direction ? { direction } : {}) }, action: ACTION });
    expect(guard("walk").prompt).toContain("This is a walk in place: the character walks on the spot");
    expect(guard("walk").prompt).not.toContain("Seen from the");
    expect(guard("walk-front", "front").prompt).toContain("Seen from the front, the gait reads through alternating leg, arm, shoulder and body-height changes");
    expect(guard("run").prompt).toContain("This is a run in place: the character runs on the spot with a bounding rhythm");
    expect(guard("jump").prompt).toContain("This is one jump, not repeated hops");
    expect(guard("attack").prompt).toContain("one hand stays one hand, both hands stay both hands");
    expect(guard("wave").prompt).toContain("This is a gesture made with the arm alone");
    const generic = guard("celebrate");
    expect(generic.parts.guards).toContain("state:generic");
    expect(generic.prompt).toContain("Carry the action in the body");
    expect(generic.prompt).not.toContain("This is ");
    // --state overrides the reading.
    const forced = buildSheetPrompt({ character: BLOB, motion: IDLE, action: ACTION, state: "wave" });
    expect(forced.parts.guards).toContain("state:wave");
    expect(() => buildSheetPrompt({ character: BLOB, motion: IDLE, action: ACTION, state: "dance" as never })).toThrow(/--state: expected/);
  });

  test("row continuity only with more than one row; the ending follows loop", () => {
    const strip = buildSheetPrompt({ character: BLOB, motion: { ...IDLE, grid: { rows: 1, cols: 3 }, loop: false }, action: ACTION });
    expect(strip.parts.guards).toEqual(["state:idle", "one-shot-end"]);
    expect(strip.prompt).toContain("(3 frames, played once)");
    expect(strip.prompt).toContain("Cell 3 is the pose the motion ends on.");
    expect(strip.prompt).not.toContain("row ends");
    expect(strip.prompt).toContain("3 columns and 1 row,");
  });

  test("a direction locks the facing; the anchor for it is named and attached, others are not", () => {
    const refs = [
      { id: "turnaround", role: "turnaround" },
      { id: "anchor-left", role: "anchor", direction: "left" as const },
      { id: "portrait", role: "portrait" },
      { id: "anchor-right", role: "anchor", direction: "right" as const },
    ];
    const walkLeft = { ...IDLE, id: "walk-left", direction: "left" as const };
    const built = buildSheetPrompt({ character: BLOB, motion: walkLeft, refs, action: ACTION });
    expect(built.parts.guards).toEqual(["direction:left", "anchor:left", "state:walk", "row-continuity", "loop-close"]);
    expect(built.prompt).toContain("Every cell is a pure side profile facing camera-left; lock the whole sheet to that facing");
    expect(built.prompt).toContain("The attached left-facing anchor is authoritative for that facing");
    expect(built.prompt).not.toContain("The character faces right.");
    // The direction's anchor goes first, whatever order the refs were
    // registered in — the recipe E7 measured (prompting.md, Direction
    // anchors); anchors facing elsewhere stay home.
    expect(built.attach).toEqual(["anchor-left", "turnaround", "portrait"]);
    // No anchor facing that way: the lock stays, the anchor clause does not.
    const front = buildSheetPrompt({ character: BLOB, motion: { ...walkLeft, id: "walk-front", direction: "front" }, refs, action: ACTION });
    expect(front.parts.guards).toEqual(["direction:front", "state:walk", "row-continuity", "loop-close"]);
    expect(front.prompt).toContain("Every cell faces the viewer (front view)");
    expect(front.prompt).not.toContain("anchor is authoritative");
    expect(front.attach).toEqual(["turnaround", "portrait"]);
    expect(buildSheetPrompt({ character: BLOB, motion: { ...walkLeft, direction: "back" }, action: ACTION }).prompt)
      .toContain("Every cell faces away from the viewer (back view, no visible face)");
  });

  test("the asymmetric sentence is carried verbatim as a lock; pixel art states its logical height", () => {
    const character = { ...BLOB, asymmetric: "The sword is in the right hand; the scar is over the left eye", pixel: { logicalHeight: 32 } };
    const built = buildSheetPrompt({ character, motion: IDLE, action: ACTION });
    expect(built.parts.guards).toEqual(["pixel:32", "asymmetric", "state:idle", "row-continuity", "loop-close"]);
    expect(built.prompt).toContain("These details are side-specific and never flip or change sides in any cell: The sword is in the right hand; the scar is over the left eye.");
    expect(built.prompt).toContain("Flat vector blob, thick outline. Pixel art, 32 logical pixels tall: every logical pixel is a crisp square block");
    // An empty sentence is no lock.
    expect(buildSheetPrompt({ character: { ...BLOB, asymmetric: "  " }, motion: IDLE, action: ACTION }).parts.guards).not.toContain("asymmetric");
  });

  test("the guide clause and its geometry travel together", () => {
    const built = buildSheetPrompt({ character: BLOB, motion: IDLE, action: ACTION, guide: true });
    expect(built.parts.guards[0]).toBe("guide");
    expect(built.parts.guide).toEqual({ rows: 2, cols: 4, cell: { width: 512, height: 512 }, safeMargin: { x: 48, y: 48 } });
    expect(built.prompt).toContain("The last attached image is the layout guide for this sheet: its dark boxes are the 8 cells");
    expect(renderSheetPrompt({ character: BLOB, motion: IDLE }, built.parts)).toBe(built.prompt);
    // The only difference the guide makes is its clause.
    const without = buildSheetPrompt({ character: BLOB, motion: IDLE, action: ACTION });
    const clause = built.prompt.slice(without.prompt.indexOf(" The same character"), built.prompt.indexOf(" The same character"));
    expect(built.prompt.replace(clause, "")).toBe(without.prompt);
    expect(GUIDE_DEFAULT).toBe(false);
  });

  test("the renderer refuses what this builder could not have written", () => {
    const parts = buildSheetPrompt({ character: BLOB, motion: IDLE, action: ACTION }).parts;
    const render = (p: typeof parts, character: SheetCharacter = BLOB) => () => renderSheetPrompt({ character, motion: IDLE }, p);
    expect(render({ ...parts, builder: "sheet-prompt/0" })).toThrow(/cannot render parts built by sheet-prompt\/0/);
    expect(render({ ...parts, guards: [...parts.guards, "no-shadow"] })).toThrow(/does not know the clause 'no-shadow'/);
    expect(render({ ...parts, guards: ["row-continuity", "loop-close"] })).toThrow(/no state/);
    expect(render({ ...parts, guards: ["state:idle"] })).toThrow(/no ending/);
    expect(render({ ...parts, guards: ["anchor:left", "state:idle", "loop-close"] })).toThrow(/anchor:left without direction:left/);
    expect(render({ ...parts, guards: ["guide", "state:idle", "loop-close"] })).toThrow(/needs the guide's geometry/);
    expect(render({ ...parts, guards: ["asymmetric", "state:idle", "loop-close"] })).toThrow(/needs character.asymmetric/);
    expect(render({ ...parts, action: "  " })).toThrow(/--action/);
    expect(render(parts, { ...BLOB, style: "" })).toThrow(/no style sentence/);
  });
});

describe("sheet-prompt.mjs — the layout guide", () => {
  const SLOT = [0x33, 0x33, 0x33, 255];
  const SAFE = [0x2f, 0x80, 0xed, 255];
  const CENTRE = [0xb8, 0xc8, 0xe8, 255];
  const BACKGROUND = [0xf6, 0xf6, 0xf6, 255];

  test("geometry: the sheet's size, the inset floored per axis, refusals", () => {
    const g = guideGeometry({ rows: 2, cols: 4, cell: { width: 512, height: 512 } });
    expect(g).toEqual({ rows: 2, cols: 4, cell: { width: 512, height: 512 }, safeMargin: { x: 48, y: 48 }, width: 2048, height: 1024 });
    expect(guideGeometry({ rows: 1, cols: 3, cell: { width: 200, height: 300 }, margin: 0.1 }).safeMargin).toEqual({ x: 20, y: 30 });
    expect(() => guideGeometry({ rows: 0, cols: 4, cell: { width: 512, height: 512 } })).toThrow(/--rows\/--cols/);
    expect(() => guideGeometry({ rows: 1, cols: 1, cell: { width: 512, height: 512 }, margin: 0.5 })).toThrow(/--margin/);
    expect(() => guideGeometry({ rows: 1, cols: 1, cell: { width: 20, height: 20 }, safeMargin: { x: 10, y: 2 } })).toThrow(/does not fit/);
  });

  test("pixels: dark 3 px cell boxes, blue 2 px safe boxes at the inset, a centre line inside its own cell", () => {
    const g = guideGeometry({ rows: 2, cols: 2, cell: { width: 100, height: 80 }, margin: 0.1 });
    expect(g.safeMargin).toEqual({ x: 10, y: 8 });
    const { width, height, data } = guideRaster(g);
    expect([width, height, data.length]).toEqual([200, 160, 200 * 160 * 4]);
    const at = (x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    // Cell (row 1, col 1) spans x 100..199, y 80..159. Its box is drawn inward.
    for (const [x, y] of [[100, 120], [102, 120], [199, 120], [197, 120], [150, 80], [150, 82], [150, 159], [150, 157]]) {
      expect(at(x, y)).toEqual(SLOT);
    }
    expect(at(103, 120)).toEqual(BACKGROUND);
    expect(at(150, 156)).toEqual(BACKGROUND);
    // Safe box: x 110..189, y 88..151, 2 px wide.
    for (const [x, y] of [[110, 120], [111, 120], [189, 120], [188, 120], [130, 88], [130, 89], [130, 151], [130, 150]]) {
      expect(at(x, y)).toEqual(SAFE);
    }
    expect(at(112, 120)).toEqual(BACKGROUND);
    expect(at(109, 120)).toEqual(BACKGROUND);
    // Centre line at x = 150 from the safe top (y 88) to 80 + 80 − 8 = 152, drawn over the safe box.
    expect(at(150, 88)).toEqual(CENTRE);
    expect(at(150, 120)).toEqual(CENTRE);
    expect(at(150, 152)).toEqual(CENTRE);
    expect(at(150, 153)).toEqual(BACKGROUND);
    expect(at(150, 87)).toEqual(BACKGROUND);
    // Every pixel is opaque and one of the four colours.
    const colours = new Set<string>();
    for (let i = 0; i < data.length; i += 4) colours.add(Array.from(data.slice(i, i + 4)).join(","));
    expect([...colours].sort()).toEqual([SLOT, SAFE, CENTRE, BACKGROUND].map((c) => c.join(",")).sort());
  });
});

// ---------------------------------------------------------------------------
// The CLI halves
// ---------------------------------------------------------------------------

function run(script: string, argv: string[]) {
  const r = Bun.spawnSync([process.execPath, script, ...argv], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function character(motions: Array<string[]> = [["--id", "idle", "--label", "Idle", "--rows", "4", "--cols", "4", "--fps", "8", "--loop"]]) {
  const dir = mkdtempSync(join(tmpdir(), "sheet-prompt-"));
  const ok = (r: ReturnType<typeof run>) => {
    if (r.code !== 0) throw new Error(r.err);
    return r;
  };
  ok(run(PROJECT, ["init", "--dir", dir, "--name", "Blob", "--style", BLOB.style!, "--description", BLOB.description!, "--cell", "64x64"]));
  for (const flags of motions) ok(run(PROJECT, ["add-motion", "--dir", dir, ...flags]));
  return dir;
}

const readProject = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));

describe("sprite-project.mjs sheet-prompt", () => {
  test("prints the prompt alone, records it with its parts, and --frames redraws the grid", () => {
    const dir = character();
    const r = run(PROJECT, ["sheet-prompt", "--dir", dir, "--motion", "idle", "--action", ACTION, "--frames", "8"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${GOLDEN_IDLE}\n`);
    const motion = readProject(dir).sprite.motions[0];
    expect(motion.prompt).toBe(GOLDEN_IDLE);
    expect(motion.promptParts).toEqual({ builder: "sheet-prompt/1", action: ACTION, guards: ["state:idle", "row-continuity", "loop-close"] });
    expect(motion.grid).toEqual({ rows: 2, cols: 4 });
    expect(r.err).toContain("recorded sheet-prompt/1 on idle: 8 frames as 4 columns × 2 rows, state idle");
    expect(r.err).toContain("image: --image-size 2048x1024");
    // `show` names the builder.
    expect(run(PROJECT, ["show", "--dir", dir, "--motion", "idle"]).out).toContain("prompt built by sheet-prompt/1 (guards: state:idle, row-continuity, loop-close)");
  });

  test("--json carries the image size, the attach order and the guide call; the idle note names the measured count", () => {
    const dir = character();
    const r = run(PROJECT, ["sheet-prompt", "--dir", dir, "--motion", "idle", "--action", ACTION, "--guide", "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.prompt).toBe(readProject(dir).sprite.motions[0].prompt);
    expect(out.imageSize).toBe("2048x2048");
    expect(out.grid).toEqual({ rows: 4, cols: 4 });
    expect(out.promptParts.guide).toEqual({ rows: 4, cols: 4, cell: { width: 512, height: 512 }, safeMargin: { x: 48, y: 48 } });
    expect(out.guide).toEqual({ out: join(dir, "motions/idle/layout-guide.png"), rows: 4, cols: 4, cell: "512x512" });
    expect(out.attach).toEqual([join(dir, "motions/idle/layout-guide.png")]);
    expect(out.notes.join("\n")).toMatch(/idle reads best at 8 frames \(4 columns × 2 rows\)/);
  });

  test("a hand-written --prompt afterwards drops the parts", () => {
    const dir = character();
    expect(run(PROJECT, ["sheet-prompt", "--dir", dir, "--motion", "idle", "--action", ACTION]).code).toBe(0);
    expect(run(PROJECT, ["set-motion", "--dir", dir, "--motion", "idle", "--prompt", "my own words"]).code).toBe(0);
    const motion = readProject(dir).sprite.motions[0];
    expect(motion.prompt).toBe("my own words");
    expect("promptParts" in motion).toBe(false);
  });

  test("refusals leave project.json untouched", () => {
    const dir = character([
      ["--id", "idle", "--label", "Idle", "--rows", "4", "--cols", "4", "--fps", "8", "--loop"],
      ["--id", "flame", "--kind", "loop", "--fps", "24"],
    ]);
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    const refuse = (argv: string[], message: RegExp) => {
      const r = run(PROJECT, ["sheet-prompt", "--dir", dir, ...argv]);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(message);
    };
    refuse(["--motion", "flame", "--action", ACTION], /'flame' is a loop/);
    refuse(["--motion", "idle"], /--action is required/);
    refuse(["--motion", "idle", "--action", ACTION, "--guide", "--no-guide"], /mutually exclusive/);
    refuse(["--motion", "idle", "--action", ACTION, "--frames", "5"], /a sheet holds/);
    refuse(["--motion", "idle", "--action", ACTION, "--state", "dance"], /--state: expected one of/);
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);
    // A character with no style sentence is refused, not given a blank anchor.
    const bare = mkdtempSync(join(tmpdir(), "sheet-prompt-"));
    run(PROJECT, ["init", "--dir", bare, "--name", "Bare"]);
    run(PROJECT, ["add-motion", "--dir", bare, "--id", "idle", "--rows", "2", "--cols", "2", "--fps", "4", "--loop"]);
    const r = run(PROJECT, ["sheet-prompt", "--dir", bare, "--motion", "idle", "--action", ACTION]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no style sentence/);
  });

  test.skipIf(!HAS_FFMPEG)("a direction motion attaches its anchor by path, and the anchor clause is recorded", () => {
    const dir = character([["--id", "walk-left", "--label", "Walk · left", "--rows", "2", "--cols", "4", "--fps", "10", "--loop", "--direction", "left"]]);
    buildSheet(join(dir, "refs", "turnaround.png"), { cell: 64, rows: 1, cols: 1 });
    buildSheet(join(dir, "refs", "anchor-left.png"), { cell: 64, rows: 1, cols: 1 });
    for (const flags of [
      ["--id", "turnaround", "--file", "refs/turnaround.png", "--role", "turnaround"],
      ["--id", "left", "--file", "refs/anchor-left.png", "--role", "anchor", "--direction", "left"],
    ]) expect(run(PROJECT, ["add-ref", "--dir", dir, ...flags]).code).toBe(0);
    const r = run(PROJECT, ["sheet-prompt", "--dir", dir, "--motion", "walk-left", "--action", ACTION, "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.promptParts.guards).toEqual(["direction:left", "anchor:left", "state:walk", "row-continuity", "loop-close"]);
    expect(out.attach).toEqual([join(dir, "refs/anchor-left.png"), join(dir, "refs/turnaround.png")]);
  });
});

describe.skipIf(!HAS_FFMPEG)("sprite-sheet.mjs guide", () => {
  test("writes the guide at the sheet's size, pixel for pixel what the module draws", () => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-guide-"));
    const png = join(dir, "layout-guide.png");
    const r = run(SHEET, ["guide", "--rows", "2", "--cols", "3", "--cell", "96x80", "--out", png, "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out).toEqual({ output: png, rows: 2, cols: 3, cell: { width: 96, height: 80 }, safeMargin: { x: 9, y: 7 }, width: 288, height: 160 });
    const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 24 });
    expect(decoded.status).toBe(0);
    const expected = guideRaster(guideGeometry({ rows: 2, cols: 3, cell: { width: 96, height: 80 } }));
    expect(Buffer.compare(decoded.stdout, Buffer.from(expected.data))).toBe(0);
  });

  test("refuses a missing cell, a margin that does not fit, and a positional", () => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-guide-"));
    const out = join(dir, "g.png");
    expect(run(SHEET, ["guide", "--rows", "2", "--cols", "4", "--out", out]).err).toMatch(/--cell is required/);
    expect(run(SHEET, ["guide", "--rows", "2", "--cols", "4", "--cell", "auto", "--out", out]).err).toMatch(/generation cell/);
    expect(run(SHEET, ["guide", "--rows", "2", "--cols", "4", "--cell", "64x64", "--margin", "0.6", "--out", out]).err).toMatch(/--margin/);
    expect(run(SHEET, ["guide", "sheet.png", "--rows", "2", "--cols", "4", "--cell", "64x64", "--out", out]).err).toMatch(/unexpected argument/);
  });
});
