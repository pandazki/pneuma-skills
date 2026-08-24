/**
 * Byte-parity of the TypeScript samplers against the bash-era originals.
 *
 * The sampler goldens (`cksum-pins.json`, `primer-sample.*`, `voice-*`) were
 * recorded from `primer_sample.sh` and `voice_sample.sh` immediately before
 * the bash → TypeScript migration, against the committed fixture inputs
 * (`fixtures/primer-lib/`, `fixtures/voice-taste/`, and the bundled primer
 * library). Those are frozen: a differing byte means the port is wrong, never
 * that the golden needs regenerating. `primed-leaf-prompt.golden.md` pins the
 * current composer instead — the prompt shape has deliberately evolved since
 * the migration (preceding-last in 0.13.0, the system/user split in 0.14.0) —
 * so it is regenerated when the wording is meant to change, in the same
 * commit that says so; the sampled passages inside it still come from the
 * frozen seed maths.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeLeafPromptFile } from "../skill/scripts/lib/compose.ts";
import { cksum, samplePrimer, sampleVoice } from "../skill/scripts/lib/sampling.ts";

const fixturesDir = join(import.meta.dir, "fixtures");
const primerLib = join(fixturesDir, "primer-lib");
const voiceTaste = join(fixturesDir, "voice-taste");

function golden(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("the seeded generator matches the bash era", () => {
  it("computes the exact cksum values bash fed the LCG", () => {
    const pins = JSON.parse(golden("cksum-pins.json")) as Record<string, number>;
    for (const [seed, value] of Object.entries(pins)) {
      expect([seed, cksum(seed)]).toEqual([seed, value]);
    }
  });
});

describe("primer sampler byte parity", () => {
  it("reproduces the synthetic-library draws byte for byte", () => {
    expect(samplePrimer({ seed: "unit-1|writer|0", libs: primerLib })).toBe(
      golden("primer-sample.synthetic-1.golden.txt"),
    );
    expect(samplePrimer({ seed: "unit-2|writer|0", libs: primerLib })).toBe(
      golden("primer-sample.synthetic-2.golden.txt"),
    );
    expect(
      samplePrimer({ seed: "t-9|repair|2", libs: primerLib, count: 2, min: 300, max: 700, total: 1200 }),
    ).toBe(golden("primer-sample.synthetic-3.golden.txt"));
  });

  it("reproduces the bundled-library draws byte for byte", () => {
    expect(samplePrimer({ seed: "bundled-seed" })).toBe(golden("primer-sample.bundled-1.golden.txt"));
    expect(samplePrimer({ seed: "unit-1|writer|0" })).toBe(golden("primer-sample.bundled-2.golden.txt"));
  });
});

describe("voice sampler byte parity", () => {
  it("reproduces both seeded draws byte for byte", () => {
    for (const tag of ["u1", "u2"]) {
      const out = mkdtempSync(join(tmpdir(), "wordtaste-voice-parity-"));
      try {
        sampleVoice(voiceTaste, out, `task-1|${tag}|0`);
        expect(readFileSync(join(out, "voice_style.en.md"), "utf8")).toBe(
          golden(`voice-style.${tag}.golden.md`),
        );
        expect(readFileSync(join(out, "voice_examples.md"), "utf8")).toBe(
          golden(`voice-examples.${tag}.golden.md`),
        );
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    }
  });
});

describe("primed composed prompt byte parity", () => {
  it("reproduces the recorded primed writer prompt byte for byte", () => {
    const root = mkdtempSync(join(tmpdir(), "wordtaste-primed-parity-"));
    const savedEnv = {
      PNEUMA_SESSION_DIR: process.env.PNEUMA_SESSION_DIR,
      WORDTASTE_PRIMER_LIBS: process.env.WORDTASTE_PRIMER_LIBS,
      WORDTASTE_PRIMER: process.env.WORDTASTE_PRIMER,
    };
    try {
      const session = join(root, "sess");
      mkdirSync(join(session, ".pneuma"), { recursive: true });
      writeFileSync(join(session, "workflow.json"), '{"taskId":"t-fix"}\n');
      const parts = join(root, "parts", "u1");
      mkdirSync(parts, { recursive: true });
      writeFileSync(
        join(parts, "brief.en.md"),
        [
          "This is the opening section of an essay about how a workshop splits its two benches.",
          "Readers already build things; do not explain what a bench is.",
          "Walk through one complete job first, then name the two benches. Stop there.",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(parts, "material.md"),
        ["# 两张工作台", "", "第一张台子只做粗活，三年里换过四套夹具，大部分时候够用。", "", "第二张台子做细活，谁也不许在上面放锤子。", ""].join("\n"),
      );
      writeFileSync(join(parts, "kernel.md"), "「三年里换过四套夹具」这句里的数字一个都不能改。\n");

      process.env.PNEUMA_SESSION_DIR = session;
      process.env.WORDTASTE_PRIMER_LIBS = primerLib;
      delete process.env.WORDTASTE_PRIMER;

      const out = join(root, "prompt.md");
      composeLeafPromptFile(parts, out);
      expect(readFileSync(out, "utf8")).toBe(golden("primed-leaf-prompt.golden.md"));
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});
