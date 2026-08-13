/**
 * The pre-mixed track end to end, through the REAL engine (T10-5).
 *
 * `track.test.ts` pins the arithmetic against hand-built windows; this
 * file pins the thing that actually protects the user: that a track mixed
 * for one board is REFUSED by a board that has since changed. The host's
 * verdict is fifteen lines of glue over `layOutTrack` + `verifyTrack`, and
 * the mechanism it depends on — one appended sentence shifting every later
 * position — is only visible through a real compile, so that is what runs
 * here.
 *
 * DOM-free: `buildTimeline` without measurements never touches a document
 * (the `determinism-probe.ts` precedent). The absolute positions below are
 * therefore NOT the browser's — the live compile also consumes measured
 * wall geometry — which is exactly why the viewer recomputes the layout
 * from its own compile instead of trusting either number.
 */

import { describe, expect, test } from "bun:test";

import { parseLecture, loadBoard, type Board } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { buildTimeline } from "../engine/timeline.js";
import { buildNarrationPlan } from "../narration/plan.js";
import { clipWindows, createNarrationHook } from "../narration/timing.js";
import { layOutTrack, verifyTrack } from "../narration/track.js";
import type { NarrationManifest } from "../narration/types.js";
import { collectFindings } from "../viewer/board-check.js";

const SR = 48000;

const SOURCE = `# 光学

第一段讲的是角膜。

第二段讲的是晶状体。

第三段讲的是视网膜。
`;

/**
 * A manifest keyed by the board's OWN hashes. The narration plan is the
 * product's route to them (`narrate` answers with exactly these keys), so
 * the fixture cannot drift from the engine.
 */
function manifestFor(source: string, seconds: (i: number) => number) {
  const plan = buildNarrationPlan(parseLecture(source, "set"), null, new Set());
  const clips = Object.fromEntries(
    plan.entries.map((e, i) => [
      e.hash,
      { file: `narration/${e.hash}.mp3`, seconds: seconds(i), text: e.text },
    ]),
  );
  return { clips } as NarrationManifest;
}

/** Compile a board with a manifest and return its clip windows + duration. */
function compile(source: string, manifest: NarrationManifest) {
  const lecture = parseLecture(source, "set");
  const hook = createNarrationHook(lecture.source, manifest);
  const timeline = buildTimeline(lecture, {
    durations: DEFAULT_DURATIONS,
    ...(hook ? { durationOverride: hook.durationOverride } : {}),
  });
  return {
    windows: hook ? clipWindows(timeline.schedule, hook.applied) : [],
    duration: timeline.duration,
  };
}

describe("a track is refused by a board that moved under it", () => {
  test("an appended sentence shifts later clips and the track goes stale", () => {
    const before = compile(SOURCE, manifestFor(SOURCE, (i) => 3 + i));
    expect(before.windows.length).toBeGreaterThan(1);
    const recorded = layOutTrack(before.windows, before.duration, SR);

    // The board still agrees with itself.
    expect(verifyTrack(recorded, recorded).ok).toBe(true);

    // Now the agent appends one sentence in the MIDDLE. Every later clip
    // moves; the track's own positions are unchanged.
    const grown = SOURCE.replace(
      "第二段讲的是晶状体。",
      "第二段讲的是晶状体。\n\n插进来的一句话。",
    );
    const after = compile(grown, manifestFor(grown, (i) => 3 + i));
    const live = layOutTrack(after.windows, after.duration, SR);
    const verdict = verifyTrack(recorded, live);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBeTruthy();
  });

  test("the same board recompiled agrees with itself to the sample", () => {
    const manifest = manifestFor(SOURCE, () => 4);
    const a = compile(SOURCE, manifest);
    const b = compile(SOURCE, manifest);
    const layoutA = layOutTrack(a.windows, a.duration, SR);
    const layoutB = layOutTrack(b.windows, b.duration, SR);
    expect(layoutA.clips.map((c) => c.offset)).toEqual(
      layoutB.clips.map((c) => c.offset),
    );
    expect(verifyTrack(layoutA, layoutB, 0)).toEqual({ ok: true, reason: null });
  });
});

describe("the board reads the track sidecar off the same source ride", () => {
  test("loadBoard picks up narration/track.json per content set", () => {
    const sidecar = JSON.stringify({
      file: "narration/track.mp3",
      sampleRate: SR,
      samples: 10 * SR,
      clips: [{ hash: "a", offset: SR, samples: SR, start: 1, holdAt: null }],
    });
    const board = loadBoard([
      { path: "set/board.md", content: SOURCE },
      { path: "set/narration/track.json", content: sidecar },
    ]) as Board;
    expect(board.track.set?.manifest?.file).toBe("narration/track.mp3");
    expect(board.track.set?.issue).toBeNull();
  });

  test("a board with no sidecar is the ordinary no-track state", () => {
    const board = loadBoard([
      { path: "board.md", content: SOURCE },
    ]) as Board;
    expect(board.track[""]).toEqual({ manifest: null, issue: null });
  });

  test("a malformed sidecar carries its reason instead of hiding", () => {
    const board = loadBoard([
      { path: "board.md", content: SOURCE },
      { path: "narration/track.json", content: "{ not json" },
    ]) as Board;
    expect(board.track[""]?.manifest).toBeNull();
    expect(board.track[""]?.issue).toContain("not valid JSON");
  });
});

describe("a refused track is said out loud", () => {
  test("check-board reports staleTrack with the reason quoted", () => {
    const findings = collectFindings(parseLecture(SOURCE, "set"), {
      mathErrors: [],
      overflowing: [],
      staleTrack: "clip b sits 1.40s away from where the board now performs it",
    });
    const stale = findings.filter((f) => f.code === "staleTrack");
    expect(stale).toHaveLength(1);
    expect(stale[0]!.excerpt).toContain("1.40s");
    // Board-level: there is no one step to blame for a whole track.
    expect(stale[0]!.address).toBeUndefined();
  });

  test("no track and a fresh track both report nothing", () => {
    for (const staleTrack of [null, undefined]) {
      const findings = collectFindings(parseLecture(SOURCE, "set"), {
        mathErrors: [],
        overflowing: [],
        staleTrack,
      });
      expect(findings.filter((f) => f.code === "staleTrack")).toHaveLength(0);
    }
  });
});
