/**
 * The box model, judged offline by the same oracle the re-basing protocol
 * uses (design §12.2 item 3a).
 *
 * `harness/y-oracle.mjs` is the §7.5 model written a second time, on
 * purpose: it runs against a CAPTURE, outside the app, and is what decides
 * whether the positioning engine is faithful. This test closes the loop
 * the other way — it feeds the committed pre-V1 capture's own `h` and
 * margins through `foldBoardLayout` and asserts the fold's boxes land
 * EXACTLY where the oracle says, on all three instrument strips.
 *
 * Why that matters: 3a is run once, by hand, in a browser session that
 * cannot be re-taken. This keeps its arithmetic under `bun test` forever,
 * so a later refactor of the fold cannot quietly break the thing the
 * one-shot measurement proved.
 */

import { describe, expect, test } from "bun:test";

import { oracleTops } from "../harness/y-oracle.mjs";
import type { Capture, CaptureStep } from "../harness/y-oracle.d.mts";
import {
  foldBoardLayout,
  type LayoutStepInput,
} from "../engine/layout.js";

/** Exactly the oracle's own flow-box rule — see y-oracle.mjs. */
const OUT_OF_FLOW = new Set(["bansho-ink", "bansho-backref"]);
const isFlowBox = (s: CaptureStep): boolean =>
  !s.hidden && !!s.rect && !OUT_OF_FLOW.has(s.cls);

function foldInputsFrom(capture: Capture): LayoutStepInput[] {
  const inputs: LayoutStepInput[] = [];
  for (const step of capture.steps) {
    if (!isFlowBox(step)) continue;
    const h = step.rect![3];
    const [marginTop, marginBottom] = step.margins ?? [0, 0];
    inputs.push({
      kind: "content",
      key: step.ref,
      height: h + marginTop + marginBottom,
      box: { h, marginTop, marginBottom },
    });
  }
  return inputs;
}

const STRIPS = ["fourier", "kelly", "brain"] as const;

describe("the fold's boxes vs the y-oracle (pre-V1 capture)", () => {
  for (const strip of STRIPS) {
    test(`${strip}: every box lands exactly where the oracle says`, async () => {
      const capture: Capture = await Bun.file(
        new URL(
          `../harness/layout-baseline/pre-v1/${strip}.json`,
          import.meta.url,
        ),
      ).json();
      const padTop = capture.boardPadding[0];
      const padLeft = capture.boardPadding[3];
      const padRight = capture.boardPadding[1];
      const faceWidth = capture.boardLayoutWidth - padLeft - padRight;

      const layout = foldBoardLayout(
        foldInputsFrom(capture),
        1,
        Infinity,
        undefined,
        faceWidth,
      );
      const oracle = oracleTops(capture, capture);

      expect(oracle.size).toBeGreaterThan(20);
      expect(layout.boxes.size).toBe(oracle.size);
      for (const [ref, want] of oracle) {
        const box = layout.boxes.get(ref);
        expect(box).toBeDefined();
        // The oracle quotes board-BORDER-relative tops; the fold quotes
        // the content face. One padding-top converts between them.
        expect(Math.round((padTop + box!.y) * 100) / 100).toBe(want);
        expect(box!.x).toBe(0);
        expect(box!.w).toBe(faceWidth);
      }
    });

    test(`${strip}: the face extent reproduces the board's own height`, async () => {
      // Design §8 rev 2.1 — absolutely positioned children cannot hold the
      // strip open, so the host writes the height back from THIS number.
      // It must reproduce what CSS flow produced, or the camera's fit and
      // follow arithmetic (which read offsetHeight) drift.
      const capture: Capture = await Bun.file(
        new URL(
          `../harness/layout-baseline/pre-v1/${strip}.json`,
          import.meta.url,
        ),
      ).json();
      const [padTop, padRight, padBottom, padLeft] = capture.boardPadding;
      const layout = foldBoardLayout(
        foldInputsFrom(capture),
        1,
        Infinity,
        undefined,
        capture.boardLayoutWidth - padLeft - padRight,
      );
      const height = padTop + layout.faceExtent[0]! + padBottom;
      // `boardLayoutHeight` is `offsetHeight` — an integer round of the
      // fractional flow height, so the comparison is at that resolution.
      expect(Math.round(height)).toBe(capture.boardLayoutHeight);
    });
  }
});
