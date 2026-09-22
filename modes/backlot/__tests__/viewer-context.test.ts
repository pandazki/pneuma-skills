/**
 * `<viewer-context>` — what the agent reads about what the user is seeing.
 *
 * Two claims are load-bearing and both are pinned here:
 *
 *  - THE STAGE STATE IS THE SCRIPTS'. The block quotes the same derivation
 *    `backlot.mjs` refuses to spend against, so the agent can never read
 *    "approved" here and be refused there.
 *  - "HERE" HAS ONE REFERENT. Each stage contributes only what its own body
 *    shows; the shot block appears on the stages that are about a shot, and
 *    the Address line is the machine handle for whatever that is.
 */

import { describe, expect, test } from "bun:test";

import { extractBacklotContext, resolveBacklotItems } from "../pneuma-mode.js";
import { hashStage } from "../skill/scripts/stage-state.mjs";

type File = { path: string; content: string };

const SHOT = (id: string, scene: string) =>
  JSON.stringify({
    version: 1,
    id,
    title: id === "s01" ? "The door opens" : "Coins on the counter",
    spec: { seconds: 8, fps: 24, width: 1280, height: 720, frames: 192 },
    scene,
    characters: ["kai"],
    set: "store",
    board: { file: "board.png", revision: 1, cost: { usd: 0.11, basis: "reported" } },
    lines:
      id === "s01"
        ? [
            { id: "l2", speaker: "narrator", kind: "vo", text: "Three in the morning.", at: 0.8, file: "sound/l2.mp3", seconds: 3.1, cost: { usd: 0.02, basis: "table" } },
          ]
        : [],
    beats: [{ id: "open", label: "The door opens", from: 0, to: 1.2, kind: "action" }],
    greybox: { revision: 1, final: { file: "greybox/greybox.mp4", revision: 1 } },
    checks: [{ id: "frames", label: "192 frames", target: "greybox", status: "pass" }],
    takes:
      id === "s01"
        ? [{ id: "take-01", status: "done", file: "takes/take-01.mp4", selected: true, cost: { usd: 2.12, basis: "table" } }]
        : [],
  });

const IDEA = "# A film\n\nOne customer, one clerk.\n";

const MANIFEST = (approvals: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    title: "The last customer",
    logline: "A customer who will not go home.",
    gates: "closed",
    approvals,
    scenes: [
      { id: "sc1", number: 1, heading: "INT. STORE — NIGHT", summary: "He comes in." },
      { id: "sc2", number: 2, heading: "INT. COUNTER — NIGHT", summary: "He pays." },
    ],
    characters: ["kai"],
    sets: ["store"],
    shots: ["s01", "s02"],
  });

/** Files arrive content-set-relative — `src/ws.ts` strips the prefix. */
const FILES = (approvals: Record<string, unknown> = {}): File[] => [
  { path: "backlot.json", content: MANIFEST(approvals) },
  { path: "idea.md", content: IDEA },
  {
    path: "bible/characters/kai/character.json",
    content: JSON.stringify({
      id: "kai",
      name: "Kai",
      sheet: { file: "sheet.png", revision: 1, cost: { usd: 0.13, basis: "reported" } },
    }),
  },
  { path: "bible/sets/store/set.json", content: JSON.stringify({ id: "store", name: "The store" }) },
  { path: "shots/s01/shot.json", content: SHOT("s01", "sc1") },
  { path: "shots/s02/shot.json", content: SHOT("s02", "sc2") },
  {
    path: "cut/edl.json",
    content: JSON.stringify({
      kind: "final",
      file: "final.mp4",
      seconds: 16,
      segments: [
        { shot: "s01", source: "take-01", offset: 0, seconds: 8 },
        { shot: "s02", source: "greybox", offset: 8, seconds: 8 },
      ],
    }),
  },
];

const context = (address: Record<string, unknown> | undefined, files: File[] = FILES()) =>
  extractBacklotContext(address ? ({ type: "x", content: "", address } as never) : null, files);

describe("the stage block", () => {
  test("names every stage, its status and what it spent", () => {
    const text = context(undefined);
    expect(text).toContain("gates closed");
    // 0.13 sheet + 0.22 two boards + 2.12 take + 0.02 voice-over.
    expect(text).toContain("$2.49 spent");
    for (const stage of ["idea", "script", "bible", "boards", "previz", "takes", "sound", "cut"]) {
      expect(text).toContain(stage);
    }
    expect(text).toContain("bible draft $0.13");
    expect(text).toContain("takes draft $2.12");
  });

  test("a stage that MOVED since it was approved is shouted, and is the next open one", () => {
    const approved = context(undefined, FILES({ idea: { at: 1, hash: "not-the-hash" } }));
    expect(approved).toContain("idea CHANGED");
    expect(approved).toContain("Next open stage: idea (changed");
    expect(approved).toContain("approved once, the files have moved since");
  });

  test("an approval that still holds reads as approved and moves the next stage on", () => {
    const texts = Object.fromEntries(FILES().map((f) => [f.path, f.content]));
    const text = context(undefined, FILES({ idea: { at: 1, hash: hashStage("idea", texts) } }));
    expect(text).toContain("idea approved");
    expect(text).toContain("Next open stage: script");
  });

  test("open gates say so, because they are what lets the agent spend", () => {
    const files = FILES();
    files[0] = { path: "backlot.json", content: MANIFEST().replace('"closed"', '"open"') };
    expect(context(undefined, files)).toContain("gates are open");
  });
});

describe("what each stage puts in focus", () => {
  test("the bible lists its cards and names the one in focus", () => {
    const text = context({ stage: "bible", character: "kai" });
    expect(text).toContain("On screen: bible");
    expect(text).toContain("1 character(s)");
    expect(text).toContain('Card in focus: character "kai"');
    // No shot block: nobody is looking at a shot on the bible.
    expect(text).not.toContain("Greybox checks");
  });

  test("the cut reports what kind of cut it is and where the segment sits", () => {
    const text = context({ stage: "cut", segment: "s02" });
    // The EDL says `final`, but a greybox still stands in — so it is a reel.
    expect(text).toContain("Cut: reel");
    expect(text).toContain("1 greybox stand-in(s)");
    expect(text).toContain("Segment in focus: s02 from greybox at 8.0–16.0 s");
  });

  test("the script lists the scenes with the shots broken out of them", () => {
    const text = context({ stage: "script", scene: "sc1" });
    expect(text).toContain("1:sc1 (1 shot(s))");
    expect(text).toContain("Scene in focus: 1 — INT. STORE — NIGHT");
  });

  test("sound counts both kinds of line and says whether there is music", () => {
    const text = context({ stage: "sound", line: "l2" });
    expect(text).toContain("1 vo, 0 spoken");
    expect(text).toContain("music not generated");
    expect(text).toContain('Line in focus: l2 · narrator · vo');
  });

  test("an address with no stage is a PREVIZ address, and carries the playhead", () => {
    const text = context({ shot: "s01", lane: "take", take: "take-01", time: 0.5 });
    expect(text).toContain("On screen: previz");
    expect(text).toContain('Shot: "The door opens" (s01)');
    expect(text).toContain("Playhead: 00.50 s · frame 13 of 192 · Take 01 lane");
    expect(text).toContain('beat "open"');
  });
});

describe("workspace items", () => {
  test("the items are the shots, in manifest order", () => {
    const items = resolveBacklotItems(FILES());
    expect(items.map((i) => i.path)).toEqual(["shots/s01/shot.json", "shots/s02/shot.json"]);
    expect(items[0].metadata?.shot).toBe("s01");
  });
});
