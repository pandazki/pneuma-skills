import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { buildSheetPrompt, buildGifPrompt, renderSheetPrompt, SHEET_STATES } from "../skill/scripts/sheet-prompt.mjs";
import { facingSheetPrompt, itemSheetPrompt, packClipPrompt, PACK_STATES } from "../skill/scripts/pack.mjs";

const subjects = [
  ["A human with two arms holding a lantern in her own right hand.", "Raise her left hand while the lantern stays in her right hand."],
  ["A bird with two wings and two clawed feet.", "Spread both wings and fold them."],
  ["A quadruped fox with four paws and one tail.", "Trot with alternating diagonal pairs of paws."],
  ["A legless serpent with no arms.", "Coil, uncoil and slither in place."],
  ["A glass potion bottle icon with translucent liquid.", "The liquid changes colour and bubbles rise."],
  ["A translucent smoke, fire and glow effect.", "Smoke expands and fades while fire sheds glowing particles."],
  ["An abstract loop of luminous ribbons.", "The ribbons change shape, hue and size, then dissolve."],
] as const;
const motion = { id: "idle", grid: { rows: 2, cols: 4 }, loop: true };

test("every sheet and GIF state preserves subject facts and custom action without invented anatomy or effect bans", () => {
  for (const [description, action] of subjects) {
    const character = { description, style: "Painterly game art.", cell: { width: 64, height: 64 } };
    for (const state of [...SHEET_STATES, "generic"] as const) {
      for (const { prompt } of [
        buildSheetPrompt({ character, motion, action, state }),
        buildGifPrompt({ character, motion, action, state, frames: 8 }),
      ]) {
        expect(prompt).toContain(description);
        expect(prompt).toContain(action);
        const defaults = prompt.replace(description, "").replace(action, "");
        expect(defaults).not.toMatch(/\b(arms?|legs?|feet|hands?|shoulders?|chest|eyes|hair|torso|fist|knees?)\b/i);
        expect(defaults).not.toMatch(/fully opaque|never through effects|no (particles|effects|glows|smoke)|without changing shape/);
        expect(prompt).toContain("Fixed camera");
      }
    }
  }
});

test("facing and item packs carry structure and permit intentional materials and deformation", () => {
  for (const [description, action] of subjects) {
    const character = { description, style: "Painterly game art." };
    const pack = { state: "loop", rows: 2, cols: 2, cells: [{ motion: "one", item: "one" }] };
    for (const prompt of [
      facingSheetPrompt({ character }).prompt,
      itemSheetPrompt({ character, items: ["one"], rows: 1, cols: 1 }).prompt,
      ...PACK_STATES.flatMap((state) => [
        packClipPrompt({ character, pack: { ...pack, state } }).prompt,
        packClipPrompt({ character, pack: { ...pack, state, cells: [{ motion: "front", direction: "front" }, { motion: "back-left", direction: "back-left" }] } }).prompt,
      ]),
    ]) {
      expect(prompt).toContain(description);
      const defaults = prompt.replace(description, "");
      expect(defaults).not.toMatch(/\b(arms?|legs?|feet|hands?|shoulders?|chest|eyes|hair)\b/i);
      expect(defaults).not.toMatch(/no particles|no effects|without changing shape|colors and proportions exactly/);
    }
    expect(packClipPrompt({ character, pack: { ...pack, state: "death" } }).pinned).toBe(false);
    const custom = packClipPrompt({ character, pack: { ...pack, state: "idle" }, action });
    expect(custom.prompt).toContain(action.replace(/\.$/, ""));
    expect(custom.prompt).not.toContain("last frame returns");
    expect(custom.pinned).toBe(false);
  }
});

test("old builder records load unchanged and new prompts never rewrite paid provenance", () => {
  const dir = mkdtempSync(join(tmpdir(), "sprite-old-prompt-"));
  const script = join(import.meta.dir, "../skill/scripts/sprite-project.mjs");
  const run = (...args: string[]) => {
    const result = Bun.spawnSync([process.execPath, script, ...args, "--dir", dir], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    return result.stdout.toString();
  };
  try {
    run("init", "--name", "Smoke", "--style", "Painterly effects", "--description", "Translucent smoke", "--cell", "64x64");
    run("add-motion", "--id", "idle", "--label", "Idle", "--rows", "2", "--cols", "4", "--fps", "8", "--loop");
    const file = join(dir, "project.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const legacyParts = { builder: "sheet-prompt/2", action: "Old exact action.", guards: ["state:idle", "row-continuity", "loop-close"] };
    doc.sprite.motions[0].prompt = "The exact previously paid prompt.";
    doc.sprite.motions[0].promptParts = legacyParts;
    doc.assets.push({ id: "paid-sheet", type: "image", uri: "motions/idle/old-sheet.png", name: "Paid sheet", metadata: {}, createdAt: 1, status: "ready" });
    const paid = { toAssetId: "paid-sheet", fromAssetId: null, operation: { type: "generate", actor: "agent", timestamp: 1, params: { model: "openai/gpt-image-2.5-flare", prompt: doc.sprite.motions[0].prompt, inputs: [], background: "opaque", imageSize: "2048x1024", requestId: "old-paid-request" } } };
    doc.provenance.push(paid);
    writeFileSync(file, JSON.stringify(doc));
    const before = readFileSync(file, "utf8");
    const shown = JSON.parse(run("show", "--motion", "idle", "--json"));
    expect(shown.promptParts).toEqual(legacyParts);
    expect(shown.prompt).toBe(paid.operation.params.prompt);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(() => renderSheetPrompt({ character: doc.sprite.character, motion }, legacyParts)).toThrow("cannot render parts built by sheet-prompt/2");
    run("sheet-prompt", "--motion", "idle", "--action", "Smoke expands and fades.", "--json");
    const updated = JSON.parse(readFileSync(file, "utf8"));
    expect(updated.sprite.motions[0].promptParts.builder).toBe("sheet-prompt/3");
    expect(updated.provenance).toEqual(doc.provenance);
    expect(updated.assets).toEqual(doc.assets);
    expect(updated.provenance.at(-1).operation.params).toEqual(paid.operation.params);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("direction packs retain explicit asymmetry alongside custom effects", () => {
  const asymmetric = "The blue marking is on its own left side.";
  const character = { style: "Painterly effects", description: "A translucent wingless creature.", asymmetric };
  const { prompt, pinned } = packClipPrompt({ character, pack: { state: "cast", rows: 1, cols: 1, cells: [{ motion: "cast-left", direction: "left" }] }, action: "Emit sparks from the blue marking, then fade away." });
  expect(prompt).toContain(asymmetric);
  expect(prompt).toContain("never flip or change sides throughout the clip");
  expect(prompt).toContain("no copy turns, rotates or changes direction");
  expect(prompt).toContain("Emit sparks from the blue marking, then fade away.");
  expect(pinned).toBe(false);
});
