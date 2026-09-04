/**
 * The interlude's two derivations: what it says (the sentences of the
 * scene just watched) and what it shows (the frame that scene ended
 * on, or the style anchor when there is none).
 */

import { describe, expect, test } from "bun:test";
import { interludeBackdrop, recapLines } from "../viewer/Interlude.js";

const style = { id: "chalk", status: "confirmed" as const, refImages: ["style/anchor.png", "style/refs/teacher.png"], sample: { image: "style/sample.png" } };

describe("recapLines", () => {
  test("one line per narration line, across the scene's clips, blanks dropped", () => {
    const prev = {
      clips: [
        { narration: [{ from: 0, to: 3, text: " 第一句。 " }, { from: 3, to: 6, text: "" }] },
        { narration: [{ from: 0, to: 4, text: "第二句。" }] },
      ],
      script: "",
    } as never;
    expect(recapLines(prev)).toEqual(["第一句。", "第二句。"]);
  });
  test("a scene without clips recaps by script lines; no scene, nothing", () => {
    expect(recapLines({ clips: [], script: "a\n\nb\n" })).toEqual(["a", "b"]);
    expect(recapLines(null)).toEqual([]);
  });
});

describe("interludeBackdrop", () => {
  test("holds the last frame of the previous scene's last finished clip", () => {
    const prev = { id: "n2", clips: [{ id: "c1", video: { file: "x", duration: 1 } }, { id: "c2", video: { file: "y", duration: 1 } }, { id: "c3" }] } as never;
    expect(interludeBackdrop({ style }, "course", prev)).toEqual({
      image: "/content/course/nodes/n2/c2.last.png",
      fallback: "/content/course/style/anchor.png",
    });
  });
  test("falls back to the anchor, then the sample still, when there is nothing to hold", () => {
    expect(interludeBackdrop({ style }, "", null).image).toBe("/content/style/anchor.png");
    expect(interludeBackdrop({ style: { ...style, refImages: undefined } }, "", { id: "n1", clips: [] }).image).toBe("/content/style/sample.png");
    expect(interludeBackdrop({ style: { id: "", status: "confirmed" } }, "", null)).toEqual({ image: null, fallback: null });
  });
});
