/**
 * layout.ts (C3) — the placement fold's three invariants, the clean-board
 * policy, and the `@board` / `@erase` dialect.
 *
 * The properties that must hold (spec, rev 2 §1.4):
 *  1. PREFIX STABILITY — an append never moves an existing step's board.
 *  2. Erase target sets are pairwise disjoint.
 *  3. A named container's home never migrates.
 * Plus (canvas pivot V2, design §2.3 — 2026-08-11): the room synthesizes
 * NO erase, ever. A full wall is where the room stops deciding; writing
 * continues where it stands and bursts past the bottom edge, visibly. The
 * tests that used to pin auto-erase are kept HERE, inverted — a deletion
 * is only proven by the negatives that replace its positives.
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import {
  boardCount,
  foldBoardLayout,
  layoutKey,
  panelHeightFor,
  PANEL_HEIGHT_RATIO,
  scanBoxRects,
  standingBoxes,
  type BoxMetrics,
  type LayoutStepInput,
} from "../engine/layout.js";
import {
  columnWidth,
  detectCollisions,
  REGION_GUTTER,
  type RegionName,
} from "../engine/regions.js";
import { mulberry32 } from "../engine/sketch/index.js";
import { TURN_UNDERFILL_THRESHOLD } from "../viewer/board-check.js";

const content = (
  key: string,
  height: number,
  container?: string,
): LayoutStepInput => ({
  kind: "content",
  key,
  height,
  ...(container !== undefined ? { container } : {}),
});
const erase = (key: string, anchorKey?: string): LayoutStepInput => ({
  kind: "erase",
  key,
  ...(anchorKey !== undefined ? { anchorKey } : {}),
});

describe("panel geometry", () => {
  test("panel height is a pure function of panel width — NEVER of the viewport", () => {
    // The fold's verdicts synthesize canonical auto-erase units; a
    // viewport-derived height would let a window resize rewrite the
    // timeline. Pinned by construction: the only input is the width.
    expect(panelHeightFor(1000)).toBe(Math.round(1000 * PANEL_HEIGHT_RATIO));
    expect(panelHeightFor(1000)).toBe(720);
  });
});

describe("boardCount — the opening stage direction", () => {
  test("reads the @board count; defaults to the single long strip", () => {
    expect(boardCount(parseLecture("@board 3\n\n# 题\n\n正文。\n"))).toBe(3);
    expect(boardCount(parseLecture("# 题\n\n正文。\n"))).toBe(1);
    expect(boardCount(parseLecture(""))).toBe(1);
  });
});

describe("the assignment fold", () => {
  test("fills boards in document order, breaking only at step boundaries", () => {
    const layout = foldBoardLayout(
      [content("a", 60), content("b", 30), content("c", 40), content("d", 80)],
      3,
      100,
    );
    expect(layout.assignments.get("a")).toEqual({ panel: 0, region: "full", run: "0.0" });
    expect(layout.assignments.get("b")).toEqual({ panel: 0, region: "full", run: "0.0" });
    // c (40) does not fit on board 0 (90 used of 100) — whole step moves.
    expect(layout.assignments.get("c")).toEqual({ panel: 1, region: "full", run: "1.0" });
    expect(layout.assignments.get("d")).toEqual({ panel: 2, region: "full", run: "2.0" });
    expect(layout.eraseOps).toEqual([]);
  });

  test("a FULL WALL erases nothing — the pen stays and the writing bursts where it stands (design §2.3)", () => {
    // This test is the inverse of the one that stood here until
    // 2026-08-11 ("auto-erase fires when every board stands full, wiping
    // the EARLIEST-FILLED one"). The room no longer picks a victim: it
    // stops deciding, and the author says their own `@erase "锚"`.
    const layout = foldBoardLayout(
      [
        content("a", 90),
        content("b", 90),
        content("c", 90), // three boards standing full
        content("d", 50), // nowhere to go — and the room does NOT make room
      ],
      3,
      100,
    );
    // The whole of D-3, as a structural property: no synthesized erase.
    expect(layout.eraseOps).toEqual([]);
    // `d` stays on the board the pen was standing on, and joins its run —
    // it does not open a second run, because nothing was retired.
    expect(layout.assignments.get("d")).toEqual({
      panel: 2,
      region: "full",
      run: "2.0",
    });
    expect(layout.cur).toBe(2);
    expect(layout.panels[2]!.cursor).toBe(140); // past the 100 budget, visibly

    // Keeping the pen still is not "nothing happened": the ONE automatic
    // act that survives is walking to a clean board, and it still fires
    // whenever one exists. Same wall, one board erased ⇒ the wiped board
    // is taken.
    const withRoom = foldBoardLayout(
      [
        content("a", 90),
        content("b", 90),
        content("c", 90),
        erase("e1", "a"),
        content("d", 50),
      ],
      3,
      100,
    );
    expect(withRoom.assignments.get("d")).toEqual({
      panel: 0,
      region: "full",
      run: "0.1",
    });
    expect(withRoom.eraseOps).toHaveLength(1); // the author's, and only it
    expect(withRoom.eraseOps[0]!.key).toBe("e1");
  });

  test("the single board is an unbounded strip: it never overflows and never erases", () => {
    const steps: LayoutStepInput[] = [];
    for (let i = 0; i < 60; i++) steps.push(content(`s${i}`, 500));
    const layout = foldBoardLayout(steps, 1, Infinity);
    expect(layout.eraseOps).toEqual([]);
    for (let i = 0; i < 60; i++) {
      expect(layout.assignments.get(`s${i}`)).toEqual({ panel: 0, region: "full", run: "0.0" });
    }
  });

  test("bare @erase resets the CURRENT board; writing resumes at its top", () => {
    const layout = foldBoardLayout(
      [content("a", 60), erase("e1"), content("b", 60)],
      1,
      Infinity,
    );
    expect(layout.eraseOps).toEqual([
      { key: "e1", panel: 0, region: "full", run: "0.0", targets: ["a"] },
    ]);
    // The new chapter overlays the strip's top — a fresh run, same board.
    expect(layout.assignments.get("b")).toEqual({ panel: 0, region: "full", run: "0.1" });
  });

  test("anchored @erase wipes the board HOLDING the anchor, not the one being written", () => {
    const layout = foldBoardLayout(
      [
        content("a", 90),
        content("b", 90), // board 1
        erase("e1", "a"), // erase the board where "a" lives (board 0)
        content("c", 50),
      ],
      3,
      100,
    );
    expect(layout.eraseOps).toEqual([
      { key: "e1", panel: 0, region: "full", run: "0.0", targets: ["a"] },
    ]);
    // The pen keeps writing where it was — board 1 is full, so `c` walks
    // to the first NEVER-USED board (tier 1 outranks the wiped board 0).
    expect(layout.assignments.get("c")).toEqual({ panel: 2, region: "full", run: "2.0" });
  });

  test("erasing an empty board is a quiet no-op erase (empty target set, run unchanged)", () => {
    const layout = foldBoardLayout([erase("e1"), content("a", 10)], 2, 100);
    expect(layout.eraseOps).toEqual([
      { key: "e1", panel: 0, region: "full", run: "", targets: [] },
    ]);
    expect(layout.assignments.get("a")).toEqual({ panel: 0, region: "full", run: "0.0" });
  });

  test("a giant step (taller than a board) soft-passes with a boardOverflow warning", () => {
    const layout = foldBoardLayout(
      [content("a", 40), content("giant", 250), content("b", 40)],
      2,
      100,
    );
    // Placed whole on the next unused board, never truncated. The record
    // carries how far past one board it stands (250 − 100), so the finding
    // can say the amount instead of just pointing.
    expect(layout.assignments.get("giant")).toEqual({ panel: 1, region: "full", run: "1.0" });
    expect(layout.overflowing).toEqual([
      { key: "giant", overBy: 150, cause: "step" },
    ]);
    // Degenerate continuation (a bad lecture, handled deterministically):
    // both boards are spoken for, and the room no longer makes room —
    // `b` joins the giant's own run and the board stands over-full.
    expect(layout.eraseOps).toEqual([]);
    expect(layout.assignments.get("b")).toEqual({ panel: 1, region: "full", run: "1.0" });
  });

  test("a container's home never migrates: layers draw back into the frame's board and run while it stands", () => {
    const layout = foldBoardLayout(
      [
        content("frame", 80, "chart:走势"),
        content("x", 90),
        content("y", 90), // boards 1, 2 fill
        content("layer", 0, "chart:走势"), // the layer goes home — run OPEN
      ],
      3,
      100,
    );
    expect(layout.assignments.get("frame")).toEqual({ panel: 0, region: "full", run: "0.0" });
    expect(layout.assignments.get("layer")).toEqual({ panel: 0, region: "full", run: "0.0" });
    expect(layout.orphaned).toEqual([]);
    // A later erase of that board declares BOTH — membership was frozen
    // with the layer already inside.
    const erased = foldBoardLayout(
      [
        content("frame", 80, "chart:走势"),
        content("layer", 0, "chart:走势"),
        erase("e1", "frame"),
      ],
      3,
      100,
    );
    expect(erased.eraseOps[0]!.targets).toEqual(["frame", "layer"]);
  });

  test("ink aimed at an ERASED home is a loud orphan — never quietly swallowed by the closed run (review P1-1)", () => {
    const layout = foldBoardLayout(
      [
        content("frame", 80, "chart:走势"),
        content("x", 90),
        content("y", 90),
        erase("e1", "frame"), // the frame's board is erased…
        content("layer", 0, "chart:走势"), // …then a layer aims at it
      ],
      3,
      100,
    );
    // The erase declared its targets when it closed the run, and the late
    // layer must NOT join them afterwards: the declared target set and
    // the set of steps the closed run holds are THE SAME SET — the
    // compile-time disjointness the whole "erase is a Revealable"
    // argument stands on. An erase at t=20 never swallows ink from t=30.
    expect(layout.eraseOps[0]!.targets).toEqual(["frame"]);
    expect(layout.runs.get("0.0")!.steps).toEqual(["frame"]);
    expect(layout.assignments.has("layer")).toBe(false);
    expect(layout.orphaned).toEqual(["layer"]);
  });

  test("a back reference whose target was erased is an orphan too (anchor form, same contract)", () => {
    const layout = foldBoardLayout(
      [
        content("a", 60),
        erase("e1"),
        { kind: "content", key: "circle", height: 0, anchorKey: "a" },
      ],
      1,
      Infinity,
    );
    expect(layout.eraseOps[0]!.targets).toEqual(["a"]);
    expect(layout.runs.get("0.0")!.steps).toEqual(["a"]);
    expect(layout.assignments.has("circle")).toBe(false);
    expect(layout.orphaned).toEqual(["circle"]);
  });

  test("a graph layer's growth is charged at the LAYER's position; the frame keeps its first-written charge (review P1-2)", () => {
    // Board budget 600. Pre-append: heading(100) + frame(180) + 中段(260)
    // = 540 on board 0; 尾声(110) overflows to board 1. The appended
    // layer regrows the frame's MEASURED height to 340 — the fold must
    // keep every existing verdict and charge the 160 growth at the tail.
    const before = foldBoardLayout(
      [
        content("head", 100),
        content("frame", 180, "graph:流程"),
        content("mid", 260),
        content("tail", 110),
      ],
      2,
      600,
    );
    const after = foldBoardLayout(
      [
        content("head", 100),
        { kind: "content", key: "frame", height: 340, container: "graph:流程" },
        content("mid", 260),
        content("tail", 110),
        {
          kind: "content",
          key: "layer",
          height: 0,
          container: "graph:流程",
          growth: 160,
        },
      ],
      2,
      600,
    );
    for (const [key, verdict] of before.assignments) {
      expect(after.assignments.get(key)).toEqual(verdict);
    }
    expect(after.assignments.get("layer")).toEqual({ panel: 0, region: "full", run: "0.0" });
    // Board 0 now stands at 540 + 160 = 700 > 600: the growth crowded the
    // standing content past the board's bottom edge — said out loud, with
    // the overrun (700 − 600) on the record.
    expect(after.overflowing).toEqual([
      { key: "layer", overBy: 100, cause: "growth" },
    ]);
  });
});

describe("fold properties (seeded random boards)", () => {
  /** A deterministic random step sequence with occasional erases. */
  function randomSteps(seed: number, n: number): LayoutStepInput[] {
    const rnd = mulberry32(seed);
    const steps: LayoutStepInput[] = [];
    const contentKeys: string[] = [];
    for (let i = 0; i < n; i++) {
      const roll = rnd();
      if (roll < 0.12 && contentKeys.length > 0) {
        const anchored = rnd() < 0.5;
        steps.push(
          anchored
            ? erase(
                `e${i}`,
                contentKeys[Math.floor(rnd() * contentKeys.length)]!,
              )
            : erase(`e${i}`),
        );
        continue;
      }
      const key = `c${i}`;
      contentKeys.push(key);
      steps.push(content(key, 10 + Math.floor(rnd() * 120)));
    }
    return steps;
  }

  test("PREFIX STABILITY — an append never moves an existing step's board or run", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const steps = randomSteps(seed, 80);
      const full = foldBoardLayout(steps, 4, 100);
      for (const cut of [1, 7, 23, 41, 79]) {
        const prefix = foldBoardLayout(steps.slice(0, cut), 4, 100);
        for (const [key, assignment] of prefix.assignments) {
          expect(full.assignments.get(key)).toEqual(assignment);
        }
        // Erase ops already folded are byte-stable too.
        expect(full.eraseOps.slice(0, prefix.eraseOps.length)).toEqual([
          ...prefix.eraseOps,
        ]);
      }
    }
  });

  // ── Growing containers: appends that RE-MEASURE the prefix ────────────────
  // The fixed-height property above slices a frozen input list, so it can
  // never see the real streaming case the 2026-08-10 review's P1-2 named:
  // a graph frame's measured height is the accumulated UNION, so a pure
  // append of a same-name layer regrows a PREFIX step's measurement. The
  // document model below derives the input list PER CUT the way the live
  // board measures it — frames report own height + every in-prefix
  // layer's growth — and the fold must still never move a placed step.

  type DocItem =
    | { kind: "content"; key: string; height: number }
    | { kind: "erase"; key: string; anchorKey?: string }
    | { kind: "frame"; key: string; container: string; ownHeight: number }
    | { kind: "layer"; key: string; container: string; growth: number };

  function randomDoc(seed: number, n: number): DocItem[] {
    const rnd = mulberry32(seed);
    const doc: DocItem[] = [];
    const contentKeys: string[] = [];
    const containers: string[] = [];
    for (let i = 0; i < n; i++) {
      const roll = rnd();
      if (roll < 0.1 && contentKeys.length > 0) {
        const anchored = rnd() < 0.5;
        doc.push(
          anchored
            ? {
                kind: "erase",
                key: `e${i}`,
                anchorKey: contentKeys[Math.floor(rnd() * contentKeys.length)]!,
              }
            : { kind: "erase", key: `e${i}` },
        );
        continue;
      }
      if (roll < 0.18) {
        const container = `graph:g${i}`;
        containers.push(container);
        contentKeys.push(`f${i}`);
        doc.push({
          kind: "frame",
          key: `f${i}`,
          container,
          ownHeight: 30 + Math.floor(rnd() * 60),
        });
        continue;
      }
      if (roll < 0.32 && containers.length > 0) {
        doc.push({
          kind: "layer",
          key: `l${i}`,
          container: containers[Math.floor(rnd() * containers.length)]!,
          growth: Math.floor(rnd() * 50),
        });
        continue;
      }
      const key = `c${i}`;
      contentKeys.push(key);
      doc.push({ kind: "content", key, height: 10 + Math.floor(rnd() * 120) });
    }
    return doc;
  }

  /** Derive the fold input for one PREFIX of the document: a frame
   *  measures as its own height PLUS the growth of every layer inside the
   *  prefix — the retroactive union measurement the live board reports.
   *
   *  Every space-occupying item carries `box` metrics as well as its
   *  charge, because a fold handed no box metrics places no boxes at all —
   *  which is how the 2026-08-13 review found this file agreeing with the
   *  implementation about `assignments` while never once looking at
   *  `boxes`. Margins are zero so the two registers quote one number: the
   *  point here is the CHAIN, not margin collapsing (pinned separately by
   *  the box oracle). A container LAYER keeps no box on purpose — it is a
   *  hidden zero-rect marker on the live board, and its arrival is felt
   *  only through the frame's own re-measurement. */
  function inputsFor(doc: readonly DocItem[], cut: number): LayoutStepInput[] {
    const prefix = doc.slice(0, cut);
    const growthIn = new Map<string, number>();
    for (const item of prefix) {
      if (item.kind === "layer") {
        growthIn.set(
          item.container,
          (growthIn.get(item.container) ?? 0) + item.growth,
        );
      }
    }
    const metrics = (h: number): BoxMetrics => ({
      h,
      marginTop: 0,
      marginBottom: 0,
    });
    return prefix.map((item): LayoutStepInput => {
      switch (item.kind) {
        case "content":
          return {
            kind: "content",
            key: item.key,
            height: item.height,
            box: metrics(item.height),
          };
        case "erase":
          return {
            kind: "erase",
            key: item.key,
            ...(item.anchorKey !== undefined
              ? { anchorKey: item.anchorKey }
              : {}),
          };
        case "frame": {
          const height = item.ownHeight + (growthIn.get(item.container) ?? 0);
          return {
            kind: "content",
            key: item.key,
            height,
            box: metrics(height),
            container: item.container,
          };
        }
        case "layer":
          return {
            kind: "content",
            key: item.key,
            height: 0,
            container: item.container,
            growth: item.growth,
          };
      }
    });
  }

  test("PREFIX STABILITY survives appends that re-measure a prefix frame (review P1-2)", () => {
    for (const seed of [31, 32, 33, 34, 35]) {
      const doc = randomDoc(seed, 90);
      const fullInputs = inputsFor(doc, doc.length);
      const full = foldBoardLayout(fullInputs, 3, 150);
      // Fixture guard, loud on drift: some prefix frame really measures
      // differently once the whole document is in — without that the
      // property degenerates to the fixed-height one above.
      let regrew = false;
      for (const cut of [9, 27, 45, 71]) {
        const prefixInputs = inputsFor(doc, cut);
        for (let i = 0; i < prefixInputs.length; i++) {
          const a = prefixInputs[i]!;
          const b = fullInputs[i]!;
          if (a.kind === "content" && b.kind === "content" && a.height !== b.height) {
            regrew = true;
          }
        }
        const prefix = foldBoardLayout(prefixInputs, 3, 150);
        for (const [key, assignment] of prefix.assignments) {
          expect(full.assignments.get(key)).toEqual(assignment);
        }
        expect(full.eraseOps.slice(0, prefix.eraseOps.length)).toEqual([
          ...prefix.eraseOps,
        ]);
        expect(full.orphaned.slice(0, prefix.orphaned.length)).toEqual([
          ...prefix.orphaned,
        ]);
      }
      expect(regrew).toBe(true);
    }
  });

  // ── The geometric register, which the property above never looked at ──
  //
  // The 2026-08-13 review found the test above comparing assignments,
  // erases and orphans and NOT `boxes` — and the generator handing the fold
  // no box metrics at all, so `boxes` was empty and could not have been
  // compared. These two close that, and between them they say exactly what
  // the fold promises in each register, because the two promises DIFFER and
  // the gap is where the review's proposed repair would have landed.

  /** Every fold's face width and column count, one place. */
  const FACE_W = 1154;
  const COLS = 2;

  test("no two boxes standing in one region ever overlap — the guarantee `detectCollisions` structurally cannot make", () => {
    // `regions.ts::detectCollisions` skips same-region pairs (`a.region ===
    // b.region` → continue) because the flow's own chain is what keeps them
    // apart. That makes the chain the SOLE guarantor of flow-on-flow ink,
    // and nothing was pinning it. It is also the exact invariant the review
    // wanted broken: charging a grown container frame's box at its
    // first-written height puts the following box INSIDE the picture (74 vs
    // a measured 162, measured), and no instrument in this mode would ever
    // have said so.
    for (const seed of [31, 32, 33, 34, 35, 36]) {
      const doc = randomDoc(seed, 90);
      for (const cut of [9, 27, 45, 71, doc.length]) {
        const inputs = inputsFor(doc, cut);
        const layout = foldBoardLayout(inputs, 3, 150, undefined, FACE_W, COLS);
        const standing = standingBoxes(layout, inputs);
        for (let i = 0; i < standing.length; i++) {
          for (let j = i + 1; j < standing.length; j++) {
            const a = standing[i]!;
            const b = standing[j]!;
            if (a.panel !== b.panel || a.region !== b.region) continue;
            const gap =
              a.rect.y >= b.rect.y + b.rect.h || b.rect.y >= a.rect.y + a.rect.h;
            const apart =
              a.rect.x >= b.rect.x + b.rect.w || b.rect.x >= a.rect.x + a.rect.w;
            expect(`${seed}/${cut} ${a.key}×${b.key}: ${gap || apart}`).toBe(
              `${seed}/${cut} ${a.key}×${b.key}: true`,
            );
          }
        }
      }
    }
  });

  test("an append moves a box only where the picture above it grew, and only downward, by exactly that growth", () => {
    // What prefix stability IS in the geometric register, stated as the
    // model rather than as a wish. The reviewer's own scenario, with the
    // numbers they quoted:
    //
    //   [graph frame own-height 74, prose 30]         → prose at y = 74
    //   append a layer that grows the graph by 88     → prose at y = 162
    //
    // The prose DOES move, and it must: the frame's node is the whole
    // accumulated dagre canvas — the layer mounts a hidden zero-rect marker
    // — so the box the browser holds open really is 162 tall from the first
    // paint after the append. Chaining on the first-written 74 would place
    // the prose inside that picture, ink over ink, silently (see the test
    // above). The room's honesty here is that the ASSIGNMENT does not move
    // (which board, which run — that is what the deferred charge buys) and
    // the ink lands below what stands, which is R1's other half.
    const box = (h: number): BoxMetrics => ({ h, marginTop: 0, marginBottom: 0 });
    const before: LayoutStepInput[] = [
      { kind: "content", key: "F", height: 74, box: box(74), container: "graph:g" },
      { kind: "content", key: "P", height: 30, box: box(30) },
    ];
    const after: LayoutStepInput[] = [
      ...before.slice(0, 1).map((s) => ({
        ...(s as Extract<LayoutStepInput, { kind: "content" }>),
        height: 162,
        box: box(162),
      })),
      before[1]!,
      { kind: "content", key: "L", height: 0, container: "graph:g", growth: 88 },
    ];
    const fold = (steps: LayoutStepInput[]) =>
      foldBoardLayout(steps, 1, Infinity, undefined, FACE_W, 1);

    const a = fold(before);
    const b = fold(after);
    expect(a.boxes.get("P")!.y).toBe(74);
    expect(b.boxes.get("P")!.y).toBe(162);
    // The frame itself never moves, and the prose moved by exactly the
    // growth — no more (which would be double-charging) and no less (which
    // would be an overlap).
    expect(b.boxes.get("F")).toEqual(a.boxes.get("F")!);
    expect(b.boxes.get("P")!.y - a.boxes.get("P")!.y).toBe(88);
    // The register that IS byte-stable across the append.
    expect([...b.assignments].slice(0, 2)).toEqual([...a.assignments]);
    // And the prose stands clear of the picture, at its measured size.
    const standing = standingBoxes(b, after);
    const frame = standing.find((s) => s.key === "F")!;
    const prose = standing.find((s) => s.key === "P")!;
    expect(frame.rect.h).toBe(162);
    expect(prose.rect.y).toBeGreaterThanOrEqual(frame.rect.y + frame.rect.h);

    // A layer that grows NOTHING moves nothing: the append is felt only
    // through the frame's own re-measurement, never through its arrival.
    const inert: LayoutStepInput[] = [
      before[0]!,
      before[1]!,
      { kind: "content", key: "L", height: 0, container: "graph:g", growth: 0 },
    ];
    expect([...fold(inert).boxes]).toEqual([...a.boxes]);
  });

  test("erase target sets are PAIRWISE DISJOINT and every step has exactly one board — or stands orphaned", () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const steps = randomSteps(seed, 120);
      const layout = foldBoardLayout(steps, 3, 100);
      const seen = new Set<string>();
      for (const op of layout.eraseOps) {
        for (const target of op.targets) {
          expect(seen.has(target)).toBe(false);
          seen.add(target);
        }
      }
      // Each run is closed by at most one erase.
      const closedRuns = layout.eraseOps
        .map((op) => op.run)
        .filter((r) => r !== "");
      expect(new Set(closedRuns).size).toBe(closedRuns.length);
      // Every content step is assigned exactly once XOR orphaned (this
      // generator has no homes, so orphans never arise here — the growing
      // documents below exercise that half).
      for (const step of steps) {
        if (step.kind === "content") {
          expect(
            layout.assignments.has(step.key) !==
              layout.orphaned.includes(step.key),
          ).toBe(true);
        }
      }
    }
  });

  test("an erase's declared target set EQUALS its closed run's membership — with late homes in play (review P1-1)", () => {
    for (const seed of [41, 42, 43, 44, 45]) {
      const doc = randomDoc(seed, 110);
      const layout = foldBoardLayout(inputsFor(doc, doc.length), 3, 150);
      for (const op of layout.eraseOps) {
        if (op.run === "") continue;
        const hidden = layout.runs.get(op.run)?.steps ?? [];
        expect([...hidden].sort()).toEqual([...op.targets].sort());
      }
      for (const item of doc) {
        if (item.kind === "erase") continue;
        expect(
          layout.assignments.has(item.key) !==
            layout.orphaned.includes(item.key),
        ).toBe(true);
      }
    }
  });

  test("determinism — the same input folds to the byte-identical layout", () => {
    const steps = randomSteps(21, 100);
    const a = foldBoardLayout(steps, 4, 100);
    const b = foldBoardLayout(steps, 4, 100);
    expect(JSON.stringify([...a.assignments], null, 0)).toBe(
      JSON.stringify([...b.assignments], null, 0),
    );
    expect([...a.eraseOps]).toEqual([...b.eraseOps]);
  });
});

describe("the @board / @erase dialect (C3)", () => {
  test("@board 2|3|4 parses only as the document's very first step", () => {
    const ok = parseLecture("@board 3\n\n# 题\n\n正文。\n");
    expect(ok.sections[0]!.steps[0]).toMatchObject({
      kind: "board-config",
      count: 3,
    });
    // The H1 AFTER @board is still the preamble's title — the stage
    // direction must not renumber every section.
    expect(ok.sections.length).toBe(1);
    expect(ok.sections[0]!.heading).toBeDefined();

    const mid = parseLecture("正文。\n\n@board 2\n");
    expect(mid.sections[0]!.steps[1]).toMatchObject({ kind: "bad" });
    expect(mid.errors.length).toBe(1);

    const twice = parseLecture("@board 2\n\n@board 3\n");
    expect(twice.sections[0]!.steps[1]).toMatchObject({ kind: "bad" });
  });

  test("@board rejects counts outside 1–4 and never takes other arguments", () => {
    for (const bad of ["@board 5", "@board 0", "@board 2.5", "@board left", "@board"]) {
      const lecture = parseLecture(`${bad}\n`);
      expect(lecture.sections[0]!.steps[0]).toMatchObject({ kind: "bad" });
    }
    expect(
      parseLecture("@board 1\n\n正文。\n").sections[0]!.steps[0],
    ).toMatchObject({ kind: "board-config", count: 1 });
  });

  test("bare @erase and anchored @erase both parse; the anchor resolves nearest-upward", () => {
    const src = "甲说法。\n\n乙说法。\n\n@erase \"甲说法\"\n\n@erase\n";
    const lecture = parseLecture(src);
    const steps = lecture.sections[0]!.steps;
    expect(steps[2]).toMatchObject({
      kind: "erase",
      targetText: "甲说法",
      target: { section: 0, step: 0 },
    });
    expect(steps[3]).toMatchObject({ kind: "erase" });
    expect((steps[3] as { targetText?: string }).targetText).toBeUndefined();
    expect(lecture.errors).toEqual([]);
  });

  test("an unresolvable erase anchor degrades to a BadStep + refUnresolved (R6)", () => {
    const lecture = parseLecture('甲。\n\n@erase "不存在的话"\n');
    expect(lecture.sections[0]!.steps[1]).toMatchObject({ kind: "bad" });
    expect(lecture.errors[0]).toMatchObject({ code: "refUnresolved" });
  });

  test("@erase never takes a board number — a numbered form is a BadStep", () => {
    const lecture = parseLecture("甲。\n\n@erase 2\n");
    const bad = lecture.sections[0]!.steps[1]!;
    expect(bad.kind).toBe("bad");
    expect((bad as { reason: string }).reason).toContain("board number");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The canvas pivot's box model (V1, design §2.2 / §7.5) — the arithmetic
// the pre-V1 y-oracle judges. These numbers were validated against the
// committed `layout-baseline/pre-v1/` capture (98 flow boxes, two residuals
// of −0.03px attributed to probe rounding), so a failure here is the
// ENGINE, never the model.
// ────────────────────────────────────────────────────────────────────────────

/** A content step that also occupies a box (border height + margins). */
const boxed = (
  key: string,
  h: number,
  marginTop: number,
  marginBottom: number,
  container?: string,
): LayoutStepInput => ({
  kind: "content",
  key,
  height: h + marginTop + marginBottom,
  box: { h, marginTop, marginBottom },
  ...(container !== undefined ? { container } : {}),
});

describe("the box model (canvas pivot V1)", () => {
  test("the FIRST box keeps its own margin-top — the board's padding blocks collapse-through", () => {
    // §7.5 reads "y(first) = front" with front = 0, which would DROP the
    // first box's margin. CSS does not drop it, and dropping it would lift
    // every strip by mt(first). The instruments cannot discriminate
    // (fourier's first box has mt = 0); a heading-first board can, so this
    // test is the pin.
    const layout = foldBoardLayout(
      [boxed("a", 47.84, 26, 20), boxed("b", 44.72, 0, 14)],
      1,
      Infinity,
      undefined,
      1154,
    );
    expect(layout.boxes.get("a")).toEqual({ x: 0, y: 26, w: 1154 });
    // gap = max(mb(a)=20, mt(b)=0) = 20
    expect(layout.boxes.get("b")).toEqual({ x: 0, y: 26 + 47.84 + 20, w: 1154 });
  });

  test("gap(a, b) = max(marginBottom(a), marginTop(b)) — collapsing, written out", () => {
    const layout = foldBoardLayout(
      [
        boxed("a", 58.8, 0, 26), // heading: big bottom margin wins
        boxed("b", 89.44, 0, 14),
        boxed("c", 47.84, 26, 20), // heading: big TOP margin wins
      ],
      1,
      Infinity,
      undefined,
      1154,
    );
    // Reproduces fourier's first three boxes exactly (pre-v1/fourier.json,
    // rect tops 36 / 120.8 / 236.23 minus the board's 36px padding-top).
    expect(layout.boxes.get("a")!.y).toBe(0);
    expect(layout.boxes.get("b")!.y).toBe(84.8);
    expect(layout.boxes.get("c")!.y).toBe(200.24);
  });

  test("every box is `full` in V1: x = 0, w = the face's own width", () => {
    const layout = foldBoardLayout(
      [boxed("a", 10, 0, 0), boxed("b", 10, 0, 0)],
      1,
      Infinity,
      undefined,
      1154,
    );
    for (const box of layout.boxes.values()) {
      expect(box.x).toBe(0);
      expect(box.w).toBe(1154);
    }
  });

  test("an erase retires the run: the front falls back, the face's EXTENT does not", () => {
    const layout = foldBoardLayout(
      [
        boxed("a", 100, 0, 14),
        boxed("b", 200, 0, 14),
        erase("e"),
        boxed("c", 30, 0, 14),
      ],
      1,
      Infinity,
      undefined,
      1154,
    );
    expect(layout.boxes.get("b")!.y).toBe(114);
    // 清场开新章 — the new run starts at the top of the face again.
    expect(layout.boxes.get("c")!.y).toBe(0);
    // …but the board stays tall enough to scrub back into the closed run.
    expect(layout.faceExtent[0]).toBe(114 + 200 + 14);
  });

  test("a home placement gets no box of its own — it draws into space that exists", () => {
    const layout = foldBoardLayout(
      [
        boxed("frame", 300, 8, 22, "graph:g"),
        { kind: "content", key: "layer", height: 0, container: "graph:g" },
        { kind: "content", key: "mark", height: 0, anchorKey: "frame" },
        boxed("after", 40, 0, 14),
      ],
      1,
      Infinity,
      undefined,
      1154,
    );
    expect(layout.boxes.has("layer")).toBe(false);
    expect(layout.boxes.has("mark")).toBe(false);
    // …and neither pushes `after` down: gap = max(22, 0).
    expect(layout.boxes.get("after")!.y).toBe(8 + 300 + 22);
  });

  test("each board carries its own chain — a walk to board 2 starts at its own face top", () => {
    const layout = foldBoardLayout(
      [boxed("a", 500, 0, 14), boxed("b", 500, 0, 14), boxed("c", 100, 26, 14)],
      2,
      700,
      undefined,
      1154,
    );
    expect(layout.assignments.get("b")!.panel).toBe(1);
    expect(layout.boxes.get("a")!.y).toBe(0);
    expect(layout.boxes.get("b")!.y).toBe(0);
    expect(layout.boxes.get("c")!.y).toBe(500 + 26);
    expect(layout.faceExtent).toEqual([514, 640]);
  });

  test("the box chain changes NO fill verdict — geometry never sways board selection", () => {
    // The durable form of V1's "no physics change" claim: the SAME step
    // sequence must fold to the same boards whether or not the host had
    // box metrics to hand over. It is what keeps `cleanBoardTarget`'s
    // "wiped" tier honest — a board carrying charge is never called clean
    // just because nobody measured it.
    const withBoxes = foldBoardLayout(
      [boxed("a", 500, 0, 14), boxed("b", 500, 0, 14), boxed("c", 100, 0, 14)],
      2,
      600,
      undefined,
      1154,
    );
    const without = foldBoardLayout(
      [content("a", 514), content("b", 514), content("c", 114)],
      2,
      600,
    );
    expect([...withBoxes.assignments].map(([k, a]) => [k, a.panel])).toEqual(
      [...without.assignments].map(([k, a]) => [k, a.panel]),
    );
    expect(withBoxes.panels.map((p) => p.cursor)).toEqual(
      without.panels.map((p) => p.cursor),
    );
  });

  test("prefix stability in the geometric register: an append moves no placed box", () => {
    const head = [boxed("a", 58.8, 0, 26), boxed("b", 89.44, 0, 14)];
    const before = foldBoardLayout(head, 1, Infinity, undefined, 1154);
    const after = foldBoardLayout(
      [...head, boxed("c", 47.84, 26, 20)],
      1,
      Infinity,
      undefined,
      1154,
    );
    for (const key of ["a", "b"]) {
      expect(after.boxes.get(key)).toEqual(before.boxes.get(key)!);
    }
  });

  test("measurements are quoted at 1/100 px, so the chain is reproducible", () => {
    // Float noise below the instrument's resolution must not accumulate
    // into the chain — that is what makes the offline y-oracle decidable.
    const layout = foldBoardLayout(
      [boxed("a", 58.8004, 0, 26.0001), boxed("b", 89.4449, 0, 14)],
      1,
      Infinity,
      undefined,
      1154,
    );
    expect(layout.boxes.get("a")!.y).toBe(0);
    expect(layout.boxes.get("b")!.y).toBe(84.8);
  });

  test("a step with no box metrics is skipped, never placed at a guessed zero", () => {
    const layout = foldBoardLayout(
      [content("silent", 0), boxed("a", 40, 10, 12)],
      1,
      Infinity,
      undefined,
      1154,
    );
    expect(layout.boxes.has("silent")).toBe(false);
    expect(layout.boxes.get("a")!.y).toBe(10);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// W2 (2026-08-12) — THE ROOM'S FLOW FILLS IN COLUMNS
//
// The one behaviour change: reaching the bottom of column 1 resumes at the
// TOP OF COLUMN 2, and only a full FACE walks to a clean board. Everything
// here is about a face that HAS a bottom; a strip's flow is one column by
// arithmetic (`columnCountFor` returns 1 on an infinite height), which is
// why the three layout-baseline strips are byte-identical across this
// change.
// ────────────────────────────────────────────────────────────────────────────

describe("the column flow (W2)", () => {
  const at = (key: string, region: RegionName): LayoutStepInput => ({
    kind: "at",
    key,
    region,
  });

  const W = 1154;
  const H = 700;
  const cols = 2;
  const colW = columnWidth(W, cols);

  test("a full column resumes at the TOP of the next one, not on a clean board", () => {
    // Two steps of 400 against a 700 budget: the second does not fit
    // column 1. Pre-W2 it walked to board 1.
    const layout = foldBoardLayout(
      [boxed("a", 400, 0, 0), boxed("b", 400, 0, 0)],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.assignments.get("a")!.panel).toBe(0);
    expect(layout.assignments.get("b")!.panel).toBe(0);
    // ...and it starts at the top of the face, one column across.
    expect(layout.boxes.get("a")).toEqual({ x: 0, y: 0, w: colW });
    expect(layout.boxes.get("b")).toEqual({ x: colW + REGION_GUTTER, y: 0, w: colW });
    expect(layout.cur).toBe(0);
  });

  test("a board holds `columns × budget` before the pen walks", () => {
    const steps = [0, 1, 2, 3].map((i) => boxed(`s${i}`, 400, 0, 0));
    const layout = foldBoardLayout(steps, 3, H, undefined, W, cols);
    // Four 400s = 1600 > 2 x 700, so the fourth is the one that walks.
    expect(steps.map((s) => layout.assignments.get(s.key)!.panel)).toEqual([
      0, 0, 1, 1,
    ]);
    // The same document with ONE column walks twice as early — the control.
    const one = foldBoardLayout(steps, 3, H, undefined, W, 1);
    expect(steps.map((s) => one.assignments.get(s.key)!.panel)).toEqual([
      0, 1, 2, 2,
    ]);
  });

  test("prefix stability survives the column break — an append moves nothing", () => {
    const grow = (n: number): LayoutStepInput[] =>
      Array.from({ length: n }, (_, i) => boxed(`s${i}`, 180, 8, 8));
    let prev = foldBoardLayout(grow(1), 3, H, undefined, W, cols);
    for (let n = 2; n <= 24; n++) {
      const next = foldBoardLayout(grow(n), 3, H, undefined, W, cols);
      for (const [key, box] of prev.boxes) {
        expect(next.boxes.get(key)).toEqual(box);
        expect(next.assignments.get(key)).toEqual(prev.assignments.get(key)!);
      }
      prev = next;
    }
  });

  test("an erase wipes every column of the flow and returns the pen to the first", () => {
    const layout = foldBoardLayout(
      [
        boxed("a", 400, 0, 0),
        boxed("b", 400, 0, 0),
        erase("e"),
        boxed("c", 100, 0, 0),
      ],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.eraseOps[0]!.targets).toEqual(["a", "b"]);
    expect(layout.boxes.get("c")).toEqual({ x: 0, y: 0, w: colW });
    expect(layout.panels[0]!.cursor).toBe(100);
  });

  test("`full`'s columns never write over a named region sharing their span", () => {
    // The room's flow carries on BELOW everything in its way — and a named
    // `left` corner is in column 1's way while column 2 is free of it.
    const layout = foldBoardLayout(
      [
        at("a1", "left"),
        boxed("named", 200, 0, 0),
        { kind: "turn", key: "t" },
        boxed("flow1", 100, 0, 0),
        boxed("flow2", 700, 0, 0),
      ],
      1,
      H,
      undefined,
      W,
      cols,
    );
    // The turn is a full wall on a one-board lecture, so the pen stays and
    // the flow writes on the same face as the named region.
    expect(layout.boxes.get("named")).toEqual({ x: 0, y: 0, w: colW });
    // Column 1 starts BELOW the standing `left` box...
    expect(layout.boxes.get("flow1")!.x).toBe(0);
    expect(layout.boxes.get("flow1")!.y).toBe(200);
    // ...and column 2 starts at the TOP, because `left` is not in its way.
    expect(layout.boxes.get("flow2")).toEqual({
      x: colW + REGION_GUTTER,
      y: 0,
      w: colW,
    });
  });

  test("NO collision is reported between the flow and the half it never reached", () => {
    // The other half of the same story, judged by the predicate the author
    // actually sees (`check-board`). Pre-W2 a `full` box claimed the whole
    // face, so a right-hand placement was always reported as collided with
    // the opening prose; that was a false positive by construction.
    const inputs: LayoutStepInput[] = [
      boxed("flow", 200, 0, 0),
      at("a1", "right"),
      boxed("named", 200, 0, 0),
    ];
    const layout = foldBoardLayout(inputs, 1, H, undefined, W, cols);
    expect(detectCollisions(standingBoxes(layout, inputs))).toEqual([]);
    // And the TRUE positive still fires: `left` shares column 1's span.
    const left: LayoutStepInput[] = [
      boxed("flow", 200, 0, 0),
      at("a1", "left"),
      boxed("named", 200, 0, 0),
    ];
    const hit = foldBoardLayout(left, 1, H, undefined, W, cols);
    const found = detectCollisions(standingBoxes(hit, left));
    expect(found.length).toBe(1);
    expect([found[0]!.a.region, found[0]!.b.region].sort()).toEqual([
      "full",
      "left",
    ]);
  });

  test("a CENTREPIECE takes the whole face and pushes every column down", () => {
    const face: LayoutStepInput = {
      kind: "content",
      key: "formula",
      height: 120,
      box: { h: 120, marginTop: 0, marginBottom: 0 },
      span: "face",
    };
    const layout = foldBoardLayout(
      [boxed("a", 100, 0, 0), face, boxed("b", 100, 0, 0), boxed("c", 500, 0, 0)],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.boxes.get("formula")).toEqual({ x: 0, y: 100, w: W });
    // The next flow box carries on below it in column 1...
    expect(layout.boxes.get("b")).toEqual({ x: 0, y: 220, w: colW });
    // ...and column 2 starts below it too — the formula is in its way.
    expect(layout.boxes.get("c")).toEqual({
      x: colW + REGION_GUTTER,
      y: 220,
      w: colW,
    });
  });

  test("board membership does NOT depend on being handed a face width", () => {
    // The fold's standing parity rule, extended to columns: the glance
    // folds with no geometry at all, and it must reach the same boards the
    // rebuild does. Membership is charge-driven; `columns` is a parameter,
    // never derived from `frameWidth`.
    const steps = [0, 1, 2, 3, 4].map((i) => content(`s${i}`, 300));
    const withGeom = foldBoardLayout(steps, 3, H, undefined, W, cols);
    const without = foldBoardLayout(steps, 3, H, undefined, 0, cols);
    for (const s of steps) {
      expect(without.assignments.get(s.key)!.panel).toBe(
        withGeom.assignments.get(s.key)!.panel,
      );
    }
    expect(without.columns).toBe(cols);
  });

  test("`@turn` records the SOURCE board's fill, not the destination's", () => {
    const layout = foldBoardLayout(
      [content("a", 140), { kind: "turn", key: "t" }, content("b", 700)],
      2,
      H,
      undefined,
      W,
      cols,
    );
    // 140 charged against a capacity of 2 x 700.
    expect(layout.turns[0]!.fill).toBeCloseTo(0.1, 10);
    expect(layout.turns[0]!.panel).toBe(1); // the destination, unchanged
  });

  test("a fill fraction is never a fraction of infinity", () => {
    const layout = foldBoardLayout(
      [content("a", 140), { kind: "turn", key: "t" }],
      1,
      Infinity,
      undefined,
      W,
      1,
    );
    expect(layout.turns[0]!.fill).toBe(1);
  });

  // The two calibration points of `turnUnderfilled`, stated as LAYOUTS
  // rather than as numbers — the finding's threshold and the fold's fill
  // are one instrument, and either drifting alone is the regression. The
  // reading below the threshold is the whole reason W5 re-calibrated it:
  // before, a lecture could fill one column of two, walk, repeat on every
  // board, and be told nothing.
  test("walking away with a whole column still blank is said back", () => {
    const layout = foldBoardLayout(
      // Column 1 filled to its budget, column 2 never touched.
      [content("a", H), { kind: "turn", key: "t" }, content("b", 100)],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.turns[0]!.fill).toBeCloseTo(0.5, 10);
    expect(layout.turns[0]!.fill).toBeLessThan(TURN_UNDERFILL_THRESHOLD);
  });

  test("walking away with the last column more than half written is not", () => {
    const layout = foldBoardLayout(
      // Column 1 full, column 2 written past its own half: 1.6 of 2.
      [
        content("a", H),
        content("b", H * 0.6),
        { kind: "turn", key: "t" },
        content("c", 100),
      ],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.turns[0]!.fill).toBeCloseTo(0.8, 10);
    expect(layout.turns[0]!.fill).toBeGreaterThan(TURN_UNDERFILL_THRESHOLD);
  });

  test("two full columns of a three-column face are still under-filled", () => {
    // One number has to read every face the room can stand. At three
    // columns, walking with a third of the board blank is the same waste.
    const layout = foldBoardLayout(
      [content("a", H), content("b", H), { kind: "turn", key: "t" }],
      2,
      H,
      undefined,
      W,
      3,
    );
    expect(layout.turns[0]!.fill).toBeCloseTo(2 / 3, 10);
    expect(layout.turns[0]!.fill).toBeLessThan(TURN_UNDERFILL_THRESHOLD);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// W9 (2026-08-12) — OCCUPANCY COUNTS WHAT STANDS ON THE FACE
//
// The instrument that lied. `fill` summed the flow's column cursors, and
// `place()` charged those only on the `full` path — so ink an `@at` put in a
// named region charged NOTHING, and a board composed entirely of placements
// reported near-zero while standing visibly full. Three independent field
// hits, and the third author had to photograph every board by hand because
// the number they were handed was false.
//
// The four calibration numbers above are UNCHANGED by this fix and that is
// deliberate: on a face whose ink is all in the room's own flow, the union
// of its written columns IS Σ cursors / (columns × budget). What is new is
// that the union also sees the regions — and one honest correction that
// falls out of it, pinned below: a single column charged to twice the budget
// used to clamp to 1.0 ("full") on a board whose other column was blank.
// ────────────────────────────────────────────────────────────────────────────

describe("the face's occupancy (W9)", () => {
  const at = (key: string, region: RegionName): LayoutStepInput => ({
    kind: "at",
    key,
    region,
  });

  const W = 1154;
  const H = 700;
  const cols = 2;

  /** The shape of every field report: two pools set side by side. */
  const pools = (leftH: number, rightH: number): LayoutStepInput[] => [
    at("a1", "left"),
    content("l", leftH),
    at("a2", "right"),
    content("r", rightH),
  ];

  test("a board written entirely with `@at` is not an empty board", () => {
    // THE DEFECT, stated. Both halves written to 80% of the face's depth:
    // the board is 80% written on, and used to report 0%.
    const layout = foldBoardLayout(
      pools(H * 0.8, H * 0.8),
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.panels[0]!.fill).toBeCloseTo(0.8, 10);
    // …and the flow's own cursor still says what it always said: nothing
    // was placed in it. The two fields answer two different questions.
    expect(layout.panels[0]!.cursor).toBe(0);
  });

  test("two pools that fill the face read as a full board", () => {
    const layout = foldBoardLayout(pools(H, H), 2, H, undefined, W, cols);
    expect(layout.panels[0]!.fill).toBe(1);
  });

  test("half the face written in one half-width region reads as half", () => {
    const layout = foldBoardLayout(
      [at("a1", "left"), content("l", H)],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.panels[0]!.fill).toBeCloseTo(0.5, 10);
  });

  test("a full `top` band is half a board, and a corner a quarter", () => {
    const band = foldBoardLayout(
      [at("a1", "top"), content("t", H / 2)],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(band.panels[0]!.fill).toBeCloseTo(0.5, 10);
    const corner = foldBoardLayout(
      [at("a1", "top-left"), content("t", H / 2)],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(corner.panels[0]!.fill).toBeCloseTo(0.25, 10);
  });

  test("overlapping claims are counted ONCE — the union, never the sum", () => {
    // Design §5.2 ratifies the overlap: `full` and `left` may both hold
    // ink. A sum would read 1.0 here (and 1.5 with the corner below) for a
    // board whose right half is bare.
    const layout = foldBoardLayout(
      [content("flow", H), at("a1", "left"), content("l", H)],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.panels[0]!.fill).toBeCloseTo(0.5, 10);
  });

  test("no charge, however large, drives the reading past 1", () => {
    // Not a clamp: the union of spans inside the unit face cannot exceed
    // it. Every region on the board, each charged four faces deep.
    const words: RegionName[] = [
      "left",
      "right",
      "top",
      "bottom",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ];
    const inputs: LayoutStepInput[] = [content("flow", H * 4)];
    for (const [i, word] of words.entries()) {
      inputs.push(at(`a${i}`, word), content(`c${i}`, H * 4));
    }
    const layout = foldBoardLayout(inputs, 2, H, undefined, W, cols);
    expect(layout.panels[0]!.fill).toBe(1);
  });

  test("a board over-charged in ONE column stops reading as full", () => {
    // The one existing reading this fix changes, and it changes toward the
    // truth: Σ/(N×budget) clamped to 1, so a single column charged to twice
    // the budget said "full" about a board with a blank column beside it.
    const layout = foldBoardLayout(
      [content("a", H * 2)],
      1,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.panels[0]!.fill).toBeCloseTo(0.5, 10);
  });

  test("an erase of a region gives its room back", () => {
    const layout = foldBoardLayout(
      [
        at("a1", "left"),
        content("l", H),
        at("a2", "right"),
        content("r", H),
        erase("e", "l"),
      ],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.panels[0]!.fill).toBeCloseTo(0.5, 10);
    expect(layout.regions.get("0:left")!.cursor).toBe(0);
    expect(layout.regions.get("0:right")!.cursor).toBe(H);
  });

  test("the reading does NOT depend on being handed a face width", () => {
    // THE PARITY THAT DECIDES THE WHOLE DESIGN. `viewer/glance.ts` folds
    // with `frameWidth = 0` — membership needs no geometry — so an
    // occupancy computed from `resolveRegionRect`'s pixels would be
    // garbage on the very surface an author reads it from. Occupancy is
    // measured on the unit face, and these two folds are the proof.
    const inputs = [
      ...pools(H * 0.8, H * 0.6),
      content("more", H * 0.2),
      { kind: "turn", key: "t" } as LayoutStepInput,
    ];
    const withGeom = foldBoardLayout(inputs, 2, H, undefined, W, cols);
    const without = foldBoardLayout(inputs, 2, H, undefined, 0, cols);
    expect(without.panels.map((p) => p.fill)).toEqual(
      withGeom.panels.map((p) => p.fill),
    );
    expect(without.turns[0]!.fill).toBe(withGeom.turns[0]!.fill);
  });

  test("`fill` and `turns[].fill` are ONE number, read at two moments", () => {
    // An author reads the glance's percentage and the finding's percentage
    // minutes apart; they may not disagree. The turn reads the source
    // board before the walk, so the destination's later ink cannot move it.
    const inputs: LayoutStepInput[] = [
      ...pools(H * 0.5, H * 0.5),
      { kind: "turn", key: "t" },
      content("next", H),
    ];
    const layout = foldBoardLayout(inputs, 2, H, undefined, W, cols);
    expect(layout.turns[0]!.fill).toBeCloseTo(0.5, 10);
    expect(layout.panels[0]!.fill).toBe(layout.turns[0]!.fill);
  });

  test("a placement-composed board is no longer accused of being abandoned", () => {
    // The interaction that made this urgent: the threshold was raised to
    // 0.75, which WIDENED the window in which a board written entirely
    // with `@at` was falsely called half-written. Both legs pinned — the
    // full pair goes quiet, the thin pair still speaks.
    const written = foldBoardLayout(
      [...pools(H * 0.9, H * 0.9), { kind: "turn", key: "t" }],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(written.turns[0]!.fill).toBeGreaterThan(TURN_UNDERFILL_THRESHOLD);
    const thin = foldBoardLayout(
      [...pools(H * 0.3, H * 0.3), { kind: "turn", key: "t" }],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(thin.turns[0]!.fill).toBeLessThan(TURN_UNDERFILL_THRESHOLD);
  });

  test("the strip has no bottom, so it still has no fill", () => {
    const layout = foldBoardLayout(
      [at("a1", "left"), content("l", 4000), { kind: "turn", key: "t" }],
      1,
      Infinity,
      undefined,
      W,
      1,
    );
    expect(layout.panels[0]!.fill).toBe(1);
    expect(layout.turns[0]!.fill).toBe(1);
  });

  test("a region's charge is the fold's, in the flow's own currency", () => {
    // `RegionRecord.cursor` is what lets the snapshot answer "how much
    // room is left where the pen STANDS" — a named frame's remaining depth
    // is its own, never the board's.
    const layout = foldBoardLayout(
      [at("a1", "right"), content("r1", 120), content("r2", 80)],
      2,
      H,
      undefined,
      W,
      cols,
    );
    expect(layout.regions.get("0:right")!.cursor).toBe(200);
    // The flow's own record carries the columns' sum — `panels[].cursor`.
    expect(layout.regions.get("0:full")?.cursor ?? 0).toBe(0);
  });

  test("ink does not move: charging a region changes no box and no board", () => {
    // The whole fix is ACCOUNTING. A named region never migrates and never
    // runs a fits-in test, so its new cursor can reach no placement
    // decision — pinned against the flow-only control on the same face.
    const inputs: LayoutStepInput[] = [
      boxed("open", 200, 0, 14),
      at("a1", "left"),
      boxed("l1", 300, 0, 14),
      at("a2", "right"),
      boxed("r1", 300, 0, 14),
      boxed("r2", 300, 0, 14),
    ];
    const layout = foldBoardLayout(inputs, 2, H, undefined, W, cols);
    expect([...layout.boxes]).toEqual([
      ["open", { x: 0, y: 0, w: columnWidth(W, cols) }],
      // The author's frame chains on its OWN front (§7.5), so it opens at
      // the top of the face over the flow's box — the overlap design §5.2
      // ratifies. Unchanged by W9, and that is the point of the test.
      ["l1", { x: 0, y: 0, w: columnWidth(W, cols) }],
      ["r1", { x: W - columnWidth(W, cols), y: 0, w: columnWidth(W, cols) }],
      ["r2", { x: W - columnWidth(W, cols), y: 314, w: columnWidth(W, cols) }],
    ]);
    expect([...layout.assignments].map(([k, a]) => [k, a.panel, a.region])).toEqual([
      ["open", 0, "full"],
      ["l1", 0, "left"],
      ["r1", 0, "right"],
      ["r2", 0, "right"],
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// W2b (2026-08-12) — THE MEASURE PASS'S OWN WIDTH
//
// A step's ink is measured at BUILD time: an underline is the set of line
// boxes its run occupied. So the hidden host a node is built in has to be
// as wide as the box it will stand in, or the run wraps somewhere the
// reader never sees it wrap and the ink is drawn for a line that does not
// exist. `scanBoxRects` is the one answer to "how wide is this box", and it
// answers WITHOUT heights — which is what lets the measure pass run before
// the fold (design §7.2).
// ────────────────────────────────────────────────────────────────────────────

describe("scanBoxRects — the width the measure pass must present (W2b)", () => {
  const W = 1154;
  const H = 700;
  const cols = 2;
  const colW = columnWidth(W, cols);
  const face = { faceW: W, faceH: H, columns: cols };

  const say = (key: string, region: RegionName): LayoutStepInput => ({
    kind: "at",
    key,
    region,
  });
  const step = (key: string, span?: "face"): LayoutStepInput => ({
    kind: "content",
    key,
    height: 0,
    ...(span !== undefined ? { span } : {}),
  });

  test("the room's own flow is ONE COLUMN wide, not the whole face", () => {
    // The defect this pins: the host presented the face (1154) while the
    // box stood in a column (565), so every wrapped emphasis drew one
    // overshooting row and left its continuation bare.
    const rects = scanBoxRects([step("a"), step("b")], face);
    expect(rects.get("a")!.w).toBe(colW);
    expect(rects.get("b")!.w).toBe(colW);
    expect(colW).toBeLessThan(W);
  });

  test("a centrepiece keeps the whole face", () => {
    const rects = scanBoxRects([step("title", "face"), step("body")], face);
    expect(rects.get("title")!.w).toBe(W);
    expect(rects.get("body")!.w).toBe(colW);
  });

  test("a named region claims exactly what the region table says", () => {
    const rects = scanBoxRects(
      [say("p1", "right"), step("a"), say("p2", "top-left"), step("b")],
      face,
    );
    // §3.2's table, reached through `resolveRegionRect` — the same numbers
    // the fold places the box at, so the two can never disagree.
    expect(rects.get("a")).toEqual({ x: W - (W - REGION_GUTTER) / 2, y: 0, w: (W - REGION_GUTTER) / 2, h: H });
    expect(rects.get("b")).toEqual({ x: 0, y: 0, w: (W - REGION_GUTTER) / 2, h: (H - REGION_GUTTER) / 2 });
  });

  test("`@turn` returns the pen to the room's flow", () => {
    const rects = scanBoxRects(
      [say("p", "right"), step("a"), { kind: "turn", key: "t" }, step("b")],
      face,
    );
    expect(rects.get("a")!.w).toBe((W - REGION_GUTTER) / 2);
    expect(rects.get("b")!.w).toBe(colW);
  });

  test("on a strip the flow is one column, so the face IS the width", () => {
    const strip = { faceW: W, faceH: Infinity, columns: 1 };
    expect(scanBoxRects([step("a")], strip).get("a")!.w).toBe(W);
  });

  test("the scan and the FOLD agree on every box's width, step for step", () => {
    // The whole point of one implementation: whatever the measure pass
    // presented, the fold places the box at the same number. A second copy
    // of the column arithmetic would show up here and nowhere else — the
    // symptom on screen is silent.
    const steps: LayoutStepInput[] = [
      {
        kind: "content",
        key: "title",
        height: 100,
        box: { h: 100, marginTop: 0, marginBottom: 0 },
        span: "face",
      },
      boxed("a", 300, 0, 0),
      boxed("b", 300, 0, 0),
      boxed("c", 300, 0, 0),
      say("p", "bottom-right"),
      boxed("d", 100, 0, 0),
    ];
    const rects = scanBoxRects(steps, face);
    const layout = foldBoardLayout(steps, 2, H, undefined, W, cols);
    for (const [key, box] of layout.boxes) {
      expect(box.w).toBe(rects.get(key)!.w);
    }
    expect(layout.boxes.size).toBe(5);
  });
});
