/**
 * The code-built GIF prompt (`sheet-prompt.mjs` `buildGifPrompt`,
 * `sprite-project.mjs gif-prompt`).
 *
 * Pure, plus the real CLI on a character with no references — neither needs
 * ffmpeg.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const GOLDEN_IDLE =
  "Flat vector blob, thick outline. One animated GIF of 8 frames on one fixed canvas: one instance of the subject where visible, allowing disappearance explicitly requested by the action, at a consistent reference scale, allowing the size changes requested by the action, with a clear margin of empty background on every side — all requested motion and effects included — and nothing cut off by the edge of the frame. Where visible, the subject matches the attached references. A round test blob with one antenna. Preserve the described materials, including intentional translucency, emission and pale details; transparency outside the subject is the background. The subject faces right. Fixed camera: consistent reference scale and camera distance in every frame, and any ground contacts specified by the action share one baseline. The references and description own the subject's identity and structure. Preserve its defining details and side-specific features while allowing the changes of shape, colour, size and opacity requested by the action. Do not invent features absent from the subject. The motion (8 frames, looping): Frames 1-4 the blob swells, frames 5-8 it settles back. This is an idle motion: follow the explicit action and the described subject structure, using only features the subject actually has. The action determines the phases, deformation, materials and effects; do not add anatomy or movements from the state name. Frame 8 leads smoothly into frame 1 on the next beat, with compatible movement direction and without an extra hold: it is the pose just before frame 1, not a copy of it. Include the effects and material changes requested by the action as part of the subject, within the same safe area; add no unrelated decoration. A fully transparent background in every frame. Add no floor, ground line, scenery, text, shadows or motion blur unless they are explicitly part of the described subject or requested action.";

describe("sheet-prompt.mjs — the GIF prompt", () => {
  test("gif-prompt/2 text is pinned, and the recorded parts render the same text", () => {
    const built = buildGifPrompt({ character: BLOB, motion: IDLE, action: ACTION, frames: 8 });
    expect(GIF_PROMPT_BUILDER).toBe("gif-prompt/2");
    expect(built.prompt).toBe(GOLDEN_IDLE);
    expect(built.parts).toEqual({ builder: "gif-prompt/2", action: ACTION, guards: ["frames:8", "state:idle", "loop-close"] });
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
    const sheetGuard = attack(buildSheetPrompt).match(/This is an attack[^]*?state name\./)![0];
    expect(attack(buildGifPrompt)).toContain(gifWording(sheetGuard));
    expect(attack(buildGifPrompt)).toContain("one instance of the subject where visible");
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
    expect(() => renderGifPrompt({ character: BLOB, motion: IDLE }, { builder: "sheet-prompt/3", action: ACTION, guards: ["state:idle", "loop-close"] })).toThrow("gif-prompt/2");
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
    expect(motion.promptParts).toEqual({ builder: "gif-prompt/2", action: ACTION, guards: ["frames:8", "state:idle", "loop-close"] });
    // 8 fps is 125 ms a frame, on fal's 10 ms grid.
    expect(r.err).toContain(`gif: --frame-count 8 --frame-duration-ms 130 --image-size 512x512 --background transparent --output ${join(dir, "motions/idle/gif-raw-1.gif")}`);
    expect(r.err).toContain("no references are registered");

    const json = JSON.parse(run(["gif-prompt", "--dir", dir, "--motion", "idle", "--action", ACTION, "--frames", "8", "--json"]).out);
    expect(json).toMatchObject({ frameCount: 8, frameDurationMs: 130, imageSize: "512x512", background: "transparent", attach: [], output: join(dir, "motions/idle/gif-raw-1.gif") });
  });

  test("the printed --output never names a file that is already there: every take gets its own", () => {
    const dir = character(["--id", "idle", "--label", "Idle", "--source", "gif", "--fps", "8", "--loop"]);
    // An earlier take's GIF — paid for, whether or not it was ever recorded.
    mkdirSync(join(dir, "motions", "idle"), { recursive: true });
    writeFileSync(join(dir, "motions", "idle", "gif-raw-1.gif"), "GIF89a an earlier take");
    const json = JSON.parse(run(["gif-prompt", "--dir", dir, "--motion", "idle", "--action", ACTION, "--frames", "8", "--json"]).out);
    expect(json.output).toBe(join(dir, "motions/idle/gif-raw-2.gif"));
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
