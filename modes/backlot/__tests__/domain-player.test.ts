/**
 * The player's rules, away from React: the one clock, the lane resolution,
 * the layout algebra, the timeline geometry and address routing.
 *
 * These are the parts the agent and the user both depend on being the SAME
 * answer — `navigate-to`, `get-player-state`, a click on the rail and a click
 * on a check all funnel through them.
 */

import { describe, expect, test } from "bun:test";

import { parseShot, type Project, type Shot } from "../domain.js";
import {
  beatEdges,
  beatLinks,
  beatRows,
  defaultPair,
  extractPromptBlock,
  failedRanges,
  fitBox,
  formatFactor,
  formatSeconds,
  isPlayerStage,
  laneOfTarget,
  laneViews,
  nextEdge,
  parseAddress,
  planSideLayout,
  playheadLabel,
  positionAddress,
  prevEdge,
  probeFacts,
  resolveAddress,
  stagePair,
  takeLabel,
  tempoSpans,
  visibleLanes,
  withStageDefaults,
  type PlayerPosition,
  type ViewPosition,
} from "../viewer/player-model.js";
import { Playhead } from "../viewer/usePlayhead.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function shot(overrides: Record<string, unknown> = {}): Shot {
  return parseShot(
    "one-inch-of-wind/shots/lab-walk",
    "lab-walk",
    JSON.stringify({
      version: 1,
      id: "lab-walk",
      title: "The researcher wakes the device",
      entry: "original",
      spec: { seconds: 8, fps: 24, width: 1280, height: 720, frames: 192 },
      beats: [
        { id: "establish", label: "Doorway", from: 0, to: 0.5, kind: "hold" },
        { id: "walk", label: "Walks", from: 0.5, to: 3.8, kind: "action" },
        { id: "touch", label: "Raises a hand", from: 4.5, to: 5.5, kind: "action" },
        { id: "glow", label: "Brightens", from: 5.5, to: 7.5, kind: "trigger", causedBy: "touch" },
        { id: "push", label: "Pushes in", from: 0, to: 7.5, kind: "camera" },
      ],
      greybox: {
        revision: 2,
        final: {
          file: "greybox/greybox.mp4",
          revision: 2,
          probe: { width: 1280, height: 720, fps: 24, frames: 192, seconds: 8 },
        },
        glb: "greybox/scene.glb",
      },
      checks: [
        { id: "contact", label: "Hand reaches", target: "greybox", status: "fail", range: [4.5, 5.5] },
        { id: "camera-smooth", label: "No jitter", target: "greybox", status: "fail", range: null },
        { id: "take-order", label: "Glow follows", target: "take-01", status: "pass", range: [5.5, 7.5] },
      ],
      takes: [
        {
          id: "take-01",
          status: "done",
          model: "bytedance/seedance-2.5",
          resolution: "480p",
          seconds: 8,
          greyboxRevision: 2,
          file: "takes/take-01.mp4",
          probe: { width: 854, height: 480, fps: 24, frames: 193, seconds: 8.04 },
          selected: true,
        },
      ],
      ...overrides,
    }),
  )!;
}

const PROJECT = (s: Shot, extra: Partial<Project> = {}): Project => ({
  dir: "one-inch-of-wind",
  title: "One Inch of Wind",
  logline: "",
  defaults: { seconds: 8, fps: 24, width: 1280, height: 720 },
  gates: "closed",
  approvals: {},
  stages: [],
  scenes: [],
  characters: [],
  sets: [],
  shots: [s],
  sound: { music: null, lines: [] },
  cut: null,
  cost: [],
  idea: null,
  screenplay: null,
  warnings: [],
  ...extra,
});

const PLAYER_HERE: PlayerPosition = {
  shot: "lab-walk",
  lane: "greybox",
  take: "take-01",
  layout: "side",
  time: 2,
  range: null,
};

/** The whole viewer's position, with the player pointed at `PLAYER_HERE`. */
const HERE: ViewPosition = {
  stage: "previz",
  scene: null,
  character: null,
  set: null,
  line: null,
  segment: null,
  cutTime: 0,
  player: PLAYER_HERE,
};

// ── Lanes ───────────────────────────────────────────────────────────────────

describe("lanes", () => {
  test("a shot with no reference has two lanes; one with a reference has three", () => {
    expect(laneViews(shot(), null).map((l) => l.id)).toEqual(["greybox", "take"]);
    const withRef = shot({
      reference: {
        file: "reference/source.mp4",
        sourceName: "clip.mp4",
        in: 12.5,
        out: 20.5,
        probe: { width: 854, height: 480, fps: 24, frames: 193, seconds: 8.04 },
        cuts: [],
      },
    });
    expect(laneViews(withRef, null).map((l) => l.id)).toEqual(["reference", "greybox", "take"]);
  });

  test("a missing greybox is a NAMED empty lane, never a broken player", () => {
    const lane = laneViews(shot({ greybox: { revision: 0 } }), null)[0];
    expect(lane.kind).toBe("empty");
    expect(lane.file).toBeNull();
    expect(lane.note).toContain("No greybox");
  });

  test("a FREE shot's empty greybox lane says the plan worked, not that a step is missing", () => {
    // "Not rendered yet" on a shot that will never be blocked reads as
    // work still owed. It is not: the take is made from the sheets, the
    // style frame and the words.
    const lane = laneViews(shot({ conditioning: "free", greybox: { revision: 0 } }), null)[0];
    expect(lane.kind).toBe("empty");
    expect(lane.facts).toBe("free shot — no greybox");
    expect(lane.note).toContain("free shot — no greybox");
    expect(lane.note).not.toContain("No greybox has been rendered");
    // And the lane's badge agrees: not the "Nothing here yet" every other
    // empty lane wears, which reads as a render still owed.
    expect(lane.stateTitle).toBe("Not needed");
    // A free shot that DID render one for the reel plays it as usual.
    const forTheReel = laneViews(
      shot({
        conditioning: "free",
        greybox: { revision: 1, final: { file: "greybox/greybox.mp4", revision: 1, probe: null } },
      }),
      null,
    )[0];
    expect(forTheReel.kind).toBe("video");
  });

  test("a submitted take shows its state and its estimate, not a player", () => {
    // Invariant 6: paid work is recorded before it leaves, so the user must
    // be able to see the job that is running and what it will cost.
    const lane = laneViews(
      shot({
        takes: [
          {
            id: "take-02",
            status: "submitted",
            model: "bytedance/seedance-2.5",
            resolution: "720p",
            seconds: 8,
            fix: "hand must land on the button",
            cost: { usd: 4.54, basis: "(8 s out + 8 s ref) x $0.2838" },
          },
        ],
      }),
      null,
    ).at(-1)!;
    expect(lane.kind).toBe("waiting");
    expect(lane.facts).toContain("$4.54");
    expect(lane.note).toContain("hand must land on the button");
  });

  test("a failed take shows its reason", () => {
    const lane = laneViews(
      shot({ takes: [{ id: "take-03", status: "failed", error: "content filter" }] }),
      null,
    ).at(-1)!;
    expect(lane.kind).toBe("failed");
    expect(lane.note).toContain("content filter");
  });

  test("a done take with no file is failed, not a blank player", () => {
    const lane = laneViews(shot({ takes: [{ id: "take-04", status: "done" }] }), null).at(-1)!;
    expect(lane.kind).toBe("failed");
  });

  test("the lane header states what was MEASURED", () => {
    const lanes = laneViews(shot(), null);
    expect(lanes[0].facts).toContain("1280×720 · 24 fps · 192 f");
    // The take's 8.04 s against an 8 s spec is exactly the drift the player
    // has to clamp, so the header says it.
    expect(lanes[1].facts).toContain("8.04 s");
  });

  test("a lane with no probe says so rather than inventing numbers", () => {
    expect(probeFacts(null)).toBe("no probe recorded");
  });

  test("the take lane plays the take that was asked for", () => {
    const s = shot({
      takes: [
        { id: "take-01", status: "done", file: "takes/take-01.mp4", selected: true },
        { id: "take-02", status: "done", file: "takes/take-02.mp4" },
      ],
    });
    expect(laneViews(s, "take-02").at(-1)!.takeId).toBe("take-02");
    expect(laneViews(s, null).at(-1)!.takeId).toBe("take-01");
  });

  test("take-01 reads as Take 01", () => {
    expect(takeLabel("take-01")).toBe("Take 01");
    expect(takeLabel("hero")).toBe("hero");
  });
});

describe("layouts", () => {
  const lanes = laneViews(shot(), null);

  test("side shows every lane; solo shows A; two-up shows the pair", () => {
    expect(visibleLanes(lanes, "side", "greybox", "take")).toHaveLength(2);
    expect(visibleLanes(lanes, "solo", "take", "greybox").map((l) => l.id)).toEqual(["take"]);
    expect(visibleLanes(lanes, "wipe", "greybox", "take").map((l) => l.id)).toEqual([
      "greybox",
      "take",
    ]);
  });

  test("a pair naming a lane this shot does not have falls back to two real ones", () => {
    const pair = defaultPair(lanes);
    expect(pair.a).not.toBe(pair.b);
    expect(lanes.map((l) => l.id)).toContain(pair.a);
    expect(lanes.map((l) => l.id)).toContain(pair.b);
  });

  test("a 16:9 box fits inside a square pane without stretching", () => {
    expect(fitBox(400, 400, 16 / 9)).toEqual({ width: 400, height: 225 });
    expect(fitBox(400, 100, 16 / 9)).toEqual({ width: 178, height: 100 });
    expect(fitBox(0, 0, 16 / 9)).toEqual({ width: 0, height: 0 });
  });

  test("side stacks its lanes when that makes them bigger", () => {
    const chrome = { padding: 16, gap: 8, header: 46 };
    // Measured panes, 2026-09-20: chat open (680×700) and chat collapsed
    // (1240×700). The answer flips, which is why it is computed.
    expect(planSideLayout(680, 700, 16 / 9, 3, chrome).direction).toBe("column");
    expect(planSideLayout(1240, 700, 16 / 9, 3, chrome).direction).toBe("row");
  });

  test("a stacked card is sized by height, so three of them fit", () => {
    const chrome = { padding: 16, gap: 8, header: 46 };
    const plan = planSideLayout(680, 700, 16 / 9, 3, chrome);
    const cardHeight = plan.laneWidth! / (16 / 9) + chrome.header;
    expect(cardHeight * 3 + chrome.gap * 2).toBeLessThanOrEqual(700 - chrome.padding + 1);
  });

  test("one lane is always a row — there is nothing to stack", () => {
    expect(planSideLayout(400, 900, 16 / 9, 1, { padding: 0, gap: 0, header: 0 }).direction).toBe(
      "row",
    );
  });
});

// ── Timeline ────────────────────────────────────────────────────────────────

describe("timeline geometry", () => {
  const s = shot();

  test("rows are ordered and empty ones are not drawn", () => {
    expect(beatRows(s.beats).map((r) => r.kind)).toEqual(["action", "trigger", "camera", "hold"]);
    expect(beatRows(s.beats.filter((b) => b.kind === "camera")).map((r) => r.kind)).toEqual([
      "camera",
    ]);
  });

  test("a trigger beat links back to its cause, cause-end to effect-start", () => {
    // Invariant 5 drawn: the connector runs in the direction the order rule
    // reads, so an inversion is visible rather than merely recorded.
    const links = beatLinks(beatRows(s.beats));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ triggerId: "glow", causeId: "touch", fromTime: 5.5, toTime: 5.5 });
  });

  test("failed checks with a range paint that range; whole-shot failures do not", () => {
    const ranges = failedRanges(s.checks);
    expect(ranges.map((r) => r.id)).toEqual(["contact"]);
    expect(ranges[0]).toMatchObject({ from: 4.5, to: 5.5, target: "greybox" });
  });

  test("beat edges include both ends of the shot and are de-duplicated", () => {
    expect(beatEdges(s.beats, 8)).toEqual([0, 0.5, 3.8, 4.5, 5.5, 7.5, 8]);
  });

  test("[ and ] move to the next edge strictly, and stop at the ends", () => {
    const edges = beatEdges(s.beats, 8);
    expect(nextEdge(edges, 0)).toBe(0.5);
    expect(nextEdge(edges, 0.5)).toBe(3.8);
    expect(nextEdge(edges, 8)).toBe(8);
    expect(prevEdge(edges, 8)).toBe(7.5);
    expect(prevEdge(edges, 0)).toBe(0);
  });

  test("the tempo row draws the greybox's own time remap, in the shot's clock", () => {
    // The shot still runs 8 s — `slowmo` stretches the ACTION, not the
    // shot — so the row is spans on the same axis as the beats, never a
    // rescaling of them.
    const spans = tempoSpans(
      [
        { from: 5.5, to: 6.5, factor: 0.5 },
        { from: 1, to: 2, factor: 2 },
      ],
      8,
    );
    expect(spans.map((s) => [s.from, s.to, s.label, s.slow])).toEqual([
      [1, 2, "2×", false],
      [5.5, 6.5, "½×", true],
    ]);
  });

  test("a warp is clamped to the shot, and one entirely outside it is dropped", () => {
    // Pinning an out-of-range warp to the edge would draw a ramp the render
    // does not have; a zero-width block is not a tempo.
    expect(tempoSpans([{ from: 6, to: 12, factor: 0.5 }], 8).map((s) => [s.from, s.to])).toEqual([
      [6, 8],
    ]);
    expect(tempoSpans([{ from: 9, to: 12, factor: 0.5 }], 8)).toEqual([]);
    // A factor of 1 remaps nothing, and drawing "1×" would suggest the rest
    // of the shot is not.
    expect(tempoSpans([{ from: 1, to: 2, factor: 1 }], 8)).toEqual([]);
    expect(tempoSpans([], 8)).toEqual([]);
  });

  test("factors are printed the way an editor says them", () => {
    expect(formatFactor(0.5)).toBe("½×");
    expect(formatFactor(0.25)).toBe("¼×");
    expect(formatFactor(2)).toBe("2×");
    expect(formatFactor(1.25)).toBe("1.25×");
  });

  test("a check's target picks the lane the user is sent to", () => {
    expect(laneOfTarget("greybox")).toEqual({ lane: "greybox", take: null });
    expect(laneOfTarget("take-01")).toEqual({ lane: "take", take: "take-01" });
  });
});

// ── Readouts ────────────────────────────────────────────────────────────────

describe("readouts", () => {
  test("the readout is fixed width so it does not jump while playing", () => {
    expect(formatSeconds(3.8)).toBe("03.80");
    expect(formatSeconds(0)).toBe("00.00");
    expect(formatSeconds(12.345)).toBe("12.35");
  });

  test("the playhead label is the brief's", () => {
    expect(playheadLabel(3.8, shot().spec)).toBe("03.80 s · f 92 / 192");
  });

  test("the fenced prompt block is what the copy button copies", () => {
    const md = "# Pack\n\n## Prompt\n\n```prompt\nUse [Video1] as the reference.\n```\n\n## Notes\n";
    expect(extractPromptBlock(md)).toBe("Use [Video1] as the reference.");
    expect(extractPromptBlock("no fence here")).toBeNull();
  });
});

// ── Addresses ───────────────────────────────────────────────────────────────

describe("addresses", () => {
  const s = shot();
  const ctx = {
    contentSet: "one-inch-of-wind",
    projects: { "one-inch-of-wind": PROJECT(s) },
    contentSets: ["one-inch-of-wind"],
    position: HERE,
  };

  test("parseAddress ignores what it does not understand", () => {
    expect(parseAddress({ shot: "a", lane: "nope", time: "x", junk: 1 })).toEqual({ shot: "a" });
    expect(parseAddress("not an object")).toEqual({});
    expect(parseAddress({ range: [5, 2] })).toEqual({ range: [2, 5] });
  });

  test("an unknown shot is refused BY NAME and nothing moves", () => {
    const outcome = resolveAddress(ctx, { shot: "corridor" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain("corridor");
      expect(outcome.message).toContain("lab-walk");
    }
  });

  test("an unknown take is refused BY NAME", () => {
    const outcome = resolveAddress(ctx, { take: "take-09" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("take-09");
  });

  test("an unknown project is refused, and the known ones are listed", () => {
    const outcome = resolveAddress(ctx, { contentSet: "nowhere" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("one-inch-of-wind");
  });

  test("naming a take means showing it", () => {
    const outcome = resolveAddress(ctx, { take: "take-01" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.position.player.lane).toBe("take");
  });

  test("time is clamped to the shot, never past its end", () => {
    const outcome = resolveAddress(ctx, { time: 99 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.position.player.time).toBe(8);
  });

  test("a reference lane on a shot that has none lands on the greybox and says so", () => {
    const outcome = resolveAddress(ctx, { lane: "reference" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.position.player.lane).toBe("greybox");
  });

  test("an address that changes nothing keeps the viewer where it is", () => {
    const outcome = resolveAddress(ctx, {});
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.position).toEqual(HERE);
  });

  test("the reported address carries the frame, not only the second", () => {
    const address = positionAddress(
      "one-inch-of-wind",
      { ...HERE, player: { ...PLAYER_HERE, time: 3.8 } },
      s.spec,
    );
    expect(address).toMatchObject({
      contentSet: "one-inch-of-wind",
      stage: "previz",
      shot: "lab-walk",
      lane: "greybox",
      take: "take-01",
      time: 3.8,
      frame: 92,
      layout: "side",
    });
  });

  test("a marked range rides along when there is one", () => {
    expect(
      positionAddress("", { ...HERE, player: { ...PLAYER_HERE, range: [1, 2] } }, s.spec).range,
    ).toEqual([1, 2]);
    expect(positionAddress("", HERE, s.spec).range).toBeUndefined();
  });
});

// ── The eight stages ────────────────────────────────────────────────────────

describe("stage addressing", () => {
  const s = shot({
    scene: "sc1",
    board: { file: "board.png", revision: 1, prompt: "the doorway", refs: [], at: 10 },
    lines: [{ id: "l1", speaker: "kai", kind: "vo", text: "It is late.", at: 0.5, file: "sound/l1.mp3" }],
  });
  const project = PROJECT(s, {
    scenes: [{ id: "sc1", number: 1, heading: "INT. LAB — NIGHT", summary: "", shots: ["lab-walk"] }],
    characters: [
      { id: "kai", name: "Kai", description: "", look: "", sheet: null, voice: null, dir: "one-inch-of-wind/bible/characters/kai" },
    ],
    sets: [
      { id: "lab", name: "The lab", description: "", look: "", concept: null, dir: "one-inch-of-wind/bible/sets/lab" },
    ],
    sound: {
      music: null,
      lines: [
        {
          id: "l1",
          speaker: "kai",
          kind: "vo",
          text: "It is late.",
          at: 0.5,
          file: "sound/l1.mp3",
          seconds: 1.4,
          cost: null,
          shot: "lab-walk",
          shotTitle: s.title,
          shotDir: s.dir,
        },
      ],
    },
    cut: {
      kind: "reel",
      file: "reel.mp4",
      seconds: 16,
      builtAt: 7,
      probe: null,
      segments: [
        { shot: "lab-walk", source: "take-01", offset: 0, seconds: 8 },
        { shot: "corridor", source: "greybox", offset: 8, seconds: 8 },
      ],
      vo: [],
      music: null,
      finish: null,
    },
  });
  const ctx = {
    contentSet: "one-inch-of-wind",
    projects: { "one-inch-of-wind": project },
    contentSets: ["one-inch-of-wind"],
    position: HERE,
  };

  test("an address with no stage is a PREVIZ address — every old one still lands", () => {
    // The brief's appendix: `stage` defaults to previz when absent, which is
    // what keeps the addresses written before the other seven stages working.
    const outcome = resolveAddress({ ...ctx, position: { ...HERE, stage: "cut" } }, { time: 3 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.position.stage).toBe("previz");
      expect(outcome.position.player.time).toBe(3);
    }
  });

  test("parseAddress reads every key of the vocabulary", () => {
    expect(
      parseAddress({
        stage: "bible",
        character: "kai",
        set: "lab",
        line: "l1",
        segment: "lab-walk",
        scene: 2,
      }),
    ).toEqual({ stage: "bible", character: "kai", set: "lab", line: "l1", segment: "lab-walk", scene: 2 });
    expect(parseAddress({ stage: "nowhere" })).toEqual({});
  });

  test("a scene can be named by its id or by its number", () => {
    for (const scene of ["sc1", 1] as const) {
      const outcome = resolveAddress(ctx, { stage: "script", scene });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.position.scene).toBe("sc1");
    }
  });

  test("an unknown scene, character, set, line or segment is refused BY NAME", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ scene: "sc9" }, "sc9"],
      [{ character: "nobody" }, "nobody"],
      [{ set: "nowhere" }, "nowhere"],
      [{ line: "l9" }, "l9"],
      [{ segment: "missing" }, "missing"],
    ];
    for (const [address, needle] of cases) {
      const outcome = resolveAddress(ctx, address);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.message).toContain(needle);
    }
  });

  test("naming a cut segment parks the cut's playhead where it starts", () => {
    const outcome = resolveAddress(ctx, { stage: "cut", segment: "corridor" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.position.segment).toBe("corridor");
      expect(outcome.position.cutTime).toBe(8);
      // The shot clock is a different clock and does not move.
      expect(outcome.position.player.time).toBe(HERE.player.time);
    }
  });

  test("a second on the cut stage is a second of the CUT, not of the shot", () => {
    const outcome = resolveAddress(ctx, { stage: "cut", time: 12 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.position.cutTime).toBe(12);
      expect(outcome.position.player.time).toBe(HERE.player.time);
    }
    const past = resolveAddress(ctx, { stage: "cut", time: 99 });
    if (past.ok) expect(past.position.cutTime).toBe(16);
  });

  test("the reported address only carries keys that mean something on the stage", () => {
    const bible = positionAddress("one-inch-of-wind", { ...HERE, stage: "bible", character: "kai" }, s.spec);
    expect(bible).toEqual({ contentSet: "one-inch-of-wind", stage: "bible", character: "kai" });

    const cut = positionAddress(
      "one-inch-of-wind",
      { ...HERE, stage: "cut", segment: "corridor", cutTime: 8.5 },
      s.spec,
    );
    expect(cut).toEqual({
      contentSet: "one-inch-of-wind",
      stage: "cut",
      segment: "corridor",
      time: 8.5,
    });
  });

  test("a shot with a board gets a board lane; a still, not a player", () => {
    const lanes = laneViews(s, null);
    expect(lanes.map((l) => l.id)).toEqual(["board", "greybox", "take"]);
    expect(lanes[0].kind).toBe("image");
    expect(lanes[0].file).toBe("board.png");
  });

  test("Takes opens with the take over the greybox; Previz opens on the greybox", () => {
    const toTakes = withStageDefaults({ ...HERE, stage: "takes" }, "previz", {});
    expect(toTakes.player.lane).toBe("take");
    expect(toTakes.player.layout).toBe("wipe");
    expect(stagePair("takes", laneViews(s, null))).toEqual({ a: "take", b: "greybox" });

    const back = withStageDefaults({ ...toTakes, stage: "previz" }, "takes", {});
    expect(back.player.lane).toBe("greybox");
    expect(back.player.layout).toBe("side");
  });

  test("an explicit lane or layout is never overridden by a stage default", () => {
    const named = withStageDefaults({ ...HERE, stage: "takes" }, "previz", {
      lane: "greybox",
      layout: "solo",
    });
    expect(named.player.lane).toBe("greybox");
    expect(named.player.layout).toBe("solo");
  });

  test("only previz and takes are player stages", () => {
    expect(isPlayerStage("previz")).toBe(true);
    expect(isPlayerStage("takes")).toBe(true);
    for (const stage of ["idea", "script", "bible", "boards", "sound", "cut"] as const) {
      expect(isPlayerStage(stage)).toBe(false);
    }
  });
});

// ── The one clock ───────────────────────────────────────────────────────────

describe("the clock", () => {
  test("stepping snaps to the frame grid and pauses", () => {
    const clock = new Playhead(8, 24);
    clock.seek(3.817);
    clock.play();
    clock.stepFrames(1);
    expect(clock.getSnapshot().playing).toBe(false);
    // round(3.817 × 24) = 92, + 1 frame = 93 → 93/24.
    expect(clock.getTime()).toBeCloseTo(93 / 24, 6);
  });

  test("a frame step never leaves the shot", () => {
    const clock = new Playhead(8, 24);
    clock.stepFrames(-1);
    expect(clock.getTime()).toBe(0);
    clock.seek(8);
    clock.stepFrames(1);
    expect(clock.getTime()).toBe(8);
  });

  test("seeking is clamped to the shot", () => {
    const clock = new Playhead(8, 24);
    clock.seek(-5);
    expect(clock.getTime()).toBe(0);
    clock.seek(99);
    expect(clock.getTime()).toBe(8);
  });

  test("playing from the end restarts rather than doing nothing", () => {
    const clock = new Playhead(8, 24);
    clock.seek(8);
    clock.play();
    expect(clock.getTime()).toBe(0);
  });

  test("a beat loop restarts inside its own window", () => {
    const clock = new Playhead(8, 24);
    clock.setLoopWindow([4.5, 5.5]);
    clock.setLoop("beat");
    clock.seek(5.5);
    clock.play();
    expect(clock.getTime()).toBeCloseTo(4.5, 6);
  });

  test("subscribers are told immediately and on every change", () => {
    const clock = new Playhead(8, 24);
    const seen: number[] = [];
    const off = clock.subscribe((s) => seen.push(s.time));
    clock.seek(1);
    clock.seek(2);
    off();
    clock.seek(3);
    expect(seen).toEqual([0, 1, 2]);
  });

  test("a shot switch re-clamps a playhead past the new end", () => {
    const clock = new Playhead(12, 24);
    clock.seek(11);
    clock.rebind(8, 24);
    expect(clock.getTime()).toBe(8);
    expect(clock.duration).toBe(8);
  });

  test("the rate is state, not a re-seek", () => {
    const clock = new Playhead(8, 24);
    clock.setRate(0.25);
    expect(clock.getSnapshot().rate).toBe(0.25);
    expect(clock.getTime()).toBe(0);
  });
});
