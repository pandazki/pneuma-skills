/**
 * The code-built GIF prompt (`sheet-prompt.mjs` `buildGifPrompt`,
 * `sprite-project.mjs gif-prompt`).
 *
 * The text is pinned word for word under `gif-prompt/1`, as the sheet text is
 * under `sheet-prompt/2`: a recorded `promptParts.builder` must keep meaning
 * the words it produced. The state guards are the sheet's own sentences said
 * of frames (`gifWording`); every state and facing is rendered here so a new
 * sheet sentence that names a cell fails in this file, not in a paid call.
 *
 * Pure, plus the real CLI on a character with no references — neither needs
 * ffmpeg.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DIRECTIONS,
  GIF_PROMPT_BUILDER,
  SHEET_STATES,
  buildGifPrompt,
  buildSheetPrompt,
  gifWording,
  renderGifPrompt,
  type SheetCharacter,
  type SheetMotion,
  type SheetState,
} from "../skill/scripts/sheet-prompt.mjs";

const PROJECT = join(import.meta.dir, "..", "skill", "scripts", "sprite-project.mjs");

const BLOB: SheetCharacter = {
  style: "Flat vector blob, thick outline",
  description: "A round test blob with one antenna.",
  cell: { width: 64, height: 64 },
  facing: "right",
};
const IDLE: SheetMotion = { id: "idle", label: "Idle", grid: { rows: 1, cols: 1 }, loop: true };
const ACTION = "Frames 1-4 the blob swells, frames 5-8 it settles back.";

/** `gif-prompt/1` for BLOB's 8-frame idle, word for word. */
const GOLDEN_IDLE =
  "Flat vector blob, thick outline. One animated GIF of 8 frames on one fixed canvas: the whole character exactly once in every frame, at the same size, with a clear margin of empty background on every side — anything the character holds or wears that moves included — and nothing cut off by the edge of the frame. The same character in every frame, matching the attached references exactly. A round test blob with one antenna. Keep white and pale details inside the character — highlights, eye whites, pale hair or clothing — fully opaque; only the background is transparent. The character faces right. Fixed camera: consistent body proportions, drawing scale and camera distance in every frame, and ground contacts share one baseline while the character stands on the ground. The references own the identity — face, hair shape, markings, palette, outline weight, proportions, outfit and props stay exactly as they show, and whatever is worn or held on one side stays on that side. This animation owns motion only: spend the variation on pose, limb contacts, body height, torso lean, head bob, and hair and cloth follow-through. Prefer a subtler animation over any change that alters the character's identity. The motion (8 frames, looping): Frames 1-4 the blob swells, frames 5-8 it settles back. This is an idle: the feet, or whatever the character rests on, stay planted on the same baseline in every frame and never lift, step, shuffle or slide — no walking, no marching in place, no turning, no change of facing. The eyes close in one frame at most. Frame 8 leads smoothly into frame 1 on the next beat, with compatible movement direction and without an extra hold: it is the pose just before frame 1, not a copy of it. Show it through pose, expression and silhouette, never through effects: nothing detached from the character — no floating sparkles, symbols, smoke, dust, motion arcs, speed lines, afterimages, smears, glows or impact bursts. A fully transparent background in every frame. No floor, no ground line, no drop shadow, no ground shadow, no scenery, no text, no motion blur.";

describe("sheet-prompt.mjs — the GIF prompt", () => {
  test("gif-prompt/1 text is pinned, and the recorded parts render the same text", () => {
    const built = buildGifPrompt({ character: BLOB, motion: IDLE, action: ACTION, frames: 8 });
    expect(GIF_PROMPT_BUILDER).toBe("gif-prompt/1");
    expect(built.prompt).toBe(GOLDEN_IDLE);
    expect(built.parts).toEqual({ builder: "gif-prompt/1", action: ACTION, guards: ["frames:8", "state:idle", "loop-close"] });
    expect(renderGifPrompt({ character: BLOB, motion: IDLE }, JSON.parse(JSON.stringify(built.parts)))).toBe(GOLDEN_IDLE);
  });

  test("every state in every facing is said of frames — no cell, sheet or grid reaches the model", () => {
    for (const state of [...SHEET_STATES, "generic"] as SheetState[]) {
      for (const direction of [undefined, ...DIRECTIONS]) {
        const motion: SheetMotion = { id: "m", grid: { rows: 1, cols: 1 }, loop: state === "idle", ...(direction ? { direction } : {}) };
        const { prompt } = buildGifPrompt({ character: { ...BLOB, asymmetric: "The antenna leans to its own left." }, motion, action: "One beat.", state, frames: 12 });
        expect(prompt).not.toMatch(/\b(cells?|sheets?|grids?)\b/i);
        expect(prompt.startsWith("Flat vector blob, thick outline. ")).toBe(true);
      }
    }
    // The guard is the sheet's sentence, not a second text that can drift.
    const attack = (build: typeof buildGifPrompt | typeof buildSheetPrompt) =>
      build({ character: BLOB, motion: { id: "attack", grid: { rows: 2, cols: 4 }, loop: false }, action: "Swing.", frames: 8 } as never).prompt;
    const sheetGuard = attack(buildSheetPrompt).match(/This is an attack[^]*?trails\./)![0];
    expect(attack(buildGifPrompt)).toContain(gifWording(sheetGuard));
    expect(attack(buildGifPrompt)).toContain("The weapon or prop stays inside the frame with a clear margin in every phase.");
  });

  test("a sentence the wording does not cover is refused rather than sent", () => {
    expect(() => gifWording("Every row of the grid holds one pose.")).toThrow("grid");
    expect(gifWording("does not travel across the cell.")).toBe("does not travel across the frame.");
  });

  test("the ending follows the loop flag; a one-shot ends on its last frame", () => {
    const once = buildGifPrompt({ character: BLOB, motion: { ...IDLE, id: "hurt", loop: false }, action: "Flinch.", frames: 6 });
    expect(once.parts.guards).toEqual(["frames:6", "state:hurt", "one-shot-end"]);
    expect(once.prompt).toContain("(6 frames, played once)");
    expect(once.prompt).toContain("Frame 6 is the pose the motion ends on.");
    expect(once.prompt).not.toContain("not a copy of it");
  });

  test("the direction's anchor is named and attached first; anchors facing elsewhere are not attached", () => {
    const refs = [
      { id: "turnaround", role: "turnaround" },
      { id: "anchor-left", role: "anchor", direction: "left" as const },
      { id: "anchor-right", role: "anchor", direction: "right" as const },
      { id: "portrait", role: "portrait" },
    ];
    const built = buildGifPrompt({ character: BLOB, motion: { ...IDLE, id: "walk-left", direction: "left" }, refs, action: "Step.", frames: 8 });
    expect(built.attach).toEqual(["anchor-left", "turnaround", "portrait"]);
    expect(built.parts.guards).toEqual(["frames:8", "direction:left", "anchor:left", "state:walk", "loop-close"]);
    expect(built.prompt).toContain("The attached left-facing anchor is authoritative for that facing: match its view in every frame");
    expect(built.prompt).toContain("Every frame is a pure side profile facing camera-left; lock the whole animation to that facing");
  });

  test("frame counts outside 2–16, a pixel-art character and a missing style are refused", () => {
    expect(() => buildGifPrompt({ character: BLOB, motion: IDLE, action: ACTION, frames: 1 })).toThrow("2 to 16");
    expect(() => buildGifPrompt({ character: BLOB, motion: IDLE, action: ACTION, frames: 17 })).toThrow("2 to 16");
    expect(() => buildGifPrompt({ character: { ...BLOB, pixel: { logicalHeight: 32 } }, motion: IDLE, action: ACTION, frames: 8 })).toThrow("pixel lattice");
    expect(() => buildGifPrompt({ character: { ...BLOB, style: " " }, motion: IDLE, action: ACTION, frames: 8 })).toThrow("style sentence");
    expect(() => renderGifPrompt({ character: BLOB, motion: IDLE }, { builder: "sheet-prompt/2", action: ACTION, guards: ["state:idle", "loop-close"] })).toThrow("gif-prompt/1");
  });
});

function run(argv: string[]) {
  const r = Bun.spawnSync([process.execPath, PROJECT, ...argv], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function character(...motions: string[][]) {
  const dir = mkdtempSync(join(tmpdir(), "gif-prompt-"));
  const ok = (r: ReturnType<typeof run>) => {
    if (r.code !== 0) throw new Error(r.err);
  };
  ok(run(["init", "--dir", dir, "--name", "Blob", "--style", BLOB.style!, "--description", BLOB.description!, "--cell", "64x64"]));
  for (const flags of motions) ok(run(["add-motion", "--dir", dir, ...flags]));
  return dir;
}

const readProject = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf-8"));

describe("sprite-project.mjs gif-prompt", () => {
  test("a GIF motion needs no grid; the prompt is printed and recorded, the call's flags follow from its fps", () => {
    const dir = character(["--id", "idle", "--label", "Idle", "--source", "gif", "--fps", "8", "--loop"]);
    const planned = readProject(dir).sprite.motions[0];
    expect(planned.source).toBe("gif");
    expect(planned.grid).toEqual({ rows: 1, cols: 1 });

    const r = run(["gif-prompt", "--dir", dir, "--motion", "idle", "--action", ACTION, "--frames", "8"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${GOLDEN_IDLE}\n`);
    const motion = readProject(dir).sprite.motions[0];
    expect(motion.prompt).toBe(GOLDEN_IDLE);
    expect(motion.promptParts).toEqual({ builder: "gif-prompt/1", action: ACTION, guards: ["frames:8", "state:idle", "loop-close"] });
    // 8 fps is 125 ms a frame, on fal's 10 ms grid.
    expect(r.err).toContain(`gif: --frame-count 8 --frame-duration-ms 130 --image-size 512x512 --background transparent --output ${join(dir, "motions/idle/gif-raw.gif")}`);
    expect(r.err).toContain("no references are registered");

    const json = JSON.parse(run(["gif-prompt", "--dir", dir, "--motion", "idle", "--action", ACTION, "--frames", "8", "--json"]).out);
    expect(json).toMatchObject({ frameCount: 8, frameDurationMs: 130, imageSize: "512x512", background: "transparent", attach: [] });
  });

  test("refused on a breathe, a loop and a pixel-art character, with project.json untouched", () => {
    const dir = character(
      ["--id", "idle", "--label", "Idle", "--source", "breathe"],
      ["--id", "glow", "--label", "Glow", "--kind", "loop", "--fps", "24"],
    );
    const before = readFileSync(join(dir, "project.json"), "utf-8");
    expect(run(["gif-prompt", "--dir", dir, "--motion", "idle", "--action", ACTION, "--frames", "8"]).err).toContain("breathe motion");
    expect(run(["gif-prompt", "--dir", dir, "--motion", "glow", "--action", ACTION, "--frames", "8"]).err).toContain("is a loop");
    expect(readFileSync(join(dir, "project.json"), "utf-8")).toBe(before);

    const pixel = character(["--id", "walk", "--label", "Walk", "--source", "gif", "--fps", "10", "--loop"]);
    expect(run(["set-character", "--dir", pixel, "--pixel", "32"]).code).toBe(0);
    const r = run(["gif-prompt", "--dir", pixel, "--motion", "walk", "--action", "Step.", "--frames", "8"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("pixel lattice");
  });
});
