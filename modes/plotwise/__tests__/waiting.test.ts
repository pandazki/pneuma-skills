/**
 * A wait on the stage must say what is happening and must be able to end
 * badly: the first live course showed "正在拍摄" over a node whose producer
 * had died, and "导演正在准备下一步" over continuations that were on disk.
 */

import { describe, expect, test } from "bun:test";
import { fmtElapsed, managerSilent, phaseLabel, productionLabel, productionState, shotAt, waitState, MANAGER_SILENT_MS, PREPARING_STALE_MS, PRODUCTION_STALE_MS } from "../viewer/waiting.js";

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
  test("names the shot being made when a scene has more than one", () => {
    expect(productionLabel({ status: "generating", phase: "shoot", shotIndex: 2, shotCount: 3 })).toBe("拍摄中 2/3");
    expect(productionLabel({ status: "generating", phase: "qa", shotIndex: 3, shotCount: 3 })).toBe("质检中 3/3");
    expect(productionLabel({ status: "generating", phase: "shoot", shotIndex: 1, shotCount: 1 })).toBe("拍摄中");
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

describe("shotAt", () => {
  const shots = [
    { duration: 10, video: { file: "s1.mp4", duration: 9.5 } },
    { duration: 12, video: undefined },
    { duration: 8, video: { file: "s3.mp4", duration: 8.2 } },
  ];
  test("follows the measured durations, planned ones when a shot has no clip", () => {
    expect(shotAt(shots, 0)).toBe(0);
    expect(shotAt(shots, 9.4)).toBe(0);
    expect(shotAt(shots, 9.6)).toBe(1);
    expect(shotAt(shots, 21.4)).toBe(1);
    expect(shotAt(shots, 21.6)).toBe(2);
  });
  test("past the end stays on the last shot; no shots is shot 0", () => {
    expect(shotAt(shots, 99)).toBe(2);
    expect(shotAt([], 5)).toBe(0);
  });
});
