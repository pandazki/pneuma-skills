/**
 * §4.3 并列对齐 — the alignShift seam and the spacer-insertion protocol
 * (T4). The factory inserts a `.bansho-align-spacer` marker exactly after
 * the separator (at a reveal-segment boundary), sized by the host's
 * `MeasureContext.alignShift`; mid-segment separators degrade to no marker
 * rather than splitting a written word.
 */

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { factoryFor } from "../engine/factories/index.js";
import { flattenSteps } from "../engine/inference.js";
import type { MeasureContext, Step } from "../engine/types.js";

function makeCtx(alignShift?: (step: Step) => number | undefined): MeasureContext {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const measureHost = doc.createElement("div");
  doc.body.appendChild(measureHost);
  return {
    durations: DEFAULT_DURATIONS,
    document: doc,
    measureHost,
    env: { handwritingFontActive: true, strokeFontCovers: () => false },
    container: () => undefined,
    ...(alignShift ? { alignShift } : {}),
  };
}

function buildListItem(source: string, ctx: MeasureContext, index = 0) {
  const lecture = parseLecture(source);
  const items = flattenSteps(lecture).filter(
    (e) => e.step.kind === "list-item",
  );
  const step = items[index]!.step;
  const { node } = factoryFor(step.kind)!.build(step, ctx);
  return { step, node };
}

describe("align spacer — insertion protocol", () => {
  test("spaced colon: marker lands right after the separator, sized by the seam", () => {
    const src = "- 需求: 三倍\n- 供给: 受限\n";
    const ctx = makeCtx(() => 24);
    const { node } = buildListItem(src, ctx);
    const spacer = node.querySelector<HTMLElement>(".bansho-align-spacer");
    expect(spacer).not.toBeNull();
    expect(spacer!.style.width).toBe("24px");
    // Everything before the spacer is the label ("需求:"), value after.
    const text = node.querySelector(".bansho-text")!;
    const before: string[] = [];
    let seen = false;
    for (const child of Array.from(text.childNodes)) {
      if (child === spacer) {
        seen = true;
        continue;
      }
      (seen ? [] : before).push(child.textContent ?? "");
    }
    expect(seen).toBe(true);
    expect(before.join("")).toBe("需求:");
  });

  test("probe build (no seam) still inserts a zero-width marker", () => {
    const ctx = makeCtx();
    const { node } = buildListItem("- 速度 — 快\n- 成本 — 低\n", ctx);
    const spacer = node.querySelector<HTMLElement>(".bansho-align-spacer");
    expect(spacer).not.toBeNull();
    expect(spacer!.style.width).toBe("0px");
  });

  test("fullwidth colon glued to a CJK value gets its marker — the colon is an I9 cut char", () => {
    // §4.3's own example is `- R:自反性 — 成立`: natural Chinese glues the
    // fullwidth colon to the value. The segmenter cuts after label colons
    // (every parity), so the marker's offset always lands on a boundary.
    const ctx = makeCtx(() => 24);
    const { node } = buildListItem("- 需求：三倍\n- 供给：受限\n", ctx);
    const spacer = node.querySelector<HTMLElement>(".bansho-align-spacer");
    expect(spacer).not.toBeNull();
    expect(spacer!.style.width).toBe("24px");
  });

  test("a separator INSIDE a Latin word degrades to NO marker (never split a written word)", () => {
    // "alpha:one" is a single Latin token — one segment. Splitting it to
    // host a column marker would tear a written word apart, so the item
    // degrades to no marker (the residual, legitimate degrade case).
    const ctx = makeCtx(() => 24);
    const { node } = buildListItem("- alpha:one\n- beta:two\n", ctx);
    expect(node.querySelector(".bansho-align-spacer")).toBeNull();
  });

  test("spacer is not a reveal target and does not disturb segment spans", () => {
    const ctx = makeCtx(() => 30);
    const { node, step } = buildListItem("- 需求: 三倍\n- 供给: 受限\n", ctx);
    const spans = Array.from(node.querySelectorAll(".bansho-w"));
    expect(spans.some((s) => s.classList.contains("bansho-align-spacer"))).toBe(
      false,
    );
    // Full text is still byte-for-byte reconstructable from the walk.
    if (step.kind !== "list-item") throw new Error("expected list item");
    const text = node.querySelector(".bansho-text")!;
    expect(text.textContent).toBe("需求: 三倍");
  });

  test("non-aligned items and prose never carry a spacer", () => {
    const ctx = makeCtx(() => 24);
    const { node } = buildListItem("- 只有一个条目没有分隔符\n", ctx);
    expect(node.querySelector(".bansho-align-spacer")).toBeNull();
  });
});
