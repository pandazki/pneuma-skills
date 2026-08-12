/**
 * wall.ts — the room's shape, and the ban on a second copy of it.
 *
 * Two kinds of test here. The first pins the slotting rule and the
 * round trip between a board and the point it stands at. The second is a
 * source scan with teeth: `panel * (panelW + gap)` used to live inline in
 * five places in `BoardCanvas.tsx`, every one of them silently assuming
 * the wall had exactly one row. That assumption is exactly what a 2D wall
 * breaks, and a re-grown copy would break it silently again — so the scan
 * pins wall arithmetic to this module the way `stage-measure.test.ts`
 * pins `getBoundingClientRect` to the funnel.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  wallExtent,
  wallGrid,
  wallSlot,
  wallSlotAt,
  type WallGeometry,
} from "../engine/wall.js";

/** A board wider than tall, with wall showing between boards. */
const G: WallGeometry = { panelW: 1000, panelH: 720, gap: 32 };

describe("wallGrid — one rule, four rooms", () => {
  test("the ratified slotting: 1x1, 2 across, 2 over 1, 2x2", () => {
    expect(wallGrid(1)).toEqual({ cols: 1, rows: 1 });
    expect(wallGrid(2)).toEqual({ cols: 2, rows: 1 });
    expect(wallGrid(3)).toEqual({ cols: 2, rows: 2 });
    expect(wallGrid(4)).toEqual({ cols: 2, rows: 2 });
  });

  test("a degenerate count is the single strip, never a divide by zero", () => {
    expect(wallGrid(0)).toEqual({ cols: 1, rows: 1 });
    expect(wallGrid(-3)).toEqual({ cols: 1, rows: 1 });
    expect(wallGrid(Number.NaN)).toEqual({ cols: 1, rows: 1 });
  });
});

describe("wallSlot — where each board stands", () => {
  test("one board stands at the origin (the strip, bit for bit)", () => {
    expect(wallSlot(0, 1, G)).toEqual({ x: 0, y: 0 });
  });

  test("two boards stand side by side, one row", () => {
    expect(wallSlot(0, 2, G)).toEqual({ x: 0, y: 0 });
    expect(wallSlot(1, 2, G)).toEqual({ x: 1032, y: 0 });
  });

  test("four boards stand two by two, row-major", () => {
    expect(wallSlot(0, 4, G)).toEqual({ x: 0, y: 0 });
    expect(wallSlot(1, 4, G)).toEqual({ x: 1032, y: 0 });
    expect(wallSlot(2, 4, G)).toEqual({ x: 0, y: 752 });
    expect(wallSlot(3, 4, G)).toEqual({ x: 1032, y: 752 });
  });

  test("three boards are two over one — the bottom right stays bare wall", () => {
    expect(wallSlot(2, 3, G)).toEqual({ x: 0, y: 752 });
    // The room HOLDS a fourth slot; nothing stands in it. Asking for a
    // board that does not exist clamps into the room, never off the wall.
    expect(wallSlot(9, 3, G)).toEqual({ x: 1032, y: 752 });
  });

  test("no two boards share a slot, and none overlaps its neighbour", () => {
    for (const n of [2, 3, 4]) {
      const slots = Array.from({ length: n }, (_, i) => wallSlot(i, n, G));
      const seen = new Set(slots.map((s) => `${s.x},${s.y}`));
      expect(seen.size).toBe(n);
      for (const a of slots) {
        for (const b of slots) {
          if (a === b) continue;
          const apart =
            Math.abs(a.x - b.x) >= G.panelW || Math.abs(a.y - b.y) >= G.panelH;
          expect(apart).toBe(true);
        }
      }
    }
  });
});

describe("wallExtent — the camera's clamp box", () => {
  test("one board's extent IS the panel (the strip is untouched)", () => {
    expect(wallExtent(1, G)).toEqual({ w: 1000, h: 720 });
  });

  test("a 2x2 wall is two boards and one gap in each axis", () => {
    expect(wallExtent(4, G)).toEqual({ w: 2032, h: 1472 });
  });

  test("a 2x2 room is far closer to a viewport's shape than a 4-strip", () => {
    // The rejection, as a number: four across is 5.7 viewports wide and
    // 0.9 tall, so fitting it costs three quarters of the zoom and leaves
    // the rest of the frame void.
    const strip = { w: 4 * G.panelW + 3 * G.gap, h: G.panelH };
    const room = wallExtent(4, G);
    const fit = (e: { w: number; h: number }) =>
      Math.min(1600 / e.w, 1000 / e.h);
    expect(fit(room)).toBeGreaterThan(fit(strip) * 1.7);
  });

  test("every board fits inside the extent it is quoted against", () => {
    for (const n of [1, 2, 3, 4]) {
      const e = wallExtent(n, G);
      for (let i = 0; i < n; i++) {
        const s = wallSlot(i, n, G);
        expect(s.x + G.panelW).toBeLessThanOrEqual(e.w);
        expect(s.y + G.panelH).toBeLessThanOrEqual(e.h);
      }
    }
  });
});

describe("wallSlotAt — which board a point stands on", () => {
  test("a board's own origin, its centre and its far corner all read it", () => {
    for (const n of [1, 2, 3, 4]) {
      for (let i = 0; i < n; i++) {
        const s = wallSlot(i, n, G);
        expect(wallSlotAt(s, n, G)).toBe(i);
        expect(
          wallSlotAt(
            { x: s.x + G.panelW / 2, y: s.y + G.panelH / 2 },
            n,
            G,
          ),
        ).toBe(i);
        expect(
          wallSlotAt({ x: s.x + G.panelW - 1, y: s.y + G.panelH - 1 }, n, G),
        ).toBe(i);
      }
    }
  });

  test("the gap, the bare slot and the void all fall back to a real board", () => {
    // The wall strip between two boards belongs to the one you have
    // walked past — never to no board at all.
    expect(wallSlotAt({ x: 1010, y: 10 }, 4, G)).toBe(0);
    expect(wallSlotAt({ x: 1040, y: 10 }, 4, G)).toBe(1);
    // The bare bottom-right of a three-board room belongs to board 3.
    expect(wallSlotAt({ x: 1500, y: 1000 }, 3, G)).toBe(2);
    // Off the wall entirely, in both directions.
    expect(wallSlotAt({ x: -9999, y: -9999 }, 4, G)).toBe(0);
    expect(wallSlotAt({ x: 9999, y: 9999 }, 4, G)).toBe(3);
  });
});

describe("the standing ban — wall arithmetic lives HERE", () => {
  /**
   * `panel * (panelW + gap)` in any spelling is wall arithmetic. It may
   * appear in `engine/wall.ts` (the definition) and nowhere else: a second
   * copy is a one-row assumption waiting to be re-introduced, and it is
   * silent — the board simply stands in the wrong place.
   */
  test("no module outside engine/wall.ts builds a pitch or multiplies by one", async () => {
    const root = join(import.meta.dir, "..");
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    const offenders: string[] = [];
    const patterns = [
      // `panel * (panelW + gap)` — the slot, computed inline.
      /panel\w*\s*\*\s*\([^)]*panel_?w[^)]*gap[^)]*\)/i,
      // `panelW + gap` — the pitch itself, in any spelling.
      /panel_?w\w*[^\n]{0,48}\+[^\n]{0,24}gap/i,
    ];
    for (const path of glob.scanSync({ cwd: root })) {
      if (path.includes("__tests__/") || path.startsWith("harness/")) continue;
      if (path === "engine/wall.ts") continue;
      const text = await Bun.file(join(root, path)).text();
      for (const line of text.split("\n")) {
        if (patterns.some((p) => p.test(line))) {
          offenders.push(`${path}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
