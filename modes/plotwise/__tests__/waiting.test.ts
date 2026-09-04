/**
 * A wait on the stage must say what is happening and must be able to end
 * badly: the first live course showed "正在拍摄" over a node whose producer
 * had died, and "导演正在准备下一步" over continuations that were on disk.
 */

import { describe, expect, test } from "bun:test";
import { fmtElapsed, lineAt, managerSilent, phaseLabel, productionLabel, productionState, waitState, MANAGER_SILENT_MS, PREPARING_STALE_MS, PRODUCTION_STALE_MS } from "../viewer/waiting.js";

const T0 = Date.parse("2026-09-02T10:00:00Z");

describe("productionState", () => {
  test("a generating node reports its phase and how long since the producer started", () => {
    const s = productionState({ status: "generating", startedAt: "2026-09-02T10:00:00Z", phase: "shoot" }, null, T0 + 65_000);
    expect(s).toEqual({ kind: "running", phase: "shoot", elapsedMs: 65_000, stale: false });
  });

  test("a segment the learner asked for before it existed counts from the request", () => {
    const s = productionState({ status: "planned" }, T0, T0 + 10_000);
    expect(s).toEqual({ kind: "running", phase: undefined, elapsedMs: 10_000, stale: false });
  });

  test("the producer's own start wins over the viewer's memory", () => {
    const s = productionState({ status: "generating", startedAt: "2026-09-02T10:01:00Z", phase: "script" }, T0, T0 + 90_000);
    expect(s.kind === "running" && s.elapsedMs).toBe(30_000);
  });

  test("past the stale line the wait is presumed stuck", () => {
    const s = productionState({ status: "generating", startedAt: "2026-09-02T10:00:00Z", phase: "qa" }, null, T0 + PRODUCTION_STALE_MS + 1);
    expect(s.kind === "running" && s.stale).toBe(true);
  });

  test("a failed node carries the producer's reason", () => {
    expect(productionState({ status: "failed", error: "narration QA failed twice" }, null, T0)).toEqual({ kind: "failed", error: "narration QA failed twice" });
  });

  test("a scene queued or being written is a wait too", () => {
    expect(productionState({ status: "queued" }, null, T0).kind).toBe("running");
    expect(productionState({ status: "scripting", startedAt: "2026-09-02T10:00:00Z", phase: "script" }, null, T0 + 5_000)).toEqual({ kind: "running", phase: "script", elapsedMs: 5_000, stale: false });
  });

  test("a ready or planned node that nobody asked for is not waiting", () => {
    expect(productionState({ status: "ready" }, null, T0)).toEqual({ kind: "idle" });
    expect(productionState({ status: "planned" }, null, T0)).toEqual({ kind: "idle" });
  });
});

describe("waitState / labels", () => {
  test("the preparing wait goes stale after its own line", () => {
    expect(waitState(T0, T0 + 20_000)).toEqual({ elapsedMs: 20_000, stale: false });
    expect(waitState(T0, T0 + PREPARING_STALE_MS + 1).stale).toBe(true);
  });
  test("elapsed reads as m:ss", () => {
    expect(fmtElapsed(0)).toBe("0:00");
    expect(fmtElapsed(65_000)).toBe("1:05");
    expect(fmtElapsed(600_000)).toBe("10:00");
  });
  test("phases have learner-facing names, and no phase reads as shooting", () => {
    expect(phaseLabel("script")).toBe("写稿中");
    expect(phaseLabel("qa")).toBe("质检中");
    expect(phaseLabel(undefined)).toBe("拍摄中");
  });
});

describe("productionLabel", () => {
  test("counts the clip being made when a scene is more than one", () => {
    expect(productionLabel({ status: "generating", phase: "shoot", clipIndex: 2, clipCount: 3 })).toBe("拍摄中 2/3");
    expect(productionLabel({ status: "generating", phase: "qa", clipIndex: 3, clipCount: 3 })).toBe("质检中 3/3");
    expect(productionLabel({ status: "generating", phase: "shoot", clipIndex: 1, clipCount: 1 })).toBe("拍摄中");
    expect(productionLabel({ status: "generating", phase: undefined })).toBe("拍摄中");
  });
  test("queued and scripting scenes say so, whatever their phase field", () => {
    expect(productionLabel({ status: "queued" })).toBe("排队中");
    expect(productionLabel({ status: "scripting", phase: "script" })).toBe("写稿中");
  });
});

describe("managerSilent", () => {
  const play = { updatedAt: "2026-09-02T10:00:00Z" };
  test("a heartbeat that stops while work is pending is silence", () => {
    expect(managerSilent(play, true, T0 + 30_000)).toEqual({ silent: false, sinceMs: 30_000 });
    expect(managerSilent(play, true, T0 + MANAGER_SILENT_MS + 1).silent).toBe(true);
  });
  test("nothing pending, or no manager yet, is not silence", () => {
    expect(managerSilent(play, false, T0 + MANAGER_SILENT_MS + 1).silent).toBe(false);
    expect(managerSilent(undefined, true, T0 + MANAGER_SILENT_MS + 1)).toEqual({ silent: false, sinceMs: null });
  });
});

/**
 * The caption's lookup. A scene's video is its clips concatenated, so a
 * playhead first picks the clip (by measured length, planned when a clip
 * has not been shot yet) and then the narration line inside it — the
 * montage's whole point is that one clip says several things.
 */
describe("lineAt", () => {
  const clips = [
    // 0 → 14.6
    {
      duration: 15,
      video: { file: "c1.mp4", duration: 14.6 },
      narration: [
        { from: 0, to: 3, text: "a" },
        { from: 3, to: 8, text: "b" },
        { from: 8, to: 14, text: "c" },
      ],
    },
    // 14.6 → 26.6 (not shot yet: the planned length carries it)
    {
      duration: 12,
      video: undefined,
      narration: [
        { from: 0, to: 4, text: "d" },
        { from: 6, to: 11, text: "e" },
      ],
    },
    // 26.6 → 42
    { duration: 15, video: { file: "c3.mp4", duration: 15.4 }, narration: [{ from: 0, to: 5, text: "f" }] },
  ];
  const at = (t: number) => {
    const p = lineAt(clips, t);
    return `${p.clip}:${p.line}`;
  };

  test("walks the narration lines inside the first clip", () => {
    expect(at(0)).toBe("0:0");
    expect(at(2.9)).toBe("0:0");
    expect(at(3.1)).toBe("0:1");
    expect(at(13.9)).toBe("0:2");
  });

  test("crosses into the next clip by the clips before it, measured or planned", () => {
    expect(at(14.5)).toBe("0:2");
    expect(at(14.7)).toBe("1:0");
    expect(at(21)).toBe("1:1");
    expect(at(26.5)).toBe("1:1");
    expect(at(27)).toBe("2:0");
  });

  test("a silence holds the last line spoken, in the clip and past its end", () => {
    // clip 1's lines are [0,4) and [6,11): 5 s in, nobody is speaking.
    expect(at(19.6)).toBe("1:0");
    // clip 0's last line ends at 14, the clip runs to 14.6.
    expect(at(14.2)).toBe("0:2");
  });

  test("past the end of the scene stays on the last clip's last line", () => {
    expect(at(99)).toBe("2:0");
  });

  test("no clips, or a clip with nothing spoken, is line 0 — the caption falls back to the scene", () => {
    expect(lineAt([], 5)).toEqual({ clip: 0, line: 0 });
    expect(lineAt([{ duration: 15, narration: [] }], 7)).toEqual({ clip: 0, line: 0 });
  });

  test("a pre-0.6 scene — one clip per shot, one line each — reads as the shot being spoken", () => {
    const legacy = [
      { duration: 6, video: { file: "s1.mp4", duration: 6.6 }, narration: [{ from: 0, to: 6, text: "one" }] },
      { duration: 8, video: { file: "s2.mp4", duration: 8 }, narration: [{ from: 0, to: 8, text: "two" }] },
      { duration: 8, video: { file: "s3.mp4", duration: 8 }, narration: [{ from: 0, to: 8, text: "three" }] },
    ];
    expect(lineAt(legacy, 0)).toEqual({ clip: 0, line: 0 });
    expect(lineAt(legacy, 6.4)).toEqual({ clip: 0, line: 0 });
    expect(lineAt(legacy, 7)).toEqual({ clip: 1, line: 0 });
    expect(lineAt(legacy, 15)).toEqual({ clip: 2, line: 0 });
    expect(lineAt(legacy, 22.5)).toEqual({ clip: 2, line: 0 });
  });
});
