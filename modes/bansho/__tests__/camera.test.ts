/**
 * camera.ts — the C1 stage camera as a pure module (zero DOM): clamping,
 * anchored zoom, wheel panning and the follow-target computation that
 * replaced the scroll-container follow. happy-dom has no layout engine, so
 * this pure core is the ONLY place the camera arithmetic is testable — the
 * component wires events into it and writes one transform string out.
 *
 * It also carries the soul of the deleted camera-latch.test.ts: the detach
 * policy. The original latch existed because of a real bug — during a live
 * broadcast one click on the board killed the follow forever and the pen
 * kept writing below the fold. Under the stage camera a transform write
 * fires no scroll events, so the whole echo-suppression channel is gone;
 * what must survive is the POLICY: a bare click never detaches, camera
 * gestures do, and live/seek/resume re-engage.
 *
 * C1′ (2026-08-10) put the hand on the board: a press that travels past
 * the slop is a grab and detaches; a press that does not is still the
 * click. Both halves are pinned below, because the whole defence of T6
 * pointing now rests on that threshold.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  CAMERA_MAX_Z,
  CAMERA_MIN_Z,
  cameraCss,
  cameraMinZ,
  clampCamera,
  exceedsGrabSlop,
  followShift,
  reattachCamera,
  gateCamera,
  GRAB_SLOP_PX,
  GRAB_SLOP_TOUCH_PX,
  grabPan,
  grabSlopFor,
  handBackCamera,
  homeCamera,
  latchInput,
  panBy,
  penHandBack,
  restZoom,
  wheelZoomFactor,
  zoomAt,
  type Camera,
  type Viewbox,
} from "../viewer/camera.js";
import { buildStageSchedule, type StageView } from "../engine/stage.js";
import { PANEL_WIDTH } from "../engine/layout.js";

/**
 * W7 — the at-rest zoom is `viewW / PANEL_WIDTH`, so a viewport exactly one
 * board wide rests at 1. That is the case every pre-W7 assertion in this
 * file was written against (the board WAS the viewport then), which is why
 * they read unchanged below with `REST_1` handed to the hand-back.
 */
const REST_1 = restZoom(PANEL_WIDTH, PANEL_WIDTH);

/** A tall single-panel board (the C1 shape): panel width == viewport width. */
const TALL: Viewbox = { panelW: 800, panelH: 3000, viewW: 800, viewH: 600 };

const cam = (x: number, y: number, z: number): Camera => ({ x, y, z });

describe("clampCamera — the viewport never leaves the panel", () => {
  test("at z=1 with panelW == viewW, x is pinned to 0", () => {
    expect(clampCamera(cam(120, 100, 1), TALL)).toEqual(cam(0, 100, 1));
    expect(clampCamera(cam(-40, 100, 1), TALL)).toEqual(cam(0, 100, 1));
  });

  test("y spans [0, panelH - viewH/z]", () => {
    expect(clampCamera(cam(0, -5, 1), TALL).y).toBe(0);
    expect(clampCamera(cam(0, 99999, 1), TALL).y).toBe(2400);
    // Zoomed in, the visible slice is shorter, so the range grows.
    expect(clampCamera(cam(0, 99999, 2), TALL).y).toBe(2700);
  });

  test("zoomed out past the panel, the stage CENTRES on that axis", () => {
    // viewH/z = 1200 > what a 500px panel offers, viewW/z = 1600 > 800 —
    // no room to pan on either axis, so the only question left is where
    // the stage sits in the space it has. Pinning to 0 hung the whole room
    // off the top-left with dead room to the right (measured on the 2x2
    // wall, 2026-08-12); the middle is where a thing hangs on a wall.
    const short: Viewbox = { panelW: 800, panelH: 500, viewW: 800, viewH: 600 };
    expect(clampCamera(cam(300, 300, 0.5), short)).toEqual(
      cam((800 - 1600) / 2, (500 - 1200) / 2, 0.5),
    );
    // The camera standing left of / above the origin IS the centring: the
    // stage renders at ((0 - x) * z) = 400px in from a 800px viewport edge
    // with 800 * 0.5 = 400px of stage between.
    const centred = clampCamera(cam(0, 0, 0.5), short);
    expect((0 - centred.x) * 0.5).toBe((800 - 800 * 0.5) / 2);
    expect((0 - centred.y) * 0.5).toBe((600 - 500 * 0.5) / 2);
  });

  test("an axis with room to roam is untouched by the centring", () => {
    // The C1 rest state and every zoomed-in pan: span >= 0, so the range
    // is exactly [0, panel - view/z] as it always was. A tall strip pans
    // vertically while its horizontal axis is degenerate at z=1.
    expect(clampCamera(cam(0, 1000, 1), TALL)).toEqual(cam(0, 1000, 1));
    expect(clampCamera(cam(0, 2400, 1), TALL).y).toBe(2400);
    expect(clampCamera(cam(500, 100, 1), TALL).x).toBe(0);
  });

  test("z is clamped into [CAMERA_MIN_Z, CAMERA_MAX_Z]", () => {
    expect(clampCamera(cam(0, 0, 0.01), TALL).z).toBe(CAMERA_MIN_Z);
    expect(clampCamera(cam(0, 0, 50), TALL).z).toBe(CAMERA_MAX_Z);
  });
});

describe("panBy — a pan is quoted in SCREEN px, the board moves in board px", () => {
  // No gesture calls `panBy` directly any more: since W4a the wheel is the
  // zoom, and what is left is `grabPan` (the hand, which negates first) and
  // the wall map's drag, which hands the host board px. The conversion is
  // still one arithmetic and still needs pinning — this block describes
  // the CONVERSION, not a wheel.
  test("a vertical pan moves y by delta/z", () => {
    expect(panBy(cam(0, 100, 1), TALL, 0, 120).y).toBe(220);
    expect(panBy(cam(0, 100, 2), TALL, 0, 120).y).toBe(160);
  });

  test("a horizontal pan at z=1 has no effect on x — but is correct, not absent", () => {
    // The spec pins this exact case: with panelW == viewW the clamp keeps
    // x at 0, so the conversion is a no-op at rest yet fully wired for z>1.
    expect(panBy(cam(0, 100, 1), TALL, 500, 0)).toEqual(cam(0, 100, 1));
    const zoomed = panBy(cam(0, 100, 2), TALL, 120, 0);
    expect(zoomed.x).toBe(60);
  });

  test("panning clamps at the panel edges", () => {
    expect(panBy(cam(0, 2390, 1), TALL, 0, 500).y).toBe(2400);
    expect(panBy(cam(0, 10, 1), TALL, 0, -500).y).toBe(0);
  });
});

describe("zoomAt — the board point under the cursor does not move", () => {
  test("anchor invariance", () => {
    const before = cam(100, 200, 1);
    const point = { x: 400, y: 300 };
    const box: Viewbox = { panelW: 5000, panelH: 5000, viewW: 800, viewH: 600 };
    const anchor = {
      x: before.x + point.x / before.z,
      y: before.y + point.y / before.z,
    };
    const after = zoomAt(before, box, point, 1.5);
    expect(after.z).toBe(1.5);
    // Screen position of the anchored board point: ((bx-x)*z, (by-y)*z).
    expect((anchor.x - after.x) * after.z).toBeCloseTo(point.x, 9);
    expect((anchor.y - after.y) * after.z).toBeCloseTo(point.y, 9);
  });

  test("zoom is clamped, and a clamped-to-same zoom returns the camera unchanged", () => {
    const box: Viewbox = { panelW: 5000, panelH: 5000, viewW: 800, viewH: 600 };
    const atMax = cam(100, 100, CAMERA_MAX_Z);
    expect(zoomAt(atMax, box, { x: 10, y: 10 }, 2)).toBe(atMax);
    // The floor is the STAGE FIT (C3): on a stage wider than the
    // viewport the user may keep zooming out until it all fits — the
    // constant floor applies only where viewW covers the stage.
    const atFit = cam(0, 0, cameraMinZ(box));
    expect(zoomAt(atFit, box, { x: 10, y: 10 }, 0.5)).toBe(atFit);
    const single: Viewbox = { panelW: 800, panelH: 5000, viewW: 800, viewH: 600 };
    const atMin = cam(0, 0, CAMERA_MIN_Z);
    expect(zoomAt(atMin, single, { x: 10, y: 10 }, 0.5)).toBe(atMin);
  });

  test("zooming out re-clamps the position", () => {
    // At z=1 sitting deep in the board; zooming out to 0.5 makes the
    // visible slice taller than what remains -> y pulls back into range.
    const after = zoomAt(cam(0, 2400, 1), TALL, { x: 0, y: 0 }, 0.5);
    expect(after.z).toBe(0.5);
    expect(after.y).toBe(3000 - 600 / 0.5);
  });

  test("wheelZoomFactor: pinch-out (negative deltaY) zooms in", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  test("wheelZoomFactor reads the platform's UNITS (d3-zoom's factors)", () => {
    // Since W4a the wheel IS the zoom, so a line-mode mouse (Firefox on
    // Windows/Linux, ~3 per notch) has to feel like a pixel-mode one
    // (~100 per notch) rather than moving the board half a percent.
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(Math.exp(3 * 0.05), 12);
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(Math.exp(1), 12);
    // Pixels are the default, and the default is what it always was.
    expect(wheelZoomFactor(-100, 0)).toBe(wheelZoomFactor(-100));
    // Direction survives every unit: up zooms in, down zooms out.
    expect(wheelZoomFactor(3, 1)).toBeLessThan(1);
  });
});

describe("followShift — the scroll-follow semantics, re-derived on the camera", () => {
  // These numbers are ports of the pre-C1 showStep arithmetic:
  //   viewBottom - 40 slack, bottom - viewH + 96 margin, top - 96 margin.
  test("a target below the fold pulls the camera down (margin 96)", () => {
    const next = followShift(cam(0, 100, 1), TALL, { top: 800, bottom: 900 });
    expect(next).not.toBeNull();
    expect(next!.y).toBe(900 - 600 + 96);
  });

  test("a target above the view pulls the camera up (margin 96, floored at 0)", () => {
    const next = followShift(cam(0, 1000, 1), TALL, { top: 200, bottom: 300 });
    expect(next!.y).toBe(200 - 96);
    const nearTop = followShift(cam(0, 1000, 1), TALL, { top: 50, bottom: 90 });
    expect(nearTop!.y).toBe(0);
  });

  test("a target comfortably in view moves nothing (null — no camera write)", () => {
    // Since review P1-4 this dead band IS the shared convention: the
    // canonical from-pose simulates this very function (stage.test.ts
    // pins the resolver side), so pinning it here no longer contradicts
    // the stage's pose chain — it pins half of one arithmetic.
    expect(
      followShift(cam(0, 100, 1), TALL, { top: 200, bottom: 300 }),
    ).toBeNull();
  });

  test("at z=2 the visible slice is viewH/z board px", () => {
    const next = followShift(cam(0, 0, 2), TALL, { top: 400, bottom: 450 });
    // viewBottom = 0 + 600/2 = 300; 450 > 300 - 40 -> y = 450 - 300 + 96.
    expect(next!.y).toBe(246);
  });

  test("the shifted camera is clamped to the panel", () => {
    const next = followShift(cam(0, 0, 1), TALL, { top: 2900, bottom: 2990 });
    // Raw: 2990 - 600 + 96 = 2486 > max 2400 -> clamped.
    expect(next!.y).toBe(2400);
  });

  test("x is never touched by follow", () => {
    const box: Viewbox = { panelW: 800, panelH: 3000, viewW: 800, viewH: 600 };
    const next = followShift(cam(0, 0, 2), box, { top: 800, bottom: 900 });
    expect(next!.x).toBe(0);
  });
});

describe("C3 — the wide stage (multi-board camera policy)", () => {
  /** Three 800-wide boards with 32px gaps: the Viewbox carries the STAGE
   *  extent, so panelW here is the whole wall. */
  const WIDE: Viewbox = { panelW: 2464, panelH: 576, viewW: 800, viewH: 600 };

  test("cameraMinZ — exactly CAMERA_MIN_Z on a single panel, stage-fitting on a wide one", () => {
    expect(cameraMinZ(TALL)).toBe(CAMERA_MIN_Z); // viewW == panelW → 1 → floor
    expect(cameraMinZ(WIDE)).toBeCloseTo(800 / 2464, 10); // below the constant
    expect(cameraMinZ({ ...WIDE, panelW: 0 })).toBe(CAMERA_MIN_Z); // degenerate
  });

  test("the user can zoom out far enough to see every board", () => {
    const out = zoomAt(cam(0, 0, 1), WIDE, { x: 400, y: 300 }, 0.2);
    expect(out.z).toBeCloseTo(800 / 2464, 10); // clamped at the stage fit
    // …but never below it.
    expect(zoomAt(cam(0, 0, 1), WIDE, { x: 400, y: 300 }, 0.01).z).toBeCloseTo(
      800 / 2464,
      10,
    );
  });

  test("followShift walks to the writing board when it is out of view", () => {
    const pitch = 800 + 32;
    // The pen writes on board 2 while the camera looks at board 0.
    const next = followShift(cam(0, 0, 1), WIDE, {
      top: 100,
      bottom: 300,
      left: 2 * pitch + 44,
      right: 2 * pitch + 700,
      board: { x: 2 * pitch, y: 0, h: 576 },
    });
    // y lands where the CLAMP puts it: this wall is 576 tall in a 600
    // viewport, so its vertical axis has no room to roam and the stage
    // hangs in the middle of the space it has (12px of room above and
    // below) rather than against the top edge.
    expect(next).toEqual(cam(2 * pitch, (576 - 600) / 2, 1));
    // In view horizontally and vertically: no write at all (C1 economy).
    expect(
      followShift(cam(2 * pitch, 0, 1), WIDE, {
        top: 100,
        bottom: 300,
        left: 2 * pitch + 44,
        right: 2 * pitch + 700,
        board: { x: 2 * pitch, y: 0, h: 576 },
      }),
    ).toBeNull();
  });

  test("single-board callers omit the horizontal fields — C1 behaviour bit for bit", () => {
    // Vertically comfortable, no horizontal info → null, x never touched.
    expect(
      followShift(cam(0, 100, 1), TALL, { top: 200, bottom: 400 }),
    ).toBeNull();
    const pulled = followShift(cam(0, 0, 1), TALL, { top: 900, bottom: 1000 })!;
    expect(pulled.x).toBe(0);
  });

  test("handBackCamera rebaselines onto the pen's board, not board 1", () => {
    const pitch = 832;
    // A tall board with room to roam keeps the reader's height (the C2
    // contract); only x and z are handed back.
    const tall = { x: 2 * pitch, y: 0, h: 3000 };
    expect(handBackCamera(cam(0, 500, 0.5), REST_1, tall, 600)).toEqual(
      cam(2 * pitch, 500, 1),
    );
    // Already the pen camera on that board: no write.
    expect(handBackCamera(cam(2 * pitch, 500, 1), REST_1, tall, 600)).toBeNull();
    // No board supplied preserves C2's single-panel contract.
    expect(handBackCamera(cam(0, 500, 1), REST_1)).toBeNull();
  });

  test("handBackCamera on a board that FITS stands at its corner", () => {
    const pitch = 832;
    const board = { x: 2 * pitch, y: 926, h: 576 };
    expect(handBackCamera(cam(0, 500, 0.5), REST_1, board, 600)).toEqual(
      cam(2 * pitch, 926, 1),
    );
  });

  test("handBackCamera never hands the camera back to another ROW", () => {
    // Defect W4a-3a: the hand-back used to keep the camera's y whenever a
    // whole board did not fit the view, so decaying onto a board in the
    // second row left the reader looking at the first one with the pen
    // writing off screen. The kept height is now kept INSIDE the board.
    const board = { x: 0, y: 926, h: 894 };
    expect(handBackCamera(cam(0, 100, 1), REST_1, board, 637)).toEqual(
      cam(0, 926, 1),
    );
    // Below the board is the same mistake, mirrored.
    expect(handBackCamera(cam(0, 1800, 1), REST_1, board, 637)).toEqual(
      cam(0, 926 + 894 - 637, 1),
    );
    // Inside it, the reader's own height survives — that IS the C2
    // behaviour on a board too tall to stand in front of whole.
    expect(handBackCamera(cam(0, 1000, 1), REST_1, board, 637)).toBeNull();
  });
});

describe("W4a-3a — a wall has ROWS, and the follow may not leave a board", () => {
  /** A 2x2 wall of 1242x894 boards with 32px gaps, in a window too short
   *  to hold a whole board — the regime the row-crossing bug lives in. */
  const ROOM: Viewbox = { panelW: 2516, panelH: 1820, viewW: 1242, viewH: 637 };
  const BOARD2 = { x: 0, y: 926, h: 894 };

  test("crossing to the next row lands INSIDE that board, never in the gap", () => {
    // The pen turns to board 3 (bottom left) and writes at its head. The
    // old arithmetic chased the head with C1's slack rule and stopped
    // 429px down the wall — five sixths of the view still showing the row
    // above, which is the owner's 「内容已经在另一块写了，镜头还停在前一块」.
    const next = followShift(cam(0, 0, 1), ROOM, {
      top: 970,
      bottom: 970,
      left: 44,
      right: 1198,
      board: BOARD2,
    })!;
    expect(next.y).toBe(926);
    expect(next.x).toBe(0);
  });

  test("…and the chase down that board's own face still works", () => {
    // Halfway down board 3: the follow moves, and the band lets it.
    const next = followShift(cam(0, 926, 1), ROOM, {
      top: 1500,
      bottom: 1560,
      left: 44,
      right: 1198,
      board: BOARD2,
    })!;
    expect(next.y).toBe(1560 - 637 + 96);
    // Never past the board's own bottom, whatever the slack rule wants.
    const deep = followShift(cam(0, 1100, 1), ROOM, {
      top: 1790,
      bottom: 1815,
      left: 44,
      right: 1198,
      board: BOARD2,
    })!;
    expect(deep.y).toBe(926 + 894 - 637);
  });

  test("a board that FITS the view is still stood in front of, at its corner", () => {
    // The same call in a taller window: the band collapses, and the rule
    // is the one that shipped with the room — no branch, same arithmetic.
    const tallWindow: Viewbox = { ...ROOM, viewH: 1017 };
    const next = followShift(cam(1274, 0, 1), tallWindow, {
      top: 970,
      bottom: 970,
      left: 44,
      right: 1198,
      board: BOARD2,
    })!;
    // 926 is the board's corner; 803 is as far down the WALL as a 1017-tall
    // window can stand (1820 - 1017), and the wall's own clamp has the last
    // word — the whole board is in view either way.
    expect(next).toEqual(cam(0, 803, 1));
  });
});

/**
 * THE @at FLASHBACK (2026-08-15) — measured, not reasoned.
 *
 * A lecture that turns to board 2 and then places the pen with
 * `@at bottom-left` sent the camera back to BOARD 1 for 1.26 s before it
 * corrected itself. Per-frame trace of the real player (1370x817 window, a
 * 2x2 wall of 1242x894 boards):
 *
 *   t=7.50  board 2   the @turn's walk, correct
 *   t=10.40 board 1   ← the excursion
 *   t=11.66 board 2   the next written step pulls it back
 *
 * Both obvious suspects were exonerated by the same trace: the stage-anchor
 * measurement answered `left: 1318` (board 2's own coordinates) for every
 * written step, and the fold's assignment said panel 1 for every one of
 * them. The liar was a third input — the hand-back's BOARD, which the host
 * resolves from the active schedule entry's own assignment. An `@at` is not
 * a box, so it has no assignment, and "no board" was then spelled the way a
 * STRIP spells it — and on a strip the pen's rest x is 0, which on a wall is
 * board 1. Absence of a board was being read as the board at the origin.
 *
 * `penHandBack` is where the two facts stop sharing a spelling.
 */
describe("penHandBack — 'I don't know the board' is not 'the board at x = 0'", () => {
  /** The measured window: 1370 wide over 1242-wide boards. */
  const REST = restZoom(1370, PANEL_WIDTH);
  /** The measured wall: 2 x 2 boards of 1242x894 with a 32px gap. */
  const VIEW_H = 817;
  const BOARD2 = { x: 1274, y: 0, h: 894 };

  test("a wall entry that names NO board leaves the camera where the pen left it", () => {
    // The exact frame the trace caught: the camera stands in front of
    // board 2 at rest, and the active entry is the `@at`.
    const standing = cam(1274, 0, REST);
    expect(penHandBack(standing, REST, VIEW_H, null, true)).toBeNull();
    // Pin the defect itself: the spelling the host used to reach for is
    // still, correctly, the STRIP's — it walks to the wall origin. That is
    // why the seam exists, and why passing `undefined` from a wall is the
    // bug rather than a style choice.
    expect(handBackCamera(standing, REST, undefined, VIEW_H)).toEqual(
      cam(0, 0, REST),
    );
  });

  test("…even when the camera still wears a director's residue", () => {
    // An @overview's zoom with the board unknown: the hand-back cannot
    // invent a board to walk to, so it writes nothing at all rather than
    // walking to the wrong one. The z is restored at the next step that
    // DOES name a board — which is every writing step, since a write is a
    // box and a box is assigned.
    expect(penHandBack(cam(600, 40, 0.5), REST, VIEW_H, null, true)).toBeNull();
  });

  test("a wall entry that names a board hands back to it, unchanged", () => {
    expect(penHandBack(cam(0, 0, 0.5), REST, VIEW_H, BOARD2, true)).toEqual(
      handBackCamera(cam(0, 0, 0.5), REST, BOARD2, VIEW_H),
    );
    expect(penHandBack(cam(0, 0, 0.5), REST, VIEW_H, BOARD2, true)).toEqual(
      cam(1274, 0, REST),
    );
  });

  test("a STRIP keeps C2's contract bit for bit — no board means x = 0", () => {
    // The single-panel lecture supplies no board by design (the director's
    // y is the one thing the hand-back keeps there), and its rest IS the
    // origin, because a strip has exactly one board and it starts at 0.
    const drifted = cam(0, 500, 0.5);
    expect(penHandBack(drifted, REST_1, 600, null, false)).toEqual(
      handBackCamera(drifted, REST_1, undefined, 600),
    );
    expect(penHandBack(drifted, REST_1, 600, null, false)).toEqual(
      cam(0, 500, 1),
    );
    // Already at rest on the strip: still no write.
    expect(penHandBack(cam(0, 500, 1), REST_1, 600, null, false)).toBeNull();
  });

  /**
   * The teeth (the G8-J pattern in stage-measure.test.ts, applied to the
   * hand-back): the arithmetic above only protects callers who USE it, and
   * the defect was a host that reached past it with `undefined`. So the
   * raw entrance is pinned to the engine, where both absences are visible
   * side by side; a viewer that wants a hand-back goes through
   * `penHandBack` and has to say which world it is in.
   */
  test("the raw hand-back is engine-only — no viewer calls it directly", async () => {
    const root = join(import.meta.dir, "..");
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    const found: Record<string, number> = {};
    for (const path of glob.scanSync({ cwd: root })) {
      if (path.includes("__tests__/") || path.startsWith("harness/")) continue;
      const text = await Bun.file(join(root, path)).text();
      const count = text.split("handBackCamera(").length - 1;
      if (count > 0) found[path] = count;
    }
    expect(found).toEqual({
      // The definition, `penHandBack`'s delegation, and the fold's
      // unmeasurable-rect walk — which already gates on a resolved board,
      // so it can never spell "unknown" as the origin.
      "engine/stage.ts": 3,
    });
  });
});

describe("W4a-3b — the re-attach pose (a reader coming back)", () => {
  const ROOM: Viewbox = { panelW: 2516, panelH: 1820, viewW: 1242, viewH: 637 };
  const BOARD2 = { x: 0, y: 926, h: 894 };
  /** The pen, well down board 3's face — far enough from its top edge
   *  that a whole view of context fits above the line. */
  const pen = { top: 1600, bottom: 1660, board: BOARD2 };

  test("the pose is the performance's own, wherever the reader wandered", () => {
    // The bug: `followShift` is a MINIMUM shift, so coming back from below
    // the pen pinned the newest line to the very top of the view and
    // coming back from above put it near the bottom. Same moment, two
    // poses. The re-attach has one answer for every approach.
    const fromBelow = reattachCamera(cam(0, 1700, 1), ROOM, pen);
    const fromAbove = reattachCamera(cam(0, 940, 1), ROOM, pen);
    const fromAnotherBoard = reattachCamera(cam(1274, 200, 0.4), ROOM, pen);
    expect(fromBelow).toEqual(fromAbove);
    expect(fromBelow).toEqual(fromAnotherBoard);
  });

  test("the live line sits one FOLLOW_MARGIN above the bottom, context above it", () => {
    const back = reattachCamera(cam(0, 1700, 1), ROOM, pen);
    expect(back.y).toBe(1660 - 637 + 96);
    expect(back.x).toBe(0);
    // The performance's own zoom, not whatever the reader was reading at.
    expect(back.z).toBe(1);
  });

  test("it stands in front of the pen's board and stays inside it", () => {
    const head = { top: 940, bottom: 940, board: BOARD2 };
    expect(reattachCamera(cam(0, 0, 1), ROOM, head).y).toBe(926);
    const foot = { top: 1810, bottom: 1815, board: BOARD2 };
    expect(reattachCamera(cam(0, 0, 1), ROOM, foot).y).toBe(926 + 894 - 637);
  });

  test("on a strip it is the same sentence with no board to stand in", () => {
    // TALL is one 800x3000 panel in an 800x600 viewport — NARROWER than a
    // canonical board, so the rest zoom is below 1 and the visible height
    // is `viewH / z` board px, not `viewH`. W7's one arithmetic change here.
    const z = restZoom(TALL.viewW, PANEL_WIDTH);
    const seeH = TALL.viewH / z;
    // TALL's own panel is 800 wide — narrower than the 1242 the rest zoom
    // shows — so `clampAxis` centres it in the visible width. That is the
    // 2026-08-12 centring rule, not a W7 novelty; only `z` and the board-px
    // view height are W7's.
    const centred = (TALL.panelW - TALL.viewW / z) / 2;
    expect(reattachCamera(cam(0, 2400, 2), TALL, { top: 900, bottom: 1000 })).toEqual(
      cam(centred, 1000 - seeH + 96, z),
    );
    // Never above the board's top edge, even for the first line.
    expect(reattachCamera(cam(0, 900, 1), TALL, { top: 0, bottom: 40 })).toEqual(
      cam(centred, 0, z),
    );
  });

  test("W7 — the re-attach zoom is the performance's, on any window", () => {
    // A 1990px window: coming back puts the reader at 1990/1242, the same
    // zoom a reader who never left has been watching at all along.
    const wide: Viewbox = { ...ROOM, viewW: 1990 };
    expect(reattachCamera(cam(0, 1700, 0.4), wide, pen).z).toBe(
      restZoom(1990, PANEL_WIDTH),
    );
  });
});

describe("latchInput — the detach policy (the camera-latch intent, survived)", () => {
  test("a bare click NEVER detaches", () => {
    // THE regression the original latch existed for: one click during a
    // live broadcast must not kill the follow. Structurally there is no
    // click->detach wiring any more; this pins the policy so it never
    // grows one back.
    expect(latchInput("following", "click")).toBe("following");
  });

  test("a pointer press that has not travelled never detaches", () => {
    // C1 wrote this assertion as "no drag-pan exists"; C1′ has drag-pan
    // and the assertion means MORE now, not less: every grab starts as a
    // press, and only clearing GRAB_SLOP_PX turns it into one. A press
    // that stays put is still T6's click, and still inert.
    expect(latchInput("following", "pointer")).toBe("following");
  });

  test("wheel detaches", () => {
    expect(latchInput("following", "wheel")).toBe("detached");
    expect(latchInput("detached", "wheel")).toBe("detached");
  });

  test("a grab detaches — the hand on the board is the loudest claim there is", () => {
    // C1′: the owner overturned "no drag-pan". A drag is unambiguously
    // the user taking the camera, so it goes through the SAME policy as
    // the wheel rather than growing a parallel one.
    expect(latchInput("following", "grab")).toBe("detached");
    expect(latchInput("detached", "grab")).toBe("detached");
  });

  test("reset (Live / explicit seek / resume) re-engages", () => {
    // One re-engage token for all three: resuming playback after a grab
    // returns the camera to the performance through exactly this door
    // ("继续的时候回到之前的位置").
    expect(latchInput("detached", "reset")).toBe("following");
    expect(latchInput("following", "reset")).toBe("following");
  });

  test("a click while detached does not re-engage either", () => {
    expect(latchInput("detached", "click")).toBe("detached");
  });
});

describe("the grab (C1′) — a press that travels takes the camera", () => {
  test("the board follows the hand: pointer right/down moves content with it", () => {
    // Drag the board 200px right and 100px down. The content must travel
    // WITH the hand, so the camera (the board point at the view origin)
    // moves the other way — this sign is the whole reason grabPan exists
    // beside panBy, which takes CONTENT deltas from the wheel.
    const start = cam(300, 900, 1);
    const after = grabPan(start, TALL, 200, 100);
    expect(after.y).toBe(800);
    // Single-panel board: x is pinned at 0 by the clamp regardless.
    expect(after.x).toBe(0);
    // Dragging up scrolls forward — the same gesture as a wheel down.
    expect(grabPan(start, TALL, 0, -100).y).toBe(1000);
  });

  test("a grab is clamped like every other camera write", () => {
    // Yanking the board down at the top edge cannot pull it past y = 0,
    // and yanking up at the bottom cannot pass the last screenful.
    expect(grabPan(cam(0, 10, 1), TALL, 0, 400).y).toBe(0);
    const floor = TALL.panelH - TALL.viewH; // 2400
    expect(grabPan(cam(0, floor - 10, 1), TALL, 0, -900).y).toBe(floor);
  });

  test("zoom divides the hand's travel — the board tracks the finger at any z", () => {
    // At z = 2 a 200px hand movement is 100 BOARD px: the point under
    // the finger stays under the finger.
    expect(grabPan(cam(0, 900, 2), TALL, 0, 200).y).toBe(800);
    expect(grabPan(cam(0, 900, 0.5), TALL, 0, 200).y).toBe(500);
  });

  test("a grab pans horizontally too (a staged multi-board strip)", () => {
    const strip: Viewbox = { panelW: 2400, panelH: 1200, viewW: 800, viewH: 600 };
    expect(grabPan(cam(800, 0, 1), strip, 300, 0).x).toBe(500);
    expect(grabPan(cam(800, 0, 1), strip, -300, 0).x).toBe(1100);
  });
});

describe("the grab slop — the threshold that keeps T6 pointing alive", () => {
  test("a press below the slop is not a grab (it is still the click)", () => {
    expect(exceedsGrabSlop(0, 0)).toBe(false);
    expect(exceedsGrabSlop(3, 0)).toBe(false);
    // Exactly at the threshold is still a click — a grab must EXCEED it.
    expect(exceedsGrabSlop(GRAB_SLOP_PX, 0)).toBe(false);
  });

  test("a press past the slop is a grab, in any direction", () => {
    expect(exceedsGrabSlop(5, 0)).toBe(true);
    expect(exceedsGrabSlop(0, -5)).toBe(true);
    expect(exceedsGrabSlop(-5, 0)).toBe(true);
  });

  test("the threshold is radial, not per-axis", () => {
    // 3px right AND 3px down is 4.24px of travel — one drag, one budget,
    // so a diagonal drag does not have to clear the slop twice.
    expect(Math.hypot(3, 3)).toBeGreaterThan(GRAB_SLOP_PX);
    expect(exceedsGrabSlop(3, 3)).toBe(true);
    // ...while each axis alone stays under it.
    expect(exceedsGrabSlop(3, 0)).toBe(false);
    expect(exceedsGrabSlop(0, 3)).toBe(false);
  });

  test("a finger gets a wider slop than a mouse — a tap wanders", () => {
    // The mouse threshold applied to touch would turn ordinary taps into
    // pans and make pointing unusable on a touchscreen.
    expect(GRAB_SLOP_TOUCH_PX).toBeGreaterThan(GRAB_SLOP_PX);
    expect(exceedsGrabSlop(6, 0, "touch")).toBe(false);
    expect(exceedsGrabSlop(6, 0, "mouse")).toBe(true);
    expect(exceedsGrabSlop(12, 0, "touch")).toBe(true);
  });

  test("an unknown pointer type is treated as a mouse", () => {
    expect(grabSlopFor(undefined)).toBe(GRAB_SLOP_PX);
    expect(grabSlopFor("pen")).toBe(GRAB_SLOP_PX);
    expect(grabSlopFor("mouse")).toBe(GRAB_SLOP_PX);
    expect(grabSlopFor("touch")).toBe(GRAB_SLOP_TOUCH_PX);
  });
});

describe("cameraCss — the one transform the stage wears", () => {
  test("translate(-x*z, -y*z) scale(z): board (x,y) lands at the view origin", () => {
    expect(cameraCss(cam(100, 50, 2))).toBe("translate(-200px, -100px) scale(2)");
    expect(cameraCss(cam(0, 0, 1))).toBe("translate(0px, 0px) scale(1)");
  });
});

describe("handBackCamera — the decay hand-back (director residue → pen camera)", () => {
  test("a director-residue camera (overview z, centered x) re-baselines to z=1, x=0", () => {
    expect(handBackCamera(cam(-120, 300, 0.78), REST_1)).toEqual(cam(0, 300, 1));
    expect(handBackCamera(cam(0, 500, 0.5), REST_1)).toEqual(cam(0, 500, 1));
  });

  test("the pen camera itself is a no-write (null — follow stays no-op cheap)", () => {
    expect(handBackCamera(cam(0, 1200, 1), REST_1)).toBeNull();
    expect(handBackCamera(cam(0, 0, 1), REST_1)).toBeNull();
  });

  test("W7 — it hands back the REST zoom, which is not 1 off a board-wide window", () => {
    // The whole point of the redefinition: on a 1990px window one board is
    // shown at z = 1990/1242, so THAT is the pose the decay must restore.
    // Handing back a literal 1 would drop the reader into a board floating
    // in 750px of wall — the residue bug wearing W7's clothes.
    const wide = restZoom(1990, PANEL_WIDTH);
    expect(wide).toBeCloseTo(1990 / PANEL_WIDTH, 10);
    expect(handBackCamera(cam(-120, 300, 0.4), wide)).toEqual(cam(0, 300, wide));
    // ...and the camera already AT the rest zoom is still a no-write.
    expect(handBackCamera(cam(0, 300, wide), wide)).toBeNull();
    // A literal 1 is now a POSE LIKE ANY OTHER, so it gets rebased.
    expect(handBackCamera(cam(0, 300, 1), wide)).toEqual(cam(0, 300, wide));
  });
});

describe("W7 — restZoom: what `z = 1` used to mean, for a board with a size", () => {
  test("it fits exactly one canonical board's width", () => {
    expect(restZoom(PANEL_WIDTH, PANEL_WIDTH)).toBe(1);
    expect(restZoom(1990, PANEL_WIDTH)).toBe(1990 / PANEL_WIDTH);
    // A window NARROWER than a board rests below 1 — fitting the board is
    // the correct pose there, and cropping the lecture is not.
    expect(restZoom(900, PANEL_WIDTH)).toBe(900 / PANEL_WIDTH);
    expect(restZoom(900, PANEL_WIDTH)).toBeLessThan(1);
  });

  test("it never magnifies past the gesture ceiling", () => {
    expect(restZoom(100000, PANEL_WIDTH)).toBe(CAMERA_MAX_Z);
  });

  test("an unmeasured viewport answers 1 — the pre-W7 value, not a zero", () => {
    // A zero would make `cameraCss` write scale(0) on the first frame.
    expect(restZoom(0, PANEL_WIDTH)).toBe(1);
    expect(homeCamera(0)).toEqual(cam(0, 0, 1));
    expect(homeCamera(1990)).toEqual(cam(0, 0, 1990 / PANEL_WIDTH));
  });
});

describe("gateCamera — the C2 host gate (director vs follow vs user)", () => {
  const view: StageView = { viewW: 800, viewH: 600, panelW: 800, panelH: 3000 };
  const sched = buildStageSchedule(
    [
      { kind: "write", start: 0, end: 4 },
      {
        kind: "camera",
        start: 5,
        end: 6,
        move: { from: { x: 0, y: 0, z: 1 }, to: { x: 0, y: 900, z: 1 } },
      },
      { kind: "write", start: 8, end: 10 },
    ],
    view,
    1.42,
  );

  test("the user's wheel outranks the director — detached queries write NOTHING", () => {
    expect(gateCamera(sched, 5.5, "detached")).toEqual({ kind: "user" });
    expect(gateCamera(sched, 7, "detached")).toEqual({ kind: "user" });
    expect(gateCamera(null, 1, "detached")).toEqual({ kind: "user" });
  });

  test("inside a window / hold the director's pose applies", () => {
    expect(gateCamera(sched, 6, "following")).toEqual({
      kind: "director",
      camera: { x: 0, y: 900, z: 1 },
    });
    expect(gateCamera(sched, 7.9, "following")).toEqual({
      kind: "director",
      camera: { x: 0, y: 900, z: 1 },
    });
  });

  test("a silent register — and a camera-free board — fall back to the C1 follow path", () => {
    expect(gateCamera(sched, 2, "following")).toEqual({ kind: "follow" });
    expect(gateCamera(sched, 8, "following")).toEqual({ kind: "follow" }); // decayed
    expect(gateCamera(null, 2, "following")).toEqual({ kind: "follow" });
    const empty = buildStageSchedule(
      [{ kind: "write", start: 0, end: 10 }],
      view,
      1.42,
    );
    expect(gateCamera(empty, 5, "following")).toEqual({ kind: "follow" });
  });
});
