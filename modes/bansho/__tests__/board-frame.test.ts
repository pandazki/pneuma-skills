/**
 * `frame-board`'s pure half (canvas pivot design §6, acceptance §14).
 *
 * Two halves to this file, and the SECOND one is the point:
 *
 *  - the positive tests pin the arithmetic and the wording;
 *  - the NEGATIVE tests pin what the preview refuses to do (§6.3). A
 *    preview that quietly helps — that nudges a frame off a collision,
 *    guesses a height, or re-bases a missed anchor to somewhere plausible —
 *    is a preview that lies, and the honesty is the entire reason the old
 *    "dry-run placement is permanently rejected" ruling could be partly
 *    overturned. So the refusals are tested like features.
 */

import { describe, expect, test } from "bun:test";
import {
  ANNOTATE_LINE,
  BASELINE_TAIL,
  FRAME_CLAIM_VS_INK_NOTE,
  MAX_CANDIDATES,
  performedText,
  resolveFrames,
  stripWindow,
  type FrameGeometry,
  type FrameInput,
} from "../viewer/board-frame.js";
import {
  resolveRegionRect,
  REGION_GUTTER,
  type StandingBox,
} from "../engine/regions.js";

const FACE_W = 1000;
const FACE_H = 600;

const bounded: FrameGeometry = {
  panel: 1,
  boards: 4,
  faceW: FACE_W,
  faceH: FACE_H,
  front: 0,
};

const strip: FrameGeometry = {
  panel: 0,
  boards: 1,
  faceW: FACE_W,
  faceH: Infinity,
  front: 1200,
  stripDepth: 3000,
};

const box = (
  key: string,
  region: string,
  rect: { x: number; y: number; w: number; h: number },
  panel = 1,
): StandingBox => ({ key, panel, region, rect });

const run = (over: Partial<FrameInput>): ReturnType<typeof resolveFrames> =>
  resolveFrames({
    candidates: [],
    geometry: bounded,
    standing: [],
    performed: { where: null, pending: 0 },
    ...over,
  });

describe("frame-board — the parser is the fold's parser", () => {
  test("every drawn frame is byte-equal to engine/regions.ts's own rect", () => {
    // §14 pins "解析器与折叠同源" as a MECHANICAL fact, not a promise: the
    // preview must be unable to disagree with the fold, because there is
    // only one table. This asserts the identity directly.
    for (const word of [
      "full",
      "left",
      "right",
      "top",
      "bottom",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]) {
      const report = run({ candidates: [{ at: word }] });
      const verdict = report.verdicts[0]!;
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) continue;
      const fold = resolveRegionRect(word, FACE_W, FACE_H);
      expect(fold.ok).toBe(true);
      if (!fold.ok) continue;
      expect(verdict.rect).toEqual(fold.rect);
    }
  });

  test("the gutter is the fold's gutter — a half is (W − g) / 2", () => {
    const report = run({ candidates: [{ at: "right" }] });
    const v = report.verdicts[0]!;
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.rect.w).toBe((FACE_W - REGION_GUTTER) / 2);
    expect(v.rect.x).toBe(FACE_W - (FACE_W - REGION_GUTTER) / 2);
  });
});

describe("frame-board — collisions are the collision pass's collisions", () => {
  test("a candidate free of standing ink reports free, and says so", () => {
    const report = run({
      candidates: [{ at: "right" }],
      standing: [box("1:0", "left", { x: 0, y: 0, w: 488, h: 300 })],
    });
    const v = report.verdicts[0]!;
    expect(v.ok && v.hits).toEqual([]);
    expect(report.message).toContain("Free — nothing standing under it.");
  });

  test("a candidate over standing ink names the region, the steps and the %", () => {
    const report = run({
      candidates: [{ at: "full" }],
      standing: [
        box("2:3", "right", { x: 512, y: 0, w: 488, h: 300 }),
        box("2:4", "right", { x: 512, y: 300, w: 488, h: 100 }),
      ],
    });
    const v = report.verdicts[0]!;
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.hits).toHaveLength(1);
    expect(v.hits[0]!.region).toBe("right");
    expect(v.hits[0]!.steps).toEqual(["§2 step 4", "§2 step 5"]);
    // `full` swallows both boxes whole — 100% of each.
    expect(v.hits[0]!.fraction).toBeCloseTo(1, 5);
    expect(report.message).toContain("Lands on right (§2 step 4, §2 step 5)");
    expect(report.message).toContain("covering 100% of it");
  });

  test("two columns with the gutter between them do not collide", () => {
    const report = run({
      candidates: [{ at: "right" }],
      standing: [
        box("1:0", "left", {
          x: 0,
          y: 0,
          w: (FACE_W - REGION_GUTTER) / 2,
          h: FACE_H,
        }),
      ],
    });
    expect(report.verdicts[0]!.ok && report.verdicts[0]!.hits).toEqual([]);
  });

  test("boxes on OTHER boards are not in the picture at all", () => {
    const report = run({
      candidates: [{ at: "full" }],
      standing: [box("0:0", "full", { x: 0, y: 0, w: 1000, h: 600 }, 2)],
    });
    expect(report.standing).toEqual([]);
    expect(report.verdicts[0]!.ok && report.verdicts[0]!.hits).toEqual([]);
  });
});

describe("frame-board — the strip", () => {
  test("a strip frame starts at the write front and its depth is undeclared", () => {
    const report = run({ candidates: [{ at: "right" }], geometry: strip });
    const v = report.verdicts[0]!;
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.rect.y).toBe(1200);
    expect(v.open).toBe(true);
    expect(Number.isFinite(v.rect.h)).toBe(false);
    expect(report.message).toContain("depth undeclared");
  });

  test("the crop window is stated on the report's FIRST line", () => {
    const report = run({ candidates: [{ at: "left" }], geometry: strip });
    // The line says where to LOOK, and admits the picture is not cropped
    // to it — §6.1-3's crop is owed, and a report that claimed it would be
    // the one thing this organ may never be.
    expect(report.message.split("\n")[0]).toStartWith("Your frames sit between ");
    expect(report.message.split("\n")[0]).toContain("the write front stands at");
    expect(report.message.split("\n")[0]).toContain("not built yet");
    expect(report.window).not.toBeNull();
  });

  test("the crop never exceeds two viewport heights", () => {
    const win = stripWindow([{ x: 0, y: 0, w: 10, h: 9000 }], 0, 700, 9000);
    expect(win.to - win.from).toBeLessThanOrEqual(1400);
  });

  test("a vertical word on the strip is a category error, reported in place", () => {
    const report = run({
      candidates: [{ at: "left" }, { at: "top" }, { at: "right" }],
      geometry: strip,
    });
    expect(report.verdicts.map((v) => v.ok)).toEqual([true, false, true]);
    expect(report.message).toContain('B "@at top" — not drawn:');
  });
});

describe("frame-board — the honesty surface (§6.2)", () => {
  test("the baseline line closes every report, verbatim", () => {
    for (const report of [
      run({}),
      run({ candidates: [{ at: "left" }] }),
      run({ candidates: [{ at: "nowhere" }] }),
    ]) {
      const last = report.message.split("\n").at(-1)!;
      expect(last).toEndWith(BASELINE_TAIL);
      expect(last).toStartWith("The image shows the wall as the user sees it now (");
    }
  });

  test("the watermark says 'this session' and counts the unperformed tail", () => {
    expect(performedText({ where: "section 2, step 5", pending: 3 })).toBe(
      "played through section 2, step 5 this session; 3 steps still to perform",
    );
    expect(performedText({ where: null, pending: 1 })).toBe(
      "nothing performed yet this session; 1 step still to perform",
    );
  });

  test("an overlap with the FLOW admits it may be a claim, not ink — once", () => {
    const report = run({
      candidates: [{ at: "right" }, { at: "top-right" }],
      standing: [box("1:0", "full", { x: 0, y: 0, w: FACE_W, h: 180 })],
    });
    const hits = report.message
      .split("\n")
      .filter((l) => l === FRAME_CLAIM_VS_INK_NOTE);
    expect(hits).toHaveLength(1);
  });

  test("an overlap with a NAMED region makes no such excuse", () => {
    const report = run({
      candidates: [{ at: "left" }],
      standing: [box("1:0", "left", { x: 0, y: 0, w: 488, h: 180 })],
    });
    expect(report.message).not.toContain(FRAME_CLAIM_VS_INK_NOTE);
  });

  test("empty candidates is the annotate mode, not an error", () => {
    const report = run({ standing: [box("1:0", "full", { x: 0, y: 0, w: 1000, h: 200 })] });
    expect(report.message).toContain(ANNOTATE_LINE);
    expect(report.verdicts).toEqual([]);
    expect(report.standing).toHaveLength(1);
  });

  test("more than eight candidates are capped, and the drop is declared", () => {
    const report = run({
      candidates: Array.from({ length: 11 }, () => ({ at: "left" })),
    });
    expect(report.verdicts).toHaveLength(MAX_CANDIDATES);
    expect(report.message).toContain("3 further candidates were not framed");
  });
});

describe("frame-board — NEGATIVE: what it refuses to do (§6.3)", () => {
  test("it never nudges, shrinks or reflows a frame away from a collision", () => {
    const collidingStandee = box("0:0", "full", {
      x: 0,
      y: 0,
      w: FACE_W,
      h: FACE_H,
    });
    const free = run({ candidates: [{ at: "right" }] });
    const blocked = run({
      candidates: [{ at: "right" }],
      standing: [collidingStandee],
    });
    const freeRect = free.verdicts[0]!.ok ? free.verdicts[0]!.rect : undefined;
    const blockedRect = blocked.verdicts[0]!.ok
      ? blocked.verdicts[0]!.rect
      : undefined;
    expect(freeRect).toBeDefined();
    expect(blockedRect).toEqual(freeRect!);
    // …and it reports the collision rather than silently solving it.
    expect(blocked.verdicts[0]!.ok && blocked.verdicts[0]!.hits).toHaveLength(1);
  });

  test("standing ink does not change any frame's geometry at all", () => {
    // The strongest form of the above: over EVERY word, the rect with a
    // wall full of standing boxes equals the rect on an empty board.
    const wall = [
      box("0:0", "full", { x: 0, y: 0, w: FACE_W, h: 200 }),
      box("0:1", "left", { x: 0, y: 200, w: 400, h: 200 }),
      box("0:2", "bottom-right", { x: 600, y: 400, w: 400, h: 200 }),
    ];
    for (const word of ["full", "left", "top-right", "bottom"]) {
      const a = run({ candidates: [{ at: word }] });
      const b = run({ candidates: [{ at: word }], standing: wall });
      const clean = a.verdicts[0]!.ok ? a.verdicts[0]!.rect : undefined;
      const crowded = b.verdicts[0]!.ok ? b.verdicts[0]!.rect : undefined;
      expect(clean).toBeDefined();
      expect(crowded).toEqual(clean!);
    }
  });

  test("it never predicts a height for an undeclared one", () => {
    // The strip's frame has NO number where its depth would go. A preview
    // that guessed one would be simulating content — the exact thing the
    // 2026-05 ruling rejected and this design left rejected.
    const report = run({ candidates: [{ at: "full" }], geometry: strip });
    const v = report.verdicts[0]!;
    expect(v.ok && Number.isFinite(v.rect.h)).toBe(false);
    expect(report.message).not.toContain("×");
  });

  test("it never suggests a position", () => {
    const report = run({
      candidates: [{ at: "full" }],
      standing: [box("0:0", "full", { x: 0, y: 0, w: FACE_W, h: FACE_H })],
    });
    for (const word of ["try ", "instead", "suggest", "recommend", "should ", "better"]) {
      expect(report.message.toLowerCase()).not.toContain(word);
    }
  });

  test("it never claims anything about what would be erased", () => {
    const report = run({
      candidates: [{ at: "full" }],
      standing: [box("0:0", "left", { x: 0, y: 0, w: 400, h: 400 })],
    });
    expect(report.message.toLowerCase()).not.toContain("eras");
    expect(report.message.toLowerCase()).not.toContain("wipe");
  });

  test("a missed anchor is NOT re-based to somewhere plausible", () => {
    const report = run({
      candidates: [{ at: "right", anchor: "那个定义" }],
      geometry: strip,
    });
    const v = report.verdicts[0]!;
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain("not drawn rather than quietly re-based");
    // …and the report still answers.
    expect(report.message).toEndWith(BASELINE_TAIL);
  });

  test("a resolved anchor puts the frame exactly where the anchor is", () => {
    const report = run({
      candidates: [{ at: "right", anchor: "那个定义" }],
      geometry: strip,
      anchors: new Map([["那个定义", 640]]),
    });
    const v = report.verdicts[0]!;
    expect(v.ok && v.rect.y).toBe(640);
    expect(report.message).toContain('anchored to "那个定义"');
  });

  test("an unknown word is reported in place and the others still answer", () => {
    const report = run({
      candidates: [{ at: "left" }, { at: "banner" }, { at: "right" }],
    });
    expect(report.verdicts.map((v) => v.ok)).toEqual([true, false, true]);
    expect(report.message).toContain('B "@at banner" — not drawn:');
    expect(report.message).toEndWith(BASELINE_TAIL);
  });
});

describe("frame-board — re-entering a region is not landing on it", () => {
  test("a candidate over its OWN region reports free, not a collision", () => {
    // The fold continues a re-entered region's run BELOW its standing
    // content (`RegionRecord.standingRun`), so warning here would describe
    // an overlap that never happens. Same exclusion `detectCollisions`
    // makes, same reason.
    const report = run({
      candidates: [{ at: "right" }],
      standing: [box("1:0", "right", { x: 512, y: 0, w: 488, h: 300 })],
    });
    expect(report.verdicts[0]!.ok && report.verdicts[0]!.hits).toEqual([]);
    expect(report.message).toContain("Free — nothing standing under it.");
  });

  test("a later episode of the same word is still the same region", () => {
    const report = run({
      candidates: [{ at: "right" }],
      standing: [box("1:0", "right#2", { x: 512, y: 0, w: 488, h: 300 })],
    });
    expect(report.verdicts[0]!.ok && report.verdicts[0]!.hits).toEqual([]);
  });

  test("a DIFFERENT word over that region still lands on it", () => {
    const report = run({
      candidates: [{ at: "top-right" }],
      standing: [box("1:0", "right", { x: 512, y: 0, w: 488, h: 300 })],
    });
    expect(report.verdicts[0]!.ok && report.verdicts[0]!.hits).toHaveLength(1);
  });
});
