/**
 * What the theme picker TELLS the reader about a missing face.
 *
 * The product owner's note, on the old wording: 「那你要写清楚。。用什么替代了？」
 * The line said "not on this machine: Xingkai SC — the board will fall back",
 * which names the loss and not the replacement, and those are very different
 * facts to a reader: 行草 in place of 行楷 is a substitution most people would
 * shrug at, 苹方 in place of any hand at all is one nobody would accept. The
 * old sentence rendered them identically.
 *
 * The other half of the same defect is that the sentence was appearing at
 * all. On the machine it was written on, `Xingkai SC` was installed and
 * drawing every character of the board (`CSS.getPlatformFontsForNode` →
 * `STXingkaiSC-Light`); the width probe behind the warning simply could not
 * see it, because Han is full-width in every CJK face. So the first test
 * here is that a machine WITH the face gets no warning — and the fake
 * machine ties every CJK advance on purpose, so a width probe cannot make
 * that test pass.
 */

import { describe, expect, test } from "bun:test";

import { BOARD_THEMES, themeById } from "../viewer/themes.js";
import { faceVerdicts, fallbackNotice } from "../viewer/ThemePicker.js";
import {
  type FakeMachineSpec,
  MACOS_LIKE,
  fakeFontMachine,
} from "./fake-font-machine.js";

const slate = themeById("slate-cursive")!;

const machine = (...uninstall: string[]): Document => {
  const faces = { ...MACOS_LIKE.faces };
  for (const f of uninstall) delete (faces as Record<string, unknown>)[f];
  const spec: FakeMachineSpec = { ...MACOS_LIKE, faces };
  return fakeFontMachine(spec).document;
};

const noticeFor = (doc: Document, preset = slate): string | null =>
  fallbackNotice(faceVerdicts(doc, preset));

describe("a face that is present is never warned about", () => {
  test("slate-cursive says nothing on the machine that HAS Xingkai SC", () => {
    expect(noticeFor(machine())).toBe(null);
  });

  test("no shipped preset warns on a machine that has all of its faces", () => {
    const doc = machine();
    for (const preset of BOARD_THEMES) {
      expect([preset.id, noticeFor(doc, preset)]).toEqual([preset.id, null]);
    }
  });
});

describe("a face that is absent is paired with the one that replaced it", () => {
  test("the bundled 行书 is named, by name", () => {
    expect(noticeFor(machine("Xingkai SC"))).toBe(
      "not on this machine, and what draws instead: Xingkai SC → Zhi Mang Xing",
    );
  });

  test("the next system face is named when the bundled one is gone too", () => {
    expect(noticeFor(machine("Xingkai SC", "Zhi Mang Xing"))).toBe(
      "not on this machine, and what draws instead: Xingkai SC → HanziPen SC, Zhi Mang Xing → HanziPen SC",
    );
  });

  test("a face this page cannot name is said to be unnameable, not guessed", () => {
    // Nothing the stack names draws Han any more, so the generic tail won.
    // The page has no API that can read the platform's choice back, and
    // inventing one would be the `document.fonts.check` lie in a new coat.
    const notice = noticeFor(
      machine("Xingkai SC", "Zhi Mang Xing", "HanziPen SC"),
    )!;
    expect(notice).toContain("Xingkai SC → your system’s fallback");
    expect(notice).toContain("Zhi Mang Xing → your system’s fallback");
  });

  test("every missing face carries a replacement — never a bare 'falls back'", () => {
    // The claim the product owner actually made: whatever the machine, the
    // sentence has to answer 用什么替代了 for each face it mentions.
    for (const uninstall of [
      ["Xingkai SC"],
      ["Xingkai SC", "Zhi Mang Xing"],
      ["Xingkai SC", "Zhi Mang Xing", "HanziPen SC"],
      ["Chalkduster"],
    ]) {
      const doc = machine(...uninstall);
      const verdicts = faceVerdicts(doc, slate);
      const missing = verdicts.filter((v) => v.present === false);
      const notice = fallbackNotice(verdicts) ?? "";
      expect(missing.length).toBeGreaterThan(0);
      for (const v of missing) {
        expect(notice).toContain(`${v.family} → `);
      }
      // …and it never says only that something happened.
      expect(notice).not.toMatch(/will fall back(?!\w)/);
    }
  });

  test("a Latin hand that is missing gets a Latin answer, not a CJK one", () => {
    // Each face is probed with ITS OWN sample, so the substitute named for
    // Chalkduster is whatever draws `Handwriting` — asking a CJK question
    // about a Latin face is how a probe reports the fallback as the face.
    const notice = noticeFor(machine("Chalkduster"))!;
    expect(notice).toContain("Chalkduster → ");
    expect(notice).not.toContain("Xingkai SC →");
  });
});

describe("no instrument, no claim", () => {
  test("a host that draws nothing produces no warning at all", () => {
    const blank = fakeFontMachine({ ...MACOS_LIKE, blank: true }).document;
    const verdicts = faceVerdicts(blank, slate);
    expect(verdicts.every((v) => v.present === null)).toBe(true);
    expect(fallbackNotice(verdicts)).toBe(null);
  });

  test("a present face is never asked for a substitute", () => {
    // `drawnBy` on a present face would be a measurement nobody needs and a
    // string the UI could accidentally show.
    for (const v of faceVerdicts(machine(), slate)) {
      expect(v.present).toBe(true);
      expect(v.drawnBy).toBe(null);
    }
  });
});
