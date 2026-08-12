/**
 * W7 (2026-08-12) — A BOARD HAS A SIZE. It stops being the window's size.
 *
 * The defect: `panelW = viewport.clientWidth`, so every consequence of a
 * board's width followed the reader's window — how wide a line is, where it
 * wraps, how much one board holds, which board a passage lands on, whether a
 * `@turn` finds a clean board. Two people opening one `board.md` at two
 * window sizes were watching two different lectures, and every "the check
 * came back clean" was a claim about one window.
 *
 * The cure is one constant and one ban, and this file pins both:
 *
 *  1. the canonical geometry is a NUMBER, not a measurement;
 *  2. NOTHING that decides board geometry may read the viewport again. The
 *     source scan is the mechanical half — the same shape as
 *     `wall.test.ts`'s standing ban, for the same reason: a second copy of
 *     "the board is as wide as the window" would be silent, and its symptom
 *     (a different lecture on a different screen) is not attributable to a
 *     line of code by reading a screenshot.
 *
 * The camera is where the window belongs now, and `restZoom` is its one
 * expression — pinned in `camera.test.ts` beside the poses that consume it.
 */

import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  PANEL_GAP,
  PANEL_HEIGHT,
  PANEL_HEIGHT_RATIO,
  PANEL_WIDTH,
  panelHeightFor,
} from "../engine/layout.js";
import { restZoom } from "../engine/stage.js";

describe("the canonical board", () => {
  test("its size is a constant, and the height is the width through the ratio", () => {
    // 1242 is CHOSEN (design W7): the geometry every accepted screenshot of
    // this mode was taken at, and the geometry the 34px body and the
    // 13-character column were tuned against. Changing it re-bases every
    // wrap in the corpus, so it changes only with a re-basing A/B.
    expect(PANEL_WIDTH).toBe(1242);
    expect(PANEL_HEIGHT).toBe(panelHeightFor(PANEL_WIDTH));
    expect(PANEL_HEIGHT).toBe(Math.round(PANEL_WIDTH * PANEL_HEIGHT_RATIO));
    expect(PANEL_HEIGHT).toBe(894);
    // The wall's other constant is untouched by W7.
    expect(PANEL_GAP).toBe(32);
  });

  test("a viewport exactly one board wide rests at z = 1 — the pre-W7 world", () => {
    // The whole compatibility argument in one line: W7 generalises `z = 1`,
    // it does not replace it. Every pre-W7 statement about the rest pose is
    // this case.
    expect(restZoom(PANEL_WIDTH, PANEL_WIDTH)).toBe(1);
  });
});

describe("the standing ban — board geometry may not read the window", () => {
  /**
   * A board's width and height come from `PANEL_WIDTH` / `PANEL_HEIGHT`.
   * Deriving either from `clientWidth` / `innerWidth` / a viewport rect is
   * the W7 defect, and it is exactly the kind that comes back: the two
   * quantities were the same number for a year, so the wrong one still
   * "works" on the author's own screen.
   *
   * Reading the viewport for the CAMERA is not only allowed but required —
   * that is where the reader's window belongs — so the scan is aimed at the
   * one thing it can name unambiguously: the panel/board size being assigned
   * from a measured width, in any spelling.
   */
  test("no module derives a panel/board size from a viewport measurement", async () => {
    const root = join(import.meta.dir, "..");
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    const offenders: string[] = [];
    const patterns = [
      // `panelW = viewport.clientWidth` — THE defect, in any spelling.
      // Aimed at the VIEWPORT specifically: reading a panel's own
      // `offsetWidth` back for a camera clamp box is a different act and a
      // legitimate one (the element is the canonical board).
      /panel_?[wh]\w*\s*[:=][^\n=]{0,40}(viewport\w*|window|surface\w*)\.\s*(client|offset|inner)(Width|Height)/i,
      // `panelHeightFor(<a measurement>)` — the height derived from a window.
      /panelHeightFor\([^)]*(client|offset|inner)(Width|Height)/i,
      // `--bansho-panel-w` written from anything but the constant.
      /bansho-panel-[wh]"?,\s*`\$\{(?!PANEL_)/,
    ];
    for (const path of glob.scanSync({ cwd: root })) {
      if (path.includes("__tests__/") || path.startsWith("harness/")) continue;
      // The engine's own definition is the one legal statement of the
      // ratio, and it takes a width rather than reading one.
      if (path === "engine/layout.ts") continue;
      const text = await Bun.file(join(root, path)).text();
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        // Prose about the defect is not the defect.
        if (line.startsWith("*") || line.startsWith("//")) continue;
        if (patterns.some((p) => p.test(line))) {
          offenders.push(`${path}: ${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the viewer's panel size comes from the engine constants", async () => {
    const canvas = await Bun.file(
      join(import.meta.dir, "..", "viewer/BoardCanvas.tsx"),
    ).text();
    // The two custom properties the stylesheet keys on are written from the
    // constants, in JSX, so they exist in EVERY projection — including the
    // notes one, which never runs the staged build.
    expect(canvas).toContain('"--bansho-panel-w": `${PANEL_WIDTH}px`');
    expect(canvas).toContain('"--bansho-panel-h": `${PANEL_HEIGHT}px`');
    const css = await Bun.file(
      join(import.meta.dir, "..", "viewer/board-css.ts"),
    ).text();
    // …and the hidden measure layer reads the same width, or a run would be
    // wrapped against the reader's pane and its ink drawn for a line the
    // reader never sees (the W2b defect, one level up).
    expect(css).toContain("width: var(--bansho-panel-w)");
    expect(css).not.toContain("width: 100%;\n  visibility: hidden");
  });
});
