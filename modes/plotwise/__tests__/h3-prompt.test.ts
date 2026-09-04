/**
 * The H3 prompt, pinned — because it is a practice, not a whim. Each
 * rule here is one the community and our own trials paid for: style
 * anchor first and verbatim, a timeline of beats each with a camera, the
 * negatives for what the style shows, sound under the voice. A change
 * here should be a deliberate one, recorded in
 * references/h3-best-practices.md.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CAMERA,
  H3_PRACTICES_VERSION,
  buildShotPrompt,
  hasCameraDirection,
  negativesFor,
  normalizeBeats,
  styleHasPeople,
} from "../skill/scripts/h3-prompt.mjs";

const RECIPE =
  "Elegant mathematical animation, 16:9. Palette: deep navy background (#0b1a3a), curves in glowing white and warm amber (#f5a623). Material: clean vector geometry with a soft bloom. Light: the lines are the light source. Camera drifts gently.";

const shot = {
  script: "系数配好以后，真正剩下的问题就是：原函数和多项式还差多少。",
  visual: "The exponential curve and its Taylor polynomial share the navy grid; their gap glows amber.",
  duration: 7,
  figures: [] as string[],
};

describe("buildShotPrompt", () => {
  test("opens on the style anchor, verbatim, and closes on the negatives", () => {
    const p = buildShotPrompt({ styleRecipe: RECIPE, narration: "voiceover", language: "zh", shot });
    const [description, soundscape, music] = p.split("\n");
    expect(description.startsWith("integrated_multimodal_description: [Shot 1] One continuous shot, no cuts. Style anchor: ")).toBe(true);
    expect(description).toContain(RECIPE);
    expect(description.indexOf(RECIPE)).toBeLessThan(description.indexOf(shot.visual));
    expect(description.trimEnd().endsWith("soft dissolves, morphs or hard cuts; camera shake.")).toBe(true);
    expect(soundscape).toBe("overall_soundscape: Quiet ambience matched to the scene, low enough that the narration stays the focus.");
    expect(music).toBe("non_diegetic_music: N/A");
    // The narration rides verbatim in the tagged clause; nothing numbers a reference here.
    expect(p).toContain(`<d>[Chinese] ${shot.script}</d>`);
    expect(p).not.toMatch(/Image \d|Audio \d/);
  });

  test("a visual with no camera gets the default move; one that names a camera keeps it", () => {
    const plain = buildShotPrompt({ styleRecipe: RECIPE, narration: "voiceover", language: "zh", shot });
    expect(plain).toContain(DEFAULT_CAMERA.charAt(0).toUpperCase() + DEFAULT_CAMERA.slice(1));
    const own = buildShotPrompt({
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      shot: { ...shot, visual: "The gap glows amber as the camera pushes in slowly with small amplitude." },
    });
    expect(own).not.toContain(DEFAULT_CAMERA);
    expect(hasCameraDirection("the camera drifts left")).toBe(true);
    expect(hasCameraDirection("a curve glows")).toBe(false);
  });

  test("beats become a timeline inside one take, each with its camera", () => {
    const p = buildShotPrompt({
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      shot: {
        ...shot,
        beats: [
          { from: 0, to: 2, action: "the two curves overlap near the center", camera: "the camera holds still" },
          { from: 2, to: 5, action: "the gap between them begins to glow amber" },
          { from: 5, to: 7, action: "the amber gap settles as the brightest element", camera: "the camera comes to rest" },
        ],
        sound: "a faint low room hum and a soft crystalline shimmer as the gap lights up at 3s",
      },
    });
    expect(p).toContain("Timeline of this one continuous take: 0-2s — the two curves overlap near the center. The camera holds still. 2-5s — the gap between them begins to glow amber.");
    // The beat without a camera got the default.
    expect(p).toContain(`2-5s — the gap between them begins to glow amber. ${DEFAULT_CAMERA.charAt(0).toUpperCase() + DEFAULT_CAMERA.slice(1)}.`);
    expect(p).toContain("5-7s — the amber gap settles as the brightest element. The camera comes to rest.");
    // With beats the visual summary is not repeated.
    expect(p).not.toContain(shot.visual);
    expect(p).toContain("overall_soundscape: A faint low room hum and a soft crystalline shimmer as the gap lights up at 3s. Nothing louder than the voice.");
  });

  test("a style with people closes on the people negatives; a speaker on screen is S1", () => {
    const p = buildShotPrompt({
      styleRecipe: "Live-action lesson with a warm, credible instructor speaking to camera, 16:9.",
      narration: "on-camera",
      language: "en",
      shot: { ...shot, script: "So the only question left is how far apart they are." },
    });
    expect(p).toContain("The speaker (S1), framed at medium distance facing the camera, says: <d>[English] So the only question left is how far apart they are.</d>");
    expect(p).toContain("extra fingers or limbs; deformed hands or faces; a second speaker; lips out of sync with the words.");
    expect(styleHasPeople({ narration: "voiceover", styleRecipe: RECIPE })).toBe(false);
    expect(styleHasPeople({ narration: "voiceover", styleRecipe: "Hand-drawn ink-line comic with expressive characters" })).toBe(true);
    expect(negativesFor({ narration: "voiceover", styleRecipe: RECIPE, figures: ["evidence/b1/a.png"] })).toContain("or the reference figure carries");
  });

  test("continuity and figures read as before", () => {
    const p = buildShotPrompt({
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      shot: { ...shot, figures: ["evidence/b2/prior.png"] },
      sceneGoal: "误差为何变小",
      hasParentFrame: true,
      isSceneOpening: false,
    });
    expect(p).toContain("continues seamlessly from the previous shot's last frame");
    // Drawn into the scene, not pasted: the pasted-picture failure of 2026-09-04.
    expect(p).toContain('The reference figure "prior.png" appears on screen, drawn in the scene\'s own materials and filling the frame — not pasted as a flat picture — with every label, axis and number reproduced faithfully and unaltered.');
    expect(p).not.toContain("objects or shapes the prompt did not describe");
    expect(p).toContain("Continuity note, never shown on screen: this shot is one part of a longer continuous scene explaining 误差为何变小");
    const opening = buildShotPrompt({ styleRecipe: RECIPE, narration: "voiceover", language: "zh", shot, hasParentFrame: true, isSceneOpening: true });
    expect(opening).toContain("this scene is established from it");
  });
});

describe("normalizeBeats", () => {
  test("clamps to the shot, fills the last beat to the end, names a missing camera", () => {
    const { beats, problems } = normalizeBeats(
      [
        { from: 0, to: 4, action: "a", camera: "the camera holds" },
        { from: 4, to: 12, action: "b" },
        { action: "" },
      ],
      10,
      { where: "scene 1 shot 1" },
    );
    expect(beats).toEqual([
      { from: 0, to: 4, action: "a", camera: "the camera holds" },
      { from: 4, to: 10, action: "b", camera: DEFAULT_CAMERA },
    ]);
    expect(problems.some((p) => p.includes("shot 1 beat 2: ends past the shot's 10s"))).toBe(true);
    expect(problems.some((p) => p.includes("shot 1 beat 2: no camera"))).toBe(true);
    expect(problems.some((p) => p.includes("beat 3: no action"))).toBe(true);
    expect(normalizeBeats(undefined, 10).beats).toEqual([]);
  });

  test("the practice carries a version the shots are stamped with", () => {
    expect(H3_PRACTICES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
