/**
 * The stage machine — one algorithm, two runtimes.
 *
 * `stage-state.mjs` is what `backlot.mjs` and `domain.ts` both read to decide
 * whether a stage is empty, drafted, approved or changed since approval, and
 * whether a paid command may spend. It is pure, so every rule the gate rests
 * on is exercised here without a file system:
 *
 *  - a stage's status comes from the files that DEFINE it, never from a
 *    stored status — nothing can say "approved" about a version nobody saw;
 *  - the hash survives re-serialization (key order, whitespace) and moves
 *    the moment a fact moves, so `changed` means changed;
 *  - media never enters a hash: a new PNG is seen through the `{ file,
 *    revision }` record beside it;
 *  - `changed` is NOT approved, and an unreadable file is never approved.
 */

import { describe, expect, test } from "bun:test";

import {
  fnv1a,
  GATES,
  gateCheck,
  gateFor,
  hashStage,
  isStage,
  stableStringify,
  STAGES,
  stageInputs,
  stageStatus,
  stageStatuses,
} from "../skill/scripts/stage-state.mjs";

const manifest = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    title: "Last Customer",
    gates: "closed",
    approvals: {},
    scenes: [{ id: "sc1", number: 1, heading: "INT. 便利店 — 夜", summary: "one customer" }],
    characters: ["kai"],
    sets: ["store"],
    shots: ["s01-enter"],
    ...extra,
  });

const character = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    id: "kai",
    name: "小凯",
    description: "a tired clerk",
    look: "three-quarter sheet",
    sheet: { file: "sheet.png", revision: 1, cost: { usd: 0.13, basis: "reported" } },
    voice: null,
    ...extra,
  });

const shot = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    id: "s01-enter",
    title: "He enters",
    scene: "sc1",
    characters: ["kai"],
    set: "store",
    spec: { seconds: 8, fps: 24, width: 1280, height: 720, frames: 192 },
    beats: [{ id: "walk", from: 0, to: 3, kind: "action" }],
    board: { file: "board.png", revision: 1 },
    lines: [],
    greybox: { revision: 1, final: { file: "greybox/greybox.mp4", revision: 1 } },
    checks: [{ id: "blocking", target: "greybox", status: "pass" }],
    takes: [],
    ...extra,
  });

const FILM = (): Record<string, string> => ({
  "backlot.json": manifest(),
  "idea.md": "# Idea\n\nA clerk waits for the last customer.\n",
  "screenplay.md": "# Screenplay\n\nINT. 便利店 — 夜\n",
  "bible/characters/kai/character.json": character(),
  "bible/sets/store/set.json": JSON.stringify({ version: 1, id: "store", name: "便利店", description: "", look: "", concept: { file: "concept.png", revision: 1 } }),
  "shots/s01-enter/shot.json": shot(),
});

describe("what defines a stage", () => {
  test("the eight stages are the film's order", () => {
    expect([...STAGES]).toEqual(["idea", "script", "bible", "boards", "previz", "takes", "sound", "cut"]);
    expect(isStage("bible")).toBe(true);
    expect(isStage("Bible")).toBe(false);
    expect(isStage("everything")).toBe(false);
  });

  test("a stage with no inputs is empty, and empty is not draft", () => {
    expect(stageInputs("idea", {})).toEqual([]);
    expect(hashStage("idea", {})).toBeNull();
    expect(stageStatus("idea", {}, null)).toBe("empty");
    // A file that exists but says nothing is still nothing.
    expect(stageStatus("idea", { "idea.md": "   \n" }, null)).toBe("empty");
    expect(stageStatus("idea", { "idea.md": "# Idea\n" }, null)).toBe("draft");
  });

  test("lines alone do not make a sound stage — they are script until a file exists", () => {
    const texts = { ...FILM(), "shots/s01-enter/shot.json": shot({ lines: [{ id: "l2", speaker: "narrator", kind: "vo", text: "凌晨三点", at: 0.8, file: null }] }) };
    expect(stageStatus("sound", texts, null)).toBe("empty");
    const recorded = { ...texts, "shots/s01-enter/shot.json": shot({ lines: [{ id: "l2", speaker: "narrator", kind: "vo", text: "凌晨三点", at: 0.8, file: "sound/l2.mp3" }] }) };
    expect(stageStatus("sound", recorded, null)).toBe("draft");
  });

  test("previz and takes only count the shots that have reached them", () => {
    const texts = FILM();
    // One rendered greybox, no take.
    expect(stageInputs("previz", texts)).toHaveLength(1);
    expect(stageInputs("takes", texts)).toHaveLength(0);
    const withTake = { ...texts, "shots/s01-enter/shot.json": shot({ takes: [{ id: "take-01", status: "done", selected: true }] }) };
    expect(stageInputs("takes", withTake)).toHaveLength(1);
  });
});

describe("the hash", () => {
  test("is stable under key reorder and re-serialization", () => {
    const a = FILM();
    const reordered = {
      ...a,
      "bible/characters/kai/character.json": JSON.stringify({
        sheet: { revision: 1, file: "sheet.png", cost: { basis: "reported", usd: 0.13 } },
        look: "three-quarter sheet",
        description: "a tired clerk",
        name: "小凯",
        id: "kai",
        version: 1,
        voice: null,
      }),
    };
    expect(hashStage("bible", reordered)).toBe(hashStage("bible", a));
    // Pretty-printing a JSON record is not an edit either.
    const pretty = { ...a, "bible/characters/kai/character.json": JSON.stringify(JSON.parse(a["bible/characters/kai/character.json"]), null, 2) };
    expect(hashStage("bible", pretty)).toBe(hashStage("bible", a));
    expect(stableStringify({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
    expect(fnv1a("")).toHaveLength(8);
  });

  test("moves the moment a fact a stage is made of moves", () => {
    const before = FILM();
    const renamed = { ...before, "bible/characters/kai/character.json": character({ name: "小凯（夜班）" }) };
    expect(hashStage("bible", renamed)).not.toBe(hashStage("bible", before));
    // A NEW sheet is a new revision beside the same filename: the media
    // never enters the hash, its record does.
    const reshot = { ...before, "bible/characters/kai/character.json": character({ sheet: { file: "sheet.png", revision: 2, cost: null } }) };
    expect(hashStage("bible", reshot)).not.toBe(hashStage("bible", before));
    // A cost recorded after the fact is not a change of the LOOK.
    const priced = { ...before, "bible/characters/kai/character.json": character({ sheet: { file: "sheet.png", revision: 1, cost: { usd: 9, basis: "estimate" } } }) };
    expect(hashStage("bible", priced)).toBe(hashStage("bible", before));
  });

  test("a hand-off is a BOARDS decision — declaring one re-opens the shot list", () => {
    const before = FILM();
    const continued = {
      ...before,
      "shots/s01-enter/shot.json": shot({
        continuity: { from: "s00-street", entry: "mid-stride through the door", exit: "hand on the fridge handle" },
      }),
    };
    expect(hashStage("boards", continued)).not.toBe(hashStage("boards", before));
    // …and so is changing what it says: the entry is what the take's first
    // frame is judged against.
    const reworded = {
      ...before,
      "shots/s01-enter/shot.json": shot({
        continuity: { from: "s00-street", entry: "already inside, turning", exit: "hand on the fridge handle" },
      }),
    };
    expect(hashStage("boards", reworded)).not.toBe(hashStage("boards", continued));
    // It is not a PREVIZ decision: the greybox and its checks are untouched.
    expect(hashStage("previz", continued)).toBe(hashStage("previz", before));
  });

  test("the shot plan defines the boards stage with no picture at all", () => {
    // Round 3 (2026-09-21) stopped drawing boards: the stage is the shot
    // list, its beats and its cameras, and it must be approvable — and
    // hashable — with `board: null`, or the gate in front of the greybox
    // could never open on a film shot the current way.
    const planned = { ...FILM(), "shots/s01-enter/shot.json": shot({ board: null }) };
    expect(stageInputs("boards", planned)).toHaveLength(2);
    expect(hashStage("boards", planned)).not.toBeNull();
    expect(stageStatus("boards", planned, null)).toBe("draft");
    expect(stageStatus("boards", planned, { boards: { at: 1, hash: hashStage("boards", planned)! } })).toBe("approved");
    // And a board that appears afterwards is still boards content — a
    // legacy film that re-registers one has changed its shot list.
    expect(hashStage("boards", FILM())).not.toBe(hashStage("boards", planned));
  });

  test("a beat's designed detail is boards content too — the prompt's timeline is made of it", () => {
    const before = FILM();
    const detailed = {
      ...before,
      "shots/s01-enter/shot.json": shot({
        beats: [{ id: "walk", from: 0, to: 3, kind: "action", detail: "he crosses the aisle in four heavy steps, coat dripping" }],
      }),
    };
    expect(hashStage("boards", detailed)).not.toBe(hashStage("boards", before));
  });

  test("an anchor frame belongs to previz — the lineup is what the previz gate approves", () => {
    const before = FILM();
    const anchored = {
      ...before,
      "shots/s01-enter/shot.json": shot({ anchors: [{ id: "first", at: 0, file: "anchors/first.png", revision: 1 }] }),
    };
    expect(hashStage("previz", anchored)).not.toBe(hashStage("previz", before));
    // A re-render of the same anchor moves it again…
    const reshot = {
      ...before,
      "shots/s01-enter/shot.json": shot({ anchors: [{ id: "first", at: 0, file: "anchors/first.png", revision: 2 }] }),
    };
    expect(hashStage("previz", reshot)).not.toBe(hashStage("previz", anchored));
    // …while the prompt it was made from, and its cost, are not the look.
    const priced = {
      ...before,
      "shots/s01-enter/shot.json": shot({
        anchors: [{ id: "first", at: 0, file: "anchors/first.png", revision: 1, prompt: "a colder version", cost: { usd: 0.19, basis: "reported" } }],
      }),
    };
    expect(hashStage("previz", priced)).toBe(hashStage("previz", anchored));
  });

  test("markdown is hashed verbatim — a reworded screenplay is a new script", () => {
    const before = FILM();
    const after = { ...before, "screenplay.md": `${before["screenplay.md"]}KAI\n  还开着吗？\n` };
    expect(hashStage("script", after)).not.toBe(hashStage("script", before));
  });
});

describe("approval", () => {
  test("approved, then changed the moment the files move", () => {
    const texts = FILM();
    const approvals = { script: { at: 1758380000000, hash: hashStage("script", texts)! } };
    expect(stageStatus("script", texts, approvals)).toBe("approved");

    const edited = { ...texts, "screenplay.md": "# Screenplay\n\nEXT. 停车场 — 夜\n" };
    expect(stageStatus("script", edited, approvals)).toBe("changed");
    // Re-approving the new version closes it again.
    const reapproved = { script: { at: 1758390000000, hash: hashStage("script", edited)! } };
    expect(stageStatus("script", edited, reapproved)).toBe("approved");
  });

  test("an approval of a stage that has since been emptied reads as changed, never as approved", () => {
    const approvals = { idea: { at: 1, hash: "deadbeef" } };
    expect(stageStatus("idea", {}, approvals)).toBe("changed");
  });

  test("an approval with a missing or malformed hash is changed — the creator approved SOMETHING", () => {
    const texts = FILM();
    expect(stageStatus("script", texts, { script: { at: 1 } } as never)).toBe("changed");
    expect(stageStatus("script", texts, { script: { at: 1, hash: "" } } as never)).toBe("changed");
  });

  test("an unparsable JSON file reads as changed, never as approved", () => {
    const texts = FILM();
    const approvals = { bible: { at: 1, hash: hashStage("bible", texts)! } };
    expect(stageStatus("bible", texts, approvals)).toBe("approved");
    const broken = { ...texts, "bible/characters/kai/character.json": "{ this is not json" };
    expect(stageStatus("bible", broken, approvals)).toBe("changed");
    // …and the broken text is still an INPUT, so the stage is not empty.
    expect(stageInputs("bible", broken).length).toBeGreaterThan(0);
  });

  test("stageStatuses answers for all eight, in order", () => {
    const rows = stageStatuses(FILM(), { script: { at: 1, hash: hashStage("script", FILM())! } });
    expect(rows.map((row) => row.stage)).toEqual([...STAGES]);
    expect(rows.find((row) => row.stage === "script")?.status).toBe("approved");
    expect(rows.find((row) => row.stage === "cut")?.status).toBe("empty");
  });
});

describe("the gate", () => {
  test("each paid command waits on the stage the brief assigns it", () => {
    expect(GATES).toEqual({
      "bible-image": "script",
      voice: "script",
      board: "bible",
      // An anchor frame renders the bible into one shot: the look it holds
      // has to have been approved before it is paid for.
      anchor: "bible",
      generate: "previz",
      vo: "takes",
      music: "takes",
      "cut-final": "sound",
    });
    expect(gateFor("generate")).toBe("previz");
    // Free work needs nothing: render, check, a reel, a contact sheet.
    for (const command of ["render", "check", "cut-reel", "sheet", "compare"]) {
      expect(gateFor(command)).toBeNull();
      expect(gateCheck(command, FILM(), JSON.parse(manifest())).ok).toBe(true);
    }
  });

  test("a closed gate refuses with the stage and its status, in words", () => {
    const texts = FILM();
    const refused = gateCheck("board", texts, JSON.parse(texts["backlot.json"]));
    expect(refused.ok).toBe(false);
    expect(refused.stage).toBe("bible");
    expect(refused.status).toBe("draft");
    expect(refused.reason).toContain('stage "bible" is draft');
  });

  test("approved opens it; changed closes it again — the creator has not seen this version", () => {
    const texts = FILM();
    const approved = manifest({ approvals: { bible: { at: 1, hash: hashStage("bible", texts) } } });
    expect(gateCheck("board", { ...texts, "backlot.json": approved }, JSON.parse(approved)).ok).toBe(true);

    const moved = { ...texts, "backlot.json": approved, "bible/characters/kai/character.json": character({ name: "另一个人" }) };
    const after = gateCheck("board", moved, JSON.parse(approved));
    expect(after.ok).toBe(false);
    expect(after.status).toBe("changed");
    expect(after.reason).toContain("changed after it was approved");
  });

  test("open gates satisfy every gate at once, approvals or not", () => {
    const texts = { ...FILM(), "backlot.json": manifest({ gates: "open" }) };
    for (const command of Object.keys(GATES)) {
      expect(gateCheck(command, texts, JSON.parse(texts["backlot.json"])).ok).toBe(true);
    }
  });

  test("a missing manifest is not an open gate", () => {
    expect(gateCheck("generate", FILM(), null).ok).toBe(false);
    expect(gateCheck("generate", FILM(), {}).ok).toBe(false);
  });
});
