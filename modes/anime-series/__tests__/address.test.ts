/**
 * The ViewerAddress vocabulary (canvas design §9) both ways: what an
 * address resolves to on screen, what the screen reports back, and what the
 * agent reads about it. A refusal names what does exist; nothing moves.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { loadSeries, type Series } from "../domain.js";
import { extractSeriesContext, resolveSeriesItems } from "../pneuma-mode.js";
import { positionAddress, resolveAddress, START, type Position } from "../viewer/view-model.js";
import { buildSeriesWorkspace, cleanupWorkspaces, readSeriesFiles } from "./series-workspace.js";

let files: ReturnType<typeof readSeriesFiles>;
let series: Series;

beforeAll(() => {
  files = readSeriesFiles(buildSeriesWorkspace());
  series = loadSeries(files);
});
afterAll(cleanupWorkspaces);

function resolve(address: unknown, here: Position = START): Position {
  const r = resolveAddress(series, address, here);
  if (!r.ok) throw new Error(r.message);
  return r.position;
}

function refusal(address: unknown, here: Position = START): string {
  const r = resolveAddress(series, address, here);
  if (r.ok) throw new Error(`expected a refusal for ${JSON.stringify(address)}`);
  return r.message;
}

const context = (address: Record<string, unknown> | null) =>
  extractSeriesContext(address ? { type: "viewer", content: "", address } : null, files);

describe("resolving an address", () => {
  test("a time on a 60 s episode lands on the part that holds it", () => {
    const p = resolve({ episode: "ep02", time: 31 });
    expect(p).toMatchObject({ episode: "ep02", part: "B", shot: 1, time: 31 });
    expect(resolve({ episode: "ep02", range: [31, 35] })).toMatchObject({ part: "B", shot: 1, time: 31, range: [31, 35] });
    expect(resolve({ episode: "ep02", time: 12 })).toMatchObject({ part: "A" });
  });

  test("a shot starts the clock at its own start; a take opens its part on the clip lane", () => {
    expect(resolve({ episode: "ep02", part: "B", shot: 2 })).toMatchObject({ part: "B", shot: 2, time: 33 });
    expect(resolve({ episode: "ep01", take: "ep01-a-take-1" })).toMatchObject({ part: "A", take: "ep01-a-take-1", lane: "clip" });
  });

  test("a drift compare can open on a cast member or a group", () => {
    expect(resolve({ episode: "ep01", shot: 7, check: "niuma" })).toMatchObject({ shot: 7, check: "niuma" });
    expect(resolve({ episode: "ep01", shot: 1, check: "group:stickies" })).toMatchObject({ check: "group:stickies" });
  });

  test("wall cards and sheet candidates", () => {
    expect(resolve({ character: "niuma", candidate: "char-niuma-sheet-2" })).toMatchObject({
      pointer: "wall",
      focus: { kind: "character", id: "niuma" },
      candidate: "char-niuma-sheet-2",
    });
    expect(resolve({ bible: "style" })).toMatchObject({ focus: { kind: "style", id: "style" } });
    expect(resolve({ season: "overview" }).level).toBe("overview");
  });

  test("refuses by name, listing what exists", () => {
    expect(refusal({ character: "ghost" })).toBe('no character "ghost" in the bible (has: guang, niuma)');
    expect(refusal({ episode: "ep09" })).toBe('no episode "ep09" (has: ep01, ep02)');
    expect(refusal({ character: "niuma", candidate: "x" })).toContain("has: char-niuma-sheet-1, char-niuma-sheet-2");
    expect(refusal({ episode: "ep01", shot: 12 })).toContain("has shots 1–9");
    expect(refusal({ episode: "ep02", lane: "clip" })).toContain("has no clip yet");
    expect(refusal({ episode: "ep01", shot: 3, check: "stickies" })).toContain("checks guang, niuma, group:stickies");
    expect(refusal({ episode: "ep01", check: "niuma" })).toContain("check needs a shot");
    expect(refusal({ episode: "ep01", range: [5, 2] })).toContain("from < to");
    expect(refusal({ episode: "ep01", time: 31 })).toContain("0–30 s");
    expect(refusal({ episode: "ep01", take: "nope" })).toContain("has: ep01-a-take-1");
    expect(refusal({ season: "spring" })).toContain('season must be "overview"');
  });
});

describe("the address a position reports", () => {
  const roundTrips: Array<Record<string, unknown>> = [
    { episode: "ep01" },
    { episode: "ep01", shot: 3, lane: "clip" },
    { episode: "ep01", shot: 3, lane: "board", time: 7.5 },
    { episode: "ep01", shot: 7, lane: "clip", check: "niuma" },
    { episode: "ep01", shot: 2, lane: "clip", range: [4, 9] },
    { episode: "ep02", part: "B", shot: 4, lane: "board" },
    { episode: "ep02", part: "B", shot: 4, lane: "board", time: 41.5 },
    { character: "guang" },
    { scene: "office-night" },
    { group: "stickies" },
    { character: "niuma", candidate: "char-niuma-sheet-1" },
    { bible: "style" },
    { season: "overview" },
  ];

  for (const address of roundTrips) {
    test(`${JSON.stringify(address)} comes back as itself`, () => {
      const position = resolve(address);
      expect(positionAddress(series, position)).toEqual(address);
      expect(resolve(positionAddress(series, position))).toEqual(position);
    });
  }

  test("a bare time or range comes back naming the shot under it, and stays put", () => {
    const fromTime = positionAddress(series, resolve({ episode: "ep02", time: 41.5 }));
    expect(fromTime).toEqual({ episode: "ep02", part: "B", shot: 4, lane: "board", time: 41.5 });
    expect(positionAddress(series, resolve(fromTime))).toEqual(fromTime);
    const fromRange = positionAddress(series, resolve({ episode: "ep01", range: [4, 9] }));
    expect(fromRange).toEqual({ episode: "ep01", shot: 2, lane: "clip", range: [4, 9] });
    expect(positionAddress(series, resolve(fromRange))).toEqual(fromRange);
  });

  test("a single-part episode does not name its part", () => {
    expect(positionAddress(series, resolve({ episode: "ep01", part: "A", shot: 2 }))).toEqual({ episode: "ep01", shot: 2, lane: "clip" });
  });
});

describe("what the agent reads", () => {
  test("a time on the 60 s episode reads as part B's shot, not part A's", () => {
    const text = context({ episode: "ep02", time: 31 });
    expect(text).toContain("2 parts, showing B");
    expect(text).toContain("Selected: shot 1 · 30.0–33.0s · board lane");
    expect(text).toContain("Playhead: 31.0s");
    const marked = context({ episode: "ep02", range: [31, 35] });
    expect(marked).toContain("showing B");
    expect(marked).toContain("Marked: 31.0–35.0s");
  });

  test("a shot address carries its start as the playhead", () => {
    expect(context({ episode: "ep02", part: "B", shot: 2 })).toContain("Playhead: 33.0s");
  });

  test("checks name the verdicts, including the shot a character is not in", () => {
    const text = context({ episode: "ep01", shot: 7, lane: "clip", check: "niuma" });
    expect(text).toContain("Checks: 2 ok · 1 drift (shot 7 牛马: right horn missing)");
    expect(text).toContain("1 not in shot (lost beats — the shot's words name them: shot 2 光)");
    expect(text).toContain("Drift compare open: 牛马 — drift: right horn missing");
    expect(text).toContain("shot under v1");
    expect(context({ episode: "ep01", shot: 1, check: "group:stickies" })).toContain("Drift compare open: 便利贴群 — unverified");
  });

  test("a wall card and the empty workspace", () => {
    expect(context({ character: "niuma" })).toContain("Selected card: 牛马 (character niuma)");
    expect(extractSeriesContext(null, [])).toContain("No bible yet");
    expect(context(null)).toContain("Series: 光和牛马 · bible v2");
  });

  test("workspace items are the episodes", () => {
    expect(resolveSeriesItems(files).map((i) => [i.path, i.label])).toEqual([
      ["episodes/ep01/episode.json", "ep01 《准点下班》"],
      ["episodes/ep02/episode.json", "ep02 《Two parts》"],
    ]);
  });
});
