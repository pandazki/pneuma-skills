/**
 * domain.ts — the viewer's reading of a series and the edits it writes.
 *
 * Every status here must agree with series-state.mjs (the rules the scripts
 * refuse to spend against) and every cost with craft's summarizeCosts; the
 * tests read both sides rather than restating numbers.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { landAsset, reserveAsset, summarizeCosts } from "../../_shared/scripts/craft-project.mjs";
import {
  acceptDrift,
  acknowledgeBible,
  cellName,
  cellVerdict,
  dragShotBorder,
  findCard,
  findEpisode,
  inFlight,
  isLostBeat,
  loadSeries,
  lockBible,
  partAt,
  pickSheet,
  pickStoryboard,
  pickTake,
  saveSeries,
  setEntityField,
  setShotText,
  shotAt,
  shotClip,
  shotSpan,
  type Series,
} from "../domain.js";
import { extractSeriesContext } from "../pneuma-mode.js";
import { lockStates } from "../skill/scripts/series-state.mjs";
import { stageLabel, stageTone } from "../viewer/SeasonRail.js";
import { spendLines } from "../viewer/SeasonViews.js";
import { seriesStrings } from "../viewer/strings.js";
import { callLabel } from "../viewer/view-model.js";
import { buildSeriesWorkspace, cleanupWorkspaces, FAILED_TAKE, readSeriesFiles, SEED_DIR, T0, withFailedTake, withFile } from "./series-workspace.js";

let files: ReturnType<typeof readSeriesFiles>;
let series: Series;

beforeAll(() => {
  files = readSeriesFiles(buildSeriesWorkspace());
  series = loadSeries(files);
});
afterAll(cleanupWorkspaces);

const ep = (s: Series, id: string) => {
  const found = findEpisode(s, id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};
const writtenPaths = (next: Series, current = files) => saveSeries(next, current).writes.map((w) => w.path).sort();

describe("the shipped seed", () => {
  const seedFiles = readSeriesFiles(SEED_DIR);
  const seed = loadSeries(seedFiles);

  test("is a locked bible whose every card has a ready sheet on disk", () => {
    expect(seed.hasBible).toBe(true);
    expect(seed.projectError).toBeNull();
    expect(seed.version).toBe(1);
    const states = lockStates(seed.bible);
    expect(seed.cards.map((c) => c.key).sort()).toEqual(Object.keys(states).filter((k) => k !== "style").sort());
    for (const card of seed.cards) {
      expect(card.lock.state).toBe(states[card.key].state);
      expect(card.lock.state).toBe("locked");
      expect(card.sheetState).toBe("ready");
      expect(existsSync(join(SEED_DIR, card.sheet!.uri))).toBe(true);
    }
  });

  test("ships the redesigned 牛马 only: two ox candidates, the first picked", () => {
    const niuma = findCard(seed, "character", "niuma")!;
    expect(niuma.candidates.map((c) => c.id)).toEqual(["char-niuma-sheet-1", "char-niuma-sheet-2"]);
    expect(niuma.sheet?.id).toBe("char-niuma-sheet-1");
    expect(niuma.candidates.every((c) => c.check?.verdict === "ok" && c.outdated.length === 0)).toBe(true);
    expect(String((niuma.entity as { look: string }).look)).toContain("小牛");
  });

  // ep01 is the 2026-10-29 live run, delivered: boarded (shot 6 redrawn),
  // shot, checked shot by shot, shot 8 re-shot from rewritten words and
  // spliced in on the clips' own cuts. scripts-seed.test.ts pins the same
  // reading from `series.mjs status`.
  test("ep01 is done: every cell judged, the re-shot shot on its patch", () => {
    const ep01 = ep(seed, "ep01");
    expect(ep01.stage).toBe("done");
    expect(ep01.unverified).toBe(0);
    expect(ep01.parts).toHaveLength(1);
    const part = ep01.parts[0];
    expect(part.timeline.at(-1)?.end).toBe(30);
    // 9 shots × (光, 牛马, 便利贴群); one cast member lost from shot 1.
    expect(part.checks).toHaveLength(27);
    expect(ep01.checks).toEqual({ ok: 15, drift: 3, absent: 9, accepted: 0, unverified: 0, lost: 1 });
    expect(part.checks.filter((c) => c.shot === 8).map((c) => c.source)).toEqual(Array(3).fill("ep01-a-patch-8-8-1"));
    expect(part.checks.filter((c) => c.shot !== 8).every((c) => c.source === "ep01-a-take-1")).toBe(true);
    // Shot 8's words were rewritten after the board and re-shot from the new
    // words: the board is behind, the clip in effect is not.
    expect(part.staleBoard).toEqual([8]);
    expect(part.staleClip).toEqual([]);
    expect(ep01.flag).toMatchObject({ stale: false, shotUnder: 1, latest: 1 });
    const open = [findCard(seed, "character", "guang")!, findCard(seed, "character", "niuma")!, findCard(seed, "group", "stickies")!]
      .flatMap((card) => card.drift.map((d) => `${d.check}@${d.shot}${d.accepted ? " accepted" : ""}`));
    expect(open).toEqual(["guang@7", "niuma@9", "group:stickies@9"]);
  });

  test("the picker and the takes list have something to show", () => {
    const part = ep(seed, "ep01").parts[0];
    expect(part.boards.map((b) => [b.record.asset, b.view.status])).toEqual([
      ["ep01-a-board-1", "ready"],
      ["ep01-a-board-2", "ready"],
    ]);
    expect(part.board?.record.asset).toBe("ep01-a-board-2");
    expect(part.boardPicked).toBe(true);
    // board-2 is board-1 with shot 6's panel redrawn into it.
    const composite = seed.project!.provenance.find((e) => e.toAssetId === "ep01-a-board-2")!;
    expect(composite.operation.type).toBe("composite");
    expect(composite.operation.params?.inputs).toEqual(["ep01-a-board-1", "ep01-a-panel-6-1"]);
    expect(part.take?.record.asset).toBe("ep01-a-take-1");
    expect(part.patches.map((p) => p.record.asset)).toEqual(["ep01-a-patch-8-8-1"]);
    for (const review of part.reviews) {
      for (const strip of review.record.strips ?? []) expect(existsSync(join(SEED_DIR, seed.assets[strip.asset].uri))).toBe(true);
    }
    expect(seed.lineup).toMatchObject({ names: ["光", "牛马"], stale: false });
  });

  test("the final splices the patch on the clips' detected cuts, not the planned seconds", () => {
    const ep01 = ep(seed, "ep01");
    expect(ep01.final?.record.asset).toBe("ep01-final-2");
    expect(ep01.final?.view.status).toBe("ready");
    const [splice] = ep01.final!.record.splices!;
    expect(splice).toMatchObject({ patch: "ep01-a-patch-8-8-1", shots: [8, 8], planned: { take: [24, 27], patch: [0, 3] } });
    // Every moved point is a scene cut the review detected in that clip.
    const cutsOf = (clip: string) => ep01.parts[0].reviews.find((r) => r.record.take === clip)!.record.cuts!;
    expect(cutsOf("ep01-a-take-1")).toEqual(expect.arrayContaining(splice.snapped!.take));
    expect(splice.snapped!.take).toEqual([23.63, 26.79]);
    expect(cutsOf("ep01-a-patch-8-8-1")).toContain(splice.snapped!.patch[1]);
    expect(splice.at).toEqual([23.63, 26.63]);
    // The file on disk is that build: the take, shortened by what the splice took out.
    const take = seed.assets["ep01-a-take-1"].duration!;
    const removed = splice.snapped!.take[1] - splice.snapped!.take[0] - (splice.snapped!.patch[1] - splice.snapped!.patch[0]);
    expect(Math.abs(ep01.final!.view.duration! - (take - removed))).toBeLessThan(1 / 24);
  });

  test("costs: the run's real spend, bucketed per episode, totalled by craft", () => {
    const ep01 = ep(seed, "ep01");
    const { cost } = ep01;
    expect([cost.boards.count, cost.panels.count, cost.takes.count, cost.patches.count]).toEqual([2, 1, 1, 1]);
    expect(cost.total).toBeCloseTo(cost.boards.usd + cost.panels.usd + cost.takes.usd + cost.patches.usd, 6);
    expect(cost.total).toBeCloseTo(7.5813, 6);
    expect(cost.unpriced).toBe(0);
    const craft = summarizeCosts(seed.project!);
    expect(seed.cost.total).toBe(craft.total);
    expect(craft.total).toBeCloseTo(7.9894, 6);
    expect(craft.calls).toBe(12);
    expect([craft.unpriced, craft.uncertain, craft.inFlight]).toEqual([[], [], []]);
    // The season is the sheets, the lineup and the one episode.
    const lineup = seed.project!.provenance.find((e) => e.toAssetId === "lineup-1")!.operation.params!.cost!.usd!;
    expect(seed.cost.total).toBeCloseTo(seed.cost.sheets + lineup + cost.total, 4);
  });

  test("the season spend card's lines add up to its total, the lineup on its own line", () => {
    const lines = spendLines(seed, seriesStrings("en"));
    expect(lines.map((l) => l.key)).toEqual(["sheets", "lineups", "ep01"]);
    const lineup = seed.project!.provenance.find((e) => e.toAssetId === "lineup-1")!.operation.params!.cost!.usd!;
    expect(lines.find((l) => l.key === "lineups")!.usd).toBeCloseTo(lineup, 6);
    expect(seed.cost.other).toBe(0);
    expect(lines.reduce((sum, l) => sum + l.usd, 0)).toBeCloseTo(seed.cost.total, 4);
  });

  test("re-saving an unedited seed writes nothing", () => {
    expect(saveSeries(seed, seedFiles)).toEqual({ writes: [], deletes: [] });
  });
});

describe("loading what is on disk", () => {
  test("an empty workspace is a series with no bible, not a null", () => {
    const empty = loadSeries([]);
    expect(empty.hasBible).toBe(false);
    expect(empty.episodes).toEqual([]);
    expect(empty.cards).toEqual([]);
  });

  test("unreadable files are named, and what does read still loads", () => {
    const broken = loadSeries(
      withFile(withFile(files, "episodes/ep09/episode.json", "{ nope"), "project.json", "[]"),
    );
    expect(broken.broken.map((b) => b.id)).toEqual(["ep09"]);
    expect(broken.projectError).toBeTruthy();
    expect(broken.episodes.map((e) => e.id)).toEqual(["ep01", "ep02"]);
    const noBible = loadSeries(withFile(files, "bible.json", "{"));
    expect(noBible.bibleError).toBeTruthy();
    expect(noBible.hasBible).toBe(false);
  });
});

describe("an episode after shooting", () => {
  test("two storyboards: the newest stands in until one is picked", () => {
    const part = ep(series, "ep01").parts[0];
    expect(part.boards.map((b) => b.record.asset)).toEqual(["ep01-a-board-1", "ep01-a-board-2"]);
    expect(part.board?.record.asset).toBe("ep01-a-board-2");
    expect(part.boardPicked).toBe(false);
    expect(part.take?.record.asset).toBe("ep01-a-take-1");
    expect(ep(series, "ep01").stage).toBe("shot");
  });

  test("check cells keep absent apart from ok, drift and unverified", () => {
    const ep01 = ep(series, "ep01");
    const cell = (shot: number, character: string) =>
      ep01.parts[0].checks.find((c) => c.shot === shot && c.character === character)!;
    expect(cellVerdict(cell(1, "guang"))).toBe("ok");
    expect(cellVerdict(cell(2, "guang"))).toBe("absent");
    expect(cellVerdict(cell(7, "niuma"))).toBe("drift");
    expect(cellVerdict(cell(5, "guang"))).toBe("unverified");
    expect(ep01.checks).toMatchObject({ ok: 2, drift: 1, absent: 1, accepted: 0 });
    // Shot 2's words name 光, so "not in shot" there is a lost beat — the
    // same reading `series.mjs status` reports.
    expect(String(ep01.parts[0].shots[1].desc)).toContain("光");
    expect(isLostBeat(cell(2, "guang"))).toBe(true);
    expect(ep01.checks.lost).toBe(1);
    expect(ep01.checks.unverified).toBe(ep01.parts[0].checks.length - 4);
    expect(findCard(series, "character", "niuma")!.drift).toEqual([
      { episode: "ep01", part: "A", shot: 7, check: "niuma", take: "ep01-a-take-1", note: "right horn missing", accepted: false },
    ]);
  });

  test("groups are checked too, keyed group:<id> and named from their card", () => {
    const ep01 = ep(series, "ep01");
    const group = ep01.parts[0].checks.find((c) => c.shot === 1 && c.kind === "group")!;
    expect(group.character).toBe("group:stickies");
    expect(cellName(series, group)).toBe(findCard(series, "group", "stickies")!.name);
    expect(ep01.parts[0].checks.filter((c) => c.shot === 1).map((c) => c.character)).toEqual(["guang", "niuma", "group:stickies"]);
  });

  test("a look changed and re-locked after the take raises the v1 → v2 flag", () => {
    const flag = ep(series, "ep01").flag!;
    expect(series.version).toBe(2);
    expect(flag.stale).toBe(true);
    expect(flag.shotUnder).toBe(1);
    expect(flag.latest).toBe(2);
    expect(flag.changes.find((c) => c.key === "character:niuma")?.fields).toContain("look");
    const quiet = acknowledgeBible(series, "ep01", 2);
    expect(ep(quiet, "ep01").flag!.acknowledged).toBe(true);
    expect(writtenPaths(quiet)).toEqual(["episodes/ep01/episode.json"]);
  });

  test("episode cost buckets add up to the episode total; the season total is craft's", () => {
    const cost = ep(series, "ep01").cost;
    expect(cost.boards.count).toBe(2);
    expect(cost.takes.count).toBe(1);
    expect(cost.total).toBeCloseTo(cost.boards.usd + cost.panels.usd + cost.takes.usd + cost.patches.usd, 6);
    expect(series.cost.total).toBe(summarizeCosts(series.project!).total);
  });
});

describe("a reviewed episode with unchecked cells", () => {
  test("is reviewed by stage, but says how many cells nobody checked", () => {
    const project = structuredClone(series.project!) as unknown as Parameters<typeof reserveAsset>[0];
    reserveAsset(project, { id: "ep01-a-review-1", type: "image", name: "contact sheet", op: "derive", uri: "episodes/ep01/review/a-1.webp", from: ["ep01-a-take-1"] }, T0);
    landAsset(project, { id: "ep01-a-review-1", uri: "episodes/ep01/review/a-1.webp", metadata: { width: 1024, height: 1024 } }, T0 + 1);
    const slots = (project as unknown as { series: { episodes: Record<string, { parts: Record<string, { reviews: unknown[] }> }> } }).series.episodes.ep01.parts.A;
    slots.reviews.push({ asset: "ep01-a-review-1", take: "ep01-a-take-1", strips: [], cuts: [] });
    const reviewed = loadSeries(withFile(files, "project.json", JSON.stringify(project)));
    const ep01 = ep(reviewed, "ep01");
    expect(ep01.stage).toBe("reviewed");
    expect(ep01.unverified).toBe(ep01.checks.unverified);
    expect(ep01.unverified).toBeGreaterThan(0);
    const t = seriesStrings("zh-CN");
    expect(stageLabel(ep01, t)).toBe(`已拍 · ${ep01.unverified} 处未查`);
    expect(stageTone(ep01)).toBe("warn");
  });
});

describe("the season spend", () => {
  test("lines add up to the total in a season with a lineup", () => {
    const lines = spendLines(series, seriesStrings("zh-CN"));
    expect(lines.some((l) => l.key === "lineups" && l.usd > 0)).toBe(true);
    expect(lines.reduce((sum, l) => sum + l.usd, 0)).toBeCloseTo(series.cost.total, 4);
  });
});

describe("the lineup on the wall", () => {
  test("is the newest probe, named, and goes stale when a pick moves", () => {
    expect(series.lineup?.names).toEqual(["光", "牛马"]);
    expect(series.lineup?.view.status).toBe("ready");
    expect(series.lineup?.stale).toBe(false);
    const repicked = pickSheet(series, "character", "guang", "char-guang-sheet-1");
    expect(repicked.lineup?.stale).toBe(true);
  });
});

describe("the 60 s episode: two parts on one clock", () => {
  test("part B starts at 30 s; time resolves to its part and shot", () => {
    const ep02 = ep(series, "ep02");
    expect(ep02.parts.map((p) => [p.id, p.offset, p.seconds])).toEqual([
      ["A", 0, 30],
      ["B", 30, 30],
    ]);
    expect(partAt(ep02, 12)?.id).toBe("A");
    expect(partAt(ep02, 31)?.id).toBe("B");
    const b = ep02.parts[1];
    expect(shotAt(b, 31)).toBe(1);
    expect(shotSpan(b, 1)).toEqual([30, 33]);
    expect(ep02.stage).toBe("boarded");
  });
});

describe("in-flight work", () => {
  test("a reserved storyboard makes the episode busy and is counted once", () => {
    const project = structuredClone(series.project!) as unknown as Parameters<typeof reserveAsset>[0];
    reserveAsset(
      project,
      {
        id: "ep02-b-board-2",
        type: "image",
        name: "ep02 B storyboard",
        op: "generate",
        uri: "episodes/ep02/boards/b-2.webp",
        model: "mock",
        prompt: "grid",
        provider: "mock",
        cost: { usd: 0.05, basis: "estimate" },
      },
      Date.now(),
    );
    const slots = (project as unknown as { series: { episodes: Record<string, { parts: Record<string, { boards: unknown[] }> }> } }).series
      .episodes.ep02.parts.B;
    slots.boards.push({ ...(slots.boards[0] as object), asset: "ep02-b-board-2" });
    const busy = loadSeries(withFile(files, "project.json", JSON.stringify(project)));
    const ep02 = ep(busy, "ep02");
    expect(ep02.busy).toBe(true);
    expect(ep02.parts[1].board?.record.asset).toBe("ep02-b-board-1");
    expect(ep02.cost.boards.inFlight).toBe(0.05);
    expect(inFlight(busy).map((a) => a.id)).toEqual(["ep02-b-board-2"]);
    expect(busy.cost.total).toBe(summarizeCosts(busy.project!).total);
    expect(busy.cost.inFlight).toBe(0.05);
  });
});

describe("edits the viewer writes", () => {
  test("picking a storyboard pins it and writes only that episode", () => {
    const next = pickStoryboard(series, "ep01", "A", "ep01-a-board-1");
    const part = ep(next, "ep01").parts[0];
    expect(part.board?.record.asset).toBe("ep01-a-board-1");
    expect(part.boardPicked).toBe(true);
    const save = saveSeries(next, files);
    expect(save.writes.map((w) => w.path)).toEqual(["episodes/ep01/episode.json"]);
    expect(JSON.parse(save.writes[0].content).picks.storyboard).toEqual({ A: "ep01-a-board-1" });
    expect(save.deletes).toEqual([]);
  });

  test("a pin the scripts would refuse is refused here too", () => {
    expect(() => pickStoryboard(series, "ep01", "A", "ep01-a-take-1")).toThrow("is not a storyboard of ep01 part A");
    expect(() => pickStoryboard(series, "ep01", "B", "ep01-a-board-1")).toThrow('no part "B"');
    expect(() => pickTake(series, "ep01", "A", "ep01-a-board-1")).toThrow("is not a take");
    expect(() => pickSheet(series, "character", "niuma", "nope")).toThrow("not ready");
  });

  test("accepting a drift keeps it on the record as accepted", () => {
    const next = acceptDrift(series, "ep01", "ep01-a-take-1", 7, "niuma");
    expect(ep(next, "ep01").checks).toMatchObject({ drift: 0, accepted: 1 });
    expect(findCard(next, "character", "niuma")!.drift[0].accepted).toBe(true);
    expect(acceptDrift(next, "ep01", "ep01-a-take-1", 7, "niuma").raw.episodes.ep01).toEqual(next.raw.episodes.ep01);
  });

  test("editing a shot's words marks it changed since the board and the clip", () => {
    const next = setShotText(series, "ep01", "A", 2, "desc", "a new third shot");
    const part = ep(next, "ep01").parts[0];
    expect(part.shots[2].desc).toBe("a new third shot");
    expect(part.staleBoard).toContain(3);
    expect(part.staleClip).toContain(3);
    expect(writtenPaths(next)).toEqual(["episodes/ep01/episode.json"]);
  });

  test("dragging a border moves only the neighbour, keeps the total, and holds the 2 s floor", () => {
    const before = ep(series, "ep01").parts[0].shots.map((s) => s.dur);
    const next = dragShotBorder(series, "ep01", "A", 0, before[0] + 1);
    const after = ep(next, "ep01").parts[0].shots.map((s) => s.dur);
    expect(after[0]).toBe(before[0] + 1);
    expect(after[1]).toBe(before[1] - 1);
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(after.reduce((a, b) => a + b, 0)).toBe(30);
    expect(() => dragShotBorder(series, "ep01", "A", 0, before[0] + before[1] - 1.5)).toThrow();
  });

  test("a wall edit shows as edited; locking again makes v3 and writes only the bible", () => {
    const edited = setEntityField(series, "character", "guang", "personality", "curious, then smug");
    const guang = findCard(edited, "character", "guang")!;
    expect(guang.lock.state).toBe("edited");
    expect(guang.lock.changed).toEqual(["personality"]);
    expect(guang.lock.state).toBe(lockStates(edited.bible)["character:guang"].state);
    const locked = lockBible(edited, "2026-10-30T00:00:00.000Z");
    expect(locked.version).toBe(3);
    expect(locked.cards.every((c) => c.lock.state === "locked")).toBe(true);
    expect(writtenPaths(locked)).toEqual(["bible.json"]);
  });

  test("picking a ready sheet candidate points the entity at it", () => {
    const next = pickSheet(series, "character", "guang", "char-guang-sheet-1");
    expect(findCard(next, "character", "guang")!.sheet?.id).toBe("char-guang-sheet-1");
    expect(writtenPaths(next)).toEqual(["bible.json"]);
  });
});

// The "Made from" stamps beside a shot's check must describe the clip the
// check is judged on: a re-shot shot was made by its patch (its price, its
// length), not by the take it was spliced into (2026-10-29 e2e: shot 8 read
// "$6.19 / 30s" — the take — while its cells sat on the $1.25, 6.1 s patch).
describe("the clip a shot is made from", () => {
  const seed = loadSeries(readSeriesFiles(SEED_DIR));
  const part = ep(seed, "ep01").parts[0];

  test("is the clip its check cells are judged on: the spliced re-shoot for shot 8, the take elsewhere", () => {
    for (let n = 1; n <= part.shots.length; n++) {
      const sources = [...new Set(part.checks.filter((c) => c.shot === n).map((c) => c.source))];
      expect(sources).toHaveLength(1);
      expect(shotClip(part, n)?.asset).toBe(sources[0]);
    }
    const eight = shotClip(part, 8)!;
    expect(eight).toMatchObject({ kind: "patch", asset: "ep01-a-patch-8-8-1", seconds: 6.083, resolution: "480p" });
    expect(eight.view.spent).toBeCloseTo(1.2507, 4);
    const seven = shotClip(part, 7)!;
    expect(seven).toMatchObject({ kind: "take", asset: "ep01-a-take-1", seconds: 30.093, resolution: "480p" });
    expect(seven.view.spent).toBeCloseTo(6.1871, 4);
  });

  test("a clip opened in Takes wins only where it holds the shot", () => {
    expect(shotClip(part, 8, "ep01-a-patch-8-8-1")?.asset).toBe("ep01-a-patch-8-8-1");
    // The re-shoot does not hold shot 3: that shot is still the take's.
    expect(shotClip(part, 3, "ep01-a-patch-8-8-1")?.asset).toBe("ep01-a-take-1");
    // The raw take, opened on its own, shows its own shot 8.
    expect(shotClip(part, 8, "ep01-a-take-1")?.asset).toBe("ep01-a-take-1");
  });

  test("a part with no take has no clip to stamp", () => {
    expect(shotClip(ep(series, "ep02").parts[0], 1)).toBeNull();
  });
});

// A call that failed after it was sent may have been charged: craft keeps it
// in the total and lists it as `uncertain`. The viewer must say so where the
// money is shown, not leave it as an unexplained line in "Takes · 2".
describe("a take that failed after it was sent", () => {
  const failed = loadSeries(withFailedTake(readSeriesFiles(SEED_DIR), "provider disconnected"));

  test("is uncertain on its asset, its episode and the season — craft's own list, still counted", () => {
    const craft = summarizeCosts(failed.project!);
    expect(craft.uncertain).toEqual([FAILED_TAKE]);
    expect(failed.assets[FAILED_TAKE]).toMatchObject({ status: "failed", uncertain: [FAILED_TAKE] });
    expect(failed.assets[FAILED_TAKE].failure).toMatchObject({ reason: "provider disconnected", billing: "unknown" });
    const ep01 = ep(failed, "ep01");
    expect(ep01.cost.uncertain).toEqual(craft.uncertain);
    expect(ep01.cost.takes.count).toBe(2);
    expect(ep01.cost.total).toBeCloseTo(7.5813 + 6.1887, 4);
    expect(failed.cost.uncertain).toBe(1);
    expect(failed.cost.total).toBe(craft.total);
    // The take in effect is still the one that landed.
    expect(ep01.parts[0].take?.record.asset).toBe("ep01-a-take-1");
    expect(ep(series, "ep01").cost.uncertain).toEqual([]);
  });

  test("is named in the viewer's words, and the agent hears about it", () => {
    const t = seriesStrings("en");
    expect(callLabel(failed, FAILED_TAKE, t, "ep01")).toBe("Take 2");
    expect(callLabel(failed, FAILED_TAKE, t)).toBe("ep01 · Take 2");
    expect(callLabel(failed, `${FAILED_TAKE}#1`, t, "ep01")).toBe("Take 2 · attempt 1");
    expect(callLabel(failed, "ep01-a-patch-8-8-1", t, "ep01")).toBe("Re-shoot 8");
    expect(callLabel(failed, "char-niuma-sheet-2", t)).toBe("牛马 sheet");
    expect(callLabel(failed, "no-such-asset", t)).toBe("no-such-asset");
    expect(extractSeriesContext(null, withFailedTake(readSeriesFiles(SEED_DIR)))).toContain(`billing is unknown: ${FAILED_TAKE}`);
  });
});
