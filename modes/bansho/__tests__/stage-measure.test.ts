/**
 * stage-measure.ts — the G8-J funnel, plus the source-scan gate that gives
 * the rule teeth.
 *
 * Once the stage wears a CSS transform, `getBoundingClientRect()` returns
 * RENDERED coordinates while offset* / client* / scroll* stay layout values
 * — and mixing the two families in one formula is exactly correct at zoom 1
 * and silently wrong everywhere else. So every rect reading that falls
 * back to board coordinates must be divided by the accumulated scale
 * measured in the SAME frame (`rect.width / offsetWidth` — numerator and
 * denominator from the same instant, self-consistent even mid-transition).
 *
 * The structural guard (not "remember to divide"): `getBoundingClientRect(`
 * may appear ONLY in the funnel file and the named exemptions. Precedent:
 * `engine/factories/svg.ts::el()` turned G8-D into a throw.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  boardRects,
  deltaLeft,
  liveScale,
  viewportPoint,
  withDepthSuspended,
  type ClientRectLike,
} from "../viewer/stage-measure.js";

const rect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): ClientRectLike => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
});

const el = (r: ClientRectLike, offsetWidth = 0) => ({
  getBoundingClientRect: () => r,
  offsetWidth,
});

describe("liveScale — empirical accumulated scale, same-frame", () => {
  test("rendered width over layout width", () => {
    expect(liveScale(el(rect(0, 0, 150, 10), 100))).toBe(1.5);
    expect(liveScale(el(rect(0, 0, 100, 10), 100))).toBe(1);
  });

  test("degenerate layout (unmounted / zero-width) reads 1, never NaN", () => {
    expect(liveScale(el(rect(0, 0, 0, 0), 0))).toBe(1);
    expect(liveScale(el(rect(0, 0, 0, 0), 100))).toBe(1);
  });
});

describe("boardRects — screen rects fall back to board coordinates", () => {
  test("subtract the base origin, divide by the same-frame scale", () => {
    // Base rendered at 1.5x: layout 100 wide, rendered 150 wide at (10,20).
    const base = el(rect(10, 20, 160, 80), 100);
    const target = el(rect(85, 95, 160, 110));
    expect(boardRects(base, [target], null, null)).toEqual([
      { left: 50, top: 50, right: 100, bottom: 60 },
    ]);
  });

  test("at scale 1 the divide is exact identity (division by 1.0)", () => {
    const base = el(rect(10, 20, 110, 80), 100);
    const target = el(rect(33.359375, 45.71875, 60.015625, 52.5));
    const [r] = boardRects(base, [target], null, null);
    // Byte-for-byte the same floats the un-divided subtraction yields —
    // this is what keeps the C1 layout baseline byte-identical at rest.
    expect(r).toEqual({
      left: 33.359375 - 10,
      top: 45.71875 - 20,
      right: 60.015625 - 10,
      bottom: 52.5 - 20,
    });
  });

  test("many targets share ONE base reading (one scale for the whole batch)", () => {
    let reads = 0;
    const base = {
      getBoundingClientRect: () => {
        reads++;
        return rect(0, 0, 200, 100);
      },
      offsetWidth: 100,
    };
    boardRects(base, [el(rect(0, 0, 10, 10)), el(rect(10, 10, 20, 20))], null, null);
    expect(reads).toBe(1);
  });
});

describe("deltaLeft — the align probe's horizontal distance, scale-safe", () => {
  test("divides the left difference by the base's live scale", () => {
    const host = el(rect(0, 0, 300, 100), 200); // scale 1.5
    const a = el(rect(150, 0, 160, 10));
    const b = el(rect(90, 0, 100, 10));
    expect(deltaLeft(host, a, b)).toBe(40);
  });

  test("at scale 1 it is the raw subtraction (G8-K measure host case)", () => {
    const host = el(rect(0, 0, 200, 100), 200);
    const a = el(rect(56.5, 0, 60, 10));
    const b = el(rect(20.25, 0, 30, 10));
    expect(deltaLeft(host, a, b)).toBe(56.5 - 20.25);
  });
});

describe("viewportPoint — client coords to viewport-relative screen px", () => {
  test("subtracts the viewport's rendered origin", () => {
    const viewport = el(rect(40, 60, 840, 660));
    expect(viewportPoint(viewport, 440, 360)).toEqual({ x: 400, y: 300 });
  });
});

describe("withDepthSuspended — V1.5's exclusion of the 3D surface", () => {
  /**
   * G8-J's divide undoes a uniform scale; a 3D rotation is projective and
   * no scalar undoes it. So the depth surface is LIFTED for the read
   * instead of corrected for — and the mouse drives that surface, so
   * getting this wrong means back-reference ink that drifts as the reader
   * moves (brief §5.2-2).
   */
  const layer = (transform: string) => ({ style: { transform } });

  test("the read happens flat, and the pose is back before we return", () => {
    const l = layer("perspective(1600px) rotateY(-4deg)");
    const seen = withDepthSuspended(l, () => l.style.transform);
    expect(seen).toBe("");
    expect(l.style.transform).toBe("perspective(1600px) rotateY(-4deg)");
  });

  test("a throwing read must not leave the board stuck flat", () => {
    const l = layer("perspective(1600px) rotateX(3deg)");
    expect(() =>
      withDepthSuspended(l, () => {
        throw new Error("measurement blew up");
      }),
    ).toThrow("measurement blew up");
    expect(l.style.transform).toBe("perspective(1600px) rotateX(3deg)");
  });

  test("an absent or already-flat surface is a straight pass-through", () => {
    expect(withDepthSuspended(null, () => 7)).toBe(7);
    expect(withDepthSuspended(undefined, () => 7)).toBe(7);
    const rest = layer("");
    let wrote = 0;
    const proxy = {
      style: {
        get transform() {
          return rest.style.transform;
        },
        set transform(v: string) {
          wrote++;
          rest.style.transform = v;
        },
      },
    };
    expect(withDepthSuspended(proxy, () => 7)).toBe(7);
    // At rest the funnel touches nothing at all — the C1 hot path keeps
    // its exact cost on every board that never turns the surface on.
    expect(wrote).toBe(0);
  });

  test("the WHOLE batch is quoted in one pose — base and targets together", () => {
    // The funnel's rule is one scale, one origin, one frame. Suspending
    // per-rect would quote the base flat and the targets tilted (or the
    // reverse) and silently mix two frames.
    const l = layer("perspective(1600px) rotateY(-4deg)");
    const poses: string[] = [];
    const reader = (r: ClientRectLike) => ({
      getBoundingClientRect: () => {
        poses.push(l.style.transform);
        return r;
      },
      offsetWidth: 100,
    });
    const base = reader(rect(0, 0, 100, 100));
    const a = reader(rect(10, 10, 20, 20));
    const b = reader(rect(30, 30, 40, 40));
    boardRects(base, [a, b], l, null);
    expect(poses).toEqual(["", "", ""]);
    expect(l.style.transform).toBe("perspective(1600px) rotateY(-4deg)");
  });

  test("a ONE-target read is suspended too — the fold's shape, and the bug", () => {
    // The regression this exists for: `computeFoldInputs` measures each
    // box with a single-target `boardRects` to get the fractional border
    // box the chain spaces with. Read through a 4° parallax tilt it came
    // back inflated, every box inherited it, and a 4218px board folded to
    // 7629 — while every individual `h` still read correct afterwards, so
    // nothing about the symptom pointed at the measurement. Found by
    // measurement, not by review; pinned here so it stays found.
    const l = layer("perspective(1600px) rotateX(-4deg)");
    let poseAtRead = "unset";
    const base = {
      getBoundingClientRect: () => rect(0, 0, 100, 100),
      offsetWidth: 100,
    };
    const one = {
      getBoundingClientRect: () => {
        poseAtRead = l.style.transform;
        return rect(0, 10, 100, 60);
      },
    };
    const [r] = boardRects(base, [one], l, null);
    expect(poseAtRead).toBe("");
    expect(r!.bottom - r!.top).toBe(50);
    expect(l.style.transform).toBe("perspective(1600px) rotateX(-4deg)");
  });
});

describe("G8-J teeth — getBoundingClientRect is funnel-only in modes/bansho", () => {
  /**
   * Allowlist: file (relative to modes/bansho/) -> exact occurrence count.
   * Growing a count or adding a file is a G8-J event: route the reading
   * through stage-measure.ts, or argue the exemption HERE, in review.
   */
  const EXEMPT: Record<string, number> = {
    // The funnel itself — the one place the raw API is the point
    // (6 readings + the RectReader interface declaration).
    "viewer/stage-measure.ts": 7,
    // Timeline's scrub track lives in the transport bar, OUTSIDE the
    // stage — its rect is never transformed (named by the C1 spec).
    "viewer/Timeline.tsx": 1,
    // In-place ink measurement inside ctx.measureHost — G8-K pins the
    // host outside the stage at scale 1, and engine/ is out of C1's
    // blast radius by gate (2 calls + 1 mention in a comment).
    "engine/factories/prose.ts": 3,
    // The drawn fraction bar reads the mfrac's box and its two children's
    // boxes inside ctx.measureHost — the SAME exemption as prose.ts above
    // (G8-K pins that host outside the stage, so the readings are already
    // at scale 1) and, like it, the values never leave the host's own
    // coordinate space: each one is immediately differenced against the
    // math host's rect to become a host-local path coordinate, so even a
    // hypothetical scale would cancel. 4 calls: host, mfrac, numerator,
    // denominator.
    "engine/factories/math.ts": 4,
  };

  test("every occurrence outside the funnel is on the exemption list", async () => {
    const root = join(import.meta.dir, "..");
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    const found: Record<string, number> = {};
    for (const path of glob.scanSync({ cwd: root })) {
      if (path.includes("__tests__/") || path.startsWith("harness/")) continue;
      const text = await Bun.file(join(root, path)).text();
      const count = text.split("getBoundingClientRect(").length - 1;
      if (count > 0) found[path] = count;
    }
    expect(found).toEqual(EXEMPT);
  });
});
