/**
 * The player's rules, away from React: the one clock, the lane resolution,
 * the layout algebra, the timeline geometry and address routing.
 *
 * These are the parts the agent and the user both depend on being the SAME
 * answer — `navigate-to`, `get-player-state`, a click on the rail and a click
 * on a check all funnel through them.
 */

import { describe, expect, test } from "bun:test";

import { parseShot, type Shot } from "../domain.js";
import {
  beatEdges,
  beatLinks,
  beatRows,
  defaultPair,
  extractPromptBlock,
  failedRanges,
  fitBox,
  formatSeconds,
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
  takeLabel,
  visibleLanes,
  type StagePosition,
} from "../viewer/stage-model.js";
import { Playhead } from "../viewer/usePlayhead.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function shot(overrides: Record<string, unknown> = {}): Shot {
  return parseShot(
    "first-light/shots/lab-walk",
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

const PROJECT = (s: Shot) => ({
  dir: "first-light",
  title: "First Light",
  defaults: { seconds: 8, fps: 24, width: 1280, height: 720 },
  shots: [s],
  warnings: [],
});

const HERE: StagePosition = {
  shot: "lab-walk",
  lane: "greybox",
  take: "take-01",
  layout: "side",
  time: 2,
  range: null,
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
    contentSet: "first-light",
    projects: { "first-light": PROJECT(s) },
    contentSets: ["first-light"],
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
    if (!outcome.ok) expect(outcome.message).toContain("first-light");
  });

  test("naming a take means showing it", () => {
    const outcome = resolveAddress(ctx, { take: "take-01" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.position.lane).toBe("take");
  });

  test("time is clamped to the shot, never past its end", () => {
    const outcome = resolveAddress(ctx, { time: 99 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.position.time).toBe(8);
  });

  test("a reference lane on a shot that has none lands on the greybox and says so", () => {
    const outcome = resolveAddress(ctx, { lane: "reference" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.position.lane).toBe("greybox");
  });

  test("an address that changes nothing keeps the stage where it is", () => {
    const outcome = resolveAddress(ctx, {});
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.position).toEqual(HERE);
  });

  test("the reported address carries the frame, not only the second", () => {
    const address = positionAddress("first-light", { ...HERE, time: 3.8 }, s.spec);
    expect(address).toMatchObject({
      contentSet: "first-light",
      shot: "lab-walk",
      lane: "greybox",
      take: "take-01",
      time: 3.8,
      frame: 92,
      layout: "side",
    });
  });

  test("a marked range rides along when there is one", () => {
    expect(positionAddress("", { ...HERE, range: [1, 2] }, s.spec).range).toEqual([1, 2]);
    expect(positionAddress("", HERE, s.spec).range).toBeUndefined();
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
