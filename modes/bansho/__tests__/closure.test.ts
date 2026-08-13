/**
 * T6 — the select → view → point closure, walked end to end.
 *
 * The ViewerAddress contract exists so that ONE noun serves every verb: the
 * user picks a step, the agent is told which one, and the agent can hand
 * that same value straight back to `navigate-to`, to `capture`, or into a
 * `<viewer-locator>` card. This file walks the whole loop over a real
 * lecture, because every previous per-piece test can pass while the loop
 * itself is broken at a seam.
 *
 * The seams it pins:
 *  1. a click produces a `data-bansho-ref` key that resolves to a step;
 *  2. the selection reported to the shell carries `address` (the shell's
 *     own selection mapping drops it — the store keeps it, and that is the
 *     path `extractContext` reads);
 *  3. the `<viewer-context>` block prints that address verbatim;
 *  4. the address parsed back out of the block resolves to the SAME step;
 *  5. `capture` treats it as a coarse address and navigates first — without
 *     that it silently screenshots whatever is on screen.
 */

import { describe, expect, test } from "bun:test";

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { buildTimeline } from "../engine/timeline.js";
import {
  parseStepKey,
  resolveAddress,
  stepKey,
  toAddress,
} from "../viewer/address.js";
import { buildViewerContext, selectionForStep } from "../viewer/context.js";

const SOURCE = `# Why this cycle is different

An opening line before any section.

## Supply

Data-centre revenue tripled to ==87.4B==.

- Demand: three times
- Supply: constrained

\`\`\`chart revenue
x: 2023Q1 .. 2024Q4  (quarter)
y: 0 .. 40  (billion)
+ NVIDIA: 7.2 10.3 14.5 18.4 22.6 26.0 30.8 35.6
\`\`\`
`;

const files: ViewerFileContent[] = [{ path: "board.md", content: SOURCE }];
const lecture = parseLecture(SOURCE);
const timeline = buildTimeline(lecture, { durations: DEFAULT_DURATIONS });

/** The address printed in a `<viewer-context>` block, parsed back out. */
function addressFromContext(block: string): unknown {
  const line = block.split("\n").find((l) => l.startsWith("Address: "));
  return line ? JSON.parse(line.slice("Address: ".length)) : null;
}

describe("every step on the board survives the full round trip", () => {
  test("click key → address → context block → address → the same step", () => {
    let checked = 0;
    for (let s = 0; s < lecture.sections.length; s++) {
      const section = lecture.sections[s]!;
      const refs = section.heading ? [{ section: s, step: -1 }] : [];
      section.steps.forEach((_, i) => refs.push({ section: s, step: i }));

      for (const ref of refs) {
        // 1. the click
        const clicked = parseStepKey(stepKey(ref));
        expect(clicked).toEqual(ref);

        // 2. what the shell is told
        const selection = selectionForStep(lecture, clicked!)!;
        expect(selection).not.toBeNull();
        expect(selection.address).toEqual(toAddress(ref));
        expect(selection.content.length).toBeGreaterThan(0);

        // 3. what the agent reads
        const block = buildViewerContext(selection, files, {
          t: timeline.duration / 2,
          duration: timeline.duration,
          follow: "detached",
          playing: false,
          schedule: timeline.schedule,
        });
        const echoed = addressFromContext(block);
        expect(echoed).toEqual(toAddress(ref));

        // 4. what the agent hands back
        expect(resolveAddress(lecture, echoed as Record<string, unknown>)).toEqual(
          ref,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe("the framework's half of the loop", () => {
  test("capture navigates before it shoots for a bansho address", async () => {
    // `useCaptureAction` drives `navigateRequest` first only for address
    // keys it recognises as COARSE. A bansho step is a MOMENT in a lecture,
    // so reaching it is always a navigation — leave those keys out and
    // `capture {address:{section,step}}` silently returns the current
    // viewport instead of the step it was asked for.
    const hook = await Bun.file(
      new URL("../../../src/hooks/useCaptureAction.ts", import.meta.url).pathname,
    ).text();
    const list = hook.match(/const COARSE_ADDRESS_KEYS = \[([^\]]+)\]/)?.[1] ?? "";
    expect(list).toContain('"section"');
    expect(list).toContain('"step"');
  });

  test("the viewer-context wrapper is the shape src/ws.ts post-processes", async () => {
    const block = buildViewerContext(
      selectionForStep(lecture, { section: 1, step: 0 }),
      files,
      null,
    );
    const ws = await Bun.file(
      new URL("../../../src/ws.ts", import.meta.url).pathname,
    ).text();
    // ws.ts injects `content-set="…"` after this exact prefix and rewrites
    // the first `file="…"`; a block shaped differently loses both silently.
    expect(ws).toContain('startsWith("<viewer-context ")');
    expect(block.startsWith("<viewer-context ")).toBe(true);
    expect(/file="[^"]+"/.test(block)).toBe(true);
  });
});
