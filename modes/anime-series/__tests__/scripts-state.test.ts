/**
 * series-state.mjs — the rules the viewer and the scripts share: timing
 * conservation, rebalancing, grids, bible hashing/locks, the "shot under an
 * older bible" flag, shot staleness, picks, checks, the derived record and
 * the derived stage.
 */

import { describe, expect, test } from "bun:test";

import {
  GRIDS,
  basisChanges,
  bibleFieldHashes,
  bibleFlag,
  bibleVersion,
  boardShotHashes,
  appliedPatches,
  checkCells,
  expectedIn,
  cutStaleShots,
  namesEntity,
  partCells,
  snapToCut,
  uncutSpliceEnds,
  checkEpisode,
  clipShotHashes,
  consumedKeys,
  effectivePick,
  episodeStage,
  fieldHashes,
  gridOf,
  lockEntry,
  lockStates,
  partCountFor,
  patchPlan,
  rebalance,
  sheetBasis,
  shotBasis,
  shotTimeline,
  staleShots,
  usedIdeas,
} from "../skill/scripts/series-state.mjs";
import type { Bible, EpisodeSlots } from "../skill/scripts/series-state.mjs";
import { fixtureBible, fixtureEpisode } from "./scripts-fixture";

const locked = (bible: Bible, at = "2026-10-29T00:00:00.000Z"): Bible => ({ ...bible, locks: [...bible.locks, lockEntry(bible, at)] });

describe("timing rules", () => {
  test("the fixture episode is clean", () => {
    expect(checkEpisode(fixtureEpisode())).toEqual({ errors: [], warnings: [] });
  });

  test("a shot under 2 s is an error naming the shot", () => {
    const episode = fixtureEpisode();
    episode.parts[0].shots[3].dur = 1.5;
    episode.parts[0].shots[4].dur = 5.5;
    const { errors, warnings } = checkEpisode(episode);
    expect(errors.map((e) => [e.code, e.shot])).toEqual([["shot-too-short", 4]]);
    expect(warnings.map((w) => [w.code, w.shot])).toEqual([["shot-long", 5]]);
  });

  test("shots must add up to duration ÷ parts", () => {
    const episode = fixtureEpisode();
    episode.parts[0].shots[0].dur = 4;
    const { errors } = checkEpisode(episode);
    expect(errors.map((e) => e.code)).toEqual(["part-sum"]);
    expect(errors[0].message).toContain("add up to 31 s; they must add up to 30 s");
  });

  test("a part longer than one 30 s generation is refused", () => {
    const episode = fixtureEpisode();
    episode.duration = 60;
    const codes = checkEpisode(episode).errors.map((e) => e.code);
    expect(codes).toContain("part-too-long");
    expect(partCountFor(60)).toBe(2);
    expect(partCountFor(30)).toBe(1);
    expect(partCountFor(15)).toBe(1);
  });

  test("a 60 s episode in two parts of 30 s each is clean", () => {
    const episode = fixtureEpisode();
    episode.duration = 60;
    episode.parts.push({ id: "B", shots: episode.parts[0].shots.map((s) => ({ ...s })) });
    expect(checkEpisode(episode).errors).toEqual([]);
  });

  test("part ids must run A, B, …", () => {
    const episode = fixtureEpisode();
    episode.parts[0].id = "B";
    expect(checkEpisode(episode).errors.map((e) => e.code)).toEqual(["part-id"]);
  });

  test("a part must be whole seconds (the renderer takes integers)", () => {
    const episode = { ...fixtureEpisode(), duration: 45 };
    episode.parts = [
      { id: "A", shots: [{ dur: 22.5, desc: "x" }] },
      { id: "B", shots: [{ dur: 22.5, desc: "y" }] },
    ];
    expect(checkEpisode(episode).errors.map((e) => e.code)).toContain("part-not-whole");
  });

  test("an odd panel count is a warning, not an error", () => {
    const episode = { ...fixtureEpisode(), duration: 15 };
    episode.parts = [{ id: "A", shots: [3, 3, 3, 3, 3].map((dur) => ({ dur, desc: "beat" })) }];
    const { errors, warnings } = checkEpisode(episode);
    expect(errors).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(["odd-grid"]);
  });

  test("an episode with no shots is a draft with one named error", () => {
    expect(checkEpisode({ ...fixtureEpisode(), parts: [] }).errors.map((e) => e.code)).toEqual(["no-shots"]);
  });
});

describe("rebalance keeps the part total fixed", () => {
  const shots = () => fixtureEpisode().parts[0].shots;
  const total = (list: Array<{ dur: number }>) => Math.round(list.reduce((s, x) => s + x.dur, 0) * 10) / 10;

  test("growing a middle shot takes evenly from both neighbours", () => {
    const out = rebalance(shots(), 4, 5);
    expect(out.map((s) => s.dur)).toEqual([3, 3, 3, 2.5, 5, 2.5, 3, 4, 4]);
    expect(total(out)).toBe(30);
  });

  test("shrinking gives the seconds to the neighbours", () => {
    const out = rebalance(shots(), 4, 2);
    expect(out.map((s) => s.dur)).toEqual([3, 3, 3, 4, 2, 4, 3, 4, 4]);
  });

  test("an odd tenth goes to the next shot", () => {
    const out = rebalance(shots(), 4, 4.3);
    expect(out.map((s) => s.dur)).toEqual([3, 3, 3, 2.9, 4.3, 2.8, 3, 4, 4]);
    expect(total(out)).toBe(30);
  });

  test("a neighbour at the floor passes the rest to the other", () => {
    const list = shots();
    list[3].dur = 2;
    list[5].dur = 4;
    const out = rebalance(list, 4, 5);
    expect(out[3].dur).toBe(2);
    expect(out[5].dur).toBe(3);
    expect(out[4].dur).toBe(5);
  });

  test("--from next/prev confines the change to one side", () => {
    expect(rebalance(shots(), 4, 5, "next").map((s) => s.dur)).toEqual([3, 3, 3, 3, 5, 2, 3, 4, 4]);
    expect(rebalance(shots(), 4, 5, "prev").map((s) => s.dur)).toEqual([3, 3, 3, 2, 5, 3, 3, 4, 4]);
  });

  test("the first and last shots have one neighbour", () => {
    expect(rebalance(shots(), 0, 4).map((s) => s.dur).slice(0, 2)).toEqual([4, 2]);
    expect(rebalance(shots(), 8, 3).map((s) => s.dur).slice(7)).toEqual([5, 3]);
  });

  test("growing past what the neighbours can give names the ceiling", () => {
    expect(() => rebalance(shots(), 4, 7)).toThrow("shot 5 can grow to at most 6 s");
  });

  test("a shot cannot go under 2 s, and a lone shot cannot change", () => {
    expect(() => rebalance(shots(), 4, 1.5)).toThrow(/at least 2 s/);
    expect(() => rebalance([{ dur: 30 }], 0, 20)).toThrow(/only shot in a part/);
  });

  test("other shot fields survive", () => {
    const out = rebalance(shots(), 2, 4);
    expect(out[2].sketch).toBe("Lamp's arm stretched over desks toward the door");
    expect(out[1].sfx).toBe("paper rustle, ominous sting");
  });
});

describe("grids, timelines and patch plans", () => {
  test("the tidy grid table", () => {
    expect(GRIDS).toEqual({ 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 10: [2, 5], 12: [3, 4] });
    expect(gridOf(6)).toEqual({ rows: 2, cols: 3, tidy: true });
    expect(gridOf(9)).toEqual({ rows: 3, cols: 3, tidy: true });
    expect(gridOf(7)).toEqual({ rows: 3, cols: 3, tidy: false });
    expect(gridOf(5)).toEqual({ rows: 2, cols: 3, tidy: false });
    expect(gridOf(13)).toEqual({ rows: 4, cols: 4, tidy: false });
    expect(() => gridOf(0)).toThrow();
  });

  test("timeline is contiguous and in tenths", () => {
    const line = shotTimeline([{ dur: 2.5 }, { dur: 3.3 }, { dur: 4.2 }]);
    expect(line).toEqual([
      { shot: 1, start: 0, end: 2.5, dur: 2.5 },
      { shot: 2, start: 2.5, end: 5.8, dur: 3.3 },
      { shot: 3, start: 5.8, end: 10, dur: 4.2 },
    ]);
  });

  test("a patch at the end of a part widens backwards and offsets into the patch clip", () => {
    const shots = fixtureEpisode().parts[0].shots;
    const plan = patchPlan(shots, 9, 9);
    expect(plan).toEqual({ shots: [9, 9], covered: [9, 9], extended: false, span: [26, 30], offset: 0, seconds: 4, requestSeconds: 4 });
    const short = patchPlan([{ dur: 3 }, { dur: 2 }, { dur: 2 }], 3, 3);
    expect(short.covered).toEqual([2, 3]);
    expect(short.offset).toBe(2);
    expect(short.span).toEqual([5, 7]);
    expect(short.requestSeconds).toBe(4);
  });

  test("fractional coverage rounds the request up to whole seconds", () => {
    const plan = patchPlan([{ dur: 2.5 }, { dur: 2.5 }, { dur: 5 }], 1, 2);
    expect(plan.seconds).toBe(5);
    const odd = patchPlan([{ dur: 2.5 }, { dur: 2 }, { dur: 5.5 }], 1, 2);
    expect(odd.seconds).toBe(4.5);
    expect(odd.requestSeconds).toBe(5);
  });

  test("an out-of-range patch is refused", () => {
    expect(() => patchPlan([{ dur: 3 }], 1, 2)).toThrow(/within 1–1/);
    expect(() => patchPlan([{ dur: 3 }, { dur: 3 }], 2, 1)).toThrow();
  });
});

describe("bible hashing, locks and versions", () => {
  test("field hashes ignore key order and treat absent like empty", () => {
    const a = fieldHashes("character", { id: "x", name: "X", look: "round", poses: [] });
    const b = fieldHashes("character", { look: "round", name: "X", id: "x", sheet: null, palette: [] });
    expect(a).toEqual(b);
    expect(Object.keys(a)).toEqual(["name", "look", "markings", "ability", "personality", "palette", "expressions", "poses", "sheet"]);
    // A palette may be a list or a label → colour object; empty is the same as absent.
    expect(fieldHashes("character", { palette: {} }).palette).toBe(fieldHashes("character", {}).palette);
    expect(fieldHashes("character", { palette: { shell: "#f97316" } }).palette).not.toBe(fieldHashes("character", {}).palette);
  });

  test("an unlocked bible is version 0; each lock adds one", () => {
    const bible = fixtureBible();
    expect(bibleVersion(bible)).toBe(0);
    const v1 = locked(bible);
    expect(bibleVersion(v1)).toBe(1);
    expect(bibleVersion(locked(v1))).toBe(2);
    expect(Object.keys(v1.locks[0].hashes)).toEqual(["style", "character:lamp", "character:ox", "group:notes", "scene:office"]);
  });

  test("lock states: unlocked → locked → edited, naming the field", () => {
    const bible = fixtureBible();
    expect(lockStates(bible)["character:ox"].state).toBe("unlocked");
    const v1 = locked(bible);
    expect(lockStates(v1)["character:ox"]).toEqual({ state: "locked", version: 1, changed: [] });
    v1.characters[1].look = "a stout cartoon ox, both horns whole";
    expect(lockStates(v1)["character:ox"]).toEqual({ state: "edited", version: 1, changed: ["look"] });
    expect(lockStates(v1)["character:lamp"].state).toBe("locked");
  });

  test("every edit to any bible field changes the bible's hashes", () => {
    const before = bibleFieldHashes(fixtureBible());
    for (const mutate of [
      (b: Bible) => { b.style = "flat 2D"; },
      (b: Bible) => { b.characters[0].ability = "glows brighter"; },
      (b: Bible) => { b.characters[0].palette = ["#000"]; },
      (b: Bible) => { b.groups[0].look = "blue notes"; },
      (b: Bible) => { b.scenes[0].sheet = "scene-office-sheet-9"; },
    ]) {
      const bible = fixtureBible();
      mutate(bible);
      expect(bibleFieldHashes(bible)).not.toEqual(before);
    }
  });
});

describe("shot under an older bible", () => {
  test("the basis records only what the episode consumes", () => {
    const basis = shotBasis(fixtureBible(), fixtureEpisode());
    expect(consumedKeys(fixtureEpisode())).toEqual(["style", "character:lamp", "character:ox", "group:notes", "scene:office"]);
    expect(Object.keys(basis.fields)).toEqual(["style", "character:lamp", "character:ox", "group:notes", "scene:office"]);
    expect(Object.keys(basis.fields["character:lamp"])).toEqual(["name", "look", "markings", "sheet"]);
    expect(Object.keys(basis.fields["group:notes"])).toEqual(["name", "look", "leader", "markings", "sheet"]);
    expect(Object.keys(basis.fields["scene:office"])).toEqual(["name", "look", "time", "rules", "sheet"]);
    expect(Object.keys(basis.fields.style)).toEqual(["style", "ratio", "dialogue"]);
  });

  test("a take shot under v1 is flagged after a locked v2 changes a cast member's look", () => {
    const v1 = locked(fixtureBible());
    const basis = shotBasis(v1, fixtureEpisode());
    expect(basis.version).toBe(1);
    expect(bibleFlag(v1, basis).stale).toBe(false);

    const edited = structuredClone(v1);
    edited.characters[1].look = "a stout cartoon ox, both horns whole";
    // Edited but not locked: the bible in force is still v1.
    expect(bibleFlag(edited, basis).stale).toBe(false);

    const v2 = locked(edited);
    const flag = bibleFlag(v2, basis);
    expect(flag).toEqual({ stale: true, shotUnder: 1, latest: 2, changes: [{ key: "character:ox", name: "Ox", fields: ["look"] }], acknowledged: false });
  });

  test("a change to someone not in the episode, or to a field no shot consumes, raises nothing", () => {
    const bible = fixtureBible();
    bible.characters.push({ id: "fern", name: "Fern", look: "a potted fern", sheet: null });
    const v1 = locked(bible);
    const basis = shotBasis(v1, fixtureEpisode());
    const v2 = structuredClone(v1);
    v2.characters[2].look = "a tall potted fern";
    v2.characters[0].personality = "calm now";
    v2.characters[0].ability = "folds flat";
    expect(bibleFlag(locked(v2), basis).stale).toBe(false);
  });

  test("re-picking a cast member's sheet flags the take", () => {
    const bible = fixtureBible();
    bible.characters[0].sheet = "char-lamp-sheet-1";
    const basis = shotBasis(locked(bible), fixtureEpisode());
    const v2 = locked(bible);
    v2.characters[0].sheet = "char-lamp-sheet-3";
    expect(basisChanges(locked(v2), basis)).toEqual([{ key: "character:lamp", name: "Lamp", fields: ["sheet"] }]);
  });

  test("with no lock at all, the current text is the reference", () => {
    const bible = fixtureBible();
    const basis = shotBasis(bible, fixtureEpisode());
    bible.scenes[0].look = "the office at night";
    const flag = bibleFlag(bible, basis);
    expect(flag.stale).toBe(true);
    expect(flag.changes).toEqual([{ key: "scene:office", name: "open-plan office", fields: ["look"] }]);
  });

  test("acknowledging the latest version quiets the flag; a newer lock raises it again", () => {
    const v1 = locked(fixtureBible());
    const basis = shotBasis(v1, fixtureEpisode());
    const changed = structuredClone(v1);
    changed.style = "flat 2D cutout";
    const v2 = locked(changed);
    expect(bibleFlag(v2, basis, 2)).toMatchObject({ stale: false, acknowledged: true });
    const again = structuredClone(v2);
    again.characters[0].look = "a taller lamp";
    expect(bibleFlag(locked(again), basis, 2).stale).toBe(true);
  });

  test("a sheet's basis covers its own design fields and the sheet style", () => {
    const bible = fixtureBible();
    const basis = sheetBasis(bible, "character", "lamp");
    expect(Object.keys(basis.fields)).toEqual(["style", "character:lamp"]);
    expect(Object.keys(basis.fields["character:lamp"])).toEqual(["name", "look", "expressions", "poses"]);
    bible.characters[0].poses = ["sitting"];
    expect(basisChanges(bible, basis)).toEqual([{ key: "character:lamp", name: "Lamp", fields: ["poses"] }]);
  });
});

describe("shot staleness", () => {
  test("an edited desc marks that shot for the clip; a sketch-only edit marks it for the board only", () => {
    const episode = fixtureEpisode();
    const part = episode.parts[0];
    const board = boardShotHashes(part);
    const clip = clipShotHashes(part);
    part.shots[6].desc = "they reach the door, it swings open onto a wall";
    expect(staleShots(clip, clipShotHashes(part))).toEqual([7]);
    expect(staleShots(board, boardShotHashes(part))).toEqual([7]);
    part.shots[2].sketch = "Lamp's arm as a bridge";
    expect(staleShots(board, boardShotHashes(part))).toEqual([3, 7]);
    expect(staleShots(clip, clipShotHashes(part))).toEqual([7]);
  });

  test("a duration drag marks the clip, not the board; a changed count marks everything", () => {
    const part = fixtureEpisode().parts[0];
    const board = boardShotHashes(part);
    const clip = clipShotHashes(part);
    part.shots = rebalance(part.shots, 4, 5);
    expect(staleShots(clip, clipShotHashes(part))).toEqual([4, 5, 6]);
    expect(staleShots(board, boardShotHashes(part))).toEqual([]);
    expect(staleShots(board, boardShotHashes({ shots: part.shots.slice(1) }))).toHaveLength(8);
  });
});

describe("picks, checks, record, stage", () => {
  const status: Record<string, string> = {
    "b-1": "ready", "b-2": "failed", "b-3": "ready", "t-1": "ready", "t-2": "generating", "r-1": "ready", "f-1": "ready",
  };
  const statusOf = (id: string) => status[id];

  test("the human's pick wins when ready; otherwise the newest ready candidate", () => {
    expect(effectivePick("b-1", ["b-1", "b-2", "b-3"], statusOf)).toEqual({ asset: "b-1", picked: true });
    expect(effectivePick(undefined, ["b-1", "b-2", "b-3"], statusOf)).toEqual({ asset: "b-3", picked: false });
    expect(effectivePick("b-2", ["b-1", "b-2"], statusOf)).toEqual({ asset: "b-1", picked: false });
    expect(effectivePick(null, ["b-2"], statusOf)).toEqual({ asset: null, picked: false });
  });

  test("unjudged cells are unverified, never ok; accepted drift is per take; groups have cells too", () => {
    const episode = fixtureEpisode();
    const checks = {
      "7": { ox: { verdict: "drift" as const, note: "right horn missing", frame: "s7", at: 1 } },
      "1": { lamp: { verdict: "ok" as const, note: "", frame: null, at: 1 }, "group:notes": { verdict: "absent" as const, note: "", frame: null, at: 1 } },
    };
    const cells = checkCells(episode, "A", "t-1", checks, [{ take: "t-1", shot: 7, character: "ox" }]);
    expect(cells).toHaveLength(27); // 9 shots × (2 cast + 1 group)
    expect(cells.filter((c) => c.verdict === "unverified")).toHaveLength(24);
    expect(cells.find((c) => c.shot === 7 && c.character === "ox")).toEqual({ shot: 7, kind: "character", id: "ox", character: "ox", verdict: "drift", note: "right horn missing", frame: "s7", accepted: true, expected: null, source: "t-1" });
    expect(cells.find((c) => c.shot === 1 && c.kind === "group")).toMatchObject({ id: "notes", character: "group:notes", verdict: "absent" });
    const other = checkCells(episode, "A", "t-9", checks, [{ take: "t-1", shot: 7, character: "ox" }]);
    expect(other.find((c) => c.shot === 7 && c.character === "ox")?.accepted).toBe(false);
  });

  test("a shot's words say who it should show; a word that only contains a one-character name does not", () => {
    const cells = checkCells(fixtureEpisode(), "A", "t-1", {}, [], { bible: fixtureBible() });
    const expected = (shot: number) => cells.filter((c) => c.shot === shot && c.expected).map((c) => c.id);
    expect(expected(1)).toEqual(["lamp", "ox"]);
    expect(expected(2)).toEqual(["notes"]); // "the sticky notes" names the group, case aside
    expect(expected(6)).toEqual(["ox"]); // "the note swarm" does not
    expect(expected(5)).toEqual(["lamp", "ox"]);
    expect(cells.every((c) => c.expected === true || c.expected === null)).toBe(true);
    expect(namesEntity("光从显示器后面飘出来", "光")).toBe(true);
    expect(namesEntity("牛马驮着文件；光在前面开路", "光")).toBe(true);
    expect(namesEntity("显示器的冷蓝光照着它", "光")).toBe(false);
    expect(namesEntity("便利贴群扑上来", "便利贴群")).toBe(true);
    expect(namesEntity("Oxford is closed", "Ox")).toBe(false);
    expect(namesEntity("then ox charges", "Ox")).toBe(true);
    expect(expectedIn({ desc: "x", sketch: "Lamp's arm" }, { name: "Lamp" })).toBe(true);
  });

  test("a shot spliced from a patch is judged on the patch, not on the take it replaced", () => {
    const episode = fixtureEpisode();
    const partSlots = {
      boards: [], panels: [], takes: [], reviews: [],
      patches: [{ asset: "p-1", take: "t-1", shots: [7, 7] as [number, number], covered: [7, 8] as [number, number], span: [19, 22] as [number, number], offset: 0, length: 3, seconds: 7, requestSeconds: 7, board: "b-1", refs: [], basis: { version: 0, fields: {} }, shotHashes: [] }],
      checks: {
        "t-1": { "7": { ox: { verdict: "drift" as const, note: "horn", frame: null, at: 1 } }, "8": { ox: { verdict: "ok" as const, note: "", frame: null, at: 1 } } },
        "p-1": { "7": { ox: { verdict: "ok" as const, note: "fixed by the patch", frame: null, at: 2 } } },
      },
    };
    const ready = (id: string) => (id === "p-1" || id === "t-1" ? "ready" : undefined);
    const cells = partCells(episode, "A", partSlots, "t-1", ready);
    expect(cells.find((c) => c.shot === 7 && c.id === "ox")).toMatchObject({ verdict: "ok", source: "p-1", note: "fixed by the patch" });
    expect(cells.find((c) => c.shot === 7 && c.id === "lamp")).toMatchObject({ verdict: "unverified", source: "p-1" });
    expect(cells.find((c) => c.shot === 8 && c.id === "ox")).toMatchObject({ verdict: "ok", source: "t-1" });
    // A patch that is not ready is not in the cut: the take's verdict stands.
    const pending = partCells(episode, "A", partSlots, "t-1", (id) => (id === "t-1" ? "ready" : "generating"));
    expect(pending.find((c) => c.shot === 7 && c.id === "ox")).toMatchObject({ verdict: "drift", source: "t-1" });
    expect(appliedPatches(partSlots, "t-1", ready).kept.map((p) => p.asset)).toEqual(["p-1"]);
  });

  test("the derived record: locations default to the scene's name", () => {
    const one = { ...fixtureEpisode(), log: { goal: "leave at six", abilities: ["Ox carries Lamp"], ending: "blank note on the face" } };
    const two = { ...fixtureEpisode(), id: "ep02", scene: null, log: { location: "rooftop", goal: "last coffee", abilities: ["Lamp's long arm", "Ox carries Lamp"], ending: "coffee spills" } };
    const three = { ...fixtureEpisode(), id: "ep03", log: null };
    const ideas = usedIdeas(fixtureBible(), [one, two, three]);
    expect(ideas.episodes.map((e) => [e.episode, e.location])).toEqual([["ep01", "open-plan office"], ["ep02", "rooftop"]]);
    expect(ideas.abilities).toEqual(["Ox carries Lamp", "Lamp's long arm"]);
    expect(ideas.endings).toEqual(["blank note on the face", "coffee spills"]);
  });

  test("the stage walks draft → planned → boarded → shot → reviewed → done", () => {
    const episode = fixtureEpisode();
    const slots = (over: Partial<EpisodeSlots["parts"]["A"]> = {}, finals: EpisodeSlots["finals"] = []): EpisodeSlots => ({
      prompts: {},
      finals,
      parts: { A: { boards: [], panels: [], takes: [], patches: [], reviews: [], checks: {}, ...over } },
    });
    const board = { asset: "b-1", basis: { version: 0, fields: {} }, shots: [], refs: [] };
    const take = { asset: "t-1", board: "b-1", refs: [], basis: { version: 0, fields: {} }, shots: [], durs: [], setup: "", resolution: "480p", seconds: 30 };
    expect(episodeStage({ ...episode, parts: [] }, null, statusOf).stage).toBe("draft");
    expect(episodeStage(episode, slots(), statusOf).stage).toBe("planned");
    expect(episodeStage(episode, slots({ boards: [board] }), statusOf).stage).toBe("boarded");
    expect(episodeStage(episode, slots({ boards: [board], takes: [{ ...take, asset: "t-2" }] }), statusOf)).toEqual({ stage: "boarded", busy: true, unverified: 0, finalReady: false });
    expect(episodeStage(episode, slots({ boards: [board], takes: [take] }), statusOf).stage).toBe("shot");
    const review = { asset: "r-1", take: "t-1", strips: [], cuts: [] };
    expect(episodeStage(episode, slots({ boards: [board], takes: [take], reviews: [review] }), statusOf).stage).toBe("reviewed");
    const final = { asset: "f-1", takes: { A: "t-1" }, patches: [], parts: [], splices: [] };
    // A final exists, but nothing has been judged: built, not done.
    expect(episodeStage(episode, slots({ boards: [board], takes: [take], reviews: [review] }, [final]), statusOf))
      .toEqual({ stage: "reviewed", busy: false, unverified: 27, finalReady: true });
    const judged: Record<string, Record<string, { verdict: "ok" | "absent"; note: string; frame: null; at: number }>> = {};
    for (let shot = 1; shot <= 9; shot += 1) {
      judged[String(shot)] = { lamp: { verdict: "ok", note: "", frame: null, at: 1 }, ox: { verdict: "ok", note: "", frame: null, at: 1 }, "group:notes": { verdict: "absent", note: "", frame: null, at: 1 } };
    }
    expect(episodeStage(episode, slots({ boards: [board], takes: [take], reviews: [review], checks: { "t-1": judged } }, [final]), statusOf))
      .toEqual({ stage: "done", busy: false, unverified: 0, finalReady: true });
    const oldFinal = { ...final, takes: { A: "t-0" } };
    expect(episodeStage(episode, slots({ boards: [board], takes: [take], reviews: [review], checks: { "t-1": judged } }, [oldFinal]), statusOf).stage).toBe("reviewed");
  });
});

describe("round 2: live-run rules", () => {
  test("a field added after a lock reads as unchanged while empty, and as edited once written", () => {
    const bible = fixtureBible();
    const entry = lockEntry(bible, "2026-10-29T00:00:00.000Z");
    // A lock written before scenes had `rules`.
    delete entry.fields["scene:office"].rules;
    bible.locks = [entry];
    expect(lockStates(bible)["scene:office"]).toEqual({ state: "locked", version: 1, changed: [] });
    const basis = shotBasis(bible, fixtureEpisode());
    expect(basisChanges(bible, basis)).toEqual([]);
    bible.scenes[0].rules = "the clock face has no numbers";
    expect(lockStates(bible)["scene:office"]).toMatchObject({ state: "edited", changed: ["rules"] });
    // A take that consumed the empty rule is flagged once a lock carries one.
    bible.locks.push(lockEntry(bible, "2026-10-29T01:00:00.000Z"));
    expect(basisChanges(bible, basis)).toEqual([{ key: "scene:office", name: "open-plan office", fields: ["rules"] }]);
    // A record that predates the field compares only what it consumed (no false flag on old sheets).
    const old = structuredClone(basis);
    delete old.fields["scene:office"].rules;
    expect(basisChanges(bible, old)).toEqual([]);
  });

  test("a shot an applied patch re-shot is current; one edited after the patch is not", () => {
    const episode = fixtureEpisode();
    const part = episode.parts[0];
    const take = { asset: "t-1", shots: clipShotHashes(part) };
    const edited = structuredClone(part);
    edited.shots[7].desc = "the clock strikes six; Lamp lights the clock face";
    const now = clipShotHashes(edited);
    const ready = (id: string) => (["t-1", "p-1"].includes(id) ? "ready" : undefined);
    const patch = { asset: "p-1", take: "t-1", shots: [8, 8] as [number, number], covered: [8, 9] as [number, number], span: [22, 26] as [number, number], offset: 0, length: 4, seconds: 8, requestSeconds: 8, board: "b", refs: [], basis: { version: 0, fields: {} }, shotHashes: now };
    expect(cutStaleShots(take, { patches: [] }, ready, now)).toEqual([8]);
    expect(cutStaleShots(take, { patches: [patch] }, ready, now)).toEqual([]);
    // A patch still generating is not in the cut.
    expect(cutStaleShots(take, { patches: [patch] }, (id) => (id === "t-1" ? "ready" : "generating"), now)).toEqual([8]);
    // Edited again after the patch: stale on the patch's record.
    const again = structuredClone(edited);
    again.shots[7].sfx = "a different bell";
    expect(cutStaleShots(take, { patches: [patch] }, ready, clipShotHashes(again))).toEqual([8]);
    // A changed shot count marks every shot.
    expect(cutStaleShots(take, { patches: [] }, ready, now.slice(0, 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("a splice point meets a detected cut within half a second, otherwise stays", () => {
    expect(snapToCut(24, [2.96, 5.88, 23.63, 24.54])).toBe(23.63);
    expect(snapToCut(27, [26.79, 27.6])).toBe(26.79);
    expect(snapToCut(16, [15.4, 16.7])).toBe(16);
    expect(snapToCut(16, [])).toBe(16);
  });

  test("a splice end with no detected cut within half a second is named; the clip's own ends never are", () => {
    // The take cut at 15.7 s for shot 6 (planned at 16) and nowhere near 19.
    expect(uncutSpliceEnds([16, 19], [15.7], 30)).toEqual([19]);
    expect(uncutSpliceEnds([16, 19], [15.7, 19.4], 30)).toEqual([]);
    // 0.6 s away is too far: final would splice at the planned second.
    expect(uncutSpliceEnds([16, 19], [15.4, 19.6], 30)).toEqual([16, 19]);
    // The start and the end of the take are not splice points.
    expect(uncutSpliceEnds([0, 6], [], 30)).toEqual([6]);
    expect(uncutSpliceEnds([24, 30], [24.2], 30)).toEqual([]);
    // An unknown length excludes only the start.
    expect(uncutSpliceEnds([16, 30], [], null)).toEqual([16, 30]);
  });

  test("names in the middle of a sentence, aliases and a group's leader count; compounds do not", () => {
    const guang = { id: "guang", name: "光" };
    expect(expectedIn({ desc: "分针跳到十一点整；同一瞬间光飘到挂钟前" }, guang)).toBe(true);
    expect(expectedIn({ desc: "显示器的冷蓝光照着它的眼袋" }, guang)).toBeNull();
    expect(expectedIn({ desc: "顶灯的灯光一齐熄灭" }, guang)).toBeNull();
    expect(expectedIn({ desc: "屏幕的蓝光很刺眼" }, { ...guang, notNames: [] })).toBeNull();
    expect(expectedIn({ desc: "屏幕上一片白光" }, guang)).toBe(true); // not a listed compound: counts
    expect(expectedIn({ desc: "屏幕上一片白光" }, { ...guang, notNames: ["白光"] })).toBeNull();
    const stickies = { id: "stickies", name: "便利贴群", leader: "一张三倍大的红色便利贴" };
    expect(expectedIn({ desc: "红色头目晃晃悠悠飘下来" }, stickies)).toBe(true);
    expect(expectedIn({ desc: "红色头目晃晃悠悠飘下来" }, { ...stickies, leader: "" })).toBeNull();
    expect(expectedIn({ desc: "几张便利贴飘落" }, { ...stickies, aliases: ["便利贴"] })).toBe(true);
    expect(expectedIn({ desc: "the leader slaps onto Ox" }, { id: "notes", name: "Sticky Notes", leader: "a red note" })).toBe(true);
    expect(namesEntity("冷蓝光", "光", [])).toBe(false);
  });
});
