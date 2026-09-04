/**
 * The H3 prompt, pinned — because it is a practice, not a whim.
 *
 * Every rule here was paid for: the community's published prompts, the
 * FINAL BET reproduction on fal, and the W1 writer trial (all
 * 2026-09-04, recorded in references/h3-best-practices.md). The shape is
 * the four-block montage grammar — style anchor verbatim, a time-coded
 * shot list with a bracketed camera per cut, the narration distributed
 * in `<d>` tags, the audio under the voice, the negatives last.
 *
 * The two things this file guards hardest are the two that were wrong
 * before 0.6: a montage must be allowed to CUT (the old prompt opened
 * with "One continuous shot, no cuts"), and a knowledge figure must be
 * drawn into the scene rather than pasted flat.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CAMERA,
  H3_PRACTICES_VERSION,
  bindingLines,
  buildClipPrompt,
  clipScript,
  defaultCamera,
  insertReferenceBlock,
  negativesFor,
  normalizeCuts,
  normalizeNarration,
  styleHasPeople,
} from "../skill/scripts/h3-prompt.mjs";
import type { ClipDraft } from "../skill/scripts/h3-prompt.d.mts";

const RECIPE =
  "Stop-motion paper cutout animation, 16:9. Palette: layered colored card — kraft brown (#c9a373), coral (#e57a5a), teal (#3d8c8c). Material: visible paper fiber and cut edges. Light: a soft overhead lamp.";

const clip: ClipDraft = {
  duration: 15,
  theme: "用会繁殖的纸片硬币表现利息生利息",
  cuts: [
    { from: 0, to: 3, shot: "一枚芥末黄色纸片硬币静置在米白色纸面上", camera: "俯拍" },
    { from: 3, to: 9, shot: "珊瑚色硬币从它边缘弹出，两枚一起向前滑动", camera: "缓慢推进" },
    { from: 9, to: 15, shot: "硬币沿青绿纸带堆高，纸带末端突然变陡", camera: "横移" },
  ],
  narration: [
    { from: 0, to: 4, text: "本金先生出利息。" },
    { from: 5, to: 10, text: "下一轮，利息也开始生利息。" },
    { from: 11, to: 15, text: "所以曲线越来越陡。" },
  ],
  audio: "全程轻微纸张摩擦；3 秒硬币弹出时一声清脆纸响",
  negatives: "不要出现真实金属硬币、渐变、塑料质感",
};

describe("buildClipPrompt", () => {
  test("the four blocks, in order, with the style anchor verbatim", () => {
    const p = buildClipPrompt({ styleRecipe: RECIPE, narration: "voiceover", language: "zh", clip });
    expect(p.startsWith(`1. Style anchor: ${RECIPE}`)).toBe(true);
    expect(p).toContain("Subject: 用会繁殖的纸片硬币表现利息生利息。");
    const order = ["1. Style anchor:", "2. Shot list", "3. Narration", "4. Audio:", "5. Do not show:"].map((h) => p.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  test("the shot list is time-coded, one line per cut, each with a bracketed camera", () => {
    const p = buildClipPrompt({ styleRecipe: RECIPE, narration: "voiceover", language: "zh", clip });
    expect(p).toContain("2. Shot list — 3 cuts in 15s, cut on the times given:");
    expect(p).toContain("0-3s Cut 1: 一枚芥末黄色纸片硬币静置在米白色纸面上。 [俯拍]");
    expect(p).toContain("9-15s Cut 3: 硬币沿青绿纸带堆高，纸带末端突然变陡。 [横移]");
    // A montage cuts. The 0.5 prompt forbade exactly this, and that one
    // clause is most of why the courses looked like talking illustrations.
    expect(p).not.toContain("One continuous shot");
    expect(p).not.toContain("no cuts");
    expect(p).not.toContain("hard cuts");
  });

  test("the narration is distributed across the timeline in tagged lines", () => {
    const p = buildClipPrompt({ styleRecipe: RECIPE, narration: "voiceover", language: "zh", clip });
    expect(p).toContain("3. Narration — off-screen voiceover; no one on screen opens their mouth:");
    expect(p).toContain("0-4s <d>[Chinese]本金先生出利息。</d>");
    expect(p).toContain("11-15s <d>[Chinese]所以曲线越来越陡。</d>");
    // Nothing numbers a reference at writing time.
    expect(p).not.toMatch(/Image \d|Audio \d/);
  });

  test("audio never carries music, and the writer's negatives ride after the standing ones", () => {
    const p = buildClipPrompt({ styleRecipe: RECIPE, narration: "voiceover", language: "zh", clip });
    expect(p).toContain("4. Audio: 全程轻微纸张摩擦；3 秒硬币弹出时一声清脆纸响。 Nothing louder than the voice, and no music.");
    expect(p.trimEnd().endsWith("不要出现真实金属硬币、渐变、塑料质感。")).toBe(true);
    expect(p).toContain("5. Do not show: any on-screen text, labels, formulas or numbers");
  });

  test("a speaker on screen is S1 and brings the people negatives", () => {
    const p = buildClipPrompt({
      styleRecipe: "Live-action lesson with a warm, credible instructor speaking to camera, 16:9.",
      narration: "on-camera",
      language: "en",
      clip: {
        ...clip,
        narration: [{ from: 0, to: 6, text: "So the only question left is how far apart they are." }],
        negatives: "",
      },
    });
    expect(p).toContain("3. Narration — the speaker (S1) is in frame at medium distance and their lips are in sync with the words:");
    expect(p).toContain("0-6s <d>[English]So the only question left is how far apart they are.</d>");
    expect(p).toContain("extra fingers or limbs; deformed hands or faces; a second speaker; lips out of sync with the words.");
  });

  test("a figure is drawn into the cut that shows it, never pasted flat", () => {
    const p = buildClipPrompt({
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      clip: { ...clip, cuts: [{ ...clip.cuts[0], figures: ["evidence/b2/curve.png"] }, clip.cuts[1], clip.cuts[2]] },
    });
    expect(p).toContain(
      '(The reference figure "curve.png" appears in this cut, drawn in the scene\'s own materials and filling the frame — not pasted as a flat picture — with every label, axis and number reproduced faithfully and unaltered.)',
    );
    // With a figure on screen the text negative admits what the figure carries.
    expect(p).toContain("beyond what this prompt spells out in quotes or the reference figure carries");
    // The clause that made the model paste a flat picture is gone for good.
    expect(p).not.toContain("objects or shapes the prompt did not describe");
  });

  test("a clip of a multi-part scene says so, off screen", () => {
    const p = buildClipPrompt({
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      clip,
      part: { index: 2, total: 3, sceneGoal: "利息生利息" },
    });
    expect(p).toContain("This is part 2 of 3 of one continuous scene about 利息生利息: the same set, materials, palette and lighting as the other parts. Never shown on screen.");
    const solo = buildClipPrompt({ styleRecipe: RECIPE, narration: "voiceover", language: "zh", clip, part: { index: 1, total: 1 } });
    expect(solo).not.toContain("This is part");
  });
});

describe("normalizeCuts", () => {
  test("clamps to the clip, carries the last cut to the end, names a missing camera", () => {
    const { cuts, problems } = normalizeCuts(
      [
        { from: 0, to: 4, shot: "a", camera: "俯拍" },
        { from: 4, to: 20, shot: "b" },
        { shot: "" },
      ],
      15,
      { where: "scene 1 clip 1", language: "zh" },
    );
    expect(cuts).toEqual([
      { from: 0, to: 4, shot: "a", camera: "俯拍" },
      { from: 4, to: 15, shot: "b", camera: "固定镜头" },
    ]);
    expect(problems.some((p) => p.includes("clip 1 cut 2: ends past the clip's 15s"))).toBe(true);
    expect(problems.some((p) => p.includes("clip 1 cut 2: no camera move"))).toBe(true);
    expect(problems.some((p) => p.includes("cut 3: nothing is described"))).toBe(true);
    expect(normalizeCuts(undefined, 15).cuts).toEqual([]);
    expect(defaultCamera("en")).toBe(DEFAULT_CAMERA);
  });

  test("out-of-order cuts are sorted and figures deduped", () => {
    const { cuts } = normalizeCuts(
      [
        { from: 8, to: 15, shot: "late", camera: "横移", figures: ["a.png", "a.png"] },
        { from: 0, to: 8, shot: "early", camera: "俯拍" },
      ],
      15,
    );
    expect(cuts.map((c) => c.shot)).toEqual(["early", "late"]);
    expect(cuts[1].figures).toEqual(["a.png"]);
    expect(cuts[0].figures).toBeUndefined();
  });
});

describe("normalizeNarration", () => {
  test("timed lines survive; bare strings are spread across the clip and reported", () => {
    const timed = normalizeNarration([{ from: 2, to: 5, text: "二" }, { from: 0, to: 2, text: "一" }], 10);
    expect(timed.narration).toEqual([
      { from: 0, to: 2, text: "一" },
      { from: 2, to: 5, text: "二" },
    ]);
    expect(timed.problems).toEqual([]);

    const bare = normalizeNarration(["一", "二"], 10, { where: "scene 1 clip 1" });
    expect(bare.narration).toEqual([
      { from: 0, to: 5, text: "一" },
      { from: 5, to: 10, text: "二" },
    ]);
    expect(bare.problems[0]).toContain("carried no time span — spread evenly");
  });

  test("the clip's spoken text has one definition, and it joins by script", () => {
    expect(clipScript(clip, "zh")).toBe("本金先生出利息。下一轮，利息也开始生利息。所以曲线越来越陡。");
    expect(clipScript({ narration: [{ from: 0, to: 2, text: "One." }, { from: 2, to: 4, text: "Two." }] }, "en")).toBe("One. Two.");
    expect(clipScript({ narration: [] }, "zh")).toBe("");
  });
});

describe("reference bindings", () => {
  test("images are numbered in order, the voice is Audio 1, and a figure names its cut", () => {
    const lines = bindingLines({
      refs: [
        { file: "style/anchor.png", job: "style-anchor", kind: "image" },
        { file: "style/character-1.png", job: "character", kind: "image" },
        { file: "evidence/b2/curve.png", job: "figure", kind: "image", note: "the two curves", cut: 3 },
        { file: "style/voice.mp3", job: "voice", kind: "audio" },
      ],
      narration: "voiceover",
    });
    expect(lines[0]).toBe("Image 1 is this course's style anchor — its palette, materials, line quality, lighting and set carry over exactly; it is a look reference, not a picture to show.");
    expect(lines[1]).toContain("Image 2 is keep this person's identity");
    expect(lines[2]).toBe('Image 3 is the code-rendered knowledge figure "curve.png" (the two curves). It appears in cut 3, drawn in the scene\'s own materials with every label, axis and number reproduced faithfully and unaltered.');
    expect(lines[3]).toContain("Audio 1 is the narrator's voice");
    expect(bindingLines({ refs: [], narration: "voiceover" })).toEqual([]);
  });

  test("the block lands between the style anchor and the shot list", () => {
    const p = buildClipPrompt({ styleRecipe: RECIPE, narration: "voiceover", language: "zh", clip });
    const bound = insertReferenceBlock(p, ["Image 1 is the anchor.", "Audio 1 is the voice."]);
    expect(bound).toContain("\n\nReference material: Image 1 is the anchor. Audio 1 is the voice.\n\n2. Shot list");
    expect(bound.indexOf("Reference material:")).toBeGreaterThan(bound.indexOf("1. Style anchor:"));
    expect(insertReferenceBlock(p, [])).toBe(p);
    expect(insertReferenceBlock("no blocks here", ["Image 1 is the anchor."])).toBe("no blocks here\n\nReference material: Image 1 is the anchor.");
  });
});

describe("the practice itself", () => {
  test("carries a version every clip is stamped with", () => {
    expect(H3_PRACTICES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  test("people negatives follow what the style shows, not what we hope", () => {
    expect(styleHasPeople({ narration: "voiceover", styleRecipe: RECIPE })).toBe(false);
    expect(styleHasPeople({ narration: "voiceover", styleRecipe: "Hand-drawn ink-line comic with expressive characters" })).toBe(true);
    expect(styleHasPeople({ narration: "on-camera", styleRecipe: RECIPE })).toBe(true);
    // Plurals count: the art-direction recipes say "characters" and "faces".
    expect(styleHasPeople({ narration: "voiceover", styleRecipe: "Claymation with sculpted characters and expressive faces" })).toBe(true);
    expect(styleHasPeople({ narration: "voiceover", styleRecipe: "Real locations, real people at real work" })).toBe(true);
    expect(negativesFor({ narration: "voiceover", styleRecipe: RECIPE, figures: ["evidence/b1/a.png"] })).toContain("or the reference figure carries");
  });
});
